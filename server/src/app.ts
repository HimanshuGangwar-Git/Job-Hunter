import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import type { AppContext } from './context';
import { registerAuthRoutes } from './auth/routes';
import { registerCvRoutes } from './cv/routes';
import { registerProfileRoutes } from './profile/routes';
import { registerJobRoutes } from './jobs/routes';
import { registerApplicationRoutes } from './applications/routes';
import { registerSearchRoutes } from './searches/routes';
import { registerAnalyticsRoutes } from './analytics/routes';
import { HttpError } from './http/errors';

export const MAX_CV_BYTES = 5 * 1024 * 1024;

export async function buildApp(ctx: AppContext): Promise<FastifyInstance> {
  const app = Fastify({
    // pino instances satisfy FastifyBaseLogger at runtime; the generic types differ slightly.
    loggerInstance: ctx.logger as unknown as FastifyBaseLogger,
    bodyLimit: 1024 * 1024,
  });

  await app.register(cors, {
    origin: ctx.config.CORS_ORIGIN.split(',').map((origin) => origin.trim()),
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Authorization', 'Content-Type'],
  });
  await app.register(multipart, { limits: { fileSize: MAX_CV_BYTES, files: 1, fields: 5 } });

  app.setErrorHandler((error: unknown, request, reply) => {
    if (error instanceof HttpError) {
      return reply.code(error.statusCode).send({ error: error.message, details: error.details });
    }
    if (error instanceof ZodError) {
      const first = error.issues[0];
      const field = first.path.join('.');
      return reply.code(400).send({
        error: field ? `${field}: ${first.message}` : first.message,
        details: error.issues,
      });
    }
    const fastifyError = error as { statusCode?: number; code?: string; message: string };
    const status = fastifyError.statusCode;
    if (status && status >= 400 && status < 500) {
      const message = fastifyError.code === 'FST_REQ_FILE_TOO_LARGE' ? 'CV files must be 5 MB or smaller.' : fastifyError.message;
      return reply.code(status).send({ error: message });
    }
    request.log.error({ err: error, url: request.url }, 'Unhandled error');
    return reply.code(500).send({ error: 'Something went wrong. Please try again.' });
  });

  app.setNotFoundHandler((request, reply) => reply.code(404).send({ error: `Route ${request.method} ${request.url} not found` }));

  app.get('/api/health', async () => {
    await ctx.db.query('SELECT 1');
    return { status: 'ok' };
  });

  await app.register(
    async (api) => {
      await registerAuthRoutes(api, ctx);
      await registerCvRoutes(api, ctx);
      await registerProfileRoutes(api, ctx);
      await registerJobRoutes(api, ctx);
      await registerApplicationRoutes(api, ctx);
      await registerSearchRoutes(api, ctx);
      await registerAnalyticsRoutes(api, ctx);
    },
    { prefix: '/api' },
  );

  return app;
}
