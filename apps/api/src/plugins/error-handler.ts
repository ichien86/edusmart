import type { FastifyError, FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';

export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail: string;
  code: string;
  requestId: string;
  invalidParams?: Array<{ name: string; reason: string }>;
}

export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    public readonly title: string,
    public readonly detail: string,
    public readonly type = 'about:blank'
  ) {
    super(detail);
    this.name = 'AppError';
  }
}

export const errorHandlerPlugin: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  fastify.setErrorHandler((error: FastifyError, request: FastifyRequest, reply: FastifyReply) => {
    const requestId = (request.id || (request.headers['x-request-id'] as string) || 'unknown') as string;

    // 1. Zod Validation Errors
    if (error instanceof ZodError) {
      const invalidParams = error.errors.map((err) => ({
        name: err.path.join('.'),
        reason: err.message,
      }));

      const problem: ProblemDetails = {
        type: 'https://eduassess.ai/errors/validation-failed',
        title: 'Validation Error',
        status: 400,
        detail: 'The submitted request payload or parameters are invalid.',
        code: 'VALIDATION_FAILED',
        requestId,
        invalidParams,
      };

      return reply.status(400).type('application/problem+json').send(problem);
    }

    // 2. Custom AppError
    if (error instanceof AppError) {
      const problem: ProblemDetails = {
        type: error.type,
        title: error.title,
        status: error.status,
        detail: error.detail,
        code: error.code,
        requestId,
      };

      return reply.status(error.status).type('application/problem+json').send(problem);
    }

    // 3. Fastify HTTP Errors
    const statusCode = error.statusCode || 500;
    const problem: ProblemDetails = {
      type: 'about:blank',
      title: statusCode === 500 ? 'Internal Server Error' : error.name,
      status: statusCode,
      detail: error.message || 'An unexpected error occurred.',
      code: error.code || (statusCode === 500 ? 'INTERNAL_SERVER_ERROR' : 'HTTP_ERROR'),
      requestId,
    };

    if (statusCode >= 500) {
      request.log.error(error);
    }

    return reply.status(statusCode).type('application/problem+json').send(problem);
  });
};

