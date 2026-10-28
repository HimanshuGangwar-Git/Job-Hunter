// Domain types shared by services and routes. Field names mirror the web client contract in web/src/types.ts.

export const APPLICATION_STATUSES = [
  'New',
  'Shortlisted',
  'CV Customized',
  'Ready to Apply',
  'Applied',
  'Interview',
  'Offer',
  'Rejected',
] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export const WORK_MODES = ['remote', 'hybrid', 'onsite'] as const;
export type WorkMode = (typeof WORK_MODES)[number];

export const EXPERIENCE_LEVELS = ['intern', 'entry', 'mid', 'senior', 'lead', 'executive'] as const;
export type ExperienceLevel = (typeof EXPERIENCE_LEVELS)[number];

export interface ExperienceItem {
  company: string;
  title: string;
  start: string;
  end: string | null;
  bullets: string[];
}

export interface EducationItem {
  institution: string;
  degree: string;
  field: string;
  year: string | null;
}

export interface Profile {
  fullName: string;
  headline: string;
  email: string | null;
  phone: string | null;
  location: string | null;
  summary: string;
  skills: string[];
  experience: ExperienceItem[];
  education: EducationItem[];
  certifications: string[];
  languages: string[];
  totalYearsExperience: number;
}

export interface Preferences {
  targetRoles: string[];
  locations: string[];
  minSalary: number | null;
  maxSalary: number | null;
  currency: string;
  experienceLevel: ExperienceLevel;
  industries: string[];
  workModes: WorkMode[];
  preferredCompanies: string[];
}

export interface ScoreBreakdown {
  skills: number;
  experience: number;
  education: number;
  role: number;
  industry: number;
  preferences: number;
}

export interface MatchResult {
  score: number;
  breakdown: ScoreBreakdown;
  matchedSkills: string[];
  missingSkills: string[];
  reasons: string[];
  cvId: string | null;
  aiSummary: string | null;
}

export const EMPTY_PREFERENCES: Preferences = {
  targetRoles: [],
  locations: [],
  minSalary: null,
  maxSalary: null,
  currency: 'INR',
  experienceLevel: 'mid',
  industries: [],
  workModes: [],
  preferredCompanies: [],
};

export function emptyProfile(fullName = ''): Profile {
  return {
    fullName,
    headline: '',
    email: null,
    phone: null,
    location: null,
    summary: '',
    skills: [],
    experience: [],
    education: [],
    certifications: [],
    languages: [],
    totalYearsExperience: 0,
  };
}
