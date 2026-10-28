import { z } from 'zod';
import type { Db } from '../db/pool';
import { query, queryOne } from '../db/pool';
import {
  EMPTY_PREFERENCES,
  EXPERIENCE_LEVELS,
  WORK_MODES,
  emptyProfile,
  type Preferences,
  type Profile,
} from '../domain/types';

const trimmedList = (max: number) => z.array(z.string().trim().min(1).max(120)).max(max);

export const profileSchema = z.object({
  fullName: z.string().trim().max(120),
  headline: z.string().trim().max(160),
  email: z.string().trim().email().max(254).nullable(),
  phone: z.string().trim().max(40).nullable(),
  location: z.string().trim().max(120).nullable(),
  summary: z.string().trim().max(2000),
  skills: trimmedList(150),
  experience: z
    .array(
      z.object({
        company: z.string().trim().max(160),
        title: z.string().trim().max(160),
        start: z.string().trim().max(20),
        end: z.string().trim().max(20).nullable(),
        bullets: z.array(z.string().trim().max(600)).max(40),
      }),
    )
    .max(40),
  education: z
    .array(
      z.object({
        institution: z.string().trim().max(160),
        degree: z.string().trim().max(120),
        field: z.string().trim().max(120),
        year: z.string().trim().max(10).nullable(),
      }),
    )
    .max(20),
  certifications: trimmedList(30),
  languages: trimmedList(15),
  totalYearsExperience: z.number().min(0).max(60),
});

export const profilePatchSchema = profileSchema.partial();

export const preferencesSchema = z.object({
  targetRoles: trimmedList(20),
  locations: trimmedList(30),
  minSalary: z.number().int().min(0).nullable(),
  maxSalary: z.number().int().min(0).nullable(),
  currency: z.string().trim().length(3).toUpperCase(),
  experienceLevel: z.enum(EXPERIENCE_LEVELS),
  industries: trimmedList(20),
  workModes: z.array(z.enum(WORK_MODES)).max(3),
  preferredCompanies: trimmedList(50),
});

export interface ProfileService {
  getProfile(userId: string): Promise<Profile>;
  updateProfile(userId: string, patch: Partial<Profile>): Promise<Profile>;
  getPreferences(userId: string): Promise<Preferences>;
  updatePreferences(userId: string, prefs: Preferences): Promise<Preferences>;
}

interface PreferencesRow {
  target_roles: string[];
  locations: string[];
  min_salary: number | null;
  max_salary: number | null;
  currency: string;
  experience_level: Preferences['experienceLevel'];
  industries: string[];
  work_modes: Preferences['workModes'];
  preferred_companies: string[];
}

async function loadProfile(db: Db, userId: string): Promise<Profile> {
  const row = await queryOne<{ data: Profile }>(db, 'SELECT data FROM profiles WHERE user_id = $1', [userId]);
  if (row) return row.data;
  const user = await queryOne<{ name: string; email: string }>(db, 'SELECT name, email FROM users WHERE id = $1', [userId]);
  return { ...emptyProfile(user?.name ?? ''), email: user?.email ?? null };
}

export function createProfileService(db: Db): ProfileService {
  return {
    getProfile: (userId) => loadProfile(db, userId),

    async updateProfile(userId, patch) {
      const current = await loadProfile(db, userId);
      const merged = profileSchema.parse({ ...current, ...patch });
      await db.query(
        `INSERT INTO profiles (user_id, data, updated_at) VALUES ($1, $2, now())
         ON CONFLICT (user_id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
        [userId, JSON.stringify(merged)],
      );
      return merged;
    },

    async getPreferences(userId) {
      const row = await queryOne<PreferencesRow>(
        db,
        `SELECT target_roles, locations, min_salary, max_salary, currency, experience_level, industries, work_modes, preferred_companies
         FROM preferences WHERE user_id = $1`,
        [userId],
      );
      if (!row) return { ...EMPTY_PREFERENCES };
      return {
        targetRoles: row.target_roles,
        locations: row.locations,
        minSalary: row.min_salary,
        maxSalary: row.max_salary,
        currency: row.currency,
        experienceLevel: row.experience_level,
        industries: row.industries,
        workModes: row.work_modes,
        preferredCompanies: row.preferred_companies,
      };
    },

    async updatePreferences(userId, prefs) {
      const parsed = preferencesSchema.parse(prefs);
      if (parsed.minSalary !== null && parsed.maxSalary !== null && parsed.minSalary > parsed.maxSalary) {
        throw new z.ZodError([
          { code: 'custom', path: ['minSalary'], message: 'Minimum salary cannot exceed maximum salary' },
        ]);
      }
      await query(
        db,
        `INSERT INTO preferences (user_id, target_roles, locations, min_salary, max_salary, currency, experience_level, industries, work_modes, preferred_companies, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())
         ON CONFLICT (user_id) DO UPDATE SET target_roles = EXCLUDED.target_roles, locations = EXCLUDED.locations,
           min_salary = EXCLUDED.min_salary, max_salary = EXCLUDED.max_salary, currency = EXCLUDED.currency,
           experience_level = EXCLUDED.experience_level, industries = EXCLUDED.industries, work_modes = EXCLUDED.work_modes,
           preferred_companies = EXCLUDED.preferred_companies, updated_at = now()`,
        [
          userId,
          parsed.targetRoles,
          parsed.locations,
          parsed.minSalary,
          parsed.maxSalary,
          parsed.currency,
          parsed.experienceLevel,
          parsed.industries,
          parsed.workModes,
          parsed.preferredCompanies,
        ],
      );
      return parsed;
    },
  };
}
