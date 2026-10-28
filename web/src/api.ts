import type {
  Analytics,
  Application,
  ApplicationStatus,
  CvDocument,
  DiscoveryRun,
  Job,
  JobFilters,
  JobPage,
  Notification,
  Preferences,
  Profile,
  SavedSearch,
  SourceInfo,
  User,
} from './types';
import { mockRequest } from './mocks/handlers';

export const USE_MOCKS = import.meta.env.VITE_MOCK_DATA === 'true';

const TOKEN_KEY = 'jh.token';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function getStoredToken(): string | null {
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setStoredToken(token: string | null): void {
  try {
    if (token) window.localStorage.setItem(TOKEN_KEY, token);
    else window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Storage unavailable (private mode): the session simply will not persist.
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  if (USE_MOCKS) return mockRequest<T>(method, path, body);

  const headers: Record<string, string> = {};
  const token = getStoredToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const res = await fetch(`/api${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return parseResponse<T>(res);
}

async function parseResponse<T>(res: Response): Promise<T> {
  if (res.status === 204) return undefined as T;
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const message =
      data && typeof data === 'object' && 'error' in data && typeof data.error === 'string'
        ? data.error
        : `Request failed (${res.status})`;
    throw new ApiError(message, res.status);
  }
  return data as T;
}

function toQuery(params: Record<string, string | number | undefined | null>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `?${qs}` : '';
}

// Auth
export const register = (name: string, email: string, password: string) =>
  request<{ token: string; user: User }>('POST', '/auth/register', { name, email, password });
export const login = (email: string, password: string) =>
  request<{ token: string; user: User }>('POST', '/auth/login', { email, password });
export const fetchMe = () => request<User>('GET', '/auth/me');

// Profile & CVs
export const fetchProfile = () => request<Profile>('GET', '/profile');
export const updateProfile = (patch: Partial<Profile>) => request<Profile>('PATCH', '/profile', patch);
export const listCvs = () => request<CvDocument[]>('GET', '/cvs');

export async function uploadCv(file: File): Promise<CvDocument> {
  if (USE_MOCKS) return mockRequest<CvDocument>('POST', '/cvs', { fileName: file.name });
  const form = new FormData();
  form.append('file', file);
  const headers: Record<string, string> = {};
  const token = getStoredToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch('/api/cvs', { method: 'POST', headers, body: form });
  return parseResponse<CvDocument>(res);
}

export const setPrimaryCv = (id: string) => request<CvDocument>('POST', `/cvs/${id}/primary`);
export const deleteCv = (id: string) => request<void>('DELETE', `/cvs/${id}`);
export const fetchPreferences = () => request<Preferences>('GET', '/preferences');
export const updatePreferences = (prefs: Preferences) => request<Preferences>('PUT', '/preferences', prefs);

// Jobs
export const listJobs = (filters: JobFilters) => request<JobPage>('GET', `/jobs${toQuery({ ...filters })}`);
export const getJob = (id: string) => request<Job>('GET', `/jobs/${id}`);
export const listSources = () => request<SourceInfo[]>('GET', '/jobs/sources');
export const runDiscovery = (keywords?: string[]) =>
  request<DiscoveryRun>('POST', '/jobs/discover', keywords ? { keywords } : {});

// Applications
export const listApplications = (status?: ApplicationStatus) =>
  request<Application[]>('GET', `/applications${toQuery({ status })}`);
export const getApplication = (id: string) => request<Application>('GET', `/applications/${id}`);
export const shortlistJob = (jobId: string) => request<Application>('POST', `/applications/${jobId}/shortlist`);
export const customizeApplication = (id: string) =>
  request<Application>('POST', `/applications/${id}/customize`);
export const updateApplication = (
  id: string,
  patch: { status?: ApplicationStatus; notes?: string; followUpAt?: string | null },
) => request<Application>('PATCH', `/applications/${id}`, patch);
export const markApplied = (id: string) =>
  request<Application>('POST', `/applications/${id}/mark-applied`, { approved: true });
export const fetchAnalytics = () => request<Analytics>('GET', '/analytics');

export async function downloadTailoredCv(url: string, fileName: string): Promise<void> {
  if (USE_MOCKS) return;
  const headers: Record<string, string> = {};
  const token = getStoredToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new ApiError('Download failed', res.status);
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(objectUrl);
}

// Saved searches & notifications
export const listSearches = () => request<SavedSearch[]>('GET', '/searches');
export const createSearch = (search: Omit<SavedSearch, 'id' | 'lastRunAt' | 'nextRunAt'>) =>
  request<SavedSearch>('POST', '/searches', search);
export const updateSearch = (id: string, patch: Partial<SavedSearch>) =>
  request<SavedSearch>('PATCH', `/searches/${id}`, patch);
export const deleteSearch = (id: string) => request<void>('DELETE', `/searches/${id}`);
export const listNotifications = () => request<Notification[]>('GET', '/notifications');
export const markNotificationRead = (id: string) => request<void>('POST', `/notifications/${id}/read`);
