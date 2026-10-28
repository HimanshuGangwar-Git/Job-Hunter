import { XMLParser } from 'fast-xml-parser';
import { normalizeJob, type NormalizedJob } from '../normalize';
import { getText, settleAll } from './http';
import type { ConnectorContext, DiscoveryQuery, JobConnector } from './types';

type Loose = Record<string, unknown>;

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', textNodeName: '#text', trimValues: true });

const asArray = <T>(value: T | T[] | undefined): T[] => (value === undefined ? [] : Array.isArray(value) ? value : [value]);

const text = (value: unknown): string => {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (typeof value === 'object' && '#text' in (value as Loose)) return String((value as Loose)['#text']);
  return '';
};

/** Splits "Senior Engineer at Acme" / "Senior Engineer - Acme" into role and company. */
export function splitRssTitle(title: string, fallbackCompany: string): { title: string; company: string } {
  const parts = title.split(/\s+(?:at|@)\s+|\s+[|–—-]\s+/i);
  if (parts.length >= 2) return { title: parts[0].trim(), company: parts[parts.length - 1].trim() };
  return { title: title.trim(), company: fallbackCompany };
}

/** Parses RSS 2.0 and Atom feeds into normalised jobs. Exported for tests. */
export function parseFeed(xml: string, feedName: string): NormalizedJob[] {
  const doc = parser.parse(xml) as Loose;
  const rss = (doc.rss as Loose | undefined)?.channel as Loose | undefined;
  const atom = doc.feed as Loose | undefined;
  const channelTitle = text(rss?.title ?? atom?.title) || feedName;

  const items = rss
    ? asArray(rss.item as Loose | Loose[])
    : atom
      ? asArray(atom.entry as Loose | Loose[])
      : [];

  return items
    .map((item) => {
      const rawTitle = text(item.title);
      const { title, company } = splitRssTitle(rawTitle, channelTitle);
      const link = typeof item.link === 'object' && item.link !== null && '@_href' in (item.link as Loose)
        ? String((item.link as Loose)['@_href'])
        : text(item.link);
      const guid = text(item.guid ?? item.id) || link;
      return normalizeJob({
        externalId: guid,
        source: 'rss',
        title,
        company,
        description: text(item.description ?? item.summary ?? item.content),
        url: link,
        postedAt: text(item.pubDate ?? item.published ?? item.updated) || null,
      });
    })
    .filter((job): job is NormalizedJob => job !== null);
}

/** Generic RSS/Atom feeds listed in RSS_FEEDS. Works for any portal or company that publishes a job feed. */
export function createRssConnector(feedUrls: string[]): JobConnector {
  return {
    id: 'rss',
    name: 'RSS / Atom feeds',
    kind: 'feed',
    note: 'Feeds you configure in RSS_FEEDS',
    isConfigured: () => feedUrls.length > 0,
    async fetchJobs(_query: DiscoveryQuery, ctx: ConnectorContext): Promise<NormalizedJob[]> {
      const { results, errors } = await settleAll(feedUrls, async (url) => {
        const xml = await getText(ctx.fetch, url);
        return parseFeed(xml, new URL(url).hostname);
      });
      if (errors.length) ctx.logger.warn({ errors }, 'Some RSS feeds failed');
      return results;
    },
  };
}
