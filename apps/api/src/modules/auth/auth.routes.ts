import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { Db } from 'mongodb';
import { hashPassword, verifyPassword } from './password.util.js';
import { TokenService, type AccessTokenPayload } from './token.service.js';
import { AppError } from '../../plugins/error-handler.js';

const LoginRequestSchema = z.object({
  schoolId: z.string().min(1),
  username: z.string().min(1),
  password: z.string().min(1),
});

const ChangePasswordRequestSchema = z.object({
  oldPassword: z.string().min(1),
  newPassword: z.string().min(8, 'Sandi baru minimal 8 karakter'),
});

export const authRoutes: FastifyPluginAsync = async (fastify) => {
  const db = (fastify as any).mongoDb as Db;
  const users = db.collection('users');

  // POST /api/v1/auth/login
  fastify.post('/auth/login', async (request, reply) => {
    const { schoolId, username, password } = LoginRequestSchema.parse(request.body);

    const user = await users.findOne({ schoolId, username });

    // Timing-attack prevention: dummy verify if user not found (§5.2)
    if (!user) {
      await verifyPassword('dummy_password', 'scrypt$16384$8$1$0000000000000000$00000000000000000000000000000000');
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Login Gagal', 'Username atau sandi salah.');
    }

    const isMatch = await verifyPassword(password, user.passwordHash);
    if (!isMatch) {
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Login Gagal', 'Username atau sandi salah.');
    }

    // Check first-time login policy (§5.2)
    const isPasswordChanged = user.isPasswordChanged !== false;
    const scope = isPasswordChanged ? 'full' : 'password_change_only';

    const tokenPayload: AccessTokenPayload = {
      sub: user._id.toString(),
      schoolId: user.schoolId,
      username: user.username,
      roles: user.roles || ['student'],
      scope,
    };

    const accessToken = TokenService.signAccessToken(tokenPayload);

    if (isPasswordChanged) {
      reply.setCookie('refreshToken', `refresh_${user._id}_${Date.now()}`, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        path: '/api/v1/auth',
        maxAge: 43200, // 12 hours
      });
    }

    return reply.status(200).send({
      accessToken,
      requiresPasswordChange: !isPasswordChanged,
      user: {
        id: user._id.toString(),
        username: user.username,
        name: user.name,
        roles: user.roles || ['student'],
        schoolId: user.schoolId,
      },
    });
  });

  // POST /api/v1/auth/change-password
  fastify.post('/auth/change-password', async (request, reply) => {
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      throw new AppError(401, 'UNAUTHORIZED', 'Unauthorized', 'Bearer token is required.');
    }

    const token = authHeader.substring(7);
    const decoded = TokenService.verifyToken(token);

    const { oldPassword, newPassword } = ChangePasswordRequestSchema.parse(request.body);

    const user = await users.findOne({ _id: decoded.sub, schoolId: decoded.schoolId });
    if (!user) {
      throw new AppError(404, 'USER_NOT_FOUND', 'User Not Found', 'Pengguna tidak ditemukan.');
    }

    const isOldMatch = await verifyPassword(oldPassword, user.passwordHash);
    if (!isOldMatch) {
      throw new AppError(400, 'INVALID_OLD_PASSWORD', 'Sandi Lama Salah', 'Sandi lama yang dimasukkan tidak cocok.');
    }

    const newHash = await hashPassword(newPassword);
    await users.updateOne(
      { _id: user._id },
      {
        $set: {
          passwordHash: newHash,
          isPasswordChanged: true,
          updatedAt: new Date(),
        },
      }
    );

    // Issue upgraded full-scope token
    const fullPayload: AccessTokenPayload = {
      sub: user._id.toString(),
      schoolId: user.schoolId,
      username: user.username,
      roles: user.roles || ['student'],
      scope: 'full',
    };

    const accessToken = TokenService.signAccessToken(fullPayload);

    reply.setCookie('refreshToken', `refresh_${user._id}_${Date.now()}`, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/api/v1/auth',
      maxAge: 43200,
    });

    return reply.status(200).send({
      message: 'Sandi berhasil diperbarui.',
      accessToken,
    });
  });

  // POST /api/v1/auth/logout
  fastify.post('/auth/logout', async (request, reply) => {
    reply.clearCookie('refreshToken', {
      path: '/api/v1/auth',
    });
    return reply.status(200).send({ success: true });
  });
};

