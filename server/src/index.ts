import 'dotenv/config';
import { buildApp } from './app';
import { loadConfig } from './config';
import { createPool } from './db/pool';
import { runMigrations } from './db/migrate';
import { createAiProvider } from './ai/provider';
import { createLogger } from './logger';
import { ensureLocalUser } from './auth/local-user';
import { createDefaultRegistry } from './jobs/connectors/registry';
import { FileStorage } from './storage';
import { startScheduler } from './searches/scheduler';
import type { AppContext } from './context';

async function main() {
  const config = loadConfig();
  const logger = createLogger(config.LOG_LEVEL);
  const db = createPool(config.DATABASE_URL);

  const applied = await runMigrations(db);
  if (applied.applied.length) logger.info({ migrations: applied.applied }, 'Applied database migrations');
  await ensureLocalUser(db);

  const ctx: AppContext = {
    config,
    db,
    logger,
    connectors: createDefaultRegistry(config),
    ai: createAiProvider(config, logger),
    // Storage root is shared by CV uploads and generated application documents.
    storage: new FileStorage(config.STORAGE_DIR),
  };
  const app = await buildApp(ctx);

  const scheduler = config.SCHEDULER_ENABLED ? startScheduler(ctx, config.SCHEDULER_INTERVAL_MS) : null;

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutting down');
    scheduler?.stop();
    await app.close();
    await db.end();
    process.exit(0);
  };
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ host: config.HOST, port: config.PORT });
  logger.info({ port: config.PORT, aiEnabled: ctx.ai.enabled }, 'Job Hunter API listening');
}

main().catch((error: unknown) => {
  console.error('Failed to start Job Hunter API:', error instanceof Error ? error.message : error);
  process.exit(1);
});
