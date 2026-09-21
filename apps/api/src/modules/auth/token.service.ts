import jwt from 'jsonwebtoken';
import { AppError } from '../../plugins/error-handler.js';

const JWT_SECRET = process.env.JWT_ACCESS_SECRET || 'dev_jwt_secret_must_be_changed_in_prod';
const ACCESS_TTL = Number(process.env.JWT_ACCESS_TTL_S || 900); // 15 minutes

export interface AccessTokenPayload {
  sub: string;
  schoolId: string;
  username: string;
  roles: string[];
  scope: 'full' | 'password_change_only';
}

export interface ExamTokenPayload {
  sub: string;
  schoolId: string;
  submissionId: string;
  examId: string;
  scope: 'exam_sync';
}

export class TokenService {
  static signAccessToken(payload: AccessTokenPayload): string {
    return jwt.sign(payload, JWT_SECRET, {
      expiresIn: payload.scope === 'password_change_only' ? '10m' : ACCESS_TTL,
    });
  }

  static signExamToken(payload: ExamTokenPayload, expiresInSeconds: number): string {
    return jwt.sign(payload, JWT_SECRET, {
      expiresIn: expiresInSeconds,
    });
  }

  static verifyToken<T = AccessTokenPayload>(token: string): T {
    try {
      return jwt.verify(token, JWT_SECRET) as T;
    } catch (err: any) {
      if (err?.name === 'TokenExpiredError') {
        throw new AppError(401, 'TOKEN_EXPIRED', 'Token Expired', 'Your session token has expired.');
      }
      throw new AppError(401, 'TOKEN_INVALID', 'Invalid Token', 'Session token is invalid or corrupted.');
    }
  }
}
