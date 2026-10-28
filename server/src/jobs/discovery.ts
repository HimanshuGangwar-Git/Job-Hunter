import type { AppContext } from '../context';
import { createProfileService } from '../profile/service';
import { rescoreForUser, HIGH_MATCH_THRESHOLD } from '../matching/service';
import { fingerprint, type NormalizedJob } from './normalize';
import { upsertJob } from './repository';
import type { DiscoveryQuery } from './connectors/types';

export interface DiscoverySourceResult {
  source: string;
  status: 'ok' | 'skipped' | 'error';
  fetched: number;
  inserted: number;
  message: string | null;
}

export interface DiscoveryRun {
  startedAt: string;
  finishedAt: string;
  sources: DiscoverySourceResult[];
  newMatches: number;
}

export interface DiscoveryOptions {
  keywords?: string[];
  locations?: string[];
  sources?: string[];
  /** Notify for matches at or above this score. Defaults to the high-match threshold. */
  notifyAtOrAbove?: number;
}

// Role words shared by almost every posting. They would make "Data Engineer" match every engineering job.
const GENERIC_ROLE_WORDS = new Set([
  'engineer', 'engineers', 'developer', 'developers', 'manager', 'senior', 'junior', 'lead', 'specialist',
  'associate', 'intern', 'analyst', 'consultant', 'architect', 'staff', 'principal', 'software', 'role', 'team',
]);

/**
 * Keeps postings that contain the keyword phrase or one of its distinctive words (generic role words are
 * ignored). Empty keyword lists keep everything.
 */
export function isRelevant(job: Pick<NormalizedJob, 'title' | 'description'>, keywords: string[]): boolean {
  if (keywords.length === 0) return true;
  const haystack = `${job.title} ${job.description}`.toLowerCase();
  const distinctive = new Set<string>();
  for (const keyword of keywords) {
    const phrase = keyword.trim().toLowerCase();
    if (phrase && haystack.includes(phrase)) return true;
    for (const word of phrase.split(/[^a-z0-9+#.]+/)) {
      if (word.length >= 3 && !GENERIC_ROLE_WORDS.has(word)) distinctive.add(word);
    }
  }
  if (distinctive.size === 0) return true;
  return [...distinctive].some((word) => haystack.includes(word));
}

/**
 * Fetches from every configured connector, stores deduplicated jobs, and re-scores them for the user.
 * A failing source is reported in the result and never stops the others.
 */
export async function runDiscovery(ctx: AppContext, userId: string, options: DiscoveryOptions = {}): Promise<DiscoveryRun> {
  const startedAt = new Date();
  const prefs = await createProfileService(ctx.db).getPreferences(userId);
  const keywords = options.keywords?.length ? options.keywords : prefs.targetRoles;
  const locations = options.locations?.length ? options.locations : prefs.locations;
  const query: DiscoveryQuery = { keywords, locations };

  const connectors = ctx.connectors
    .all()
    .filter((connector) => !options.sources?.length || options.sources.includes(connector.id));

  const sources: DiscoverySourceResult[] = [];
  for (const connector of connectors) {
    const log = ctx.logger.child({ source: connector.id, userId });
    if (!connector.isConfigured()) {
      sources.push({ source: connector.id, status: 'skipped', fetched: 0, inserted: 0, message: `Not configured. ${connector.note}` });
      continue;
    }
    try {
      const jobs = await connector.fetchJobs(query, { logger: log, fetch: globalThis.fetch });
      const relevant = jobs.filter((job) => isRelevant(job, keywords));
      let inserted = 0;
      for (const job of relevant) {
        const result = await upsertJob(ctx.db, job, fingerprint(job.company, job.title, job.location));
        if (result.inserted) inserted += 1;
      }
      log.info({ fetched: jobs.length, relevant: relevant.length, inserted }, 'Source discovery finished');
      sources.push({ source: connector.id, status: 'ok', fetched: relevant.length, inserted, message: null });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      log.warn({ err: message }, 'Source discovery failed');
      sources.push({ source: connector.id, status: 'error', fetched: 0, inserted: 0, message: `Could not fetch jobs: ${message}` });
    }
  }

  const { newHighMatches } = await rescoreForUser(ctx, userId, {
    notifyAtOrAbove: options.notifyAtOrAbove ?? HIGH_MATCH_THRESHOLD,
  });

  return {
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    sources,
    newMatches: newHighMatches.length,
  };
}
