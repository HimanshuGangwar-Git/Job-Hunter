import { readdir, readFile } from 'node:fs/promises';
import { serverPath } from '../paths';
import path from 'node:path';
import type { Db } from './pool';

export const MIGRATIONS_DIR = serverPath('migrations');

// Arbitrary constant so that concurrent app instances never run migrations at the same time.
const MIGRATION_LOCK_ID = 727_001;

export interface MigrationResult {
  applied: string[];
}

export async function runMigrations(db: Db, dir: string = MIGRATIONS_DIR): Promise<MigrationResult> {
  const client = await db.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_ID]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name       text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const done = new Set(
      (await client.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map((row) => row.name),
    );
    const files = (await readdir(dir)).filter((file) => file.endsWith('.sql')).sort();
    const applied: string[] = [];

    for (const file of files) {
      if (done.has(file)) continue;
      const sql = await readFile(path.join(dir, file), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        applied.push(file);
      } catch (error) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} failed: ${(error as Error).message}`);
      }
    }
    return { applied };
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]).catch(() => undefined);
    client.release();
  }
}
