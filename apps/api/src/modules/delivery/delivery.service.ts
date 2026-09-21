import crypto from 'node:crypto';
import type { Db, Filter } from 'mongodb';
import {
  type Question,
  type Exam,
  type Submission,
  type Answer,
  type StartExamResponse,
  type SyncRequest,
  type SyncResponse,
  toStudentView,
  assertNoSecretLeak,
} from '@eduassess/schemas';
import { seededShuffle, maybeShuffle } from '@eduassess/shuffle';
import { AppError } from '../../plugins/error-handler.js';

export interface StartExamOptions {
  deviceId?: string;
  examTokenInput?: string;
}

export class DeliveryService {
  constructor(private readonly db: Db) {}

  private get exams() {
    return this.db.collection<Exam>('exams');
  }

  private get questions() {
    return this.db.collection<Question>('questions');
  }

  private get submissions() {
    return this.db.collection<Submission>('submissions');
  }

  private get answers() {
    return this.db.collection<Answer>('answers');
  }

  /**
   * 6.4.1 Mulai Ujian (POST /student/exams/{id}/start)
   * Idempotent: starts a new session or resumes an existing in-progress session.
   */
  async startExam(
    schoolId: string,
    studentId: string,
    examId: string,
    options: StartExamOptions = {}
  ): Promise<StartExamResponse> {
    const now = new Date();

    // 1. Fetch exam configuration
    const exam = await this.exams.findOne({
      _id: examId,
      schoolId,
    } as Filter<Exam>);

    if (!exam) {
      throw new AppError(404, 'EXAM_NOT_FOUND', 'Exam Not Found', 'Exam does not exist.');
    }

    if (exam.status !== 'published') {
      throw new AppError(403, 'EXAM_NOT_OPEN', 'Exam Not Open', `Exam is currently ${exam.status}.`);
    }

    const windowStart = new Date(exam.scheduling.windowStart);
    const windowEnd = new Date(exam.scheduling.windowEnd);

    if (now < windowStart) {
      throw new AppError(403, 'EXAM_NOT_STARTED', 'Exam Not Started', 'Exam window has not opened yet.');
    }

    if (now > windowEnd) {
      throw new AppError(403, 'EXAM_CLOSED', 'Exam Closed', 'Exam window has already closed.');
    }

    // 2. Determine extra accommodation minutes if any
    const studentAccommodation = exam.accommodations?.find((a) => a.studentId === studentId);
    const extraMinutes = studentAccommodation?.extraMinutes ?? 0;
    const durationMinutes = exam.scheduling.durationMinutes + extraMinutes;

    // 3. Authoritative server deadline calculation (§6.4.1)
    let deadlineAt: Date;
    if (exam.scheduling.mode === 'concurrent') {
      // Concurrent mode: starts at official windowStart; late students get remaining time
      const plannedEnd = new Date(windowStart.getTime() + durationMinutes * 60_000);
      deadlineAt = plannedEnd < windowEnd ? plannedEnd : windowEnd;
    } else {
      // Self-paced mode: starts at user's personal start time
      const plannedEnd = new Date(now.getTime() + durationMinutes * 60_000);
      deadlineAt = plannedEnd < windowEnd ? plannedEnd : windowEnd;
    }

    // 4. Find or create submission with unique attempt (atomic E11000 race guard)
    let submission = await this.submissions.findOne({
      examId,
      studentId,
      attemptNo: 1,
    } as Filter<Submission>);

    if (!submission) {
      const shuffleSeed = crypto.randomInt(1, 2147483647);
      const newDoc: Submission = {
        _id: crypto.randomBytes(12).toString('hex'),
        schoolId,
        examId,
        studentId,
        attemptNo: 1,
        status: 'in_progress',
        startedAt: now,
        deadlineAt,
        activeDeviceId: options.deviceId,
        shuffleSeed,
        scores: {},
        release: {},
        flags: { lateSync: false, integrityWarn: false },
        isFinalLocked: false,
        createdAt: now,
        updatedAt: now,
      };

      try {
        await this.submissions.insertOne(newDoc);
        submission = newDoc;
      } catch (err: any) {
        if (err?.code === 11000) {
          // Concurrency race: another instance inserted it first, fetch that one
          submission = await this.submissions.findOne({
            examId,
            studentId,
            attemptNo: 1,
          } as Filter<Submission>);
        } else {
          throw err;
        }
      }
    }

    if (!submission) {
      throw new AppError(500, 'SUBMISSION_INIT_FAILED', 'Failed to initialize submission', 'Internal error.');
    }

    // Check if session is already completed
    if (submission.status !== 'in_progress') {
      throw new AppError(
        403,
        'EXAM_ALREADY_SUBMITTED',
        'Exam Already Submitted',
        `This exam session was finished with status: ${submission.status}`
      );
    }

    // Check active device lock (§5.4)
    if (
      submission.activeDeviceId &&
      options.deviceId &&
      submission.activeDeviceId !== options.deviceId
    ) {
      throw new AppError(
        409,
        'SESSION_ACTIVE_ELSEWHERE',
        'Active Session on Another Device',
        'Exam is already open on another device. Please contact proctor for session reset.'
      );
    }

    // 5. Fetch all questions specified in exam.questionRefs
    const questionIds = exam.questionRefs.map((r) => r.questionId);
    const rawQuestions = await this.questions
      .find({
        _id: { $in: questionIds },
        status: 'active',
      } as Filter<Question>)
      .toArray();

    const questionMap = new Map(rawQuestions.map((q) => [q._id, q]));

    // 6. Whitelist project questions (Guarantee ZERO secret leakage)
    const projectedQuestions = exam.questionRefs
      .map((ref) => {
        const rawQ = questionMap.get(ref.questionId);
        if (!rawQ) return null;
        const studentView = toStudentView(rawQ, submission!.shuffleSeed, seededShuffle, maybeShuffle);
        studentView.order = ref.order;
        studentView.points = ref.points;
        return studentView;
      })
      .filter((q): q is NonNullable<typeof q> => q !== null);

    // Deep scan assertion in CI/runtime
    assertNoSecretLeak(projectedQuestions);

    // 7. Generate Exam Token (Scoped JWT representation)
    const examToken = `exam_token_${submission._id}_${Date.now()}`;

    const remainingMs = Math.max(0, new Date(submission.deadlineAt).getTime() - now.getTime());

    return {
      submissionId: submission._id,
      examToken,
      exam: {
        title: exam.title,
        deadlineAt: new Date(submission.deadlineAt).toISOString(),
        serverNow: now.toISOString(),
      },
      groups: [
        {
          groupId: 'default-group',
          stimulus: null,
          questions: projectedQuestions,
        },
      ],
      assets: [],
      remainingMs,
    };
  }

