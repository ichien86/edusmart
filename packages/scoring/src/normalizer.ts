export interface TextNormalizeOptions {
  stripPunct?: boolean;
  stripDiacritics?: boolean;
}

/**
 * Unicode NFKC text normalizer with optional diacritics and punctuation removal.
 * Cleans BiDi and invisible control characters.
 */
export function normText(s: string, options: TextNormalizeOptions = {}): string {
  if (!s) return '';
  // 1. Normalize NFKC, lowercase, strip zero-width and directional control characters
  let t = s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g, '');

  // 2. Strip diacritics / accents if requested
  if (options.stripDiacritics) {
    t = t.normalize('NFD').replace(/\p{M}/gu, '').normalize('NFC');
  }

  // 3. Strip punctuation & symbols to space
  if (options.stripPunct) {
    t = t.replace(/[\p{P}\p{S}]/gu, ' ');
  }

  // 4. Collapse whitespace
  return t.replace(/\s+/g, ' ').trim();
}

/**
 * Indonesian Number Parser.
 * Handles:
 * - 1.000,5 (dot thousands, comma decimal) -> 1000.5
 * - 9,8 (comma decimal) -> 9.8
 * - 9.8 (dot decimal) -> 9.8
 * - 1.000 (interpreted as 1000)
 * - 1.5e-3 (scientific notation) -> 0.0015
 * Returns null if string is unparseable.
 */
export function parseIdNumber(raw: string): number | null {
  if (!raw) return null;
  const s = raw.trim().replace(/\s+/g, '');

  // Pattern 1: Dot thousands with comma decimal (e.g. 1.000,5 or 2.500.000,75)
  if (/^[+-]?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) {
    return Number(s.replace(/\./g, '').replace(',', '.'));
  }

  // Pattern 2: Comma decimal without thousands dot (e.g. 9,8 or 150,25)
  if (/^[+-]?\d+(,\d+)?$/.test(s)) {
    return Number(s.replace(',', '.'));
  }

  // Pattern 3: Standard dot decimal or plain integer (e.g. 9.8 or 100)
  if (/^[+-]?\d+(\.\d+)?$/.test(s)) {
    return Number(s);
  }

  // Pattern 4: Scientific notation (e.g. 1.5e-3 or 2,5E4)
  if (/^[+-]?\d+([.,]\d+)?[eE][+-]?\d+$/.test(s)) {
    return Number(s.replace(',', '.'));
  }

  return null;
}

/**
 * Checks if a student's numeric answer is within allowed tolerance:
 * |a - k| <= max(absTolerance, relTolerance * |k|)
 */
export function isNumberEqualWithTolerance(
  studentVal: number,
  keyVal: number,
  tolerance?: { abs?: number; rel?: number }
): boolean {
  const absAllowed = tolerance?.abs ?? 0;
  const relAllowed = (tolerance?.rel ?? 0) * Math.abs(keyVal);
  const allowedDiff = Math.max(absAllowed, relAllowed);
  return Math.abs(studentVal - keyVal) <= allowedDiff + Number.EPSILON;
}

export interface ArabicNormalizeOptions {
  mode?: 'ignore_harakat' | 'strict';
  unifyAlif?: boolean;
  unifyYa?: boolean;
  unifyTaMarbuta?: boolean;
}

const ARABIC_HARAKAT = /[\u064B-\u0652\u0670]/g; // Fathatan, Dammatan, Kasratan, Fathah, Dammah, Kasrah, Syaddah, Sukun, Alif Khanjariyah
const ARABIC_TATWEEL = /\u0640/g;
const BIDI_CHARS = /[\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g;

/**
 * Arabic normalizer using Unicode NFC.
 * Handles canonical combining class ordering, harakat removal, and letter unification.
 */
export function normArabic(s: string, options: ArabicNormalizeOptions = {}): string {
  if (!s) return '';
  // 1. NFC normalization orders combining marks canonically
  let t = s.normalize('NFC').replace(BIDI_CHARS, '').replace(ARABIC_TATWEEL, '');

  // 2. Remove harakat if in ignore mode (keeps Maddah/Hamza in NFC)
  if (options.mode === 'ignore_harakat') {
    t = t.replace(ARABIC_HARAKAT, '');
  }

  // 3. Unify Alif variants (أ, إ, آ, ٱ -> ا)
  if (options.unifyAlif) {
    t = t.replace(/[أإآٱ]/g, 'ا');
  }

  // 4. Unify Ya / Alif Maqsurah (ى -> ي)
  if (options.unifyYa) {
    t = t.replace(/ى/g, 'ي');
  }

  // 5. Unify Ta Marbuta (ة -> ه)
  if (options.unifyTaMarbuta) {
    t = t.replace(/ة/g, 'ه');
  }

  return t.replace(/\s+/g, ' ').trim();
}

