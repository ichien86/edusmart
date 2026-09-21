import { describe, it, expect } from 'vitest';
import {
  type Question,
  toStudentView,
  assertNoSecretLeak,
  FORBIDDEN_SECRET_KEYS,
} from '../src/projection.js';

describe('Anti-Leakage Projection Suite (CI Mandatory)', () => {
  const sampleSingleChoice: Question = {
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

  const sampleMultipleChoice: Question = {
    _id: '64f100000000000000000002',
    schoolId: '64f100000000000000000099',
    questionKey: 'q_mc_1',
    version: 1,
    status: 'active',
    type: 'multiple_choice',
    subject: 'Biologi',
    topic: 'Sel',
    difficulty: 'hard',
    content: { text: 'Pilih organel sel tumbuhan:', format: 'plain', dir: 'auto', lang: 'id' },
    payload: {
      options: [
        { id: 'a', content: { text: 'Kloroplas', format: 'plain', dir: 'auto', lang: 'id' } },
        { id: 'b', content: { text: 'Dinding Sel', format: 'plain', dir: 'auto', lang: 'id' } },
        { id: 'c', content: { text: 'Sentriol', format: 'plain', dir: 'auto', lang: 'id' } },
      ],
      keys: ['a', 'b'], // SECRET!
      scoringMode: 'partial',
      shuffleOptions: true,
    },
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const sampleMatching: Question = {
    _id: '64f100000000000000000003',
    schoolId: '64f100000000000000000099',
    questionKey: 'q_match_1',
    version: 1,
    status: 'active',
    type: 'matching',
    subject: 'Geografi',
    topic: 'Ibukota',
    difficulty: 'easy',
    content: { text: 'Jodohkan negara dan ibukotanya:', format: 'plain', dir: 'auto', lang: 'id' },
    payload: {
      premises: [
        { id: 'p1', content: { text: 'Indonesia', format: 'plain', dir: 'auto', lang: 'id' } },
        { id: 'p2', content: { text: 'Jepang', format: 'plain', dir: 'auto', lang: 'id' } },
      ],
      responses: [
        { id: 'r1', content: { text: 'Jakarta', format: 'plain', dir: 'auto', lang: 'id' } },
        { id: 'r2', content: { text: 'Tokyo', format: 'plain', dir: 'auto', lang: 'id' } },
      ],
      pairs: [
        { premiseId: 'p1', responseId: 'r1' }, // SECRET!
        { premiseId: 'p2', responseId: 'r2' }, // SECRET!
      ],
      scoringMode: 'partial',
    },
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const sampleEssay: Question = {
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
      rubric: [
        { id: 'c1', aspect: 'Diagram gaya', weight: 40 }, // SECRET!
        { id: 'c2', aspect: 'Persamaan gerak', weight: 60 }, // SECRET!
      ],
      idealAnswer: { text: 'Jawaban ideal...', format: 'plain', dir: 'auto', lang: 'id' }, // SECRET!
      discussion: { text: 'Pembahasan lengkap...', format: 'plain', dir: 'auto', lang: 'id' }, // SECRET!
    },
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it('toStudentView excludes secret key on single_choice', () => {
    const studentView = toStudentView(sampleSingleChoice, 12345);
    expect(studentView).not.toHaveProperty('key');
    expect(studentView).not.toHaveProperty('payload');
    expect(() => assertNoSecretLeak(studentView)).not.toThrow();
  });

  it('toStudentView excludes secret keys on multiple_choice', () => {
    const studentView = toStudentView(sampleMultipleChoice, 12345);
    expect(studentView).not.toHaveProperty('keys');
    expect(studentView).not.toHaveProperty('payload');
    expect(() => assertNoSecretLeak(studentView)).not.toThrow();
  });

  it('toStudentView excludes pairs on matching', () => {
    const studentView = toStudentView(sampleMatching, 12345);
    expect(studentView).not.toHaveProperty('pairs');
    expect(studentView).not.toHaveProperty('payload');
    expect(() => assertNoSecretLeak(studentView)).not.toThrow();
  });

  it('toStudentView excludes rubric, idealAnswer, and discussion on essay', () => {
    const studentView = toStudentView(sampleEssay, 12345);
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

      expect(() => assertNoSecretLeak(contaminated)).toThrowError(
        `CRITICAL SECURITY VIOLATION: Secret field "${forbidden}" leaked at "nested.deep.${forbidden}"`
      );
    }
  });
});

