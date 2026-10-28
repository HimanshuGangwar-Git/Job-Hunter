import EmbeddedPostgres from 'embedded-postgres';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Local development database without Docker or a system install. Data persists between runs.
// Keep this process running in its own terminal while you develop.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const port = Number(process.env.DEV_DB_PORT ?? 54329);

const pg = new EmbeddedPostgres({
  databaseDir: path.join(root, '.embedded-postgres-data'),
  user: 'postgres',
  password: 'postgres',
  port,
  persistent: true,
  initdbFlags: ['--encoding=UTF8', '--locale=C'],
  onLog: () => undefined,
  onError: (error: unknown) => console.error(error),
});

async function main() {
  const { existsSync } = await import('node:fs');
  if (!existsSync(path.join(root, '.embedded-postgres-data', 'PG_VERSION'))) {
    await pg.initialise();
  }
  await pg.start();
  try {
    await pg.createDatabase('jobhunter');
  } catch {
    // Database already exists from a previous run.
  }
  console.log(`Local PostgreSQL running on postgres://postgres:postgres@127.0.0.1:${port}/jobhunter (Ctrl+C to stop)`);

  const stop = async () => {
    await pg.stop();
    process.exit(0);
  };
  process.once('SIGINT', () => void stop());
  process.once('SIGTERM', () => void stop());
}

main().catch((error: unknown) => {
  console.error('Could not start the local database:', error instanceof Error ? error.message : error);
  process.exit(1);
});
