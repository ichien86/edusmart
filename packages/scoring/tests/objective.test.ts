import { describe, it, expect } from 'vitest';
import {
  scoreSingleChoice,
  scoreMultipleChoice,
  scoreTrueFalse,
  scoreMatching,
  round2,
} from '../src/objective.js';
import type {
  SingleChoicePayload,
  MultipleChoicePayload,
  TrueFalsePayload,
  MatchingPayload,
} from '@eduassess/schemas';

describe('Objective Scoring Suite', () => {
  it('scoreSingleChoice: awards full points for correct key, 0 for incorrect', () => {
    const payload: SingleChoicePayload = {
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
    const payload: MultipleChoicePayload = {
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

    // Both correct -> 100%
    expect(scoreMultipleChoice(payload, { selectedOptions: ['a', 'b'] }, 20)).toBe(20);

    // 1 correct, 0 incorrect -> 50%
    expect(scoreMultipleChoice(payload, { selectedOptions: ['a'] }, 20)).toBe(10);

    // 1 correct, 1 incorrect -> (1 - 1)/2 = 0
    expect(scoreMultipleChoice(payload, { selectedOptions: ['a', 'c'] }, 20)).toBe(0);

    // 1 correct, 2 incorrect -> (1 - 2)/2 = -0.5 -> floored to 0
    expect(scoreMultipleChoice(payload, { selectedOptions: ['a', 'c', 'd'] }, 20)).toBe(0);

    // All options selected (guessing exploit test) -> (2 - 2)/2 = 0
    expect(scoreMultipleChoice(payload, { selectedOptions: ['a', 'b', 'c', 'd'] }, 20)).toBe(0);
  });

  it('scoreMultipleChoice: all_or_nothing mode', () => {
    const payload: MultipleChoicePayload = {
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
    const payload: TrueFalsePayload = {
      statements: [
        { id: 's1', content: { text: 'S1', format: 'plain', dir: 'auto', lang: 'id' }, key: true },
        { id: 's2', content: { text: 'S2', format: 'plain', dir: 'auto', lang: 'id' }, key: false },
        { id: 's3', content: { text: 'S3', format: 'plain', dir: 'auto', lang: 'id' }, key: true },
        { id: 's4', content: { text: 'S4', format: 'plain', dir: 'auto', lang: 'id' }, key: false },
      ],
      scoringMode: 'partial',
    };

    // All 4 correct
    expect(scoreTrueFalse(payload, { statements: { s1: true, s2: false, s3: true, s4: false } }, 20)).toBe(20);

    // 2 correct (50%)
    expect(scoreTrueFalse(payload, { statements: { s1: true, s2: false, s3: false, s4: true } }, 20)).toBe(10);

    // Null or omitted count as incorrect
    expect(scoreTrueFalse(payload, { statements: { s1: true } }, 20)).toBe(5);
  });

  it('scoreMatching: scores proportional to correctly matched pairs', () => {
    const payload: MatchingPayload = {
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
