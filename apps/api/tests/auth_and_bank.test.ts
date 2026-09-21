import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from '../src/modules/auth/password.util.js';
import { TokenService } from '../src/modules/auth/token.service.js';

describe('Auth & Password Security Suite', () => {
  it('hashPassword & verifyPassword: generates cryptographically secure hash and verifies match', async () => {
    const password = 'SandiSiswaRahasia123!';
    const hashed = await hashPassword(password);

    expect(hashed).toBeDefined();
    expect(hashed.startsWith('scrypt$')).toBe(true);

    const isMatch = await verifyPassword(password, hashed);
    expect(isMatch).toBe(true);

    const isWrongMatch = await verifyPassword('SandiSalah123', hashed);
    expect(isWrongMatch).toBe(false);
  });

  it('TokenService: enforces limited scope for password_change_only vs full scope', () => {
    // 1. First-time login limited token
    const limitedToken = TokenService.signAccessToken({
      sub: 'student_123',
      schoolId: 'school_1',
      username: 'nis_001',
      roles: ['student'],
      scope: 'password_change_only',
    });

    const decodedLimited = TokenService.verifyToken(limitedToken);
    expect(decodedLimited.sub).toBe('student_123');
    expect(decodedLimited.scope).toBe('password_change_only');

    // 2. Full access token
    const fullToken = TokenService.signAccessToken({
      sub: 'student_123',
      schoolId: 'school_1',
      username: 'nis_001',
      roles: ['student'],
      scope: 'full',
    });

    const decodedFull = TokenService.verifyToken(fullToken);
    expect(decodedFull.scope).toBe('full');
  });
});

