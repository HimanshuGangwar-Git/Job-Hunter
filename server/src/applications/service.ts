import type { AppContext } from '../context';
import { query, queryOne, withTransaction } from '../db/pool';
import type { ApplicationStatus } from '../domain/types';
import { conflict, badRequest, notFound, unprocessable } from '../http/errors';
import { createCvService, type StoredCv } from '../cv/service';
import { pickBestCv } from '../matching/service';
import { createProfileService } from '../profile/service';
import { renderCvDocx, renderCvPdf } from './documents';
import { buildCoverLetter, buildRecruiterMessage, checkNoFabrication, tailorCv, type TailoredCvData } from './tailor';

const CUSTOMIZABLE: ApplicationStatus[] = ['Shortlisted', 'CV Customized', 'Ready to Apply', 'New'];
const APPLYABLE: ApplicationStatus[] = ['Shortlisted', 'CV Customized', 'Ready to Apply', 'New'];
const DEFAULT_FOLLOW_UP_DAYS = 7;

export interface ApplicationDto {
  id: string;
  jobId: string;
  jobTitle: string;
  company: string;
  location: string;
  source: string;
  jobUrl: string;
  status: ApplicationStatus;
  score: number | null;
  notes: string;
  coverLetter: string | null;
  recruiterMessage: string | null;
  tailoredCv: {
    cvId: string;
    cvFileName: string;
    summary: string;
    skills: string[];
    experience: { title: string; company: string; bullets: string[] }[];
    pdfUrl: string;
    docxUrl: string;
    atsKeywords: string[];
    gaps: string[];
  } | null;
  appliedAt: string | null;
  followUpAt: string | null;
  createdAt: string;
  updatedAt: string;
  events: { id: string; type: string; description: string; createdAt: string }[];
}

interface AppRow {
  id: string;
  job_id: string;
  status: ApplicationStatus;
  notes: string;
  cv_id: string | null;
  cv_file_name: string | null;
  tailored: TailoredCvData | null;
  cover_letter: string | null;
  recruiter_message: string | null;
  pdf_path: string | null;
  docx_path: string | null;
  applied_at: Date | null;
  follow_up_at: Date | null;
  created_at: Date;
  updated_at: Date;
  title: string;
  company: string;
  location: string;
  source: string;
  url: string;
  score: number | null;
}

const SELECT_APP = `
  SELECT a.id, a.job_id, a.status, a.notes, a.cv_id, cd.file_name AS cv_file_name, a.tailored, a.cover_letter,
         a.recruiter_message, a.pdf_path, a.docx_path, a.applied_at, a.follow_up_at, a.created_at, a.updated_at,
         j.title, j.company, j.location, j.source, j.url, jm.score
  FROM applications a
  JOIN jobs j ON j.id = a.job_id
  LEFT JOIN job_matches jm ON jm.job_id = a.job_id AND jm.user_id = a.user_id
  LEFT JOIN cv_documents cd ON cd.id = a.cv_id`;

export interface ApplicationService {
  list(userId: string, status?: ApplicationStatus): Promise<ApplicationDto[]>;
  get(userId: string, id: string): Promise<ApplicationDto>;
  shortlist(userId: string, jobId: string): Promise<ApplicationDto>;
  customize(userId: string, id: string): Promise<ApplicationDto>;
  update(userId: string, id: string, patch: { status?: ApplicationStatus; notes?: string; followUpAt?: string | null }): Promise<ApplicationDto>;
  markApplied(userId: string, id: string, approved: unknown): Promise<ApplicationDto>;
  document(userId: string, id: string, format: 'pdf' | 'docx'): Promise<{ buffer: Buffer; fileName: string }>;
}

