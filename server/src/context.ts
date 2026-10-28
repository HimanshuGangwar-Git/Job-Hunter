import type { AppConfig } from './config';
import type { Db } from './db/pool';
import type { Logger } from './logger';
import type { AiProvider } from './ai/provider';
import type { ConnectorRegistry } from './jobs/connectors/registry';
import type { FileStorage } from './storage';

// Everything a route or service needs. Built once in index.ts, or with fakes in tests.
export interface AppContext {
  config: AppConfig;
  db: Db;
  logger: Logger;
  connectors: ConnectorRegistry;
  ai: AiProvider;
  storage: FileStorage;
}
