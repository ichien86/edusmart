import type { FastifyPluginAsync } from 'fastify';
import type { Db } from 'mongodb';
import { z } from 'zod';
import {
  type Question,
  type Exam,
  QuestionSchema,
  ExamSchema,
} from '@eduassess/schemas';
import { AppError } from '../../plugins/error-handler.js';

export const bankRoutes: FastifyPluginAsync = async (fastify) => {
  const db = (fastify as any).mongoDb as Db;
  const questions = db.collection<Question>('questions');
  const exams = db.collection<Exam>('exams');

  // POST /api/v1/questions (Create question v1)
  fastify.post('/questions', async (request, reply) => {
    const schoolId = (request.headers['x-school-id'] as string) || 'school_1';
    const body = request.body as any;

    const newQuestion: Question = {
      ...body,
      _id: body._id || new Date().getTime().toString(16).padStart(24, '0'),
      schoolId,
      version: 1,
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const validated = QuestionSchema.parse(newQuestion);
    await questions.insertOne(validated);

    return reply.status(201).send(validated);
  });

  // POST /api/v1/questions/:key/versions (Immutable version increment §6.3)
  fastify.post('/questions/:key/versions', async (request, reply) => {
    const schoolId = (request.headers['x-school-id'] as string) || 'school_1';
    const questionKey = (request.params as any).key;
    const body = request.body as any;

    const latest = await questions.findOne(
      { schoolId, questionKey },
      { sort: { version: -1 } }
    );

    const nextVersion = (latest?.version || 0) + 1;

    const newVersionDoc: Question = {
      ...body,
      _id: new Date().getTime().toString(16).padStart(24, '0'),
      schoolId,
      questionKey,
      version: nextVersion,
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const validated = QuestionSchema.parse(newVersionDoc);
    await questions.insertOne(validated);

    return reply.status(201).send(validated);
  });

  // GET /api/v1/questions
  fastify.get('/questions', async (request, reply) => {
    const schoolId = (request.headers['x-school-id'] as string) || 'school_1';
    const query = (request.query as any) || {};

    const filter: any = { schoolId, status: 'active' };
    if (query.subject) filter.subject = query.subject;
    if (query.topic) filter.topic = query.topic;

    const list = await questions.find(filter).sort({ createdAt: -1 }).limit(100).toArray();
    return reply.status(200).send(list);
  });

  // POST /api/v1/exams (Create draft exam)
  fastify.post('/exams', async (request, reply) => {
    const schoolId = (request.headers['x-school-id'] as string) || 'school_1';
    const ownerId = (request.headers['x-user-id'] as string) || 'teacher_1';
    const body = request.body as any;

    const newExam: Exam = {
      ...body,
      _id: body._id || new Date().getTime().toString(16).padStart(24, '0'),
      schoolId,
      ownerId,
      status: 'draft',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const validated = ExamSchema.parse(newExam);
    await exams.insertOne(validated);

    return reply.status(201).send(validated);
  });

  // POST /api/v1/exams/:id/publish (Validation engine §6.3)
  fastify.post('/exams/:id/publish', async (request, reply) => {
    const schoolId = (request.headers['x-school-id'] as string) || 'school_1';
    const examId = (request.params as any).id;

    const exam = await exams.findOne({ _id: examId, schoolId });
    if (!exam) {
      throw new AppError(404, 'EXAM_NOT_FOUND', 'Exam Not Found', 'Ujian tidak ditemukan.');
    }

    const errors: string[] = [];

    // Rule 1: Question refs must exist and be active
    const qIds = exam.questionRefs.map((r) => r.questionId);
    const qDocs = await questions.find({ _id: { $in: qIds }, schoolId, status: 'active' }).toArray();
    const qMap = new Map(qDocs.map((q) => [q._id, q]));

    if (qDocs.length !== qIds.length) {
      errors.push(`Beberapa soal tidak ditemukan atau tidak berstatus aktif.`);
    }

    // Rule 2 & 3: Content checks per question type
    let totalPoints = 0;
    for (const ref of exam.questionRefs) {
      if (ref.points <= 0) {
        errors.push(`Poin untuk soal ${ref.questionId} harus lebih besar dari 0.`);
      }
      totalPoints += ref.points;

      const q = qMap.get(ref.questionId);
      if (q) {
        const p = q.payload as any;
        if (q.type === 'single_choice' && !p.key) {
          errors.push(`Soal pilihan ganda ${q.questionKey} v${q.version} tidak memiliki kunci jawaban.`);
        }
        if (q.type === 'multiple_choice' && (!p.keys || p.keys.length === 0)) {
          errors.push(`Soal pilihan ganda kompleks ${q.questionKey} v${q.version} tidak memiliki kunci jawaban.`);
        }
        if (q.type === 'matching' && (!p.pairs || p.pairs.length < 2)) {
          errors.push(`Soal menjodohkan ${q.questionKey} v${q.version} harus memiliki minimal 2 pasangan.`);
        }
        if (q.type === 'essay') {
          if (!p.rubric || p.rubric.length === 0) {
            errors.push(`Soal uraian ${q.questionKey} v${q.version} wajib memiliki minimal 1 kriteria rubrik.`);
          } else {
            const weightSum = p.rubric.reduce((acc: number, c: any) => acc + c.weight, 0);
            if (weightSum !== 100) {
              errors.push(`Total bobot rubrik pada soal uraian ${q.questionKey} harus tepat 100% (saat ini: ${weightSum}%).`);
            }
          }
        }
      }
    }

    if (totalPoints <= 0) {
      errors.push('Total poin ujian harus lebih besar dari 0.');
    }

    // Rule 4: Valid scheduling window
    const start = new Date(exam.scheduling.windowStart);
    const end = new Date(exam.scheduling.windowEnd);
    const durMs = exam.scheduling.durationMinutes * 60_000;
    if (exam.scheduling.mode === 'self_paced' && end.getTime() < start.getTime() + durMs) {
      errors.push('Jendela waktu ujian mandiri (windowEnd) harus lebih besar dari windowStart + durasi.');
    }

    // Rule 5: Target class or student not empty
    if ((!exam.assignedClassIds || exam.assignedClassIds.length === 0) &&
        (!exam.assignedStudentIds || exam.assignedStudentIds.length === 0)) {
      errors.push('Target kelas atau siswa yang ditugaskan tidak boleh kosong.');
    }

    // Check if any errors failed
    if (errors.length > 0) {
      throw new AppError(
        400,
        'EXAM_PUBLISH_VALIDATION_FAILED',
        'Validasi Publikasi Ujian Gagal',
        errors.join(' ')
      );
    }

    // Lock and publish
    await exams.updateOne(
      { _id: examId, schoolId },
      {
        $set: {
          status: 'published',
          updatedAt: new Date(),
        },
      }
    );

    return reply.status(200).send({
      message: 'Ujian berhasil divalidasi dan dipublikasikan.',
      examId,
      status: 'published',
    });
  });
};

