import { describe, it, expect, beforeEach, runAllTests } from './test-runner.mjs';

// Import compiled production modules
import {
  scoreSingleChoice,
  scoreMultipleChoice,
  scoreTrueFalse,
  scoreMatching,
  round2,
  normText,
  parseIdNumber,
  normArabic,
  scoreShortAnswer,
} from '../packages/scoring/dist/index.js';

import {
  mulberry32,
  seededShuffle,
  maybeShuffle,
  hashString,
} from '../packages/shuffle/dist/index.js';

import {
  toStudentView,
  assertNoSecretLeak,
  FORBIDDEN_SECRET_KEYS,
} from '../packages/schemas/dist/index.js';

import { DeliveryService } from '../apps/api/dist/modules/delivery/delivery.service.js';
import { hashPassword, verifyPassword } from '../apps/api/dist/modules/auth/password.util.js';
import { TokenService } from '../apps/api/dist/modules/auth/token.service.js';

// ==========================================
// Suite 1: Objective Scoring & Rounding
// ==========================================
describe('Objective Scoring Suite', () => {
  it('scoreSingleChoice: awards full points for correct key, 0 for incorrect', () => {
    const payload = {
      options: [
        { id: 'opt_a', content: { text: 'Pilihan A', format: 'plain', dir: 'auto', lang: 'id' } },
        { id: 'opt_b', content: { text: 'Pilihan B', format: 'plain', dir: 'auto', lang: 'id' } },
      ],
      key: 'opt_b',
      shuffleOptions: true,
    };

    expect(scoreSingleChoice(payload, { selected: 'opt_b' }, 10)).toBe(10);
    expect(scoreSingleChoice(payload, { selected: 'opt_a' }, 10)).toBe(0);
    expect(scoreSingleChoice(payload, { selected: null }, 10)).toBe(0);
    expect(scoreSingleChoice(payload, {}, 10)).toBe(0);
  });

  it('scoreMultipleChoice: partial scoring calculates (TP - FP) / keys.size with floor 0', () => {
    const payload = {
      options: [
        { id: 'a', content: { text: 'A', format: 'plain', dir: 'auto', lang: 'id' } },
        { id: 'b', content: { text: 'B', format: 'plain', dir: 'auto', lang: 'id' } },
        { id: 'c', content: { text: 'C', format: 'plain', dir: 'auto', lang: 'id' } },
        { id: 'd', content: { text: 'D', format: 'plain', dir: 'auto', lang: 'id' } },
      ],
      keys: ['a', 'b'],
      scoringMode: 'partial',
      shuffleOptions: true,
    };

    expect(scoreMultipleChoice(payload, { selectedOptions: ['a', 'b'] }, 20)).toBe(20);
    expect(scoreMultipleChoice(payload, { selectedOptions: ['a'] }, 20)).toBe(10);
    expect(scoreMultipleChoice(payload, { selectedOptions: ['a', 'c'] }, 20)).toBe(0);
    expect(scoreMultipleChoice(payload, { selectedOptions: ['a', 'c', 'd'] }, 20)).toBe(0);
    expect(scoreMultipleChoice(payload, { selectedOptions: ['a', 'b', 'c', 'd'] }, 20)).toBe(0);
  });

  it('scoreMultipleChoice: all_or_nothing mode', () => {
    const payload = {
      options: [
        { id: 'a', content: { text: 'A', format: 'plain', dir: 'auto', lang: 'id' } },
        { id: 'b', content: { text: 'B', format: 'plain', dir: 'auto', lang: 'id' } },
      ],
      keys: ['a', 'b'],
      scoringMode: 'all_or_nothing',
      shuffleOptions: true,
    };

    expect(scoreMultipleChoice(payload, { selectedOptions: ['a', 'b'] }, 20)).toBe(20);
    expect(scoreMultipleChoice(payload, { selectedOptions: ['a'] }, 20)).toBe(0);
  });

  it('scoreTrueFalse: scores proportional to correct statements', () => {
    const payload = {
      statements: [
        { id: 's1', content: { text: 'S1', format: 'plain', dir: 'auto', lang: 'id' }, key: true },
        { id: 's2', content: { text: 'S2', format: 'plain', dir: 'auto', lang: 'id' }, key: false },
        { id: 's3', content: { text: 'S3', format: 'plain', dir: 'auto', lang: 'id' }, key: true },
        { id: 's4', content: { text: 'S4', format: 'plain', dir: 'auto', lang: 'id' }, key: false },
      ],
      scoringMode: 'partial',
    };

    expect(scoreTrueFalse(payload, { statements: { s1: true, s2: false, s3: true, s4: false } }, 20)).toBe(20);
    expect(scoreTrueFalse(payload, { statements: { s1: true, s2: false, s3: false, s4: true } }, 20)).toBe(10);
    expect(scoreTrueFalse(payload, { statements: { s1: true } }, 20)).toBe(5);
  });

  it('scoreMatching: scores proportional to correctly matched pairs', () => {
    const payload = {
      premises: [
        { id: 'p1', content: { text: 'P1', format: 'plain', dir: 'auto', lang: 'id' } },
        { id: 'p2', content: { text: 'P2', format: 'plain', dir: 'auto', lang: 'id' } },
      ],
      responses: [
        { id: 'r1', content: { text: 'R1', format: 'plain', dir: 'auto', lang: 'id' } },
        { id: 'r2', content: { text: 'R2', format: 'plain', dir: 'auto', lang: 'id' } },
      ],
      pairs: [
        { premiseId: 'p1', responseId: 'r1' },
        { premiseId: 'p2', responseId: 'r2' },
      ],
      scoringMode: 'partial',
    };

    expect(scoreMatching(payload, { pairs: { p1: 'r1', p2: 'r2' } }, 10)).toBe(10);
    expect(scoreMatching(payload, { pairs: { p1: 'r1', p2: 'wrong' } }, 10)).toBe(5);
    expect(scoreMatching(payload, { pairs: {} }, 10)).toBe(0);
  });

  it('round2: rounds accurately with epsilon protection', () => {
    expect(round2(2 * (1 / 3))).toBe(0.67);
    expect(round2(1.005)).toBe(1.01);
  });
});

