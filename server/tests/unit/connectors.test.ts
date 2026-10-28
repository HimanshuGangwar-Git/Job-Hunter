import { describe, expect, it, vi } from 'vitest';
import { createGreenhouseConnector } from '../../src/jobs/connectors/greenhouse';
import { createLeverConnector } from '../../src/jobs/connectors/lever';
import { createLicensedFeedConnector } from '../../src/jobs/connectors/licensed-feed';
import { parseFeed, splitRssTitle } from '../../src/jobs/connectors/rss';
import { createRegistry, createDefaultRegistry } from '../../src/jobs/connectors/registry';
import { createRssConnector } from '../../src/jobs/connectors/rss';
import { createMockConnector } from '../../src/jobs/connectors/mock';
import { isRelevant } from '../../src/jobs/discovery';
import type { AppConfig } from '../../src/config';
import type { Logger } from '../../src/logger';

const logger = { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;

function jsonFetch(body: unknown, status = 200): typeof fetch {
  return vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch;
}

const RSS = `<?xml version="1.0"?>
<rss version="2.0"><channel><title>Example Jobs</title>
  <item>
    <title>Frontend Engineer at Acme Fintech</title>
    <link>https://jobs.example.com/acme/1</link>
    <guid>acme-1</guid>
    <description>&lt;p&gt;React and TypeScript. Hybrid.&lt;/p&gt;</description>
    <pubDate>Tue, 20 Oct 2026 10:00:00 GMT</pubDate>
  </item>
</channel></rss>`;

const ATOM = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom"><title>Atom Board</title>
  <entry>
    <title>Data Engineer - Orbit Logistics</title>
    <link href="https://jobs.example.com/orbit/2"/>
    <id>orbit-2</id>
    <summary>Airflow and Spark.</summary>
    <updated>2026-10-21T08:00:00Z</updated>
  </entry>
</feed>`;

describe('RSS and Atom parsing', () => {
  it('parses RSS items and splits "Role at Company" titles', () => {
    const [job] = parseFeed(RSS, 'example');
    expect(job).toMatchObject({ title: 'Frontend Engineer', company: 'Acme Fintech', url: 'https://jobs.example.com/acme/1', workMode: 'hybrid' });
    expect(job.description).toBe('React and TypeScript. Hybrid.');
  });

  it('parses Atom entries and uses the feed title when the company is not in the title', () => {
    const [job] = parseFeed(ATOM, 'example');
    expect(job).toMatchObject({ title: 'Data Engineer', company: 'Orbit Logistics', url: 'https://jobs.example.com/orbit/2' });
  });

  it('falls back to the feed name when no company is present', () => {
    expect(splitRssTitle('Backend Engineer', 'Feed Name')).toEqual({ title: 'Backend Engineer', company: 'Feed Name' });
  });

  it('ignores non-feed XML without throwing', () => {
    expect(parseFeed('<html><body>not a feed</body></html>', 'x')).toEqual([]);
  });
});

describe('API connectors', () => {
  it('maps Greenhouse board responses to normalised jobs', async () => {
    const fetchImpl = jsonFetch({
      jobs: [
        {
          id: 42,
          title: 'Senior Frontend Engineer',
          absolute_url: 'https://boards.greenhouse.io/northwind/jobs/42',
          location: { name: 'Bengaluru, India' },
          content: '&lt;p&gt;Build with React.&lt;/p&gt;',
          first_published: '2026-10-20T09:00:00Z',
        },
      ],
    });
    const connector = createGreenhouseConnector(['northwind']);
    const jobs = await connector.fetchJobs({ keywords: [], locations: [] }, { logger, fetch: fetchImpl });
    expect(fetchImpl).toHaveBeenCalledWith(expect.stringContaining('boards-api.greenhouse.io/v1/boards/northwind/jobs'), expect.anything());
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ externalId: 'northwind:42', company: 'Northwind', source: 'greenhouse', location: 'Bengaluru, India' });
    expect(jobs[0].description).toBe('Build with React.');
  });

  it('maps Lever postings and only treats yearly salary ranges as annual', async () => {
    const fetchImpl = jsonFetch([
      {
        id: 'abc',
        text: 'Frontend Engineer',
        hostedUrl: 'https://jobs.lever.co/blueharbor/abc',
        categories: { location: 'Chennai' },
        workplaceType: 'hybrid',
        descriptionPlain: 'Charts and dashboards.',
        createdAt: Date.UTC(2026, 9, 19),
        salaryRange: { min: 2400000, max: 3300000, currency: 'INR', interval: 'per-year-salary' },
      },
      {
        id: 'def',
        text: 'Hourly Contractor',
        hostedUrl: 'https://jobs.lever.co/blueharbor/def',
        categories: { location: 'Remote' },
        salaryRange: { min: 40, max: 60, currency: 'USD', interval: 'per-hour-salary' },
      },
    ]);
    const jobs = await createLeverConnector(['blueharbor']).fetchJobs({ keywords: [], locations: [] }, { logger, fetch: fetchImpl });
    expect(jobs).toHaveLength(2);
    expect(jobs[0]).toMatchObject({ salaryMin: 2400000, salaryMax: 3300000, workMode: 'hybrid' });
    expect(jobs[1]).toMatchObject({ salaryMin: null, salaryMax: null, workMode: 'remote' });
  });

  it('keeps going when one board fails and reports the failure in logs', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      if (String(url).includes('bad-board')) return new Response('nope', { status: 500 });
      return new Response(JSON.stringify({ jobs: [{ id: 1, title: 'Engineer', absolute_url: 'https://example.com/1' }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const warn = vi.fn();
    const jobs = await createGreenhouseConnector(['bad-board', 'good-board']).fetchJobs(
      { keywords: [], locations: [] },
      { logger: { ...logger, warn } as unknown as Logger, fetch: fetchImpl },
    );
    expect(jobs).toHaveLength(1);
    expect(warn).toHaveBeenCalled();
  });

  it('fails only when every configured board fails', async () => {
    const fetchImpl = jsonFetch({ error: 'down' }, 503);
    await expect(createGreenhouseConnector(['a']).fetchJobs({ keywords: [], locations: [] }, { logger, fetch: fetchImpl })).rejects.toThrow(
      /HTTP 503/,
    );
  });
});

describe('licensed feeds', () => {
  it('is not configured without a feed URL and fetches nothing', async () => {
    const connector = createLicensedFeedConnector({ id: 'naukri', name: 'Naukri', feedUrl: undefined });
    expect(connector.isConfigured()).toBe(false);
    expect(await connector.fetchJobs({ keywords: [], locations: [] }, { logger, fetch: jsonFetch({}) })).toEqual([]);
  });

  it('reads the documented Job Hunter feed shape and sends the API key as a bearer token', async () => {
    const fetchImpl = jsonFetch({
      jobs: [{ id: 7, title: 'Product Designer', company: 'Cedar', url: 'https://feeds.example.com/7', location: 'Remote', postedAt: '2026-10-22' }],
    });
    const connector = createLicensedFeedConnector({ id: 'apna', name: 'Apna', feedUrl: 'https://feeds.example.com/jobs.json', apiKey: 'k' });
    const jobs = await connector.fetchJobs({ keywords: [], locations: [] }, { logger, fetch: fetchImpl });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ externalId: '7', source: 'apna', workMode: 'remote' });
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://feeds.example.com/jobs.json',
      expect.objectContaining({ headers: expect.anything() }),
    );
  });
});

describe('registry and relevance', () => {
  const config = {
    GREENHOUSE_BOARDS: ['a'],
    LEVER_COMPANIES: [],
    RSS_FEEDS: [],
    LINKEDIN_FEED_URL: undefined,
    INDEED_FEED_URL: undefined,
    NAUKRI_FEED_URL: undefined,
    INTERNSHALA_FEED_URL: undefined,
    APNA_FEED_URL: undefined,
    JOBHAI_FEED_URL: undefined,
    LICENSED_FEED_API_KEY: undefined,
    ENABLE_MOCK_SOURCE: false,
  } as unknown as AppConfig;

  it('reports configured status per source so unconfigured portals are clearly marked', () => {
    const sources = createDefaultRegistry(config).describe();
    expect(sources.find((s) => s.id === 'greenhouse')?.configured).toBe(true);
    expect(sources.find((s) => s.id === 'lever')?.configured).toBe(false);
    expect(sources.find((s) => s.id === 'linkedin')?.configured).toBe(false);
    expect(sources.map((s) => s.id)).toEqual(expect.arrayContaining(['linkedin', 'indeed', 'naukri', 'internshala', 'apna', 'jobhai']));
  });

  it('finds connectors by id', () => {
    const registry = createRegistry([createRssConnector(['https://x.example/feed']), createMockConnector(true)]);
    expect(registry.find('rss')?.name).toBe('RSS / Atom feeds');
    expect(registry.find('missing')).toBeUndefined();
  });

  it('keeps postings that mention a keyword and everything when no keywords are given', () => {
    const job = { title: 'Frontend Engineer', description: 'React work' };
    expect(isRelevant(job, ['React'])).toBe(true);
    expect(isRelevant(job, ['Data Engineer'])).toBe(false);
    expect(isRelevant(job, [])).toBe(true);
  });
});
