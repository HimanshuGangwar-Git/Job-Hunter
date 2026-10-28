import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context';
import { query, queryOne } from '../db/pool';
import { notFound } from '../http/errors';
import { currentUserId, requireAuth } from '../http/auth';
import { HIGH_MATCH_THRESHOLD } from '../matching/service';

const FREQUENCIES = ['hourly', 'daily', 'weekly'] as const;

const searchBody = z.object({
  name: z.string().trim().min(1).max(120),
  keywords: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
  locations: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
  sources: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  minScore: z.number().int().min(0).max(100).default(HIGH_MATCH_THRESHOLD),
  frequency: z.enum(FREQUENCIES).default('daily'),
  enabled: z.boolean().default(true),
});

const searchPatch = searchBody.partial();
const idParams = z.object({ id: z.string().uuid('Invalid search id') });

export interface SearchDto {
  id: string;
  name: string;
  keywords: string[];
  locations: string[];
  sources: string[];
  minScore: number;
  frequency: 'hourly' | 'daily' | 'weekly';
  enabled: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
}

interface SearchRow {
  id: string;
  name: string;
  keywords: string[];
  locations: string[];
  sources: string[];
  min_score: number;
  frequency: SearchDto['frequency'];
  enabled: boolean;
  last_run_at: Date | null;
  next_run_at: Date | null;
}

const toDto = (row: SearchRow): SearchDto => ({
  id: row.id,
  name: row.name,
  keywords: row.keywords,
  locations: row.locations,
  sources: row.sources,
  minScore: row.min_score,
  frequency: row.frequency,
  enabled: row.enabled,
  lastRunAt: row.last_run_at?.toISOString() ?? null,
  nextRunAt: row.next_run_at?.toISOString() ?? null,
});

const SELECT_SEARCH = 'SELECT id, name, keywords, locations, sources, min_score, frequency, enabled, last_run_at, next_run_at FROM saved_searches';

export async function registerSearchRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const authenticate = requireAuth(ctx);

  app.get('/searches', { preHandler: authenticate }, async (request) => {
    const rows = await query<SearchRow>(ctx.db, `${SELECT_SEARCH} WHERE user_id = $1 ORDER BY created_at`, [currentUserId(request)]);
    return rows.map(toDto);
  });

  app.post('/searches', { preHandler: authenticate }, async (request, reply) => {
    const body = searchBody.parse(request.body);
    const row = await queryOne<SearchRow>(
      ctx.db,
      `INSERT INTO saved_searches (user_id, name, keywords, locations, sources, min_score, frequency, enabled, next_run_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CASE WHEN $8 THEN now() ELSE NULL END)
       RETURNING id, name, keywords, locations, sources, min_score, frequency, enabled, last_run_at, next_run_at`,
      [currentUserId(request), body.name, body.keywords, body.locations, body.sources, body.minScore, body.frequency, body.enabled],
    );
    reply.code(201);
    return toDto(row!);
  });

  app.patch('/searches/:id', { preHandler: authenticate }, async (request) => {
    const { id } = idParams.parse(request.params);
    const patch = searchPatch.parse(request.body ?? {});
    const userId = currentUserId(request);
    const current = await queryOne<SearchRow>(ctx.db, `${SELECT_SEARCH} WHERE id = $1 AND user_id = $2`, [id, userId]);
    if (!current) throw notFound('Search not found');

    const merged = {
      name: patch.name ?? current.name,
      keywords: patch.keywords ?? current.keywords,
      locations: patch.locations ?? current.locations,
      sources: patch.sources ?? current.sources,
      minScore: patch.minScore ?? current.min_score,
      frequency: patch.frequency ?? current.frequency,
      enabled: patch.enabled ?? current.enabled,
    };
    // Re-enabling schedules an immediate run; otherwise the existing schedule is kept.
    const runNow = merged.enabled && !current.enabled;
    const row = await queryOne<SearchRow>(
      ctx.db,
      `UPDATE saved_searches SET name = $3, keywords = $4, locations = $5, sources = $6, min_score = $7, frequency = $8,
         enabled = $9, next_run_at = CASE WHEN $10 THEN now() ELSE next_run_at END
       WHERE id = $1 AND user_id = $2
       RETURNING id, name, keywords, locations, sources, min_score, frequency, enabled, last_run_at, next_run_at`,
      [id, userId, merged.name, merged.keywords, merged.locations, merged.sources, merged.minScore, merged.frequency, merged.enabled, runNow],
    );
    return toDto(row!);
  });

  app.delete('/searches/:id', { preHandler: authenticate }, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const deleted = await queryOne<{ id: string }>(ctx.db, 'DELETE FROM saved_searches WHERE id = $1 AND user_id = $2 RETURNING id', [
      id,
      currentUserId(request),
    ]);
    if (!deleted) throw notFound('Search not found');
    reply.code(204);
    return null;
  });

  app.get('/notifications', { preHandler: authenticate }, async (request) => {
    const rows = await query<{ id: string; title: string; body: string; job_id: string | null; read_at: Date | null; created_at: Date }>(
      ctx.db,
      'SELECT id, title, body, job_id, read_at, created_at FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50',
      [currentUserId(request)],
    );
    return rows.map((n) => ({
      id: n.id,
      title: n.title,
      body: n.body,
      jobId: n.job_id,
      readAt: n.read_at?.toISOString() ?? null,
      createdAt: n.created_at.toISOString(),
    }));
  });

  app.post('/notifications/:id/read', { preHandler: authenticate }, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    await ctx.db.query('UPDATE notifications SET read_at = COALESCE(read_at, now()) WHERE id = $1 AND user_id = $2', [
      id,
      currentUserId(request),
    ]);
    reply.code(204);
    return null;
  });
}
