import type { AppContext } from '../context';
import { query } from '../db/pool';
import { runDiscovery } from '../jobs/discovery';

export interface SchedulerHandle {
  stop(): void;
  /** Runs one pass immediately. Exposed for tests and manual triggers. */
  tick(): Promise<{ searchesRun: number; followUpsNotified: number }>;
}

interface DueSearch {
  id: string;
  user_id: string;
  keywords: string[];
  locations: string[];
  sources: string[];
  min_score: number;
}

/**
 * Claims due saved searches and runs them. FOR UPDATE SKIP LOCKED plus moving next_run_at forward means two
 * instances never run the same search at the same time.
 */
export async function claimDueSearches(ctx: AppContext, limit = 10): Promise<DueSearch[]> {
  return query<DueSearch>(
    ctx.db,
    `UPDATE saved_searches s
     SET next_run_at = now() + CASE s.frequency WHEN 'hourly' THEN interval '1 hour' WHEN 'daily' THEN interval '1 day' ELSE interval '7 days' END
     WHERE s.id IN (
       SELECT id FROM saved_searches
       WHERE enabled AND (next_run_at IS NULL OR next_run_at <= now())
       ORDER BY next_run_at NULLS FIRST
       LIMIT $1
       FOR UPDATE SKIP LOCKED
     )
     RETURNING s.id, s.user_id, s.keywords, s.locations, s.sources, s.min_score`,
    [limit],
  );
}

/** Notifies about applications whose follow-up date has passed. Each follow-up notifies once. */
export async function notifyDueFollowUps(ctx: AppContext): Promise<number> {
  const due = await query<{ user_id: string; title: string; company: string }>(
    ctx.db,
    `UPDATE applications a SET follow_up_notified_at = now()
     FROM jobs j
     WHERE j.id = a.job_id AND a.follow_up_at <= now() AND a.follow_up_notified_at IS NULL
       AND a.status IN ('Applied', 'Interview')
     RETURNING a.user_id, j.title, j.company`,
  );
  for (const item of due) {
    await query(
      ctx.db,
      'INSERT INTO notifications (user_id, title, body) VALUES ($1, $2, $3)',
      [item.user_id, `Follow up: ${item.title}`, `Your follow-up date for ${item.company} has arrived.`],
    );
  }
  return due.length;
}

export function startScheduler(ctx: AppContext, intervalMs: number): SchedulerHandle {
  let running = false;

  const tick = async () => {
    if (running) return { searchesRun: 0, followUpsNotified: 0 };
    running = true;
    try {
      const due = await claimDueSearches(ctx);
      for (const search of due) {
        try {
          await runDiscovery(ctx, search.user_id, {
            keywords: search.keywords,
            locations: search.locations,
            sources: search.sources.length ? search.sources : undefined,
            notifyAtOrAbove: search.min_score,
          });
          await query(ctx.db, 'UPDATE saved_searches SET last_run_at = now() WHERE id = $1', [search.id]);
        } catch (error) {
          ctx.logger.error({ err: error, searchId: search.id }, 'Scheduled search failed');
        }
      }
      const followUpsNotified = await notifyDueFollowUps(ctx);
      return { searchesRun: due.length, followUpsNotified };
    } catch (error) {
      ctx.logger.error({ err: error }, 'Scheduler tick failed');
      return { searchesRun: 0, followUpsNotified: 0 };
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => void tick(), intervalMs);
  timer.unref();
  ctx.logger.info({ intervalMs }, 'Scheduler started');

  return {
    stop: () => clearInterval(timer),
    tick,
  };
}
