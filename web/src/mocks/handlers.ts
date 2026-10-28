import {
  APPLICATION_STATUSES,
  type Analytics,
  type Application,
  type ApplicationStatus,
  type CvDocument,
  type Job,
  type JobPage,
  type Preferences,
  type Profile,
  type SavedSearch,
} from '../types';
import {
  mockApplications,
  mockCvs,
  mockJobs,
  mockNotifications,
  mockPreferences,
  mockProfile,
  mockSearches,
  mockSources,
  mockUser,
} from './data';

// In-memory state so that mutations are visible while developing the UI.
// This module is only loaded through api.ts and is used when VITE_MOCK_DATA=true.
const state = {
  profile: structuredClone(mockProfile),
  cvs: structuredClone(mockCvs),
  preferences: structuredClone(mockPreferences),
  jobs: structuredClone(mockJobs),
  applications: structuredClone(mockApplications),
  searches: structuredClone(mockSearches),
  notifications: structuredClone(mockNotifications),
};

const delay = (ms = 150) => new Promise((resolve) => setTimeout(resolve, ms));

function notFound(): never {
  throw Object.assign(new Error('Not found'), { status: 404 });
}

function statusOf(jobId: string): ApplicationStatus | null {
  return state.applications.find((a) => a.jobId === jobId)?.status ?? null;
}

function withStatus(job: Job): Job {
  return { ...job, status: statusOf(job.id) };
}

function filterJobs(params: URLSearchParams): JobPage {
  const q = params.get('q')?.toLowerCase() ?? '';
  const minScore = Number(params.get('minScore') ?? 0);
  const role = params.get('role')?.toLowerCase() ?? '';
  const company = params.get('company')?.toLowerCase() ?? '';
  const location = params.get('location')?.toLowerCase() ?? '';
  const minSalary = Number(params.get('minSalary') ?? 0);
  const source = params.get('source') ?? '';
  const status = params.get('status') ?? '';
  const sort = params.get('sort') ?? 'score';
  const page = Number(params.get('page') ?? 1);
  const pageSize = Number(params.get('pageSize') ?? 20);

  let items = state.jobs.map(withStatus).filter((job) => {
    if (q && !`${job.title} ${job.company} ${job.description}`.toLowerCase().includes(q)) return false;
    if ((job.match?.score ?? 0) < minScore) return false;
    if (role && !job.title.toLowerCase().includes(role)) return false;
    if (company && !job.company.toLowerCase().includes(company)) return false;
    if (location && !job.location.toLowerCase().includes(location)) return false;
    if (minSalary && (job.salaryMax ?? 0) < minSalary) return false;
    if (source && job.source !== source) return false;
    if (status && job.status !== status) return false;
    return true;
  });

  items = items.sort((a, b) => {
    if (sort === 'posted') return (b.postedAt ?? '').localeCompare(a.postedAt ?? '');
    if (sort === 'salary') return (b.salaryMax ?? 0) - (a.salaryMax ?? 0);
    return (b.match?.score ?? 0) - (a.match?.score ?? 0);
  });

  const start = (page - 1) * pageSize;
  return { items: items.slice(start, start + pageSize), total: items.length, page, pageSize };
}

function analytics(): Analytics {
  const byStatus = Object.fromEntries(APPLICATION_STATUSES.map((s) => [s, 0])) as Record<ApplicationStatus, number>;
  for (const app of state.applications) byStatus[app.status] += 1;

  const applied = state.applications.filter((a) => a.appliedAt !== null).length;
  const interviews = byStatus.Interview + byStatus.Offer;
  const offers = byStatus.Offer;
  const shortlisted = state.applications.length;

  const activity = Array.from({ length: 14 }, (_, i) => {
    const date = new Date(Date.now() - (13 - i) * 86400000);
    const key = date.toISOString().slice(0, 10);
    const count = state.applications.reduce(
      (n, a) => n + a.events.filter((e) => e.createdAt.slice(0, 10) === key).length,
      0,
    );
    return { date: key, count };
  });

  const sources = [...new Set(state.jobs.map((j) => j.source))];
  return {
    totals: {
      jobs: state.jobs.length,
      highMatches: state.jobs.filter((j) => (j.match?.score ?? 0) >= 80).length,
      applications: applied,
      interviews,
      offers,
      rejections: byStatus.Rejected,
    },
    conversion: {
      shortlistToApplied: shortlisted ? Math.round((applied / shortlisted) * 100) : 0,
      appliedToInterview: applied ? Math.round((interviews / applied) * 100) : 0,
      interviewToOffer: interviews ? Math.round((offers / interviews) * 100) : 0,
    },
    byStatus,
    activity,
    bySource: sources.map((source) => {
      const jobs = state.jobs.filter((j) => j.source === source);
      const avg = jobs.reduce((n, j) => n + (j.match?.score ?? 0), 0) / jobs.length;
      return { source, jobs: jobs.length, avgScore: Math.round(avg) };
    }),
  };
}

