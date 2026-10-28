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

export interface User {
  id: string;
  email: string;
  name: string;
}

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

export interface CvDocument {
  id: string;
  fileName: string;
  uploadedAt: string;
  isPrimary: boolean;
  skillCount: number;
  wordCount: number;
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

export interface Job {
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

export interface JobFilters {
  q?: string;
  minScore?: number;
  role?: string;
  company?: string;
  location?: string;
  minSalary?: number;
  source?: string;
  status?: ApplicationStatus | '';
  sort?: 'score' | 'posted' | 'salary';
  page?: number;
  pageSize?: number;
}

export interface JobPage {
  items: Job[];
  total: number;
  page: number;
  pageSize: number;
}

export interface TailoredCv {
  cvId: string;
  cvFileName: string;
  summary: string;
  skills: string[];
  experience: { title: string; company: string; bullets: string[] }[];
  pdfUrl: string;
  docxUrl: string;
  atsKeywords: string[];
  gaps: string[];
}

export interface Application {
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
  tailoredCv: TailoredCv | null;
  appliedAt: string | null;
  followUpAt: string | null;
  createdAt: string;
  updatedAt: string;
  events: ApplicationEvent[];
}

export interface ApplicationEvent {
  id: string;
  type: 'status_changed' | 'note' | 'follow_up' | 'applied' | 'cv_customized';
  description: string;
  createdAt: string;
}

export interface SavedSearch {
  id: string;
  name: string;
  keywords: string[];
  locations: string[];
  sources: string[];
  minScore: number;
  frequency: 'hourly' | 'daily' | 'weekly';
  enabled: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
}

export interface Notification {
  id: string;
  title: string;
  body: string;
  jobId: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface DiscoverySourceResult {
  source: string;
  status: 'ok' | 'skipped' | 'error';
  fetched: number;
  inserted: number;
  message: string | null;
}

export interface DiscoveryRun {
  startedAt: string;
  finishedAt: string;
  sources: DiscoverySourceResult[];
  newMatches: number;
}

export interface SourceInfo {
  id: string;
  name: string;
  kind: 'api' | 'feed' | 'licensed-feed';
  configured: boolean;
  note: string;
}

export interface Analytics {
  totals: {
    jobs: number;
    highMatches: number;
    applications: number;
    interviews: number;
    offers: number;
    rejections: number;
  };
  conversion: {
    shortlistToApplied: number;
    appliedToInterview: number;
    interviewToOffer: number;
  };
  byStatus: Record<ApplicationStatus, number>;
  activity: { date: string; count: number }[];
  bySource: { source: string; jobs: number; avgScore: number }[];
}
