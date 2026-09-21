/**
 * Simple 32-bit string hash (Murmur3-like / FNV mix) to combine seed and string keys.
 */
export function hashString(str: string, seed = 0): number {
  let h = seed >>> 0;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 0x5bd1e995);
    h ^= h >>> 15;
  }
  return h >>> 0;
}

/**
 * 32-bit Mulberry32 PRNG.
 * Generates deterministic pseudo-random float numbers in range [0, 1).
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Fisher-Yates shuffle with seeded PRNG.
 * Pure function: does not mutate the input array.
 */
export function seededShuffle<T>(array: readonly T[], seed: number, keyModifier = ''): T[] {
  const combinedSeed = keyModifier ? hashString(keyModifier, seed) : seed;
  const rng = mulberry32(combinedSeed);
  const result = [...array];

  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const temp = result[i]!;
    result[i] = result[j]!;
    result[j] = temp;
  }

  return result;
}

/**
 * Conditionally shuffle an array based on shuffleEnabled flag.
 */
export function maybeShuffle<T>(
  array: readonly T[],
  seed: number,
  keyModifier = '',
  shuffleEnabled = true
): T[] {
  if (!shuffleEnabled) {
    return [...array];
  }
  return seededShuffle(array, seed, keyModifier);
}