export async function mockRequest<T>(method: string, fullPath: string, body?: unknown): Promise<T> {
  await delay();
  const url = new URL(fullPath, 'http://mock.local');
  const path = url.pathname;
  const params = url.searchParams;
  const payload = (body ?? {}) as Record<string, unknown>;
  const segments = path.split('/').filter(Boolean);

  try {
    if (path === '/auth/login' || path === '/auth/register') return { token: 'mock-token', user: mockUser } as T;
    if (path === '/auth/me') return mockUser as T;

    if (path === '/profile' && method === 'GET') return structuredClone(state.profile) as T;
    if (path === '/profile' && method === 'PATCH') {
      state.profile = { ...state.profile, ...(payload as Partial<Profile>) };
      return structuredClone(state.profile) as T;
    }

    if (path === '/cvs' && method === 'GET') return structuredClone(state.cvs) as T;
    if (path === '/cvs' && method === 'POST') {
      const cv: CvDocument = {
        id: `cv-${Date.now()}`,
        fileName: String(payload.fileName ?? 'uploaded.pdf'),
        uploadedAt: new Date().toISOString(),
        isPrimary: state.cvs.length === 0,
        skillCount: 0,
        wordCount: 0,
      };
      state.cvs.push(cv);
      return cv as T;
    }
    if (segments[0] === 'cvs' && segments[2] === 'primary') {
      state.cvs = state.cvs.map((cv) => ({ ...cv, isPrimary: cv.id === segments[1] }));
      return state.cvs.find((cv) => cv.id === segments[1]) as T;
    }
    if (segments[0] === 'cvs' && method === 'DELETE') {
      state.cvs = state.cvs.filter((cv) => cv.id !== segments[1]);
      return undefined as T;
    }

    if (path === '/preferences' && method === 'GET') return structuredClone(state.preferences) as T;
    if (path === '/preferences' && method === 'PUT') {
      state.preferences = payload as unknown as Preferences;
      return structuredClone(state.preferences) as T;
    }

    if (path === '/jobs' && method === 'GET') return filterJobs(params) as T;
    if (path === '/jobs/sources') return structuredClone(mockSources) as T;
    if (path === '/jobs/discover') {
      return {
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        sources: mockSources
          .filter((s) => s.configured)
          .map((s) => ({ source: s.id, status: 'ok', fetched: 12, inserted: 2, message: null })),
        newMatches: 2,
      } as T;
    }
    if (segments[0] === 'jobs' && segments.length === 2 && method === 'GET') {
      const job = state.jobs.find((j) => j.id === segments[1]);
      return (job ? withStatus(job) : notFound()) as T;
    }

    if (path === '/applications' && method === 'GET') {
      const status = params.get('status');
      const list = status ? state.applications.filter((a) => a.status === status) : state.applications;
      return structuredClone(list) as T;
    }
    if (segments[0] === 'applications' && segments.length === 3 && segments[2] === 'shortlist') {
      return shortlistJob(segments[1]) as T;
    }
    if (segments[0] === 'applications' && segments.length === 2) {
      const app = state.applications.find((a) => a.id === segments[1]);
      if (!app) notFound();
      if (method === 'GET') return structuredClone(app) as T;
      if (method === 'PATCH') {
        applyPatch(app, payload);
        return structuredClone(app) as T;
      }
    }
    if (segments[0] === 'applications' && segments[2] === 'customize') {
      const app = state.applications.find((a) => a.id === segments[1]) ?? notFound();
      app.status = 'CV Customized';
      app.coverLetter = `Dear ${app.company} Hiring Team,\n\nI am applying for the ${app.jobTitle} role. ...`;
      app.recruiterMessage = `Hi, I'm interested in the ${app.jobTitle} role at ${app.company}. Happy to share more.`;
      app.tailoredCv = {
        cvId: state.cvs.find((cv) => cv.isPrimary)?.id ?? 'cv-1',
        cvFileName: state.cvs.find((cv) => cv.isPrimary)?.fileName ?? 'CV.pdf',
        summary: state.profile.summary,
        skills: state.profile.skills,
        experience: state.profile.experience.map((e) => ({ title: e.title, company: e.company, bullets: e.bullets })),
        pdfUrl: '#',
        docxUrl: '#',
        atsKeywords: state.profile.skills.slice(0, 3),
        gaps: [],
      };
      return structuredClone(app) as T;
    }
    if (segments[0] === 'applications' && segments[2] === 'mark-applied') {
      const app = state.applications.find((a) => a.id === segments[1]) ?? notFound();
      if (payload.approved !== true) throw Object.assign(new Error('Explicit approval is required'), { status: 400 });
      app.status = 'Applied';
      app.appliedAt = new Date().toISOString();
      return structuredClone(app) as T;
    }

    if (path === '/analytics') return analytics() as T;

    if (path === '/searches' && method === 'GET') return structuredClone(state.searches) as T;
    if (path === '/searches' && method === 'POST') {
      const search: SavedSearch = { ...(payload as unknown as SavedSearch), id: `search-${Date.now()}`, lastRunAt: null, nextRunAt: null };
      state.searches.push(search);
      return search as T;
    }
    if (segments[0] === 'searches' && method === 'PATCH') {
      const search = state.searches.find((s) => s.id === segments[1]) ?? notFound();
      Object.assign(search, payload);
      return search as T;
    }
    if (segments[0] === 'searches' && method === 'DELETE') {
      state.searches = state.searches.filter((s) => s.id !== segments[1]);
      return undefined as T;
    }

    if (path === '/notifications') return structuredClone(state.notifications) as T;
    if (segments[0] === 'notifications' && segments[2] === 'read') {
      const n = state.notifications.find((x) => x.id === segments[1]);
      if (n) n.readAt = new Date().toISOString();
      return undefined as T;
    }

    notFound();
  } catch (error) {
    const status = (error as { status?: number }).status ?? 500;
    const message = error instanceof Error ? error.message : 'Unexpected error';
    throw Object.assign(new Error(message), { status });
  }
}

