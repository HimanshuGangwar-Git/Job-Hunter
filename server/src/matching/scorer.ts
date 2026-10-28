import type { MatchResult, Preferences, Profile, ScoreBreakdown } from '../domain/types';
import { canonicalSkill, findSkills } from '../cv/skills';

/**
 * Deterministic 0-100 suitability score. Weights (sum to 100):
 *   skills 40 · experience 20 · role 15 · education 10 · preferences 10 · industry 5
 * The same inputs always produce the same score, so results can be explained and tested.
 */
export const WEIGHTS: ScoreBreakdown = {
  skills: 40,
  experience: 20,
  role: 15,
  education: 10,
  preferences: 10,
  industry: 5,
};

export interface JobForScoring {
  title: string;
  company: string;
  location: string;
  workMode: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  description: string;
}

const STOPWORDS = new Set(['and', 'the', 'of', 'with', 'for', 'in', 'at', 'a', 'an', 'to', 'or']);
const MAX_SKILLS_CONSIDERED = 25;

const tokens = (text: string): string[] =>
  text
    .toLowerCase()
    .split(/[^a-z0-9+#.]+/)
    .map((t) => t.replace(/\.$/, ''))
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));

const round = (value: number) => Math.round(value);
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Largest "N years" requirement stated in the posting, e.g. "3+ years" or "3-5 years". */
export function requiredYears(text: string): number | null {
  // "3+ years" -> 3, "3-5 years" -> 5 (the upper bound is what a candidate should meet).
  const matches = [...text.matchAll(/(\d{1,2})(?:\s*(?:-|–|to)\s*(\d{1,2}))?\s*\+?\s*years?/gi)];
  const values = matches.map((m) => Number(m[2] ?? m[1])).filter((n) => n > 0 && n <= 30);
  return values.length ? Math.max(...values) : null;
}

