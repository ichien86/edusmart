import Redis from 'ioredis';
import { Db, ObjectId } from 'mongodb';

export interface PresenceRecord {
  studentId: string;
  submissionId: string;
  studentName: string;
  nis: string;
  answeredCount: number;
  totalQuestions: number;
  status: 'online' | 'offline_warning' | 'submitted' | 'auto_submitted' | 'idle';
  lastHeartbeatAt: number;
  integrityAlert?: 'none' | 'tab_blur' | 'fullscreen_exit';
  activeDeviceId?: string;
  deadlineAt?: string;
}

export interface RoomSnapshot {
  examId: string;
  roomToken?: string;
  summary: {
    totalAssigned: number;
    online: number;
    offlineWarning: number;
    submitted: number;
    anomalyCount: number;
  };
  students: PresenceRecord[];
}

const NON_AMBIGUOUS_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generateRoomToken(length: number = 6): string {
  let result = '';
  for (let i = 0; i < length; i++) {
    const idx = Math.floor(Math.random() * NON_AMBIGUOUS_CHARS.length);
    result += NON_AMBIGUOUS_CHARS[idx];
  }
  // Format with hyphen: e.g. K7P-9W2
  if (length === 6) {
    return `${result.slice(0, 3)}-${result.slice(3)}`;
  }
  return result;
}

export class PresenceService {
  private redis: Redis | null = null;
  private pubRedis: Redis | null = null;
  private isConnected = false;

  constructor(redisUrl?: string) {
    const url = redisUrl || process.env.REDIS_URL || 'redis://localhost:6379';
    try {
      this.redis = new Redis(url, {
        lazyConnect: true,
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
      });
      this.pubRedis = new Redis(url, {
        lazyConnect: true,
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
      });

      this.redis.connect().then(() => {
        this.isConnected = true;
      }).catch(() => {
        this.isConnected = false;
      });

      this.pubRedis.connect().catch(() => {});
    } catch {
      this.isConnected = false;
    }
  }

  public async recordHeartbeat(
    examId: string,
    studentId: string,
    data: {
      submissionId: string;
      studentName?: string;
      nis?: string;
      answeredCount?: number;
      totalQuestions?: number;
      integrityEvent?: 'tab_blur' | 'fullscreen_exit' | 'normal';
    }
  ): Promise<void> {
    const now = Date.now();
    const alert = data.integrityEvent === 'normal' ? 'none' : data.integrityEvent || 'none';

    const record: Partial<PresenceRecord> = {
      studentId,
      submissionId: data.submissionId,
      studentName: data.studentName || `Siswa-${studentId.slice(-4)}`,
      nis: data.nis || studentId.slice(-6),
      answeredCount: data.answeredCount || 0,
      totalQuestions: data.totalQuestions || 0,
      status: 'online',
      lastHeartbeatAt: now,
      integrityAlert: alert as any,
    };

    if (this.redis && this.isConnected) {
      try {
        const hashKey = `exam:${examId}:presence`;
        const zsetKey = `exam:${examId}:presence_zset`;

        await this.redis.hset(hashKey, studentId, JSON.stringify(record));
        await this.redis.zadd(zsetKey, now, studentId);
        await this.redis.expire(hashKey, 7200); // 2 hours
        await this.redis.expire(zsetKey, 7200);

        // Broadcast delta event over Redis PubSub
        if (this.pubRedis) {
          const eventPayload = JSON.stringify({
            type: alert !== 'none' ? 'anomaly_alert' : 'heartbeat',
            examId,
            studentId,
            record,
            timestamp: now,
          });
          await this.pubRedis.publish(`exam:${examId}:events`, eventPayload);
        }
      } catch (err) {
        // Log silently and continue
      }
    }
  }

