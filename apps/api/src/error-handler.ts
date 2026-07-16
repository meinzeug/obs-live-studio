import type { FastifyInstance } from 'fastify';
import { ZodError } from 'zod';

function httpStatus(error: unknown, replyStatus: number) {
  if (error instanceof ZodError) return 400;
  const declaredStatus =
    error && typeof error === 'object' && 'statusCode' in error ? Number(error.statusCode) : Number.NaN;
  if (Number.isInteger(declaredStatus) && declaredStatus >= 400 && declaredStatus <= 599) {
    return declaredStatus;
  }
  if (replyStatus >= 400 && replyStatus <= 599) return replyStatus;
  return 500;
}

export function installApiErrorHandler(app: FastifyInstance) {
  app.setErrorHandler((error, request, reply) => {
    const statusCode = httpStatus(error, reply.statusCode);
    if (statusCode >= 500) request.log.error({ err: error }, 'API request failed');

    if (error instanceof ZodError) {
      return reply.code(statusCode).send({
        error: 'Ungültige Anfrage',
        issues: error.issues,
      });
    }

    const message = error instanceof Error ? error.message : '';
    return reply.code(statusCode).send({
      error: message || (statusCode >= 500 ? 'Interner Serverfehler' : 'Anfrage fehlgeschlagen'),
    });
  });
}
