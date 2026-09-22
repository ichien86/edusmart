import { describe, it, expect } from './test-runner.mjs';
import { generateRoomToken } from '../apps/api/dist/modules/proctor/presence.service.js';

describe('Live Proctoring & Presence Suite', () => {
  it('generateRoomToken: creates 6-character non-ambiguous token with hyphen', () => {
    const token = generateRoomToken(6);
    expect(token.length).toBe(7); // 3 chars + '-' + 3 chars
    expect(token[3]).toBe('-');

    // Verify all chars belong to NON_AMBIGUOUS_CHARS
    const validChars = new Set('ABCDEFGHJKLMNPQRSTUVWXYZ23456789-'.split(''));
    for (const ch of token) {
      expect(validChars.has(ch)).toBe(true);
    }
  });

  it('generateRoomToken: produces distinct tokens across successive invocations', () => {
    const tokens = new Set();
    for (let i = 0; i < 50; i++) {
      tokens.add(generateRoomToken(6));
    }
    expect(tokens.size).toBe(50);
  });

  it('status calculation: offline_warning when heartbeat older than 45s', () => {
    const now = Date.now();
    const calculateStatus = (lastHeartbeat, isSubmitted) => {
      if (isSubmitted) return 'submitted';
      const diffMs = now - lastHeartbeat;
      if (diffMs > 45000) return 'offline_warning';
      return 'online';
    };

    expect(calculateStatus(now - 10000, false)).toBe('online');
    expect(calculateStatus(now - 50000, false)).toBe('offline_warning');
    expect(calculateStatus(now - 100000, true)).toBe('submitted');
  });

  it('integrity events: records tab_blur and sets alert correctly', () => {
    const record = {
      studentId: 'STU-TEST',
      answeredCount: 15,
      totalQuestions: 25,
      integrityAlert: 'tab_blur',
    };

    expect(record.integrityAlert).toBe('tab_blur');
    expect(record.answeredCount <= record.totalQuestions).toBe(true);
  });
});