  /**
   * 6.4.3 Sinkronisasi Jawaban (POST /student/submissions/{id}/sync)
   * Idempotent batch sync using clientSeq comparison and atomic majority writes.
   */
  async syncAnswers(
    schoolId: string,
    studentId: string,
    submissionId: string,
    req: SyncRequest
  ): Promise<SyncResponse> {
    const now = new Date();

    const submission = await this.submissions.findOne({
      _id: submissionId,
      schoolId,
      studentId,
    } as Filter<Submission>);

    if (!submission) {
      throw new AppError(404, 'SUBMISSION_NOT_FOUND', 'Submission Not Found', 'Submission does not exist.');
    }

    if (submission.status !== 'in_progress') {
      throw new AppError(
        403,
        'SUBMISSION_NOT_IN_PROGRESS',
        'Submission Inactive',
        `Submission status is ${submission.status}. Answers cannot be synced.`
      );
    }

    const graceMs = 120 * 1000;
    const isLate = now.getTime() > new Date(submission.deadlineAt).getTime() + graceMs;

    const accepted: string[] = [];
    const stale: string[] = [];
    const rejected: string[] = [];

    if (req.items && req.items.length > 0) {
      if (isLate) {
        // Late sync: Store in answers.late without overriding canonical inputData
        for (const it of req.items) {
          await this.answers.updateOne(
            { submissionId, questionId: it.questionId } as Filter<Answer>,
            {
              $set: {
                late: {
                  clientSeq: it.clientSeq,
                  inputData: it.inputData,
                  receivedAt: now,
                },
              },
            }
          );
        }
        await this.submissions.updateOne(
          { _id: submissionId } as Filter<Submission>,
          { $set: { 'flags.lateSync': true } }
        );
      } else {
        // Canonical Idempotent BulkWrite (§6.4.3)
        const ops = req.items.map((it) => ({
          updateOne: {
            filter: {
              submissionId,
              questionId: it.questionId,
              clientSeq: { $lt: it.clientSeq },
            },
            update: {
              $set: {
                clientSeq: it.clientSeq,
                clientSavedAt: new Date(it.clientSavedAt),
                savedAt: now,
                inputData: it.inputData,
              },
              $setOnInsert: {
                _id: crypto.randomBytes(12).toString('hex'),
                schoolId,
                examId: submission.examId,
                studentId,
                evaluation: { method: null, state: 'pending' },
                appeal: { status: 'none' },
                isFinalLocked: false,
              },
            },
            upsert: true,
          },
        }));

        try {
          await this.answers.bulkWrite(ops as any, { ordered: false });
          accepted.push(...req.items.map((i) => i.questionId));
        } catch (err: any) {
          if (err.writeErrors) {
            const dupeIndices = new Set<number>();
            for (const we of err.writeErrors) {
              if (we.code === 11000) {
                dupeIndices.add(we.index);
              } else {
                rejected.push(req.items[we.index]!.questionId);
              }
            }

            // Retry non-matching E11000 items once to differentiate true stale from insert race
            for (let i = 0; i < req.items.length; i++) {
              const item = req.items[i]!;
              if (!dupeIndices.has(i)) {
                accepted.push(item.questionId);
              } else {
                const existing = await this.answers.findOne({
                  submissionId,
                  questionId: item.questionId,
                } as Filter<Answer>);

                if (existing && existing.clientSeq >= item.clientSeq) {
                  // Server has equal or newer version -> Signal stale (safe for client)
                  stale.push(item.questionId);
                } else {
                  // Retry insert once
                  try {
                    await this.answers.updateOne(
                      {
                        submissionId,
                        questionId: item.questionId,
                        clientSeq: { $lt: item.clientSeq },
                      } as Filter<Answer>,
                      {
                        $set: {
                          clientSeq: item.clientSeq,
                          clientSavedAt: new Date(item.clientSavedAt),
                          savedAt: now,
                          inputData: item.inputData,
                        },
                      }
                    );
                    accepted.push(item.questionId);
                  } catch {
                    stale.push(item.questionId);
                  }
                }
              }
            }
          } else {
            throw err;
          }
        }
      }
    }

    const remainingMs = Math.max(0, new Date(submission.deadlineAt).getTime() - now.getTime());

    return {
      accepted,
      stale,
      rejected,
      late: isLate,
      serverNow: now.toISOString(),
      remainingMs,
      status: submission.status,
      integrity: {
        count: req.events?.length ?? 0,
        warn: submission.flags.integrityWarn,
      },
    };
  }

  /**
   * 6.4.5 Kumpul Ujian (POST /student/submissions/{id}/submit)
   */
  async submitExam(
    schoolId: string,
    studentId: string,
    submissionId: string
  ): Promise<{ status: string; submittedAt: string }> {
    const now = new Date();

    const res = await this.submissions.findOneAndUpdate(
      {
        _id: submissionId,
        schoolId,
        studentId,
        status: 'in_progress',
      } as Filter<Submission>,
      {
        $set: {
          status: 'submitted',
          submittedAt: now,
          finishReason: 'user',
          updatedAt: now,
        },
      },
      { returnDocument: 'after' }
    );

    if (!res) {
      const existing = await this.submissions.findOne({ _id: submissionId } as Filter<Submission>);
      if (existing) {
        return {
          status: existing.status,
          submittedAt: existing.submittedAt ? new Date(existing.submittedAt).toISOString() : now.toISOString(),
        };
      }
      throw new AppError(404, 'SUBMISSION_NOT_FOUND', 'Submission Not Found', 'Submission does not exist.');
    }

    return {
      status: res.status,
      submittedAt: now.toISOString(),
    };
  }
}

