import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context';
import { currentUserId, requireAuth } from '../http/auth';
import { rescoreForUser } from '../matching/service';
import { createProfileService, preferencesSchema, profilePatchSchema } from './service';

export async function registerProfileRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const profiles = createProfileService(ctx.db);
  const authenticate = requireAuth(ctx);

  app.get('/profile', { preHandler: authenticate }, async (request) => profiles.getProfile(currentUserId(request)));

  app.patch('/profile', { preHandler: authenticate }, async (request) => {
    const patch = profilePatchSchema.parse(request.body ?? {});
    const userId = currentUserId(request);
    const profile = await profiles.updateProfile(userId, patch);
    await rescoreForUser(ctx, userId);
    return profile;
  });

  app.get('/preferences', { preHandler: authenticate }, async (request) =>
    profiles.getPreferences(currentUserId(request)),
  );

  app.put('/preferences', { preHandler: authenticate }, async (request) => {
    const prefs = preferencesSchema.parse(request.body);
    const userId = currentUserId(request);
    const saved = await profiles.updatePreferences(userId, prefs);
    await rescoreForUser(ctx, userId);
    return saved;
  });
}
