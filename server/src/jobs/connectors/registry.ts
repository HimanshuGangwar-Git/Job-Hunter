import type { AppConfig } from '../../config';
import { createGreenhouseConnector } from './greenhouse';
import { createLeverConnector } from './lever';
import { createLicensedFeedConnector } from './licensed-feed';
import { createMockConnector } from './mock';
import { createRssConnector } from './rss';
import { describeConnector, type JobConnector, type SourceDescriptor } from './types';

export interface ConnectorRegistry {
  all(): JobConnector[];
  find(id: string): JobConnector | undefined;
  describe(): SourceDescriptor[];
}

export function createRegistry(connectors: JobConnector[]): ConnectorRegistry {
  const byId = new Map(connectors.map((connector) => [connector.id, connector]));
  return {
    all: () => [...connectors],
    find: (id) => byId.get(id),
    describe: () => connectors.map(describeConnector),
  };
}

/**
 * The production source list. To add a portal:
 *   1. Implement JobConnector (see types.ts) using a public API, an authorised feed, or a licensed partner endpoint.
 *   2. Add it here with its configuration from config.ts.
 *   3. Add a fixture test under server/tests/connectors.
 */
export function createDefaultRegistry(config: AppConfig): ConnectorRegistry {
  return createRegistry([
    createGreenhouseConnector(config.GREENHOUSE_BOARDS),
    createLeverConnector(config.LEVER_COMPANIES),
    createRssConnector(config.RSS_FEEDS),
    createLicensedFeedConnector({ id: 'linkedin', name: 'LinkedIn', feedUrl: config.LINKEDIN_FEED_URL, apiKey: config.LICENSED_FEED_API_KEY }),
    createLicensedFeedConnector({ id: 'indeed', name: 'Indeed', feedUrl: config.INDEED_FEED_URL, apiKey: config.LICENSED_FEED_API_KEY }),
    createLicensedFeedConnector({ id: 'naukri', name: 'Naukri', feedUrl: config.NAUKRI_FEED_URL, apiKey: config.LICENSED_FEED_API_KEY }),
    createLicensedFeedConnector({
      id: 'internshala',
      name: 'Internshala',
      feedUrl: config.INTERNSHALA_FEED_URL,
      apiKey: config.LICENSED_FEED_API_KEY,
    }),
    createLicensedFeedConnector({ id: 'apna', name: 'Apna', feedUrl: config.APNA_FEED_URL, apiKey: config.LICENSED_FEED_API_KEY }),
    createLicensedFeedConnector({ id: 'jobhai', name: 'Job Hai', feedUrl: config.JOBHAI_FEED_URL, apiKey: config.LICENSED_FEED_API_KEY }),
    createMockConnector(config.ENABLE_MOCK_SOURCE),
  ]);
}
