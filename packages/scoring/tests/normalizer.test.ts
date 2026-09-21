import { describe, it, expect } from 'vitest';
import {
  normText,
  parseIdNumber,
  normArabic,
} from '../src/normalizer.js';
import { scoreShortAnswer } from '../src/short_answer.js';
import type { ShortAnswerPayload } from '@eduassess/schemas';

describe('Normalizers & Short Answer Suite', () => {
  describe('Indonesian Number Parser', () => {
    it('parses comma decimals (9,8 -> 9.8)', () => {
      expect(parseIdNumber('9,8')).toBe(9.8);
      expect(parseIdNumber(' 150,25 ')).toBe(150.25);
    });

    it('parses dot decimals (9.8 -> 9.8)', () => {
      expect(parseIdNumber('9.8')).toBe(9.8);
    });

    it('parses dot thousands with comma decimal (1.000,5 -> 1000.5)', () => {
      expect(parseIdNumber('1.000,5')).toBe(1000.5);
      expect(parseIdNumber('2.500.000,75')).toBe(2500000.75);
    });

    it('parses plain integer and dot thousands (1.000 -> 1000)', () => {
      expect(parseIdNumber('1000')).toBe(1000);
      expect(parseIdNumber('1.000')).toBe(1000);
    });

    it('parses scientific notation', () => {
      expect(parseIdNumber('1.5e-3')).toBe(0.0015);
      expect(parseIdNumber('2,5E2')).toBe(250);
    });

    it('returns null on invalid / non-numeric text', () => {
      expect(parseIdNumber('sepuluh')).toBeNull();
      expect(parseIdNumber('12a.5')).toBeNull();
    });
  });

  describe('Arabic Normalizer (NFC & BiDi Clean)', () => {
    it('normalizes harakat in ignore_harakat mode while preserving base letters', () => {
      // كَتَبَ (with fathah) vs كتب (plain)
      const withHarakat = 'كَتَبَ';
      const plain = 'كتب';
      expect(normArabic(withHarakat, { mode: 'ignore_harakat' })).toBe(plain);
    });

    it('removes Tatweel / Kashida and BiDi control characters', () => {
      // كـــتــاب with tatweel and hidden BiDi marks
      const tatweel = 'كـــتــاب\u200E';
      const clean = 'كتاب';
      expect(normArabic(tatweel)).toBe(clean);
    });

    it('unifies Alif variants when enabled', () => {
      expect(normArabic('أحمد', { unifyAlif: true })).toBe('احمد');
      expect(normArabic('إبراهيم', { unifyAlif: true })).toBe('ابراهيم');
    });

    it('unifies Ta Marbuta and Ya', () => {
      expect(normArabic('مدرسة', { unifyTaMarbuta: true })).toBe('مدرسه');
      expect(normArabic('هدى', { unifyYa: true })).toBe('هدي');
    });
  });

  describe('Short Answer Evaluation', () => {
    it('scores text answers with case and punctuation insensitivity', () => {
      const payload: ShortAnswerPayload = {
        answerKind: 'text',
        acceptedAnswers: ['Soekarno-Hatta', 'Ir. Soekarno'],
      };

      expect(scoreShortAnswer(payload, { text: 'soekarno hatta' }, 10).isCorrect).toBe(true);
      expect(scoreShortAnswer(payload, { text: 'ir soekarno' }, 10).isCorrect).toBe(true);
      expect(scoreShortAnswer(payload, { text: 'Suharto' }, 10).isCorrect).toBe(false);
    });

    it('scores numeric answers with tolerance (e.g. 9,8 vs 9.81 within 1%)', () => {
      const payload: ShortAnswerPayload = {
        answerKind: 'numeric',
        acceptedAnswers: ['9.8'],
        tolerance: { rel: 0.01 }, // 1% tolerance
      };

      // 9,8 (Indonesian comma) matches 9.8
      expect(scoreShortAnswer(payload, { text: '9,8' }, 10).isCorrect).toBe(true);
      // 9.85 is within 1% (9.8 +/- 0.098 -> [9.702, 9.898])
      expect(scoreShortAnswer(payload, { text: '9.85' }, 10).isCorrect).toBe(true);
      // 10.5 is out of tolerance
      expect(scoreShortAnswer(payload, { text: '10.5' }, 10).isCorrect).toBe(false);
    });

    it('flags unparseable numbers as needsReview instead of zero score', () => {
      const payload: ShortAnswerPayload = {
        answerKind: 'numeric',
        acceptedAnswers: ['10'],
      };

      const result = scoreShortAnswer(payload, { text: 'sepuluh' }, 10);
      expect(result.isCorrect).toBe(false);
      expect(result.needsReview).toBe(true);
    });
  });
});