  public async getLiveRoomSnapshot(schoolId: string, examId: string, db: Db): Promise<RoomSnapshot> {
    const now = Date.now();

    // 1. Ambil seluruh submission terkait ujian dari MongoDB
    const submissions = await db
      .collection('submissions')
      .find({ schoolId, examId })
      .project({
        _id: 1,
        studentId: 1,
        status: 1,
        startedAt: 1,
        deadlineAt: 1,
        activeDeviceId: 1,
        finishReason: 1,
      })
      .toArray();

    // 2. Ambil data presence dari Redis jika ada
    let presenceMap: Record<string, PresenceRecord> = {};
    let currentToken: string | undefined;

    if (this.redis && this.isConnected) {
      try {
        const [rawHash, token] = await Promise.all([
          this.redis.hgetall(`exam:${examId}:presence`),
          this.redis.get(`exam:${examId}:room_token`),
        ]);
        currentToken = token || undefined;

        for (const [sId, jsonStr] of Object.entries(rawHash)) {
          try {
            presenceMap[sId] = JSON.parse(jsonStr);
          } catch {}
        }
      } catch {}
    }

    // 3. Susun daftar kartu siswa
    const students: PresenceRecord[] = submissions.map((sub: any) => {
      const sId = sub.studentId?.toString() || sub._id.toString();
      const existing = presenceMap[sId];

      let effectiveStatus: PresenceRecord['status'] = 'idle';
      if (sub.status === 'submitted') {
        effectiveStatus = 'submitted';
      } else if (sub.status === 'auto_submitted') {
        effectiveStatus = 'auto_submitted';
      } else if (sub.status === 'in_progress') {
        if (existing) {
          const diffMs = now - existing.lastHeartbeatAt;
          effectiveStatus = diffMs > 45000 ? 'offline_warning' : 'online';
        } else {
          effectiveStatus = 'online';
        }
      }

      return {
        studentId: sId,
        submissionId: sub._id.toString(),
        studentName: existing?.studentName || `Siswa ${sId.slice(-4)}`,
        nis: existing?.nis || sId.slice(-5),
        answeredCount: existing?.answeredCount || 0,
        totalQuestions: existing?.totalQuestions || 0,
        status: effectiveStatus,
        lastHeartbeatAt: existing?.lastHeartbeatAt || (sub.startedAt ? new Date(sub.startedAt).getTime() : now),
        integrityAlert: existing?.integrityAlert || 'none',
        activeDeviceId: sub.activeDeviceId,
        deadlineAt: sub.deadlineAt ? new Date(sub.deadlineAt).toISOString() : undefined,
      };
    });

    // 4. Hitung ringkasan statistik
    const summary = {
      totalAssigned: students.length,
      online: students.filter((s) => s.status === 'online').length,
      offlineWarning: students.filter((s) => s.status === 'offline_warning').length,
      submitted: students.filter((s) => s.status === 'submitted' || s.status === 'auto_submitted').length,
      anomalyCount: students.filter((s) => s.integrityAlert && s.integrityAlert !== 'none').length,
    };

    return {
      examId,
      roomToken: currentToken,
      summary,
      students,
    };
  }

  public async extendTime(
    schoolId: string,
    examId: string,
    studentId: string | null,
    minutes: number,
    db: Db
  ): Promise<{ modifiedCount: number }> {
    const extraMs = minutes * 60 * 1000;

    const filter: any = { schoolId, examId, status: 'in_progress' };
    if (studentId) {
      filter.studentId = studentId;
    }

    const subs = await db.collection('submissions').find(filter).toArray();
    let modifiedCount = 0;

    for (const sub of subs) {
      const currentDeadline = new Date(sub.deadlineAt).getTime();
      const newDeadline = new Date(currentDeadline + extraMs);
      await db.collection('submissions').updateOne(
        { _id: sub._id },
        {
          $set: {
            deadlineAt: newDeadline,
            updatedAt: new Date(),
          },
        }
      );
      modifiedCount++;
    }

    // Siarkan event perpanjangan waktu
    if (this.pubRedis) {
      try {
        await this.pubRedis.publish(
          `exam:${examId}:events`,
          JSON.stringify({
            type: 'time_extended',
            examId,
            studentId,
            minutes,
            timestamp: Date.now(),
          })
        );
      } catch {}
    }

    return { modifiedCount };
  }

  public async resetDeviceSession(
    schoolId: string,
    examId: string,
    studentId: string,
    db: Db
  ): Promise<boolean> {
    const result = await db.collection('submissions').updateOne(
      { schoolId, examId, studentId, status: 'in_progress' },
      {
        $set: {
          activeDeviceId: null,
          updatedAt: new Date(),
        },
      }
    );

    if (result.modifiedCount > 0 && this.pubRedis) {
      try {
        await this.pubRedis.publish(
          `exam:${examId}:events`,
          JSON.stringify({
            type: 'session_reset',
            examId,
            studentId,
            timestamp: Date.now(),
          })
        );
      } catch {}
    }

    return result.modifiedCount > 0;
  }

  public async forceSubmit(
    schoolId: string,
    examId: string,
    studentId: string,
    reason: string = 'proctor',
    db: Db
  ): Promise<boolean> {
    const now = new Date();
    const result = await db.collection('submissions').updateOne(
      { schoolId, examId, studentId, status: 'in_progress' },
      {
        $set: {
          status: 'submitted',
          finishReason: reason,
          submittedAt: now,
          updatedAt: now,
        },
      }
    );

    if (result.modifiedCount > 0 && this.pubRedis) {
      try {
        await this.pubRedis.publish(
          `exam:${examId}:events`,
          JSON.stringify({
            type: 'force_submitted',
            examId,
            studentId,
            reason,
            timestamp: now.getTime(),
          })
        );
      } catch {}
    }

    return result.modifiedCount > 0;
  }

  public async rotateRoomToken(examId: string, customToken?: string): Promise<string> {
    const token = customToken || generateRoomToken(6);
    if (this.redis && this.isConnected) {
      try {
        await this.redis.set(`exam:${examId}:room_token`, token, 'EX', 7200);
        if (this.pubRedis) {
          await this.pubRedis.publish(
            `exam:${examId}:events`,
            JSON.stringify({
              type: 'token_rotated',
              examId,
              token,
              timestamp: Date.now(),
            })
          );
        }
      } catch {}
    }
    return token;
  }

  public createSubscriber(): Redis {
    const url = process.env.REDIS_URL || 'redis://localhost:6379';
    return new Redis(url, { maxRetriesPerRequest: null });
  }
}
