import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context';
import { queryOne } from '../db/pool';
import { LOCAL_USER, LOCAL_USER_ID } from './local-user';

export async function registerAuthRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  // The web app calls this on load to show who is signed in. There is only the local user.
  app.get('/auth/me', async () => {
    const user = await queryOne<{ id: string; email: string; name: string }>(
      ctx.db,
      'SELECT id, email, name FROM users WHERE id = $1',
      [LOCAL_USER_ID],
    );
    return user ?? { id: LOCAL_USER_ID, ...LOCAL_USER };
  });
}
