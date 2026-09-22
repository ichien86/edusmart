import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { Db } from 'mongodb';
import { PresenceService, generateRoomToken } from './presence.service.js';
import { z } from 'zod';

const ExtendSchema = z.object({
  studentId: z.string().nullable().optional(),
  minutes: z.number().int().min(1).max(180),
});

const ResetSessionSchema = z.object({
  studentId: z.string().min(1),
});

const ForceSubmitSchema = z.object({
  studentId: z.string().min(1),
  reason: z.string().optional(),
});

const RotateTokenSchema = z.object({
  customToken: z.string().optional(),
});

export async function proctorRoutes(fastify: FastifyInstance) {
  const db = (fastify as any).mongoDb as Db;
  const presenceService = new PresenceService();

  // Helper untuk schoolId (multi-tenant)
  const getSchoolId = (req: FastifyRequest) => {
    return (req.headers['x-school-id'] as string) || 'SCH-001';
  };

  // 1. Snapshot REST endpoint
  fastify.get('/exams/:id/snapshot', async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const schoolId = getSchoolId(req);
    const examId = req.params.id;
    const snapshot = await presenceService.getLiveRoomSnapshot(schoolId, examId, db);
    return reply.send(snapshot);
  });

  // 2. Server-Sent Events (SSE) Live Stream (§8.3 ADR-08)
  fastify.get('/exams/:id/live', async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const schoolId = getSchoolId(req);
    const examId = req.params.id;

    // Set header SSE standar
    reply.raw.setHeader('Content-Type', 'text/event-stream');
    reply.raw.setHeader('Cache-Control', 'no-cache, no-transform');
    reply.raw.setHeader('Connection', 'keep-alive');
    reply.raw.setHeader('X-Accel-Buffering', 'no');
    reply.raw.setHeader('Access-Control-Allow-Origin', '*');
    reply.raw.flushHeaders();

    // Kirim snapshot awal
    const initialSnapshot = await presenceService.getLiveRoomSnapshot(schoolId, examId, db);
    reply.raw.write(`event: snapshot\ndata: ${JSON.stringify(initialSnapshot)}\n\n`);

    // Setup keep-alive ping setiap 15 detik
    const pingTimer = setInterval(() => {
      reply.raw.write(': ping\n\n');
    }, 15000);

    // Setup Redis Subscriber
    let sub: any = null;
    try {
      sub = presenceService.createSubscriber();
      await sub.subscribe(`exam:${examId}:events`);
      sub.on('message', (_channel: string, message: string) => {
        reply.raw.write(`event: delta\ndata: ${message}\n\n`);
      });
    } catch {
      // Jika Redis subscriber gagal (misal saat standalone test tanpa redis),
      // gunakan interval polling fallback setiap 3 detik
      const fallbackTimer = setInterval(async () => {
        try {
          const fresh = await presenceService.getLiveRoomSnapshot(schoolId, examId, db);
          reply.raw.write(`event: snapshot\ndata: ${JSON.stringify(fresh)}\n\n`);
        } catch {}
      }, 3000);

      req.raw.on('close', () => {
        clearInterval(fallbackTimer);
      });
    }

    // Cleanup saat koneksi klien ditutup
    req.raw.on('close', () => {
      clearInterval(pingTimer);
      if (sub) {
        sub.unsubscribe().catch(() => {});
        sub.quit().catch(() => {});
      }
    });

    // Pertahankan respons tetap terbuka untuk stream
    await new Promise(() => {});
  });

  // 3. Perpanjang Waktu Ujian (Individu atau Seluruh Peserta)
  fastify.post('/exams/:id/extend', async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const schoolId = getSchoolId(req);
    const examId = req.params.id;
    const body = ExtendSchema.parse(req.body);

    const result = await presenceService.extendTime(
      schoolId,
      examId,
      body.studentId || null,
      body.minutes,
      db
    );

    return reply.send({
      status: 'ok',
      message: `Waktu ujian berhasil diperpanjang +${body.minutes} menit untuk ${result.modifiedCount} siswa.`,
      modifiedCount: result.modifiedCount,
    });
  });

  // 4. Reset Sesi Perangkat (Device Lock Clear)
  fastify.post('/exams/:id/reset-session', async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const schoolId = getSchoolId(req);
    const examId = req.params.id;
    const body = ResetSessionSchema.parse(req.body);

    const success = await presenceService.resetDeviceSession(schoolId, examId, body.studentId, db);
    if (!success) {
      return reply.code(404).send({
        error: 'Not Found',
        message: 'Sesi siswa tidak ditemukan atau sudah tidak dalam status in_progress.',
      });
    }

    return reply.send({
      status: 'ok',
      message: `Kunci sesi perangkat untuk siswa ${body.studentId} berhasil di-reset. Siswa dapat login di perangkat baru.`,
    });
  });

  // 5. Paksa Kumpul Ujian (Force Submit)
  fastify.post('/exams/:id/force-submit', async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const schoolId = getSchoolId(req);
    const examId = req.params.id;
    const body = ForceSubmitSchema.parse(req.body);

    const success = await presenceService.forceSubmit(schoolId, examId, body.studentId, body.reason || 'proctor', db);
    if (!success) {
      return reply.code(404).send({
        error: 'Not Found',
        message: 'Sesi pengerjaan siswa tidak ditemukan atau sudah selesai.',
      });
    }

    return reply.send({
      status: 'ok',
      message: `Ujian siswa ${body.studentId} berhasil dikumpulkan secara paksa oleh pengawas.`,
    });
  });

  // 6. Putar Token Ruang Ujian
  fastify.post('/exams/:id/token/rotate', async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const examId = req.params.id;
    const body = RotateTokenSchema.optional().parse(req.body || {});

    const token = await presenceService.rotateRoomToken(examId, body?.customToken);
    return reply.send({
      status: 'ok',
      token,
      message: `Token ruang ujian berhasil diperbarui: ${token}`,
    });
  });
}
