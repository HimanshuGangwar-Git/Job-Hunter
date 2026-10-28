import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context';
import { badRequest, unauthorized } from '../http/errors';
import { RateLimiter } from '../http/rate-limit';
import { currentUserId, requireAuth } from '../http/auth';
import { queryOne, query } from '../db/pool';
import { hashPassword, verifyPassword } from './password';
import { issueToken } from './tokens';

const registerSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(8, 'Password must be at least 8 characters').max(200),
});

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1).max(200),
});

interface UserRow {
  id: string;
  email: string;
  name: string;
  password_hash: string;
}

export async function registerAuthRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  // 10 failed or repeated attempts per email per 15 minutes.
  const loginLimiter = new RateLimiter(10, 15 * 60 * 1000);
  const authenticate = requireAuth(ctx);

  const issue = async (user: { id: string; email: string; name: string }) => ({
    token: await issueToken({ sub: user.id, email: user.email }, ctx.config.JWT_SECRET, ctx.config.JWT_EXPIRES_IN_HOURS),
    user: { id: user.id, email: user.email, name: user.name },
  });

  app.post('/auth/register', async (request, reply) => {
    const parsed = registerSchema.safeParse(request.body);
    if (!parsed.success) throw badRequest(parsed.error.issues[0].message);
    const { name, email, password } = parsed.data;

    const existing = await queryOne(ctx.db, 'SELECT id FROM users WHERE email = $1', [email]);
    if (existing) {
      // Same response shape as success would be ideal, but a clear message is more useful for a personal tool.
      throw badRequest('An account with this email already exists');
    }

    const passwordHash = await hashPassword(password);
    const [user] = await query<UserRow>(
      ctx.db,
      'INSERT INTO users (email, name, password_hash) VALUES ($1, $2, $3) RETURNING id, email, name, password_hash',
      [email, name, passwordHash],
    );
    ctx.logger.info({ userId: user.id }, 'User registered');
    reply.code(201);
    return issue(user);
  });

  app.post('/auth/login', async (request) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) throw badRequest('Enter a valid email and password');
    const { email, password } = parsed.data;

    loginLimiter.consume(email);
    const user = await queryOne<UserRow>(
      ctx.db,
      'SELECT id, email, name, password_hash FROM users WHERE email = $1',
      [email],
    );
    // Always run the hash check so response timing does not reveal which emails exist.
    const valid = await verifyPassword(password, user?.password_hash ?? 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAA');
    if (!user || !valid) {
      throw unauthorized('Incorrect email or password');
    }
    loginLimiter.reset(email);
    ctx.logger.info({ userId: user.id }, 'User signed in');
    return issue(user);
  });

  app.get('/auth/me', { preHandler: authenticate }, async (request) => {
    const userId = currentUserId(request);
    const user = await queryOne<{ id: string; email: string; name: string }>(
      ctx.db,
      'SELECT id, email, name FROM users WHERE id = $1',
      [userId],
    );
    if (!user) throw unauthorized();
    return user;
  });
}
