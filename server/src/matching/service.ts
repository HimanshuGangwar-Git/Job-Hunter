import type { AppContext } from '../context';
import { query } from '../db/pool';
import { createCvService, type StoredCv } from '../cv/service';
import { canonicalSkill } from '../cv/skills';
import { createProfileService } from '../profile/service';
import { jobsForScoring } from '../jobs/repository';
import { scoreJob } from './scorer';

export const HIGH_MATCH_THRESHOLD = 80;
const EXPLAIN_THRESHOLD = 70;

export interface NewHighMatch {
  jobId: string;
  title: string;
  company: string;
  score: number;
}

/** Picks the CV that covers the most of the job's matched skills. Ties go to the primary CV, then the newest. */
export function pickBestCv(matchedSkills: string[], cvs: StoredCv[]): string | null {
  if (cvs.length === 0) return null;
  const wanted = new Set(matchedSkills.map((s) => s.toLowerCase()));
  const ranked = cvs
    .map((cv) => ({
      cv,
      coverage: cv.parsed.skills.map((s) => canonicalSkill(s).toLowerCase()).filter((s) => wanted.has(s)).length,
    }))
    .sort((a, b) => b.coverage - a.coverage || Number(b.cv.isPrimary) - Number(a.cv.isPrimary));
  return ranked[0].cv.id;
}

/**
 * Scores every known job against the user's profile and preferences and stores the result.
 * When notifyAtOrAbove is given, jobs crossing that threshold for the first time create a notification.
 */
export async function rescoreForUser(
  ctx: AppContext,
  userId: string,
  options: { notifyAtOrAbove?: number } = {},
): Promise<{ scored: number; newHighMatches: NewHighMatch[] }> {
  const profiles = createProfileService(ctx.db);
  const cvService = createCvService(ctx.db, ctx.storage, ctx.logger);
  const [profile, preferences, cvs, jobs] = await Promise.all([
    profiles.getProfile(userId),
    profiles.getPreferences(userId),
    cvService.all(userId),
    jobsForScoring(ctx.db),
  ]);

  const existing = await query<{ job_id: string; ai_summary: string | null }>(
    ctx.db,
    'SELECT job_id, ai_summary FROM job_matches WHERE user_id = $1',
    [userId],
  );
  const existingSummary = new Map(existing.map((row) => [row.job_id, row.ai_summary]));

  let scored = 0;
  for (const job of jobs) {
    const result = scoreJob(
      { profile, preferences },
      {
        title: job.title,
        company: job.company,
        location: job.location,
        workMode: job.work_mode,
        salaryMin: job.salary_min,
        salaryMax: job.salary_max,
        salaryCurrency: job.salary_currency,
        description: job.description,
      },
    );

    let aiSummary = existingSummary.get(job.id) ?? null;
    if (!aiSummary && ctx.ai.enabled && result.score >= EXPLAIN_THRESHOLD) {
      aiSummary = await ctx.ai.explainMatch({
        jobTitle: job.title,
        company: job.company,
        jobDescription: job.description,
        score: result.score,
        matchedSkills: result.matchedSkills,
        missingSkills: result.missingSkills,
      });
    }

    await query(
      ctx.db,
      `INSERT INTO job_matches (user_id, job_id, score, breakdown, matched_skills, missing_skills, reasons, cv_id, ai_summary, scored_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
       ON CONFLICT (user_id, job_id) DO UPDATE SET score = EXCLUDED.score, breakdown = EXCLUDED.breakdown,
         matched_skills = EXCLUDED.matched_skills, missing_skills = EXCLUDED.missing_skills, reasons = EXCLUDED.reasons,
         cv_id = EXCLUDED.cv_id, ai_summary = EXCLUDED.ai_summary, scored_at = now()`,
      [
        userId,
        job.id,
        result.score,
        JSON.stringify(result.breakdown),
        result.matchedSkills,
        result.missingSkills,
        result.reasons,
        pickBestCv(result.matchedSkills, cvs),
        aiSummary,
      ],
    );
    scored += 1;
  }

  const threshold = options.notifyAtOrAbove;
  if (threshold === undefined) return { scored, newHighMatches: [] };

  const fresh = await query<NewHighMatch>(
    ctx.db,
    `UPDATE job_matches jm SET notified_at = now()
     FROM jobs j
     WHERE jm.job_id = j.id AND jm.user_id = $1 AND jm.score >= $2 AND jm.notified_at IS NULL
     RETURNING j.id AS "jobId", j.title, j.company, jm.score`,
    [userId, threshold],
  );
  for (const match of fresh) {
    await query(
      ctx.db,
      `INSERT INTO notifications (user_id, title, body, job_id) VALUES ($1, $2, $3, $4)`,
      [
        userId,
        `New ${match.score}% match: ${match.title}`,
        `${match.company} posted a role that scores ${match.score} against your profile.`,
        match.jobId,
      ],
    );
  }
  return { scored, newHighMatches: fresh };
}
