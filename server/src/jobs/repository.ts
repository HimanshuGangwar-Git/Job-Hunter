import type { Db } from '../db/pool';
import { query, queryOne } from '../db/pool';
import type { ApplicationStatus, MatchResult, ScoreBreakdown, WorkMode } from '../domain/types';
import type { NormalizedJob } from './normalize';

export interface JobListFilters {
  q?: string;
  minScore?: number;
  role?: string;
  company?: string;
  location?: string;
  minSalary?: number;
  source?: string;
  status?: ApplicationStatus;
  sort: 'score' | 'posted' | 'salary';
  page: number;
  pageSize: number;
}

export interface JobDto {
  id: string;
  title: string;
  company: string;
  location: string;
  workMode: WorkMode | null;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  salaryText: string | null;
  description: string;
  url: string;
  source: string;
  sources: string[];
  postedAt: string | null;
  discoveredAt: string;
  match: MatchResult | null;
  status: ApplicationStatus | null;
}

interface JobRow {
  id: string;
  title: string;
  company: string;
  location: string;
  work_mode: WorkMode | null;
  salary_min: number | null;
  salary_max: number | null;
  salary_currency: string | null;
  salary_text: string | null;
  description: string;
  url: string;
  source: string;
  sources: string[];
  posted_at: Date | null;
  discovered_at: Date;
  score: number | null;
  breakdown: ScoreBreakdown | null;
  matched_skills: string[] | null;
  missing_skills: string[] | null;
  reasons: string[] | null;
  cv_id: string | null;
  ai_summary: string | null;
  app_status: ApplicationStatus | null;
}

const JOB_SELECT = `
  SELECT j.id, j.title, j.company, j.location, j.work_mode, j.salary_min, j.salary_max, j.salary_currency, j.salary_text,
         j.description, j.url, j.source, j.sources, j.posted_at, j.discovered_at,
         jm.score, jm.breakdown, jm.matched_skills, jm.missing_skills, jm.reasons, jm.cv_id, jm.ai_summary,
         a.status AS app_status
  FROM jobs j
  LEFT JOIN job_matches jm ON jm.job_id = j.id AND jm.user_id = $1
  LEFT JOIN applications a ON a.job_id = j.id AND a.user_id = $1`;

const toDto = (row: JobRow): JobDto => ({
  id: row.id,
  title: row.title,
  company: row.company,
  location: row.location,
  workMode: row.work_mode,
  salaryMin: row.salary_min,
  salaryMax: row.salary_max,
  salaryCurrency: row.salary_currency,
  salaryText: row.salary_text,
  description: row.description,
  url: row.url,
  source: row.source,
  sources: row.sources,
  postedAt: row.posted_at?.toISOString() ?? null,
  discoveredAt: row.discovered_at.toISOString(),
  match:
    row.score === null || !row.breakdown
      ? null
      : {
          score: row.score,
          breakdown: row.breakdown,
          matchedSkills: row.matched_skills ?? [],
          missingSkills: row.missing_skills ?? [],
          reasons: row.reasons ?? [],
          cvId: row.cv_id,
          aiSummary: row.ai_summary,
        },
  status: row.app_status,
});

/**
 * Inserts a job, or merges it into the existing row when the same role at the same company and location
 * is already known from another source. Returns whether a new row was created.
 */
export async function upsertJob(db: Db, job: NormalizedJob, fingerprint: string): Promise<{ id: string; inserted: boolean }> {
  const row = await queryOne<{ id: string; inserted: boolean }>(
    db,
    `INSERT INTO jobs (fingerprint, title, company, location, work_mode, salary_min, salary_max, salary_currency, salary_text,
                       description, url, source, sources, external_id, posted_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, ARRAY[$12]::text[], $13, $14)
     ON CONFLICT (fingerprint) DO UPDATE SET
       last_seen_at = now(),
       sources = ARRAY(SELECT DISTINCT unnest(jobs.sources || EXCLUDED.sources)),
       description = CASE WHEN length(EXCLUDED.description) > length(jobs.description) THEN EXCLUDED.description ELSE jobs.description END,
       salary_min = COALESCE(jobs.salary_min, EXCLUDED.salary_min),
       salary_max = COALESCE(jobs.salary_max, EXCLUDED.salary_max),
       salary_currency = COALESCE(jobs.salary_currency, EXCLUDED.salary_currency),
       salary_text = COALESCE(jobs.salary_text, EXCLUDED.salary_text)
     RETURNING id, (xmax = 0) AS inserted`,
    [
      fingerprint,
      job.title,
      job.company,
      job.location,
      job.workMode,
      job.salaryMin,
      job.salaryMax,
      job.salaryCurrency,
      job.salaryText,
      job.description,
      job.url,
      job.source,
      job.externalId,
      job.postedAt,
    ],
  );
  if (!row) throw new Error('Job upsert returned no row');
  return row;
}

