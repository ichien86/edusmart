import crypto from 'node:crypto';
import type { RubricCriterion } from '@eduassess/schemas';
import { getLLMProvider, type ILLMProvider } from './llm-provider.js';

export interface EvaluatedSuggestion {
  score: number;
  confidence: number;
  reviewPriority: 'high' | 'medium' | 'low';
  evidenceValidRatio: number;
  inSample: boolean;
  reasoning: string;
  criteriaResults: Array<{
    criterionId: string;
    aspect: string;
    score: number;
    maxScore: number;
    evidence: string;
    evidenceValid: boolean;
    reasoning: string;
  }>;
  flags: string[];
}

/**
 * Normalizes text for lenient substring comparison:
 * strips punctuation, unifies multiple whitespace, and lowercases.
 */
export function normalizeForSearch(text: string): string {
  return (text || '')
    .toLowerCase()
    .replace(/[.,/#!$%^&*;:{}=\-_`~()?"'’“”]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Checks if candidate evidence string appears as a verbatim or near-verbatim
 * substring within the student's answer.
 */
export function isEvidenceSubstring(evidence: string, studentAnswer: string): boolean {
  if (!evidence || evidence.trim().length === 0) {
    return false;
  }

  const normEvidence = normalizeForSearch(evidence);
  const normAnswer = normalizeForSearch(studentAnswer);

  if (normAnswer.includes(normEvidence)) {
    return true;
  }

  // Also check if at least 70% of words in the evidence sentence appear sequentially
  const evidenceWords = normEvidence.split(' ').filter((w) => w.length > 2);
  if (evidenceWords.length >= 4) {
    const chunk = evidenceWords.slice(0, Math.ceil(evidenceWords.length * 0.75)).join(' ');
    if (normAnswer.includes(chunk)) {
      return true;
    }
  }

  return false;
}

export class EssayEvaluatorService {
  private provider: ILLMProvider;

  constructor(provider?: ILLMProvider) {
    this.provider = provider || getLLMProvider();
  }

  async evaluate(params: {
    questionPrompt: string;
    studentAnswer: string;
    rubric: RubricCriterion[];
    idealAnswer?: string;
  }): Promise<EvaluatedSuggestion> {
    const { questionPrompt, studentAnswer, rubric, idealAnswer } = params;

    // 1. Generate unique cryptographic nonce to isolate student answer
    const nonce = crypto.randomBytes(8).toString('hex');

    // 2. Call LLM provider
    const rawResult = await this.provider.evaluateEssay({
      questionPrompt,
      studentAnswer,
      rubric,
      idealAnswer,
      nonce,
    });

    // 3. Post-process evidence validation (Hallucination detector)
    let validCount = 0;
    const totalCriteria = rawResult.criteriaResults.length || 1;

    const validatedCriteria = rawResult.criteriaResults.map((crit) => {
      const evidence = crit.evidence || '';
      let evidenceValid = false;

      if (!evidence.trim()) {
        // If score is 0, empty evidence is considered valid
        evidenceValid = crit.score === 0;
      } else {
        evidenceValid = isEvidenceSubstring(evidence, studentAnswer);
      }

      if (evidenceValid) {
        validCount++;
      }

      return {
        ...crit,
        evidenceValid,
      };
    });

    const evidenceValidRatio = Math.round((validCount / totalCriteria) * 100) / 100;
    const flags = [...(rawResult.flags || [])];

    if (evidenceValidRatio < 0.8 && studentAnswer.trim().length > 0) {
      flags.push('unverified_evidence');
    }

    // 4. Determine review priority for human teacher
    let reviewPriority: 'high' | 'medium' | 'low' = 'low';
    let adjustedConfidence = rawResult.confidence;

    if (evidenceValidRatio < 0.8) {
      adjustedConfidence = Math.min(adjustedConfidence, 0.65);
    }

    if (
      adjustedConfidence < 0.7 ||
      evidenceValidRatio < 0.8 ||
      flags.includes('adversarial_prompt_attempt') ||
      flags.includes('empty_answer') ||
      flags.includes('unverified_evidence')
    ) {
      reviewPriority = 'high';
    } else if (adjustedConfidence < 0.85 || evidenceValidRatio < 0.9) {
      reviewPriority = 'medium';
    } else {
      reviewPriority = 'low';
    }

    return {
      score: rawResult.score,
      confidence: adjustedConfidence,
      reviewPriority,
      evidenceValidRatio,
      inSample: true,
      reasoning: rawResult.reasoning,
      criteriaResults: validatedCriteria,
      flags,
    };
  }
}
