import type { FastifyPluginAsync } from 'fastify';
import type { Db, Filter } from 'mongodb';
import type { Submission, Answer, Question, Exam } from '@eduassess/schemas';
import { AppError } from '../../plugins/error-handler.js';

export const gradingRoutes: FastifyPluginAsync = async (fastify) => {
  const db = (fastify as any).mongoDb as Db;

  // GET /api/v1/grading/exams/:id/overview
  fastify.get('/exams/:id/overview', async (request, reply) => {
    const schoolId = (request.headers['x-school-id'] as string) || 'school_test_1';
    const examId = (request.params as any).id;

    const submissions = await db
      .collection<Submission>('submissions')
      .find({ examId, schoolId } as Filter<Submission>)
      .toArray();

    const answers = await db
      .collection<Answer>('answers')
      .find({ examId, schoolId } as Filter<Answer>)
      .toArray();

    let totalSubmissions = submissions.length;
    let submittedCount = submissions.filter((s) => s.status === 'submitted' || s.status === 'auto_submitted').length;
    
    // Find all essay answers
    const essayAnswers = answers.filter((a) => a.evaluation?.method === 'ai_assisted' || a.evaluation?.state === 'pending_ai');
    const pendingReviewCount = essayAnswers.filter((a) => !a.evaluation?.isReviewedByTeacher).length;
    const highPriorityCount = essayAnswers.filter(
      (a) => !a.evaluation?.isReviewedByTeacher && a.evaluation?.aiSuggestion?.reviewPriority === 'high'
    ).length;

    return reply.status(200).send({
      examId,
      totalSubmissions,
      submittedCount,
      totalEssays: essayAnswers.length,
      pendingReviewCount,
      highPriorityCount,
      allReviewed: pendingReviewCount === 0 && submittedCount > 0,
    });
  });

  // GET /api/v1/grading/exams/:id/submissions
  fastify.get('/exams/:id/submissions', async (request, reply) => {
    const schoolId = (request.headers['x-school-id'] as string) || 'school_test_1';
    const examId = (request.params as any).id;

    const submissions = await db
      .collection<Submission>('submissions')
      .find({ examId, schoolId } as Filter<Submission>)
      .sort({ startedAt: -1 })
      .toArray();

    const subIds = submissions.map((s) => s._id);
    const answers = await db
      .collection<Answer>('answers')
      .find({ submissionId: { $in: subIds }, schoolId } as Filter<Answer>)
      .toArray();

    const subAnswerMap = new Map<string, Answer[]>();
    for (const a of answers) {
      if (!subAnswerMap.has(a.submissionId)) subAnswerMap.set(a.submissionId, []);
      subAnswerMap.get(a.submissionId)!.push(a);
    }

    const results = submissions.map((sub) => {
      const subAnswers = subAnswerMap.get(sub._id) || [];
      const essayAnswers = subAnswers.filter((a) => a.evaluation?.method === 'ai_assisted' || a.evaluation?.state === 'pending_ai');
      const reviewedEssayCount = essayAnswers.filter((a) => a.evaluation?.isReviewedByTeacher).length;
      const hasHighPriority = essayAnswers.some(
        (a) => !a.evaluation?.isReviewedByTeacher && a.evaluation?.aiSuggestion?.reviewPriority === 'high'
      );

      return {
        submissionId: sub._id,
        studentId: sub.studentId,
        attemptNo: sub.attemptNo,
        status: sub.status,
        scores: sub.scores || {},
        startedAt: sub.startedAt,
        submittedAt: sub.submittedAt,
        essayCount: essayAnswers.length,
        reviewedEssayCount,
        hasHighPriority,
        gradingStatus:
          essayAnswers.length === 0
            ? 'graded'
            : reviewedEssayCount === essayAnswers.length
            ? 'reviewed'
            : 'needs_review',
      };
    });

    return reply.status(200).send({ submissions: results });
  });

  // GET /api/v1/grading/submissions/:id/review
  fastify.get('/submissions/:id/review', async (request, reply) => {
    const schoolId = (request.headers['x-school-id'] as string) || 'school_test_1';
    const submissionId = (request.params as any).id;

    const submission = await db
      .collection<Submission>('submissions')
      .findOne({ _id: submissionId, schoolId } as Filter<Submission>);

    if (!submission) {
      throw new AppError(404, 'SUBMISSION_NOT_FOUND', 'Submission Not Found', 'Submission not found.');
    }

    const answers = await db
      .collection<Answer>('answers')
      .find({ submissionId, schoolId } as Filter<Answer>)
      .toArray();

    // Fetch related questions
    const questionIds = answers.map((a) => a.questionId);
    const questions = await db
      .collection<Question>('questions')
      .find({ _id: { $in: questionIds }, schoolId } as Filter<Question>)
      .toArray();

    const qMap = new Map<string, Question>();
    for (const q of questions) {
      qMap.set(q._id, q);
    }

    const answerDetails = answers.map((ans) => {
      const q = qMap.get(ans.questionId);
      return {
        answerId: ans._id,
        questionId: ans.questionId,
        type: q?.type || 'unknown',
        prompt: q?.content?.text || '',
        rubric: (q?.payload as any)?.rubric || null,
        idealAnswer: (q?.payload as any)?.idealAnswer?.text || null,
        inputData: ans.inputData,
        evaluation: ans.evaluation,
        clientSavedAt: ans.clientSavedAt,
      };
    });

    return reply.status(200).send({
      submission,
      answers: answerDetails,
    });
  });

  // POST /api/v1/grading/answers/:id/review
  fastify.post('/answers/:id/review', async (request, reply) => {
    const schoolId = (request.headers['x-school-id'] as string) || 'school_test_1';
    const answerId = (request.params as any).id;
    const body = (request.body as any) || {};

    const { finalScore, feedback, isApprovedAISuggestion } = body;
    if (typeof finalScore !== 'number' || isNaN(finalScore)) {
      throw new AppError(400, 'INVALID_SCORE', 'Invalid Score', 'finalScore must be a number.');
    }

    const answer = await db
      .collection<Answer>('answers')
      .findOne({ _id: answerId, schoolId } as Filter<Answer>);

    if (!answer) {
      throw new AppError(404, 'ANSWER_NOT_FOUND', 'Answer Not Found', 'Answer does not exist.');
    }

    await db.collection<Answer>('answers').updateOne(
      { _id: answerId, schoolId } as Filter<Answer>,
      {
        $set: {
          'evaluation.finalScore': finalScore,
          'evaluation.state': 'reviewed',
          'evaluation.isReviewedByTeacher': true,
          'evaluation.teacherFeedback': feedback || '',
          'evaluation.approvedAI': Boolean(isApprovedAISuggestion),
          updatedAt: new Date(),
        },
      }
    );

    // Recalculate submission total score
    const submissionId = answer.submissionId;
    const allAnswers = await db
      .collection<Answer>('answers')
      .find({ submissionId, schoolId } as Filter<Answer>)
      .toArray();

    let objectiveScore = 0;
    let essayScore = 0;

    for (const a of allAnswers) {
      const s = a._id === answerId ? finalScore : (a.evaluation?.finalScore ?? a.evaluation?.score ?? 0);
      if (a.evaluation?.method === 'auto') {
        objectiveScore += s;
      } else {
        essayScore += s;
      }
    }

    const totalScore = objectiveScore + essayScore;

    await db.collection<Submission>('submissions').updateOne(
      { _id: submissionId, schoolId } as Filter<Submission>,
      {
        $set: {
          'scores.objective': objectiveScore,
          'scores.essay': essayScore,
          'scores.total': totalScore,
          updatedAt: new Date(),
        },
      }
    );

    return reply.status(200).send({
      status: 'ok',
      answerId,
      finalScore,
      totalScore,
    });
  });

  // POST /api/v1/grading/exams/:id/publish
  fastify.post('/exams/:id/publish', async (request, reply) => {
    const schoolId = (request.headers['x-school-id'] as string) || 'school_test_1';
    const examId = (request.params as any).id;

    const res = await db.collection<Submission>('submissions').updateMany(
      { examId, schoolId } as Filter<Submission>,
      {
        $set: {
          'release.scores': true,
          'release.keys': true,
          'release.releasedAt': new Date(),
          updatedAt: new Date(),
        },
      }
    );

    return reply.status(200).send({
      status: 'ok',
      examId,
      releasedCount: res.modifiedCount,
    });
  });
};
