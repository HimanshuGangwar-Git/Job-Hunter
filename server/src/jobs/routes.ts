import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context';
import { APPLICATION_STATUSES } from '../domain/types';
import { notFound } from '../http/errors';
import { currentUserId, requireAuth } from '../http/auth';
import { runDiscovery } from './discovery';
import { getJobForUser, listJobs } from './repository';

const listQuery = z.object({
  q: z.string().trim().max(200).optional(),
  minScore: z.coerce.number().int().min(0).max(100).optional(),
  role: z.string().trim().max(120).optional(),
  company: z.string().trim().max(120).optional(),
  location: z.string().trim().max(120).optional(),
  minSalary: z.coerce.number().min(0).optional(),
  source: z.string().trim().max(40).optional(),
  status: z.enum(APPLICATION_STATUSES).optional(),
  sort: z.enum(['score', 'posted', 'salary']).default('score'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

const discoverBody = z
  .object({
    keywords: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
    locations: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
    sources: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  })
  .default({});

const idParams = z.object({ id: z.string().uuid('Invalid job id') });

export async function registerJobRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const authenticate = requireAuth(ctx);

  app.get('/jobs', { preHandler: authenticate }, async (request) => {
    const filters = listQuery.parse(request.query);
    const { items, total } = await listJobs(ctx.db, currentUserId(request), filters);
    return { items, total, page: filters.page, pageSize: filters.pageSize };
  });

  app.get('/jobs/sources', { preHandler: authenticate }, async () => ctx.connectors.describe());

  app.post('/jobs/discover', { preHandler: authenticate }, async (request) => {
    const body = discoverBody.parse(request.body ?? {});
    return runDiscovery(ctx, currentUserId(request), body);
  });

  app.get('/jobs/:id', { preHandler: authenticate }, async (request) => {
    const { id } = idParams.parse(request.params);
    const job = await getJobForUser(ctx.db, currentUserId(request), id);
    if (!job) throw notFound('Job not found');
    return job;
  });
}
