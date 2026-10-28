import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context';
import { query, queryOne } from '../db/pool';
import { APPLICATION_STATUSES, type ApplicationStatus } from '../domain/types';
import { requireAuth, currentUserId } from '../http/auth';
import { HIGH_MATCH_THRESHOLD } from '../matching/service';

export interface Analytics {
  totals: { jobs: number; highMatches: number; applications: number; interviews: number; offers: number; rejections: number };
  conversion: { shortlistToApplied: number; appliedToInterview: number; interviewToOffer: number };
  byStatus: Record<ApplicationStatus, number>;
  activity: { date: string; count: number }[];
  bySource: { source: string; jobs: number; avgScore: number }[];
}

const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

/** Exported so the calculation can be tested with fixed numbers. */
export function summarise(input: {
  jobs: number;
  highMatches: number;
  byStatus: Partial<Record<ApplicationStatus, number>>;
  appliedCount: number;
  shortlistedCount: number;
}): Pick<Analytics, 'totals' | 'conversion' | 'byStatus'> {
  const byStatus = Object.fromEntries(APPLICATION_STATUSES.map((s) => [s, input.byStatus[s] ?? 0])) as Record<ApplicationStatus, number>;
  const interviews = byStatus.Interview + byStatus.Offer;
  return {
    totals: {
      jobs: input.jobs,
      highMatches: input.highMatches,
      applications: input.appliedCount,
      interviews,
      offers: byStatus.Offer,
      rejections: byStatus.Rejected,
    },
    conversion: {
      shortlistToApplied: pct(input.appliedCount, input.shortlistedCount),
      appliedToInterview: pct(interviews, input.appliedCount),
      interviewToOffer: pct(byStatus.Offer, interviews),
    },
    byStatus,
  };
}

export async function registerAnalyticsRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const authenticate = requireAuth(ctx);

  app.get('/analytics', { preHandler: authenticate }, async (request): Promise<Analytics> => {
    const userId = currentUserId(request);

    const totals = await queryOne<{ jobs: string; high: string }>(
      ctx.db,
      `SELECT (SELECT count(*) FROM jobs) AS jobs,
              (SELECT count(*) FROM job_matches WHERE user_id = $1 AND score >= $2) AS high`,
      [userId, HIGH_MATCH_THRESHOLD],
    );
    const statusRows = await query<{ status: ApplicationStatus; count: string }>(
      ctx.db,
      'SELECT status, count(*) AS count FROM applications WHERE user_id = $1 GROUP BY status',
      [userId],
    );
    const applied = await queryOne<{ applied: string; shortlisted: string }>(
      ctx.db,
      `SELECT count(*) FILTER (WHERE applied_at IS NOT NULL) AS applied, count(*) AS shortlisted
       FROM applications WHERE user_id = $1`,
      [userId],
    );

    const activityRows = await query<{ day: string; count: string }>(
      ctx.db,
      // Day buckets are UTC, matching the UTC day keys built below, whatever the database session timezone is.
      `SELECT to_char(e.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day, count(*) AS count
       FROM application_events e JOIN applications a ON a.id = e.application_id
       WHERE a.user_id = $1 AND e.created_at >= now() - interval '14 days'
       GROUP BY 1`,
      [userId],
    );
    const activityByDay = new Map(activityRows.map((r) => [r.day, Number(r.count)]));
    const activity = Array.from({ length: 14 }, (_, i) => {
      const date = new Date(Date.now() - (13 - i) * 86_400_000).toISOString().slice(0, 10);
      return { date, count: activityByDay.get(date) ?? 0 };
    });

    const sourceRows = await query<{ source: string; jobs: string; avg_score: string | null }>(
      ctx.db,
      `SELECT j.source, count(*) AS jobs, round(avg(jm.score))::text AS avg_score
       FROM jobs j JOIN job_matches jm ON jm.job_id = j.id AND jm.user_id = $1
       GROUP BY j.source ORDER BY count(*) DESC`,
      [userId],
    );

    const summary = summarise({
      jobs: Number(totals?.jobs ?? 0),
      highMatches: Number(totals?.high ?? 0),
      byStatus: Object.fromEntries(statusRows.map((r) => [r.status, Number(r.count)])) as Partial<Record<ApplicationStatus, number>>,
      appliedCount: Number(applied?.applied ?? 0),
      shortlistedCount: Number(applied?.shortlisted ?? 0),
    });

    return {
      ...summary,
      activity,
      bySource: sourceRows.map((r) => ({ source: r.source, jobs: Number(r.jobs), avgScore: Number(r.avg_score ?? 0) })),
    };
  });
}
