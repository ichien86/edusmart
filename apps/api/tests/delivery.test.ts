import { describe, it, expect, beforeEach } from 'vitest';
import { DeliveryService } from '../src/modules/delivery/delivery.service.js';
import type { Exam, Question } from '@eduassess/schemas';

// In-Memory Mongo Collection Mock for testing Delivery Service logic in isolation
class MockCollection<T extends Record<string, any>> {
  public docs: T[] = [];

  constructor(public readonly name: string) {}

  async findOne(filter: any): Promise<T | null> {
    return (
      this.docs.find((doc) => {
        for (const [key, val] of Object.entries(filter)) {
          if (doc[key] !== val) return false;
        }
        return true;
      }) || null
    );
  }

  find(filter: any) {
    let matched = this.docs;
    if (filter._id?.$in) {
      const allowed = new Set(filter._id.$in);
      matched = matched.filter((d) => allowed.has(d._id));
    }
    return {
      toArray: async () => matched,
    };
  }

  async insertOne(doc: T) {
    this.docs.push({ ...doc });
    return { insertedId: doc._id };
  }

  async updateOne(filter: any, update: any) {
    const doc = await this.findOne(filter);
    if (doc && update.$set) {
      Object.assign(doc, update.$set);
    }
    return { matchedCount: doc ? 1 : 0 };
  }

  async findOneAndUpdate(filter: any, update: any, options: any) {
    const doc = await this.findOne(filter);
    if (doc && update.$set) {
      Object.assign(doc, update.$set);
    }
    return doc;
  }

  async bulkWrite(ops: any[], options: any) {
    for (const op of ops) {
      if (op.updateOne) {
        const { filter, update, upsert } = op.updateOne;
        const existing = this.docs.find(
          (d) => d.submissionId === filter.submissionId && d.questionId === filter.questionId
        );
        if (existing) {
          if (filter.clientSeq?.$lt && existing.clientSeq >= filter.clientSeq.$lt) {
            // Document has higher/equal sequence -> reject update (stale)
            const err: any = new Error('E11000 duplicate key');
            err.code = 11000;
            err.writeErrors = [{ code: 11000, index: ops.indexOf(op) }];
            throw err;
          }
          if (update.$set) Object.assign(existing, update.$set);
        } else if (upsert) {
          const newDoc = {
            ...(update.$setOnInsert || {}),
            ...(update.$set || {}),
            submissionId: filter.submissionId,
            questionId: filter.questionId,
          };
          this.docs.push(newDoc as T);
        }
      }
    }
    return { ok: 1 };
  }
}

class MockDb {
  private collections: Record<string, MockCollection<any>> = {};

  collection<T extends Record<string, any>>(name: string): MockCollection<T> {
    if (!this.collections[name]) {
      this.collections[name] = new MockCollection<T>(name);
    }
    return this.collections[name] as MockCollection<T>;
  }
}

describe('Delivery Service Suite', () => {
  let mockDb: MockDb;
  let service: DeliveryService;

  const mockExam: Exam = {
    _id: 'exam_fisika_101',
    schoolId: 'school_1',
    ownerId: 'teacher_1',
    title: 'Penilaian Harian Fisika',
    status: 'published',
    questionRefs: [
      { questionId: 'q_1', order: 1, points: 10, status: 'active', allCredit: false },
    ],
    scheduling: {
      mode: 'self_paced',
      durationMinutes: 60,
      windowStart: new Date(Date.now() - 3600_000), // opened 1 hour ago
      windowEnd: new Date(Date.now() + 7200_000), // closes in 2 hours
      gracePeriodSeconds: 120,
    },
    assignedClassIds: ['class_10a'],
    assignedStudentIds: [],
    accommodations: [],
    tokenPolicy: { required: false, ttlSeconds: 3600 },
    settings: {
      resultReleaseMode: 'instant_objective',
      allowRubricView: false,
      aiGrading: { enabled: false, shadowMode: true, doubleEval: false, budgetTokens: 200000 },
      appealPolicy: { enabled: true, windowHours: 48, maxItems: 3, teacherSlaDays: 3 },
    },
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockQuestion: Question = {
    _id: 'q_1',
    schoolId: 'school_1',
    questionKey: 'q_fis_1',
    version: 1,
    status: 'active',
    type: 'single_choice',
    subject: 'Fisika',
    topic: 'Gerak Lurus',
    difficulty: 'easy',
    content: { text: 'Satuan kecepatan adalah?', format: 'plain', dir: 'auto', lang: 'id' },
    payload: {
      options: [
        { id: 'opt_1', content: { text: 'm/s', format: 'plain', dir: 'auto', lang: 'id' } },
        { id: 'opt_2', content: { text: 'kg', format: 'plain', dir: 'auto', lang: 'id' } },
      ],
      key: 'opt_1',
      shuffleOptions: true,
    },
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    mockDb = new MockDb();
    mockDb.collection('exams').docs = [mockExam];
    mockDb.collection('questions').docs = [mockQuestion];
    service = new DeliveryService(mockDb as any);
  });

  it('startExam initializes an authoritative deadline and safe student projection', async () => {
    const res = await service.startExam('school_1', 'student_1', 'exam_fisika_101', {
      deviceId: 'device_phone_1',
    });

    expect(res.submissionId).toBeDefined();
    expect(res.examToken).toBeDefined();
    expect(res.exam.title).toBe('Penilaian Harian Fisika');
    expect(res.groups[0]!.questions.length).toBe(1);

    // Verify secret key is stripped
    const q0 = res.groups[0]!.questions[0]!;
    expect(q0.questionId).toBe('q_1');
    expect((q0 as any).key).toBeUndefined();
    expect((q0 as any).payload).toBeUndefined();
  });

  it('syncAnswers performs idempotent upsert with clientSeq', async () => {
    const startRes = await service.startExam('school_1', 'student_1', 'exam_fisika_101');
    const sid = startRes.submissionId;

    // 1. First sync with seq=1
    const sync1 = await service.syncAnswers('school_1', 'student_1', sid, {
      items: [
        {
          questionId: 'q_1',
          clientSeq: 1,
          clientSavedAt: new Date().toISOString(),
          inputData: { selected: 'opt_1' },
        },
      ],
      events: [],
      ping: true,
    });

    expect(sync1.accepted).toContain('q_1');
    expect(sync1.stale).toHaveLength(0);

    // 2. Out-of-order stale sync with seq=1 (older or equal version)
    const syncStale = await service.syncAnswers('school_1', 'student_1', sid, {
      items: [
        {
          questionId: 'q_1',
          clientSeq: 1,
          clientSavedAt: new Date().toISOString(),
          inputData: { selected: 'opt_2' },
        },
      ],
      events: [],
      ping: true,
    });

    expect(syncStale.stale).toContain('q_1');

    // 3. Newer sync with seq=2 updates successfully
    const syncNewer = await service.syncAnswers('school_1', 'student_1', sid, {
      items: [
        {
          questionId: 'q_1',
          clientSeq: 2,
          clientSavedAt: new Date().toISOString(),
          inputData: { selected: 'opt_2' },
        },
      ],
      events: [],
      ping: true,
    });

    expect(syncNewer.accepted).toContain('q_1');
  });

  it('submitExam transitions status to submitted', async () => {
    const startRes = await service.startExam('school_1', 'student_1', 'exam_fisika_101');
    const submitRes = await service.submitExam('school_1', 'student_1', startRes.submissionId);

    expect(submitRes.status).toBe('submitted');
    expect(submitRes.submittedAt).toBeDefined();
  });
});

