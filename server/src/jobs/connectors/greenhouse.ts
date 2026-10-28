import { normalizeJob, type NormalizedJob } from '../normalize';
import { getJson, settleAll } from './http';
import type { ConnectorContext, DiscoveryQuery, JobConnector } from './types';

interface GreenhouseJob {
  id: number;
  title: string;
  absolute_url: string;
  location?: { name?: string };
  content?: string;
  first_published?: string;
  updated_at?: string;
  company_name?: string;
}

interface GreenhouseResponse {
  jobs: GreenhouseJob[];
}

/** "stripe-india" -> "Stripe India". Greenhouse's job list does not always include the company name. */
export const titleCaseSlug = (slug: string) =>
  slug
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');

/**
 * Greenhouse Job Board API (public, documented): https://developers.greenhouse.io/job-board.html
 * Configure board tokens with GREENHOUSE_BOARDS=stripe,airbnb (the token is the last path segment of the careers URL).
 */
export function createGreenhouseConnector(boards: string[]): JobConnector {
  return {
    id: 'greenhouse',
    name: 'Greenhouse career boards',
    kind: 'api',
    note: 'Public Job Board API for company career pages',
    isConfigured: () => boards.length > 0,
    async fetchJobs(_query: DiscoveryQuery, ctx: ConnectorContext): Promise<NormalizedJob[]> {
      const { results, errors } = await settleAll(boards, async (board) => {
        const data = await getJson<GreenhouseResponse>(
          ctx.fetch,
          `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board)}/jobs?content=true`,
        );
        const company = data.jobs[0]?.company_name ?? titleCaseSlug(board);
        return data.jobs
          .map((job) =>
            normalizeJob({
              externalId: `${board}:${job.id}`,
              source: 'greenhouse',
              title: job.title,
              company,
              location: job.location?.name ?? '',
              description: job.content ?? '',
              url: job.absolute_url,
              postedAt: job.first_published ?? job.updated_at ?? null,
            }),
          )
          .filter((job): job is NormalizedJob => job !== null);
      });
      if (errors.length) ctx.logger.warn({ errors }, 'Some Greenhouse boards failed');
      return results;
    },
  };
}
