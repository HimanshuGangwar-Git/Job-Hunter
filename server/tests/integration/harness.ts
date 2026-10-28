import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import PDFDocument from 'pdfkit';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app';
import { loadConfig } from '../../src/config';
import type { AppContext } from '../../src/context';
import { createPool, type Db } from '../../src/db/pool';
import { runMigrations } from '../../src/db/migrate';
import { DisabledAiProvider } from '../../src/ai/provider';
import { createLogger } from '../../src/logger';
import { createDefaultRegistry } from '../../src/jobs/connectors/registry';
import { FileStorage } from '../../src/storage';

export interface Harness {
  app: FastifyInstance;
  ctx: AppContext;
  db: Db;
  close(): Promise<void>;
}

const TABLES = [
  'notifications',
  'application_events',
  'applications',
  'job_matches',
  'saved_searches',
  'jobs',
  'preferences',
  'profiles',
  'cv_documents',
  'users',
];

/** Builds the real app against the test database. Tables are cleared so each test file starts clean. */
export async function createHarness(): Promise<Harness> {
  const storageRoot = await mkdtemp(path.join(os.tmpdir(), 'jh-test-storage-'));
  const config = loadConfig({
    ...process.env,
    NODE_ENV: 'test',
    DATABASE_URL: process.env.DATABASE_URL,
    JWT_SECRET: 'test-secret-that-is-long-enough-1234567890',
    STORAGE_DIR: storageRoot,
    LOG_LEVEL: 'silent',
    ENABLE_MOCK_SOURCE: 'true',
    SCHEDULER_ENABLED: 'false',
    CORS_ORIGIN: 'http://localhost:5173',
  } as NodeJS.ProcessEnv);

  const logger = createLogger('silent');
  const db = createPool(config.DATABASE_URL);
  await runMigrations(db);
  await db.query(`TRUNCATE ${TABLES.join(', ')} RESTART IDENTITY CASCADE`);

  const ctx: AppContext = {
    config,
    db,
    logger,
    connectors: createDefaultRegistry(config),
    ai: new DisabledAiProvider(),
    storage: new FileStorage(storageRoot),
  };
  const app = await buildApp(ctx);
  await app.ready();

  return {
    app,
    ctx,
    db,
    close: async () => {
      await app.close();
      await db.end();
    },
  };
}

/** A text-based PDF containing the given lines, so the real extraction path is exercised. */
export function makeCvPdf(text: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 48 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.font('Helvetica').fontSize(11).text(text, { lineGap: 2 });
    doc.end();
  });
}

/** Builds a multipart/form-data body for a single file field, for app.inject. */
export function multipartFile(field: string, fileName: string, contentType: string, content: Buffer) {
  const boundary = `----jobhunter${Math.random().toString(16).slice(2)}`;
  const payload = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="${fileName}"\r\nContent-Type: ${contentType}\r\n\r\n`),
    content,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return { payload, headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

export const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
