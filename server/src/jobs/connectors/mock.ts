import { readFile } from 'node:fs/promises';
import { serverPath } from '../../paths';
import { normalizeJob, type NormalizedJob, type RawJobInput } from '../normalize';
import type { ConnectorContext, DiscoveryQuery, JobConnector } from './types';

interface FixtureJob extends Omit<RawJobInput, 'postedAt' | 'source'> {
  daysAgo: number;
}

const fixturePath = serverPath('fixtures', 'sample-jobs.json');

/**
 * Offline sample source for local development and tests. Enabled with ENABLE_MOCK_SOURCE=true.
 * It never touches the network.
 */
export function createMockConnector(enabled: boolean, now: () => Date = () => new Date()): JobConnector {
  return {
    id: 'mock',
    name: 'Sample jobs (offline)',
    kind: 'feed',
    note: 'Offline fixture data for development. Enable with ENABLE_MOCK_SOURCE=true',
    isConfigured: () => enabled,
    async fetchJobs(_query: DiscoveryQuery, _ctx: ConnectorContext): Promise<NormalizedJob[]> {
      if (!enabled) return [];
      const fixtures = JSON.parse(await readFile(fixturePath, 'utf8')) as FixtureJob[];
      const today = now().getTime();
      return fixtures
        .map(({ daysAgo, ...job }) =>
          normalizeJob({
            ...job,
            source: 'mock',
            postedAt: new Date(today - daysAgo * 86_400_000),
          }),
        )
        .filter((job): job is NormalizedJob => job !== null);
    },
  };
}
