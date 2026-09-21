import { describe, it, expect } from 'vitest';
import { mulberry32, seededShuffle, maybeShuffle, hashString } from '../src/index.js';

describe('Seeded Shuffle Suite', () => {
  it('mulberry32: produces strictly deterministic float sequences for identical seed', () => {
    const rng1 = mulberry32(123456);
    const rng2 = mulberry32(123456);

    const seq1 = [rng1(), rng1(), rng1(), rng1()];
    const seq2 = [rng2(), rng2(), rng2(), rng2()];

    expect(seq1).toEqual(seq2);
    expect(seq1[0]).toBeGreaterThanOrEqual(0);
    expect(seq1[0]).toBeLessThan(1);
  });

  it('seededShuffle: produces identical permutation for identical seed & keyModifier', () => {
    const original = ['A', 'B', 'C', 'D', 'E', 'F'];
    const seed = 987654;
    const modifier = 'question_1';

    const shuffled1 = seededShuffle(original, seed, modifier);
    const shuffled2 = seededShuffle(original, seed, modifier);

    expect(shuffled1).toEqual(shuffled2);
    // Original array must remain unmodified (pure function)
    expect(original).toEqual(['A', 'B', 'C', 'D', 'E', 'F']);
    // Shuffled array contains exact same items
    expect(new Set(shuffled1)).toEqual(new Set(original));
  });

  it('maybeShuffle: respects shuffleEnabled flag', () => {
    const original = ['Semua jawaban benar', 'Opsi A', 'Opsi B'];
    const seed = 42;

    const notShuffled = maybeShuffle(original, seed, 'q_lock', false);
    expect(notShuffled).toEqual(original);

    const shuffled = maybeShuffle(original, seed, 'q_lock', true);
    expect(new Set(shuffled)).toEqual(new Set(original));
  });

  it('hashString: produces consistent 32-bit unsigned integers', () => {
    expect(hashString('question_123', 42)).toBe(hashString('question_123', 42));
    expect(hashString('question_123', 42)).not.toBe(hashString('question_124', 42));
  });
});