export async function listJobs(db: Db, userId: string, filters: JobListFilters): Promise<{ items: JobDto[]; total: number }> {
  const params: unknown[] = [userId];
  const where: string[] = [];
  // Adds a parameter and returns its placeholder. Values are never interpolated into the SQL text.
  const param = (value: unknown): string => {
    params.push(value);
    return `$${params.length}`;
  };
  const contains = (value: string): string => `%${value.replace(/[\\%_]/g, '\\$&')}%`;

  if (filters.q) {
    const p = param(contains(filters.q));
    where.push(`(j.title ILIKE ${p} OR j.company ILIKE ${p} OR j.description ILIKE ${p})`);
  }
  if (filters.minScore !== undefined) where.push(`jm.score >= ${param(filters.minScore)}`);
  if (filters.role) where.push(`j.title ILIKE ${param(contains(filters.role))}`);
  if (filters.company) where.push(`j.company ILIKE ${param(contains(filters.company))}`);
  if (filters.location) where.push(`j.location ILIKE ${param(contains(filters.location))}`);
  if (filters.minSalary !== undefined) where.push(`j.salary_max >= ${param(filters.minSalary)}`);
  if (filters.source) where.push(`j.source = ${param(filters.source)}`);
  if (filters.status) where.push(`a.status = ${param(filters.status)}`);

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const orderSql =
    filters.sort === 'posted'
      ? 'ORDER BY COALESCE(j.posted_at, j.discovered_at) DESC NULLS LAST, j.id'
      : filters.sort === 'salary'
        ? 'ORDER BY j.salary_max DESC NULLS LAST, j.id'
        : 'ORDER BY jm.score DESC NULLS LAST, j.id';

  const countRow = await queryOne<{ total: string }>(
    db,
    `SELECT count(*) AS total FROM jobs j
     LEFT JOIN job_matches jm ON jm.job_id = j.id AND jm.user_id = $1
     LEFT JOIN applications a ON a.job_id = j.id AND a.user_id = $1
     ${whereSql}`,
    params,
  );

  const offset = (filters.page - 1) * filters.pageSize;
  const pageParams = [...params, filters.pageSize, offset];
  const rows = await query<JobRow>(
    db,
    `${JOB_SELECT} ${whereSql} ${orderSql} LIMIT $${pageParams.length - 1} OFFSET $${pageParams.length}`,
    pageParams,
  );
  return { items: rows.map(toDto), total: Number(countRow?.total ?? 0) };
}

export async function getJobForUser(db: Db, userId: string, jobId: string): Promise<JobDto | null> {
  const row = await queryOne<JobRow>(db, `${JOB_SELECT} WHERE j.id = $2`, [userId, jobId]);
  return row ? toDto(row) : null;
}

/** Jobs that need (re)scoring for a user: every job, newest first, bounded for predictable cost. */
export async function jobsForScoring(db: Db, limit = 2000): Promise<JobForScoringRow[]> {
  return query<JobForScoringRow>(
    db,
    `SELECT id, title, company, location, work_mode, salary_min, salary_max, salary_currency, description
     FROM jobs ORDER BY discovered_at DESC LIMIT $1`,
    [limit],
  );
}

export interface JobForScoringRow {
  id: string;
  title: string;
  company: string;
  location: string;
  work_mode: WorkMode | null;
  salary_min: number | null;
  salary_max: number | null;
  salary_currency: string | null;
  description: string;
}
