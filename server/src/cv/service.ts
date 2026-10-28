import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { Db } from '../db/pool';
import { query, queryOne, withTransaction } from '../db/pool';
import { emptyProfile, type Profile } from '../domain/types';
import { notFound } from '../http/errors';
import type { Logger } from '../logger';
import type { FileStorage } from '../storage';
import { detectCvType, extractCvText } from './extract-text';
import { extractProfile, type ParsedCv } from './extract-profile';

export interface CvDto {
  id: string;
  fileName: string;
  uploadedAt: string;
  isPrimary: boolean;
  skillCount: number;
  wordCount: number;
}

export interface StoredCv {
  id: string;
  fileName: string;
  storagePath: string;
  parsed: ParsedCv;
  textContent: string;
  isPrimary: boolean;
}

export interface CvRow {
  id: string;
  file_name: string;
  uploaded_at: Date;
  is_primary: boolean;
  word_count: number;
  parsed: ParsedCv;
  storage_path: string;
  text_content: string;
}

// Anything that can run a query: the pool itself or a transaction client.
type Queryable = Pick<Db, 'query'>;

const SELECT_CV = `SELECT id, file_name, uploaded_at, is_primary, word_count, parsed, storage_path, text_content FROM cv_documents`;

const toDto = (row: CvRow): CvDto => ({
  id: row.id,
  fileName: row.file_name,
  uploadedAt: row.uploaded_at.toISOString(),
  isPrimary: row.is_primary,
  skillCount: row.parsed.skills.length,
  wordCount: row.word_count,
});

export function toStoredCv(row: CvRow): StoredCv {
  return {
    id: row.id,
    fileName: row.file_name,
    storagePath: row.storage_path,
    parsed: row.parsed,
    textContent: row.text_content,
    isPrimary: row.is_primary,
  };
}

export interface CvService {
  list(userId: string): Promise<CvDto[]>;
  upload(userId: string, fileName: string, buffer: Buffer): Promise<CvDto>;
  setPrimary(userId: string, cvId: string): Promise<CvDto>;
  remove(userId: string, cvId: string): Promise<void>;
  get(userId: string, cvId: string): Promise<StoredCv>;
  all(userId: string): Promise<StoredCv[]>;
}

/** Replaces the stored profile with the one extracted from the primary CV. Manual edits are overwritten here. */
async function applyPrimaryProfile(client: Queryable, userId: string, parsed: ParsedCv): Promise<void> {
  await client.query(
    `INSERT INTO profiles (user_id, data, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (user_id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
    [userId, JSON.stringify(parsed.profile)],
  );
}

/** Adds skills from a secondary CV to the profile without removing anything the user has edited. */
async function mergeSkills(client: Queryable, userId: string, skills: string[]): Promise<void> {
  const { rows } = await client.query<{ data: Profile }>('SELECT data FROM profiles WHERE user_id = $1', [userId]);
  const current = rows[0]?.data ?? emptyProfile();
  const merged = [...new Set([...current.skills, ...skills])];
  await client.query(
    `INSERT INTO profiles (user_id, data, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (user_id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
    [userId, JSON.stringify({ ...current, skills: merged })],
  );
}

export function createCvService(db: Db, storage: FileStorage, logger: Logger): CvService {
  return {
    async list(userId) {
      const rows = await query<CvRow>(db, `${SELECT_CV} WHERE user_id = $1 ORDER BY uploaded_at ASC`, [userId]);
      return rows.map(toDto);
    },

    async upload(userId, fileName, buffer) {
      const type = detectCvType(fileName, buffer);
      const text = await extractCvText(buffer, type);
      const parsed = extractProfile(text);
      const id = randomUUID();
      const storagePath = await storage.write(path.posix.join('cvs', userId, `${id}.${type}`), buffer);
      const safeName = path.basename(fileName).slice(0, 180);
      const mime =
        type === 'pdf'
          ? 'application/pdf'
          : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

      const row = await withTransaction(db, async (client) => {
        const { rows } = await client.query<{ count: string }>(
          'SELECT count(*) FROM cv_documents WHERE user_id = $1',
          [userId],
        );
        const isPrimary = Number(rows[0].count) === 0;
        const inserted = await client.query<CvRow>(
          `INSERT INTO cv_documents (id, user_id, file_name, mime_type, storage_path, text_content, parsed, is_primary, word_count)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           RETURNING id, file_name, uploaded_at, is_primary, word_count, parsed, storage_path, text_content`,
          [id, userId, safeName, mime, storagePath, text, JSON.stringify(parsed), isPrimary, text.split(/\s+/).length],
        );
        if (isPrimary) {
          await applyPrimaryProfile(client, userId, parsed);
        } else {
          await mergeSkills(client, userId, parsed.skills);
        }
        return inserted.rows[0];
      });
      logger.info({ userId, cvId: id, skills: parsed.skills.length }, 'CV uploaded and parsed');
      return toDto(row);
    },

    async setPrimary(userId, cvId) {
      const cv = await queryOne<CvRow>(db, `${SELECT_CV} WHERE id = $1 AND user_id = $2`, [cvId, userId]);
      if (!cv) throw notFound('CV not found');
      await withTransaction(db, async (client) => {
        await client.query('UPDATE cv_documents SET is_primary = false WHERE user_id = $1 AND is_primary', [userId]);
        await client.query('UPDATE cv_documents SET is_primary = true WHERE id = $1', [cvId]);
        await applyPrimaryProfile(client, userId, cv.parsed);
      });
      return toDto({ ...cv, is_primary: true });
    },

    async remove(userId, cvId) {
      const cv = await queryOne<CvRow>(db, `${SELECT_CV} WHERE id = $1 AND user_id = $2`, [cvId, userId]);
      if (!cv) throw notFound('CV not found');
      await withTransaction(db, async (client) => {
        await client.query('DELETE FROM cv_documents WHERE id = $1', [cvId]);
        if (cv.is_primary) {
          // Promote the most recent remaining CV so matching always has a primary source.
          const next = await client.query<CvRow>(`${SELECT_CV} WHERE user_id = $1 ORDER BY uploaded_at DESC LIMIT 1`, [
            userId,
          ]);
          const promoted = next.rows[0];
          if (promoted) {
            await client.query('UPDATE cv_documents SET is_primary = true WHERE id = $1', [promoted.id]);
            await applyPrimaryProfile(client, userId, promoted.parsed);
          }
        }
      });
      await storage
        .remove(cv.storage_path)
        .catch((error: unknown) => logger.warn({ err: error }, 'Could not delete CV file from storage'));
    },

    async get(userId, cvId) {
      const cv = await queryOne<CvRow>(db, `${SELECT_CV} WHERE id = $1 AND user_id = $2`, [cvId, userId]);
      if (!cv) throw notFound('CV not found');
      return toStoredCv(cv);
    },

    async all(userId) {
      const rows = await query<CvRow>(db, `${SELECT_CV} WHERE user_id = $1 ORDER BY uploaded_at ASC`, [userId]);
      return rows.map(toStoredCv);
    },
  };
}
