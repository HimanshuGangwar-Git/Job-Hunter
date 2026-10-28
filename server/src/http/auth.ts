import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AppContext } from '../context';
import { LOCAL_USER_ID } from '../auth/local-user';

declare module 'fastify' {
  interface FastifyRequest {
    userId?: string;
  }
}

/**
 * Single-user mode: every request belongs to the local user. The server listens on 127.0.0.1 (the default HOST),
 * so only this computer can reach it. Do not expose it to a network without adding real authentication.
 */
export function requireAuth(_ctx: AppContext) {
  return async function attachLocalUser(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
    request.userId = LOCAL_USER_ID;
  };
}

export function currentUserId(request: FastifyRequest): string {
  return request.userId ?? LOCAL_USER_ID;
}
