import { normalizeJob, type NormalizedJob } from '../normalize';
import { getJson, settleAll } from './http';
import { titleCaseSlug } from './greenhouse';
import type { ConnectorContext, DiscoveryQuery, JobConnector } from './types';

interface LeverPosting {
  id: string;
  text: string;
  hostedUrl: string;
  categories?: { location?: string; commitment?: string };
  workplaceType?: string;
  descriptionPlain?: string;
  createdAt?: number;
  salaryRange?: { min?: number; max?: number; currency?: string; interval?: string };
}

/**
 * Lever Postings API (public, documented): https://github.com/lever/postings-api
 * Configure companies with LEVER_COMPANIES=company-slug,another (the slug from jobs.lever.co/<slug>).
 */
export function createLeverConnector(companies: string[]): JobConnector {
  return {
    id: 'lever',
    name: 'Lever career sites',
    kind: 'api',
    note: 'Public postings API for company career pages',
    isConfigured: () => companies.length > 0,
    async fetchJobs(_query: DiscoveryQuery, ctx: ConnectorContext): Promise<NormalizedJob[]> {
      const { results, errors } = await settleAll(companies, async (company) => {
        const postings = await getJson<LeverPosting[]>(
          ctx.fetch,
          `https://api.lever.co/v0/postings/${encodeURIComponent(company)}?mode=json`,
        );
        const name = titleCaseSlug(company);
        return postings
          .map((posting) => {
            // Lever salary ranges are yearly amounts in the stated currency when interval is per-year.
            const yearly = !posting.salaryRange?.interval || /year/i.test(posting.salaryRange.interval);
            return normalizeJob({
              externalId: `${company}:${posting.id}`,
              source: 'lever',
              title: posting.text,
              company: name,
              location: posting.categories?.location ?? '',
              workModeHint: posting.workplaceType ?? null,
              description: posting.descriptionPlain ?? '',
              url: posting.hostedUrl,
              postedAt: posting.createdAt ?? null,
              salaryMin: yearly ? posting.salaryRange?.min ?? null : null,
              salaryMax: yearly ? posting.salaryRange?.max ?? null : null,
              salaryCurrency: posting.salaryRange?.currency ?? null,
            });
          })
          .filter((job): job is NormalizedJob => job !== null);
      });
      if (errors.length) ctx.logger.warn({ errors }, 'Some Lever companies failed');
      return results;
    },
  };
}
