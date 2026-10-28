import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';

/**
 * Starts a throwaway PostgreSQL cluster for the integration suite (no Docker or system install needed).
 * Set TEST_DATABASE_URL to use an existing database instead.
 */
export default async function setup(): Promise<() => Promise<void>> {
  if (process.env.TEST_DATABASE_URL) {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    return async () => undefined;
  }

  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'jh-pg-'));
  const port = 54_000 + Math.floor(Math.random() * 1000);
  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: 'postgres',
    password: 'postgres',
    port,
    persistent: false,
    // UTF-8 so that CVs and postings with ₹, €, bullets and accents are stored as written.
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
    onLog: () => undefined,
    onError: () => undefined,
  });

  await pg.initialise();
  await pg.start();
  await pg.createDatabase('jobhunter_test');
  process.env.DATABASE_URL = `postgres://postgres:postgres@127.0.0.1:${port}/jobhunter_test`;

  return async () => {
    await pg.stop();
    await rm(dataDir, { recursive: true, force: true });
  };
}
