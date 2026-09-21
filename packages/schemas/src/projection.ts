import type { Question, StudentQuestion } from './question.js';

export interface ShuffleFunction<T> {
  (array: readonly T[], seed: number, keyModifier?: string): T[];
}

export interface MaybeShuffleFunction<T> {
  (array: readonly T[], seed: number, keyModifier?: string, enabled?: boolean): T[];
}

/**
 * Whitelist projection: Converts a full server Question into a safe StudentQuestion.
 * Guarantees that secret fields (key, keys, pairs, acceptedAnswers, rubric, idealAnswer, discussion)
 * are NEVER included in the returned object.
 */
export function toStudentView(
  q: Question,
  seed: number,
  shuffleFn?: ShuffleFunction<any>,
  maybeShuffleFn?: MaybeShuffleFunction<any>
): StudentQuestion {
  const base: StudentQuestion = {
    questionId: q._id,
    order: 0,
    points: 0,
    type: q.type,
    content: q.content,
    stimulusId: q.stimulusId ?? null,
  };

  const payload = q.payload as any;

  switch (q.type) {
    case 'single_choice':
    case 'multiple_choice': {
      const rawOptions = payload.options.map((o: any) => ({
        id: o.id,
        content: o.content,
      }));
      const shuffleEnabled = payload.shuffleOptions ?? true;
      const finalOptions = maybeShuffleFn
        ? maybeShuffleFn(rawOptions, seed, q._id, shuffleEnabled)
        : rawOptions;
      return {
        ...base,
        options: finalOptions,
      };
    }

    case 'true_false': {
      return {
        ...base,
        statements: payload.statements.map((s: any) => ({
          id: s.id,
          content: s.content,
        })),
      };
    }

    case 'matching': {
      const premises = payload.premises.map((p: any) => ({
        id: p.id,
        content: p.content,
      }));
      const rawResponses = payload.responses.map((r: any) => ({
        id: r.id,
        content: r.content,
      }));
      const finalResponses = shuffleFn
        ? shuffleFn(rawResponses, seed, q._id)
        : rawResponses;
      return {
        ...base,
        premises,
        responses: finalResponses,
      };
    }

    case 'short_answer': {
      return {
        ...base,
        answerKind: payload.answerKind,
        unit: payload.unit ?? null,
      };
    }

    case 'essay': {
      // Rubric, ideal answer, and discussions are strictly withheld during exam
      return {
        ...base,
      };
    }

    default:
      throw new Error(`Unhandled question type: ${(q as any).type}`);
  }
}

/**
 * Deep scan verification function for CI tests.
 * Asserts that no forbidden secret property names exist anywhere in the object tree.
 */
export const FORBIDDEN_SECRET_KEYS = new Set([
  'key',
  'keys',
  'pairs',
  'acceptedAnswers',
  'rubric',
  'idealAnswer',
  'discussion',
]);

export function assertNoSecretLeak(obj: unknown, path = ''): void {
  if (!obj || typeof obj !== 'object') {
    return;
  }

  if (Array.isArray(obj)) {
    obj.forEach((item, index) => assertNoSecretLeak(item, `${path}[${index}]`));
    return;
  }

  for (const [key, value] of Object.entries(obj)) {
    const currentPath = path ? `${path}.${key}` : key;
    if (FORBIDDEN_SECRET_KEYS.has(key)) {
      throw new Error(`CRITICAL SECURITY VIOLATION: Secret field "${key}" leaked at "${currentPath}"`);
    }
    assertNoSecretLeak(value, currentPath);
  }
}