export function scoreJob(input: { profile: Profile; preferences: Preferences }, job: JobForScoring): MatchResult {
  const { profile, preferences } = input;
  const haystack = `${job.title}\n${job.description}`;
  const reasons: string[] = [];

  // Skills ------------------------------------------------------------------
  const profileSkills = new Map<string, string>(profile.skills.map((s) => [canonicalSkill(s).toLowerCase(), canonicalSkill(s)]));
  const jobSkills = findSkills(haystack).slice(0, MAX_SKILLS_CONSIDERED);
  const matchedSkills = jobSkills.filter((s) => profileSkills.has(s.toLowerCase()));
  const missingSkills = jobSkills.filter((s) => !profileSkills.has(s.toLowerCase()));

  let skills: number;
  if (jobSkills.length === 0) {
    skills = WEIGHTS.skills / 2;
    reasons.push('The posting does not name specific skills, so skill fit is scored neutrally.');
  } else {
    skills = (WEIGHTS.skills * matchedSkills.length) / jobSkills.length;
    reasons.push(`${matchedSkills.length} of ${jobSkills.length} skills named in the posting are on your profile.`);
  }

  // Experience ----------------------------------------------------------------
  const required = requiredYears(haystack);
  let experience: number;
  if (required === null) {
    experience = WEIGHTS.experience * 0.7;
    reasons.push('No years of experience are stated in the posting.');
  } else if (profile.totalYearsExperience >= required) {
    experience = WEIGHTS.experience;
    reasons.push(`Requires about ${required} years; you have about ${profile.totalYearsExperience}.`);
  } else {
    experience = (WEIGHTS.experience * profile.totalYearsExperience) / required;
    reasons.push(`Requires about ${required} years; you have about ${profile.totalYearsExperience}.`);
  }

  // Role ----------------------------------------------------------------------
  const targets = preferences.targetRoles.length > 0 ? preferences.targetRoles : profile.headline ? [profile.headline] : [];
  const titleTokens = new Set(tokens(job.title));
  let bestRoleRatio = 0;
  let bestTarget = '';
  for (const target of targets) {
    const targetTokens = tokens(target);
    if (targetTokens.length === 0) continue;
    const ratio = targetTokens.filter((t) => titleTokens.has(t)).length / targetTokens.length;
    if (ratio > bestRoleRatio) {
      bestRoleRatio = ratio;
      bestTarget = target;
    }
  }
  let role: number;
  if (targets.length === 0) {
    role = WEIGHTS.role * 0.5;
  } else {
    role = WEIGHTS.role * bestRoleRatio;
    if (bestRoleRatio >= 1) reasons.push(`Title matches your target role "${bestTarget}".`);
    else if (bestRoleRatio > 0) reasons.push(`Title partly matches your target role "${bestTarget}".`);
    else reasons.push('Title does not match your target roles.');
  }

  // Education -----------------------------------------------------------------
  const degreeRequired = /\b(bachelor'?s?|master'?s?|b\.?\s?tech|b\.?\s?e\b|mba|degree|phd)\b/i.test(haystack);
  const hasEducation = profile.education.length > 0;
  let education: number;
  if (degreeRequired) {
    education = hasEducation ? WEIGHTS.education : WEIGHTS.education * 0.4;
    reasons.push(hasEducation ? 'Your education meets the stated degree requirement.' : 'A degree is requested and none is listed on your CV.');
  } else {
    education = hasEducation ? WEIGHTS.education : WEIGHTS.education * 0.7;
  }

  // Industry ------------------------------------------------------------------
  let industry: number;
  if (preferences.industries.length === 0) {
    industry = WEIGHTS.industry * 0.6;
  } else {
    const hit = preferences.industries.some((ind) => haystack.toLowerCase().includes(ind.toLowerCase()));
    industry = hit ? WEIGHTS.industry : 0;
    reasons.push(hit ? 'Industry matches your preferences.' : 'Industry is not one of your preferred industries.');
  }

  // Preferences (location, work mode, salary, companies) -----------------------
  let preferencesScore = 0;
  const locationText = `${job.location} ${job.description}`.toLowerCase();
  if (preferences.locations.length === 0) {
    preferencesScore += 4;
  } else {
    const remoteOk = job.workMode === 'remote' && preferences.locations.some((l) => /remote/i.test(l));
    const inLocation = preferences.locations.some((l) => locationText.includes(l.toLowerCase()));
    if (remoteOk || inLocation) {
      preferencesScore += 4;
      reasons.push('Location fits your preferences.');
    } else {
      reasons.push('Location is outside your preferred locations.');
    }
  }

  if (preferences.workModes.length === 0) {
    preferencesScore += 3;
  } else if (!job.workMode) {
    preferencesScore += 1;
  } else if (preferences.workModes.includes(job.workMode as Preferences['workModes'][number])) {
    preferencesScore += 3;
    reasons.push(`Work mode (${job.workMode}) matches your preference.`);
  } else {
    reasons.push(`Work mode (${job.workMode}) is not one of your preferences.`);
  }

  if (preferences.minSalary === null && preferences.maxSalary === null) {
    preferencesScore += 2;
  } else if (job.salaryMin === null && job.salaryMax === null) {
    preferencesScore += 1;
  } else {
    const jobMax = job.salaryMax ?? job.salaryMin ?? 0;
    const jobMin = job.salaryMin ?? job.salaryMax ?? 0;
    const overlaps = jobMax >= (preferences.minSalary ?? 0) && jobMin <= (preferences.maxSalary ?? Number.MAX_SAFE_INTEGER);
    const sameCurrency = !job.salaryCurrency || job.salaryCurrency === preferences.currency;
    if (overlaps && sameCurrency) {
      preferencesScore += 2;
      reasons.push('Salary range overlaps your expectations.');
    } else if (overlaps) {
      preferencesScore += 1;
    } else {
      reasons.push('Salary is below or above your expectations.');
    }
  }

  const company = job.company.toLowerCase();
  if (preferences.preferredCompanies.some((c) => c.toLowerCase() === company)) {
    preferencesScore += 1;
    reasons.push(`${job.company} is one of your preferred companies.`);
  }

  const breakdown: ScoreBreakdown = {
    skills: round(clamp(skills, 0, WEIGHTS.skills)),
    experience: round(clamp(experience, 0, WEIGHTS.experience)),
    role: round(clamp(role, 0, WEIGHTS.role)),
    education: round(clamp(education, 0, WEIGHTS.education)),
    preferences: round(clamp(preferencesScore, 0, WEIGHTS.preferences)),
    industry: round(clamp(industry, 0, WEIGHTS.industry)),
  };
  const score = clamp(
    Object.values(breakdown).reduce((sum, value) => sum + value, 0),
    0,
    100,
  );

  return {
    score,
    breakdown,
    matchedSkills,
    missingSkills,
    reasons,
    cvId: null,
    aiSummary: null,
  };
}
