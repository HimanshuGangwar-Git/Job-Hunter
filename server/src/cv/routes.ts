import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context';
import { badRequest } from '../http/errors';
import { currentUserId, requireAuth } from '../http/auth';
import { rescoreForUser } from '../matching/service';
import { createCvService } from './service';

const idParams = z.object({ id: z.string().uuid('Invalid CV id') });

export async function registerCvRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const cvs = createCvService(ctx.db, ctx.storage, ctx.logger);
  const authenticate = requireAuth(ctx);

  app.get('/cvs', { preHandler: authenticate }, async (request) => cvs.list(currentUserId(request)));

  app.post('/cvs', { preHandler: authenticate }, async (request, reply) => {
    const userId = currentUserId(request);
    const file = await request.file();
    if (!file) throw badRequest('Attach a CV file in the "file" field');
    const buffer = await file.toBuffer();
    const cv = await cvs.upload(userId, file.filename, buffer);
    await rescoreForUser(ctx, userId);
    reply.code(201);
    return cv;
  });

  app.post('/cvs/:id/primary', { preHandler: authenticate }, async (request) => {
    const { id } = idParams.parse(request.params);
    const userId = currentUserId(request);
    const cv = await cvs.setPrimary(userId, id);
    await rescoreForUser(ctx, userId);
    return cv;
  });

  app.delete('/cvs/:id', { preHandler: authenticate }, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const userId = currentUserId(request);
    await cvs.remove(userId, id);
    await rescoreForUser(ctx, userId);
    reply.code(204);
    return null;
  });
}
