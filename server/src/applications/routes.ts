import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context';
import { APPLICATION_STATUSES } from '../domain/types';
import { currentUserId, requireAuth } from '../http/auth';
import { createApplicationService } from './service';

const idParams = z.object({ id: z.string().uuid('Invalid application id') });
const jobParams = z.object({ jobId: z.string().uuid('Invalid job id') });

const patchBody = z
  .object({
    status: z.enum(APPLICATION_STATUSES).optional(),
    notes: z.string().max(5000).optional(),
    followUpAt: z.string().datetime({ offset: true }).nullable().optional(),
  })
  .strict();

export async function registerApplicationRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const apps = createApplicationService(ctx);
  const authenticate = requireAuth(ctx);

  app.get('/applications', { preHandler: authenticate }, async (request) => {
    const status = z.enum(APPLICATION_STATUSES).optional().parse((request.query as Record<string, unknown>).status);
    return apps.list(currentUserId(request), status);
  });

  app.get('/applications/:id', { preHandler: authenticate }, async (request) => {
    const { id } = idParams.parse(request.params);
    return apps.get(currentUserId(request), id);
  });

  app.post('/applications/:jobId/shortlist', { preHandler: authenticate }, async (request, reply) => {
    const { jobId } = jobParams.parse(request.params);
    reply.code(201);
    return apps.shortlist(currentUserId(request), jobId);
  });

  app.post('/applications/:id/customize', { preHandler: authenticate }, async (request) => {
    const { id } = idParams.parse(request.params);
    return apps.customize(currentUserId(request), id);
  });

  app.patch('/applications/:id', { preHandler: authenticate }, async (request) => {
    const { id } = idParams.parse(request.params);
    const patch = patchBody.parse(request.body ?? {});
    return apps.update(currentUserId(request), id, patch);
  });

  app.post('/applications/:id/mark-applied', { preHandler: authenticate }, async (request) => {
    const { id } = idParams.parse(request.params);
    const body = (request.body ?? {}) as { approved?: unknown };
    return apps.markApplied(currentUserId(request), id, body.approved);
  });

  app.get('/applications/:id/cv.:format', { preHandler: authenticate }, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const format = z.enum(['pdf', 'docx']).parse((request.params as { format: string }).format);
    const file = await apps.document(currentUserId(request), id, format);
    const contentType =
      format === 'pdf'
        ? 'application/pdf'
        : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    reply.header('Content-Type', contentType);
    reply.header('Content-Disposition', `attachment; filename="${file.fileName}"`);
    reply.header('Cache-Control', 'private, no-store');
    return reply.send(file.buffer);
  });
}