function shortlistJob(jobId: string): Application {
  const existing = state.applications.find((a) => a.jobId === jobId);
  if (existing) return structuredClone(existing);
  const job = state.jobs.find((j) => j.id === jobId) ?? notFound();
  const app: Application = {
    id: `app-${Date.now()}`,
    jobId: job.id,
    jobTitle: job.title,
    company: job.company,
    location: job.location,
    source: job.source,
    jobUrl: job.url,
    status: 'Shortlisted',
    score: job.match?.score ?? null,
    notes: '',
    coverLetter: null,
    recruiterMessage: null,
    tailoredCv: null,
    appliedAt: null,
    followUpAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    events: [],
  };
  state.applications.push(app);
  return structuredClone(app);
}

function applyPatch(app: Application, payload: Record<string, unknown>): void {
  if (typeof payload.status === 'string' && payload.status !== app.status) {
    app.events.unshift({
      id: `e-${Date.now()}`,
      type: 'status_changed',
      description: `Status changed to ${payload.status}`,
      createdAt: new Date().toISOString(),
    });
    app.status = payload.status as ApplicationStatus;
  }
  if (typeof payload.notes === 'string') app.notes = payload.notes;
  if (payload.followUpAt !== undefined) app.followUpAt = payload.followUpAt as string | null;
  app.updatedAt = new Date().toISOString();
}
