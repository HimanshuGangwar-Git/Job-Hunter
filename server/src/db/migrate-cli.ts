import 'dotenv/config';
import { loadConfig } from '../config';
import { createPool } from './pool';
import { runMigrations } from './migrate';

async function main() {
  const config = loadConfig();
  const db = createPool(config.DATABASE_URL);
  try {
    const { applied } = await runMigrations(db);
    console.log(applied.length ? `Applied migrations: ${applied.join(', ')}` : 'Database is up to date.');
  } finally {
    await db.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
