import { z } from 'zod';
import { normalizeJob, type NormalizedJob, type RawJobInput } from '../normalize';
import { getJson } from './http';
import type { ConnectorContext, ConnectorKind, DiscoveryQuery, JobConnector } from './types';

/**
 * Format every licensed or partner feed must provide (the operator maps the provider's API to this shape):
 *   { "jobs": [{ "id", "title", "company", "location", "url", "description", "postedAt",
 *                "salaryMin", "salaryMax", "salaryCurrency", "workMode" }] }
 * Only feeds you are authorised to use belong here. Public job pages are not scraped.
 */
const feedItemSchema = z.object({
  id: z.union([z.string(), z.number()]),
  title: z.string(),
  company: z.string(),
  location: z.string().nullish(),
  url: z.string(),
  description: z.string().nullish(),
  postedAt: z.union([z.string(), z.number()]).nullish(),
  salaryMin: z.number().nullish(),
  salaryMax: z.number().nullish(),
  salaryCurrency: z.string().nullish(),
  workMode: z.string().nullish(),
});

const feedSchema = z.object({ jobs: z.array(feedItemSchema).max(2000) });

export interface LicensedFeedOptions {
  id: string;
  name: string;
  feedUrl: string | undefined;
  apiKey?: string;
  kind?: ConnectorKind;
}

export function createLicensedFeedConnector(options: LicensedFeedOptions): JobConnector {
  const note = `Requires a licensed feed or partner API URL (${options.id.toUpperCase()}_FEED_URL)`;
  return {
    id: options.id,
    name: options.name,
    kind: options.kind ?? 'licensed-feed',
    note,
    isConfigured: () => Boolean(options.feedUrl),
    async fetchJobs(_query: DiscoveryQuery, ctx: ConnectorContext): Promise<NormalizedJob[]> {
      if (!options.feedUrl) return [];
      const headers = options.apiKey ? { Authorization: `Bearer ${options.apiKey}` } : undefined;
      const payload = feedSchema.parse(await getJson<unknown>(ctx.fetch, options.feedUrl, { headers }));
      return payload.jobs
        .map((item): RawJobInput => ({
          externalId: String(item.id),
          source: options.id,
          title: item.title,
          company: item.company,
          location: item.location ?? '',
          workModeHint: item.workMode ?? null,
          description: item.description ?? '',
          url: item.url,
          postedAt: item.postedAt ?? null,
          salaryMin: item.salaryMin ?? null,
          salaryMax: item.salaryMax ?? null,
          salaryCurrency: item.salaryCurrency ?? null,
        }))
        .map((raw) => normalizeJob(raw))
        .filter((job): job is NormalizedJob => job !== null);
    },
  };
}