export function createApplicationService(ctx: AppContext): ApplicationService {
  const cvs = createCvService(ctx.db, ctx.storage, ctx.logger);
  const profiles = createProfileService(ctx.db);

  async function event(client: { query: typeof ctx.db.query }, applicationId: string, type: string, description: string) {
    await client.query('INSERT INTO application_events (application_id, type, description) VALUES ($1, $2, $3)', [
      applicationId,
      type,
      description,
    ]);
  }

  async function loadRow(userId: string, id: string): Promise<AppRow> {
    const row = await queryOne<AppRow>(ctx.db, `${SELECT_APP} WHERE a.id = $1 AND a.user_id = $2`, [id, userId]);
    if (!row) throw notFound('Application not found');
    return row;
  }

  async function toDto(row: AppRow): Promise<ApplicationDto> {
    const events = await query<{ id: string; type: string; description: string; created_at: Date }>(
      ctx.db,
      'SELECT id, type, description, created_at FROM application_events WHERE application_id = $1 ORDER BY created_at DESC',
      [row.id],
    );
    const tailored = row.tailored;
    return {
      id: row.id,
      jobId: row.job_id,
      jobTitle: row.title,
      company: row.company,
      location: row.location,
      source: row.source,
      jobUrl: row.url,
      status: row.status,
      score: row.score,
      notes: row.notes,
      coverLetter: row.cover_letter,
      recruiterMessage: row.recruiter_message,
      tailoredCv:
        tailored && row.cv_id
          ? {
              cvId: row.cv_id,
              cvFileName: row.cv_file_name ?? 'CV',
              summary: tailored.summary,
              skills: tailored.skills,
              experience: tailored.experience.map((e) => ({ title: e.title, company: e.company, bullets: e.bullets })),
              pdfUrl: `/api/applications/${row.id}/cv.pdf`,
              docxUrl: `/api/applications/${row.id}/cv.docx`,
              atsKeywords: tailored.atsKeywords,
              gaps: tailored.gaps,
            }
          : null,
      appliedAt: row.applied_at?.toISOString() ?? null,
      followUpAt: row.follow_up_at?.toISOString() ?? null,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
      events: events.map((e) => ({ id: e.id, type: e.type, description: e.description, createdAt: e.created_at.toISOString() })),
    };
  }

  return {
    async list(userId, status) {
      const rows = await query<AppRow>(
        ctx.db,
        `${SELECT_APP} WHERE a.user_id = $1 ${status ? 'AND a.status = $2' : ''} ORDER BY a.updated_at DESC`,
        status ? [userId, status] : [userId],
      );
      return Promise.all(rows.map(toDto));
    },

    async get(userId, id) {
      return toDto(await loadRow(userId, id));
    },

    async shortlist(userId, jobId) {
      const job = await queryOne<{ id: string }>(ctx.db, 'SELECT id FROM jobs WHERE id = $1', [jobId]);
      if (!job) throw notFound('Job not found');
      const id = await withTransaction(ctx.db, async (client) => {
        const inserted = await client.query<{ id: string }>(
          `INSERT INTO applications (user_id, job_id, status) VALUES ($1, $2, 'Shortlisted')
           ON CONFLICT (user_id, job_id) DO NOTHING RETURNING id`,
          [userId, jobId],
        );
        if (inserted.rows[0]) {
          await event(client, inserted.rows[0].id, 'status_changed', 'Shortlisted');
          return inserted.rows[0].id;
        }
        const existing = await client.query<{ id: string }>('SELECT id FROM applications WHERE user_id = $1 AND job_id = $2', [
          userId,
          jobId,
        ]);
        return existing.rows[0].id;
      });
      return toDto(await loadRow(userId, id));
    },

    async customize(userId, id) {
      const row = await loadRow(userId, id);
      if (!CUSTOMIZABLE.includes(row.status)) {
        throw conflict(`A job with status "${row.status}" cannot be customised again. Create a new shortlist entry instead.`);
      }

      const allCvs: StoredCv[] = await cvs.all(userId);
      if (allCvs.length === 0) throw unprocessable('Upload a CV before generating a tailored application.');
      const matched = (await query<{ matched_skills: string[] }>(
        ctx.db,
        'SELECT matched_skills FROM job_matches WHERE user_id = $1 AND job_id = $2',
        [userId, row.job_id],
      ))[0]?.matched_skills ?? [];
      const cvId = pickBestCv(matched, allCvs);
      const cv = allCvs.find((c) => c.id === cvId) ?? allCvs[0];

      const profile = await profiles.getProfile(userId);
      const job = await queryOne<{ title: string; company: string; description: string }>(
        ctx.db,
        'SELECT title, company, description FROM jobs WHERE id = $1',
        [row.job_id],
      );
      if (!job) throw notFound('Job not found');

      // Built only from the selected CV, so nothing from another CV or the user's unverified edits leaks in.
      const tailored = tailorCv({ cv: cv.parsed, cvText: cv.textContent, job, candidateName: profile.fullName || row.title });
      let coverLetter = buildCoverLetter(tailored, job);
      let recruiterMessage = buildRecruiterMessage(tailored, job);

      if (ctx.ai.enabled) {
        const draft = await ctx.ai.draftApplication({
          jobTitle: job.title,
          company: job.company,
          jobDescription: job.description,
          cvFacts: JSON.stringify({ tailored, cvText: cv.textContent.slice(0, 6000) }),
          allowedSkills: tailored.skills,
        });
        if (draft) {
          const check = checkNoFabrication(
            { tailored: { ...tailored, summary: draft.summary }, texts: [draft.coverLetter, draft.recruiterMessage] },
            { cv: cv.parsed, cvText: cv.textContent },
          );
          if (check.violations.length === 0) {
            tailored.summary = draft.summary;
            coverLetter = draft.coverLetter;
            recruiterMessage = draft.recruiterMessage;
          } else {
            ctx.logger.warn({ violations: check.violations.slice(0, 5) }, 'AI draft rejected by fabrication check');
          }
        }
      }

      const check = checkNoFabrication(
        { tailored, texts: [coverLetter, recruiterMessage] },
        { cv: cv.parsed, cvText: cv.textContent },
      );
      if (check.violations.length) {
        throw new Error(`Deterministic draft failed the fabrication check: ${check.violations.join('; ')}`);
      }

      const [pdf, docx] = await Promise.all([renderCvPdf(tailored), renderCvDocx(tailored)]);
      const base = `applications/${userId}/${id}`;
      const pdfPath = await ctx.storage.write(`${base}/cv.pdf`, pdf);
      const docxPath = await ctx.storage.write(`${base}/cv.docx`, docx);

      await withTransaction(ctx.db, async (client) => {
        await client.query(
          `UPDATE applications SET status = 'CV Customized', cv_id = $2, tailored = $3, cover_letter = $4,
             recruiter_message = $5, pdf_path = $6, docx_path = $7, updated_at = now()
           WHERE id = $1`,
          [id, cv.id, JSON.stringify(tailored), coverLetter, recruiterMessage, pdfPath, docxPath],
        );
        await event(client, id, 'cv_customized', `CV customised using ${cv.fileName}`);
      });
      return toDto(await loadRow(userId, id));
    },

    async update(userId, id, patch) {
      if (patch.status === 'Applied') {
        throw badRequest('Use the "mark as applied" confirmation so that applications are only recorded after you submit them.');
      }
      const row = await loadRow(userId, id);
      await withTransaction(ctx.db, async (client) => {
        if (patch.status && patch.status !== row.status) {
          await client.query("UPDATE applications SET status = $2, updated_at = now() WHERE id = $1", [id, patch.status]);
          await event(client, id, 'status_changed', `Status changed to ${patch.status}`);
        }
        if (typeof patch.notes === 'string') {
          await client.query('UPDATE applications SET notes = $2, updated_at = now() WHERE id = $1', [id, patch.notes.slice(0, 5000)]);
        }
        if (patch.followUpAt !== undefined) {
          await client.query(
            'UPDATE applications SET follow_up_at = $2, follow_up_notified_at = NULL, updated_at = now() WHERE id = $1',
            [id, patch.followUpAt],
          );
          if (patch.followUpAt) await event(client, id, 'follow_up', `Follow-up set for ${patch.followUpAt.slice(0, 10)}`);
        }
      });
      return toDto(await loadRow(userId, id));
    },

    async markApplied(userId, id, approved) {
      // Submission always happens on the employer's site. This records it only after explicit confirmation.
      if (approved !== true) {
        throw badRequest('Confirm that you have submitted this application yourself before recording it as applied.');
      }
      const row = await loadRow(userId, id);
      if (!APPLYABLE.includes(row.status)) {
        throw conflict(`Applications with status "${row.status}" cannot be marked as applied.`);
      }
      await withTransaction(ctx.db, async (client) => {
        await client.query(
          `UPDATE applications SET status = 'Applied', applied_at = now(),
             follow_up_at = COALESCE(follow_up_at, now() + make_interval(days => $2)), updated_at = now()
           WHERE id = $1`,
          [id, DEFAULT_FOLLOW_UP_DAYS],
        );
        await event(client, id, 'applied', 'Marked as applied after confirmation');
      });
      return toDto(await loadRow(userId, id));
    },

    async document(userId, id, format) {
      const row = await loadRow(userId, id);
      const relative = format === 'pdf' ? row.pdf_path : row.docx_path;
      if (!relative) throw notFound('No tailored CV has been generated for this application yet.');
      const buffer = await ctx.storage.read(relative);
      const safeTitle = `${row.company}-${row.title}`.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 80);
      return { buffer, fileName: `${safeTitle || 'tailored-cv'}.${format}` };
    },
  };
}
