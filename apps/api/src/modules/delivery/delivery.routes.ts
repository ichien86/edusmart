import type { FastifyPluginAsync } from 'fastify';
import { SyncRequestSchema } from '@eduassess/schemas';
import { DeliveryService } from './delivery.service.js';

export const deliveryRoutes: FastifyPluginAsync = async (fastify) => {
  const db = (fastify as any).mongoDb;
  const deliveryService = new DeliveryService(db);

  // POST /api/v1/student/exams/:id/start
  fastify.post('/student/exams/:id/start', async (request, reply) => {
    // In production, studentId and schoolId are parsed from authenticated JWT context
    const studentId = (request.headers['x-student-id'] as string) || 'student_test_1';
    const schoolId = (request.headers['x-school-id'] as string) || 'school_test_1';
    const examId = (request.params as any).id;
    const body = (request.body as any) || {};

    const result = await deliveryService.startExam(schoolId, studentId, examId, {
      deviceId: body.deviceId,
      examTokenInput: body.examToken,
    });

    return reply.status(200).send(result);
  });

  // POST /api/v1/student/submissions/:id/sync
  fastify.post('/student/submissions/:id/sync', async (request, reply) => {
    const studentId = (request.headers['x-student-id'] as string) || 'student_test_1';
    const schoolId = (request.headers['x-school-id'] as string) || 'school_test_1';
    const submissionId = (request.params as any).id;

    const validatedBody = SyncRequestSchema.parse(request.body || {});
    const result = await deliveryService.syncAnswers(schoolId, studentId, submissionId, validatedBody);

    return reply.status(200).send(result);
  });

  // POST /api/v1/student/submissions/:id/submit
  fastify.post('/student/submissions/:id/submit', async (request, reply) => {
    const studentId = (request.headers['x-student-id'] as string) || 'student_test_1';
    const schoolId = (request.headers['x-school-id'] as string) || 'school_test_1';
    const submissionId = (request.params as any).id;

    const result = await deliveryService.submitExam(schoolId, studentId, submissionId);

    return reply.status(200).send(result);
  });

  // POST /api/v1/student/submissions/:id/heartbeat (§8.3 ADR-08)
  fastify.post('/student/submissions/:id/heartbeat', async (request, reply) => {
    const studentId = (request.headers['x-student-id'] as string) || 'student_test_1';
    const schoolId = (request.headers['x-school-id'] as string) || 'school_test_1';
    const submissionId = (request.params as any).id;
    const body = (request.body as any) || {};

    const { PresenceService } = await import('../proctor/presence.service.js');
    const presenceService = new PresenceService();

    let examId = body.examId;
    if (!examId) {
      const sub = await db.collection('submissions').findOne({ _id: submissionId });
      examId = sub?.examId || 'EXAM-DEFAULT';
    }

    await presenceService.recordHeartbeat(examId, studentId, {
      submissionId,
      studentName: body.studentName,
      nis: body.nis,
      answeredCount: body.answeredCount,
      totalQuestions: body.totalQuestions,
      integrityEvent: body.integrityEvent,
    });

    return reply.status(200).send({
      status: 'ok',
      serverTime: new Date().toISOString(),
    });
  });
};

