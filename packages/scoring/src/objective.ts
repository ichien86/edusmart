import type {
  SingleChoicePayload,
  MultipleChoicePayload,
  TrueFalsePayload,
  MatchingPayload,
} from '@eduassess/schemas';

/**
 * Standard 2-decimal rounding with EPSILON protection.
 */
export const round2 = (x: number): number => {
  return Math.round((x + Number.EPSILON) * 100) / 100;
};

/**
 * Score single choice question.
 */
export function scoreSingleChoice(
  payload: SingleChoicePayload,
  answer: { selected?: string | null },
  points: number
): number {
  if (!answer?.selected) {
    return 0;
  }
  return round2(answer.selected === payload.key ? points : 0);
}

/**
 * Score multiple choice (PGK) question.
 * Supports partial scoring (TP - FP) / keys.size with floor 0, or all_or_nothing.
 */
export function scoreMultipleChoice(
  payload: MultipleChoicePayload,
  answer: { selectedOptions?: string[] | null },
  points: number
): number {
  const validOptionIds = new Set(payload.options.map((o) => o.id));
  const keys = new Set(payload.keys);

  if (keys.size === 0) {
    return 0;
  }

  // Filter out invalid/unknown IDs from student submission
  const selected = new Set((answer?.selectedOptions ?? []).filter((id) => validOptionIds.has(id)));

  let tp = 0; // True Positives: correctly selected
  let fp = 0; // False Positives: incorrectly selected

  for (const id of selected) {
    if (keys.has(id)) {
      tp++;
    } else {
      fp++;
    }
  }

  if (payload.scoringMode === 'all_or_nothing') {
    const isExact = tp === keys.size && fp === 0;
    return round2(isExact ? points : 0);
  }

  // Partial scoring: Math.max(0, (TP - FP) / keys.size)
  const ratio = Math.max(0, (tp - fp) / keys.size);
  return round2(points * ratio);
}

/**
 * Score True/False (Benar/Salah) compound statements question.
 */
export function scoreTrueFalse(
  payload: TrueFalsePayload,
  answer: { statements?: Record<string, boolean | null> | null },
  points: number
): number {
  const total = payload.statements.length;
  if (total === 0) return 0;

  const userAnswers = answer?.statements ?? {};
  let correctCount = 0;

  for (const statement of payload.statements) {
    if (userAnswers[statement.id] === statement.key) {
      correctCount++;
    }
  }

  if (payload.scoringMode === 'all_or_nothing') {
    return round2(correctCount === total ? points : 0);
  }

  const ratio = correctCount / total;
  return round2(points * ratio);
}

/**
 * Score Matching (Menjodohkan) question.
 */
export function scoreMatching(
  payload: MatchingPayload,
  answer: { pairs?: Record<string, string | null> | null },
  points: number
): number {
  const expectedPairs = new Map(payload.pairs.map((p) => [p.premiseId, p.responseId]));
  const total = expectedPairs.size;
  if (total === 0) return 0;

  const userPairs = answer?.pairs ?? {};
  let correctCount = 0;

  for (const [premiseId, expectedResponseId] of expectedPairs) {
    if (userPairs[premiseId] === expectedResponseId) {
      correctCount++;
    }
  }

  if (payload.scoringMode === 'all_or_nothing') {
    return round2(correctCount === total ? points : 0);
  }

  const ratio = correctCount / total;
  return round2(points * ratio);
}