// ==========================================
// Suite 2: Normalizers & Short Answer
// ==========================================
describe('Normalizers & Short Answer Suite', () => {
  it('Indonesian numbers: parses comma, dot, and thousands formats accurately', () => {
    expect(parseIdNumber('9,8')).toBe(9.8);
    expect(parseIdNumber('9.8')).toBe(9.8);
    expect(parseIdNumber('1.000,5')).toBe(1000.5);
    expect(parseIdNumber('1.000')).toBe(1000);
    expect(parseIdNumber('1.5e-3')).toBe(0.0015);
    expect(parseIdNumber('invalid_text')).toBeNull();
  });

  it('Arabic normalization: NFC, harakat removal, BiDi strip', () => {
    expect(normArabic('كَتَبَ', { mode: 'ignore_harakat' })).toBe('كتب');
    expect(normArabic('كـــتــاب\u200E')).toBe('كتاب');
    expect(normArabic('أحمد', { unifyAlif: true })).toBe('احمد');
    expect(normArabic('مدرسة', { unifyTaMarbuta: true })).toBe('مدرسه');
  });

  it('Short answer scoring: text and numeric tolerance', () => {
    const textPayload = {
      answerKind: 'text',
      acceptedAnswers: ['Soekarno-Hatta', 'Ir. Soekarno'],
    };
    expect(scoreShortAnswer(textPayload, { text: 'soekarno hatta' }, 10).isCorrect).toBe(true);
    expect(scoreShortAnswer(textPayload, { text: 'ir soekarno' }, 10).isCorrect).toBe(true);
    expect(scoreShortAnswer(textPayload, { text: 'Habibie' }, 10).isCorrect).toBe(false);

    const numPayload = {
      answerKind: 'numeric',
      acceptedAnswers: ['9.8'],
      tolerance: { rel: 0.01 },
    };
    expect(scoreShortAnswer(numPayload, { text: '9,8' }, 10).isCorrect).toBe(true);
    expect(scoreShortAnswer(numPayload, { text: '9.85' }, 10).isCorrect).toBe(true);
    expect(scoreShortAnswer(numPayload, { text: '11.0' }, 10).isCorrect).toBe(false);

    const unparseable = scoreShortAnswer(numPayload, { text: 'sepuluh' }, 10);
    expect(unparseable.needsReview).toBe(true);
  });
});

// ==========================================
// Suite 3: PRNG & Shuffle Determinism
// ==========================================
describe('Seeded Shuffle Suite', () => {
  it('mulberry32: produces deterministic pseudo-random sequences for identical seed', () => {
    const rng1 = mulberry32(424242);
    const rng2 = mulberry32(424242);
    expect([rng1(), rng1(), rng1()]).toEqual([rng2(), rng2(), rng2()]);
  });

  it('seededShuffle: produces identical permutation for identical seed', () => {
    const list = ['A', 'B', 'C', 'D', 'E'];
    const s1 = seededShuffle(list, 999, 'q1');
    const s2 = seededShuffle(list, 999, 'q1');
    expect(s1).toEqual(s2);
    expect(list).toEqual(['A', 'B', 'C', 'D', 'E']); // Immutability test
  });

  it('maybeShuffle: respects shuffleEnabled flag', () => {
    const list = ['Semua benar', 'Pilihan A', 'Pilihan B'];
    expect(maybeShuffle(list, 100, 'q1', false)).toEqual(list);
  });
});

