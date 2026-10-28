import type { Logger } from '../../logger';
import type { NormalizedJob } from '../normalize';

export type ConnectorKind = 'api' | 'feed' | 'licensed-feed';

export interface DiscoveryQuery {
  keywords: string[];
  locations: string[];
}

export interface ConnectorContext {
  logger: Logger;
  fetch: typeof fetch;
}

/**
 * A job source. To add a portal, implement this interface and register it in registry.ts.
 * Connectors must only use documented public APIs, feeds the operator is entitled to use, or the
 * portal's licensed/partner endpoints. They must not bypass CAPTCHA, logins or anti-bot protections.
 */
export interface JobConnector {
  readonly id: string;
  readonly name: string;
  readonly kind: ConnectorKind;
  readonly note: string;
  isConfigured(): boolean;
  fetchJobs(query: DiscoveryQuery, ctx: ConnectorContext): Promise<NormalizedJob[]>;
}

export interface SourceDescriptor {
  id: string;
  name: string;
  kind: ConnectorKind;
  configured: boolean;
  note: string;
}

export const describeConnector = (connector: JobConnector): SourceDescriptor => ({
  id: connector.id,
  name: connector.name,
  kind: connector.kind,
  configured: connector.isConfigured(),
  note: connector.note,
});
