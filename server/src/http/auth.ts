import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AppContext } from '../context';
import { verifyToken } from '../auth/tokens';
import { unauthorized } from './errors';

declare module 'fastify' {
  interface FastifyRequest {
    userId?: string;
  }
}

/** Builds a preHandler that requires a valid bearer token and exposes the user id on the request. */
export function requireAuth(ctx: AppContext) {
  return async function authenticate(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
    const header = request.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : '';
    if (!token) throw unauthorized();
    const claims = await verifyToken(token, ctx.config.JWT_SECRET);
    if (!claims) throw unauthorized('Your session has expired. Please sign in again.');
    request.userId = claims.sub;
  };
}

export function currentUserId(request: FastifyRequest): string {
  if (!request.userId) throw unauthorized();
  return request.userId;
}