// ==========================================
// Suite 4: Security & Anti-Leakage Projection (CI Mandatory)
// ==========================================
describe('Anti-Leakage Projection Suite', () => {
  const sampleSingleChoice = {
    _id: '64f100000000000000000001',
    schoolId: '64f100000000000000000099',
    questionKey: 'q_sc_1',
    version: 1,
    status: 'active',
    type: 'single_choice',
    subject: 'Fisika',
    topic: 'Kinematika',
    difficulty: 'medium',
    content: { text: 'Berapa gravitasi?', format: 'plain', dir: 'auto', lang: 'id' },
    payload: {
      options: [
        { id: 'opt_1', content: { text: '9.8 m/s^2', format: 'plain', dir: 'auto', lang: 'id' } },
        { id: 'opt_2', content: { text: '15 m/s^2', format: 'plain', dir: 'auto', lang: 'id' } },
      ],
      key: 'opt_1', // SECRET!
      shuffleOptions: true,
    },
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const sampleEssay = {
    _id: '64f100000000000000000004',
    schoolId: '64f100000000000000000099',
    questionKey: 'q_essay_1',
    version: 1,
    status: 'active',
    type: 'essay',
    subject: 'Fisika',
    topic: 'Dinamika',
    difficulty: 'hard',
    content: { text: 'Turunkan hukum Newton pada katrol.', format: 'plain', dir: 'auto', lang: 'id' },
    payload: {
      rubric: [{ id: 'c1', aspect: 'Diagram gaya', weight: 40 }], // SECRET!
      idealAnswer: { text: 'Jawaban ideal...', format: 'plain', dir: 'auto', lang: 'id' }, // SECRET!
      discussion: { text: 'Pembahasan lengkap...', format: 'plain', dir: 'auto', lang: 'id' }, // SECRET!
    },
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it('toStudentView strips secret key from single choice', () => {
    const studentView = toStudentView(sampleSingleChoice, 12345, seededShuffle, maybeShuffle);
    expect(studentView).not.toHaveProperty('key');
    expect(studentView).not.toHaveProperty('payload');
    expect(() => assertNoSecretLeak(studentView)).not.toThrow();
  });

  it('toStudentView strips rubric, idealAnswer, and discussion from essay', () => {
    const studentView = toStudentView(sampleEssay, 12345, seededShuffle, maybeShuffle);
    expect(studentView).not.toHaveProperty('rubric');
    expect(studentView).not.toHaveProperty('idealAnswer');
    expect(studentView).not.toHaveProperty('discussion');
    expect(studentView).not.toHaveProperty('payload');
    expect(() => assertNoSecretLeak(studentView)).not.toThrow();
  });

  it('assertNoSecretLeak catches any forbidden secret key anywhere in object hierarchy', () => {
    for (const forbidden of FORBIDDEN_SECRET_KEYS) {
      const contaminated = {
        title: 'Safe title',
        nested: {
          deep: {
            [forbidden]: 'leak_value',
          },
        },
      };

      expect(() => assertNoSecretLeak(contaminated)).toThrow();
    }
  });
});

// ==========================================
// Suite 5: Delivery Runtime & Idempotent Sync
// ==========================================
describe('Delivery Runtime & Idempotency Suite', () => {
  class MockCollection {
    constructor(name) {
      this.name = name;
      this.docs = [];
    }
    async findOne(filter) {
      return this.docs.find((doc) => {
        for (const [key, val] of Object.entries(filter)) {
          if (doc[key] !== val) return false;
        }
        return true;
      }) || null;
    }
    find(filter) {
      let matched = this.docs;
      if (filter._id?.$in) {
        const allowed = new Set(filter._id.$in);
        matched = matched.filter((d) => allowed.has(d._id));
      }
      return { toArray: async () => matched };
    }
    async insertOne(doc) {
      this.docs.push({ ...doc });
      return { insertedId: doc._id };
    }
    async updateOne(filter, update) {
      const doc = await this.findOne(filter);
      if (doc && update.$set) Object.assign(doc, update.$set);
      return { matchedCount: doc ? 1 : 0 };
    }
    async findOneAndUpdate(filter, update) {
      const doc = await this.findOne(filter);
      if (doc && update.$set) Object.assign(doc, update.$set);
      return doc;
    }
    async bulkWrite(ops) {
      for (const op of ops) {
        if (op.updateOne) {
          const { filter, update, upsert } = op.updateOne;
          const existing = this.docs.find(
            (d) => d.submissionId === filter.submissionId && d.questionId === filter.questionId
          );
          if (existing) {
            if (filter.clientSeq?.$lt && existing.clientSeq >= filter.clientSeq.$lt) {
              const err = new Error('E11000 duplicate key');
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
            this.docs.push(newDoc);
          }
        }
      }
      return { ok: 1 };
    }
  }

  class MockDb {
    constructor() {
      this.collections = {};
    }
    collection(name) {
      if (!this.collections[name]) this.collections[name] = new MockCollection(name);
      return this.collections[name];
    }
  }

  let mockDb;
  let service;

  const mockExam = {
    _id: 'exam_fisika_101',
    schoolId: 'school_1',
    ownerId: 'teacher_1',
    title: 'Penilaian Harian Fisika',
    status: 'published',
    questionRefs: [{ questionId: 'q_1', order: 1, points: 10, status: 'active', allCredit: false }],
    scheduling: {
      mode: 'self_paced',
      durationMinutes: 60,
      windowStart: new Date(Date.now() - 3600_000),
      windowEnd: new Date(Date.now() + 7200_000),
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

  const mockQuestion = {
    _id: 'q_1',
    schoolId: 'school_1',
    questionKey: 'q_fis_1',
    version: 1,
    status: 'active',
    type: 'single_choice',
    subject: 'Fisika',
    topic: 'Gerak Lurus',
    difficulty: 'easy',
    content: { text: 'Satuan kecepatan?', format: 'plain', dir: 'auto', lang: 'id' },
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
    service = new DeliveryService(mockDb);
  });

  it('startExam initializes authoritative deadline and strips keys', async () => {
    const res = await service.startExam('school_1', 'student_1', 'exam_fisika_101');
    expect(res.submissionId).toBeDefined();
    expect(res.exam.title).toBe('Penilaian Harian Fisika');
    const q0 = res.groups[0].questions[0];
    expect(q0.questionId).toBe('q_1');
    expect(q0.key).toBeUndefined();
  });

  it('syncAnswers is strictly idempotent with clientSeq', async () => {
    const startRes = await service.startExam('school_1', 'student_1', 'exam_fisika_101');
    const sid = startRes.submissionId;

    // 1. Initial sync with seq 1
    const s1 = await service.syncAnswers('school_1', 'student_1', sid, {
      items: [{ questionId: 'q_1', clientSeq: 1, clientSavedAt: new Date().toISOString(), inputData: { selected: 'opt_1' } }],
      events: [],
      ping: true,
    });
    expect(s1.accepted).toContain('q_1');
    expect(s1.stale).toHaveLength(0);

    // 2. Stale sync with seq 1 (duplicate/older)
    const sStale = await service.syncAnswers('school_1', 'student_1', sid, {
      items: [{ questionId: 'q_1', clientSeq: 1, clientSavedAt: new Date().toISOString(), inputData: { selected: 'opt_2' } }],
      events: [],
      ping: true,
    });
    expect(sStale.stale).toContain('q_1');

    // 3. Newer sync with seq 2
    const s2 = await service.syncAnswers('school_1', 'student_1', sid, {
      items: [{ questionId: 'q_1', clientSeq: 2, clientSavedAt: new Date().toISOString(), inputData: { selected: 'opt_2' } }],
      events: [],
      ping: true,
    });
    expect(s2.accepted).toContain('q_1');
  });

  it('submitExam transitions status to submitted', async () => {
    const startRes = await service.startExam('school_1', 'student_1', 'exam_fisika_101');
    const submitRes = await service.submitExam('school_1', 'student_1', startRes.submissionId);
    expect(submitRes.status).toBe('submitted');
  });
});

// ==========================================
// Suite 6: Auth & Token Security
// ==========================================
describe('Auth & Password Security Suite', () => {
  it('hashPassword & verifyPassword: generates cryptographically secure hash and verifies match', async () => {
    const password = 'SandiSiswaRahasia123!';
    const hashed = await hashPassword(password);

    expect(hashed).toBeDefined();
    expect(hashed.startsWith('scrypt$')).toBe(true);

    const isMatch = await verifyPassword(password, hashed);
    expect(isMatch).toBe(true);

    const isWrongMatch = await verifyPassword('SandiSalah123', hashed);
    expect(isWrongMatch).toBe(false);
  });

  it('TokenService: enforces limited scope for password_change_only vs full scope', () => {
    // 1. First-time login limited token
    const limitedToken = TokenService.signAccessToken({
      sub: 'student_123',
      schoolId: 'school_1',
      username: 'nis_001',
      roles: ['student'],
      scope: 'password_change_only',
    });

    const decodedLimited = TokenService.verifyToken(limitedToken);
    expect(decodedLimited.sub).toBe('student_123');
    expect(decodedLimited.scope).toBe('password_change_only');

    // 2. Full access token
    const fullToken = TokenService.signAccessToken({
      sub: 'student_123',
      schoolId: 'school_1',
      username: 'nis_001',
      roles: ['student'],
      scope: 'full',
    });

    const decodedFull = TokenService.verifyToken(fullToken);
    expect(decodedFull.scope).toBe('full');
  });
});

// Run all test suites asynchronously
await runAllTests();
