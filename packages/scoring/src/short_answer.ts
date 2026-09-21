import type { ShortAnswerPayload } from '@eduassess/schemas';
import {
  normText,
  parseIdNumber,
  isNumberEqualWithTolerance,
  normArabic,
} from './normalizer.js';
import { round2 } from './objective.js';

export interface ShortAnswerEvaluationResult {
  score: number;
  isCorrect: boolean;
  needsReview: boolean;
  matchedKey?: string;
}

/**
 * Score short answer based on answerKind: text, numeric, or arabic.
 * (Algebraic / CAS is handled by Python worker).
 */
export function scoreShortAnswer(
  payload: ShortAnswerPayload,
  answer: { text?: string | null },
  points: number
): ShortAnswerEvaluationResult {
  const rawText = answer?.text?.trim() ?? '';

  if (!rawText) {
    return { score: 0, isCorrect: false, needsReview: false };
  }

  // 1. Text Kind
  if (payload.answerKind === 'text') {
    const studentNorm = normText(rawText, { stripPunct: true, stripDiacritics: true });
    for (const accepted of payload.acceptedAnswers) {
      const acceptedNorm = normText(accepted, { stripPunct: true, stripDiacritics: true });
      if (studentNorm === acceptedNorm) {
        return { score: points, isCorrect: true, needsReview: false, matchedKey: accepted };
      }
    }
    return { score: 0, isCorrect: false, needsReview: false };
  }

  // 2. Numeric Kind
  if (payload.answerKind === 'numeric') {
    const parsedStudent = parseIdNumber(rawText);
    if (parsedStudent === null) {
      // Unparseable number format -> Mark for teacher review rather than flat zero
      return { score: 0, isCorrect: false, needsReview: true };
    }

    for (const accepted of payload.acceptedAnswers) {
      const parsedKey = parseIdNumber(accepted);
      if (parsedKey !== null && isNumberEqualWithTolerance(parsedStudent, parsedKey, payload.tolerance)) {
        return { score: points, isCorrect: true, needsReview: false, matchedKey: accepted };
      }
    }
    return { score: 0, isCorrect: false, needsReview: false };
  }

  // 3. Arabic Kind
  if (payload.answerKind === 'arabic') {
    const opts = payload.arabicOpts ?? {
      mode: 'ignore_harakat',
      unifyAlif: true,
      unifyYa: true,
      unifyTaMarbuta: true,
    };
    const studentNorm = normArabic(rawText, opts);

    for (const accepted of payload.acceptedAnswers) {
      const acceptedNorm = normArabic(accepted, opts);
      if (studentNorm === acceptedNorm) {
        return { score: points, isCorrect: true, needsReview: false, matchedKey: accepted };
      }
    }
    return { score: 0, isCorrect: false, needsReview: false };
  }

  // 4. Algebraic: requires Python CAS worker
  return { score: 0, isCorrect: false, needsReview: true };
}
