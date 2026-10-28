import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startScheduler } from '../../src/searches/scheduler';
import { SAMPLE_CV_TEXT } from '../fixtures/sample-cv';
import { createHarness, makeCvPdf, multipartFile, noAuth, type Harness } from './harness';
import { LOCAL_USER_ID } from '../../src/auth/local-user';

describe('Job Hunter API end-to-end', () => {
  let h: Harness;
  let cvId: string;
  let shortlistedAppId: string;
  let shortlistedJobId: string;

  beforeAll(async () => {
    h = await createHarness();
  });

  afterAll(async () => {
    await h.close();
  });

  describe('local user', () => {
    it('reports healthy when the database is reachable', async () => {
      const res = await h.app.inject({ method: 'GET', url: '/api/health' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ status: 'ok' });
    });

    it('returns the local user without any sign-in', async () => {
      const me = await h.app.inject({ method: 'GET', url: '/api/auth/me' });
      expect(me.statusCode).toBe(200);
      expect(me.json().id).toBe(LOCAL_USER_ID);
    });
  });

  describe('CV upload and profile', () => {
    it('uploads a PDF, extracts the profile and marks the first CV as primary', async () => {
      const pdf = await makeCvPdf(SAMPLE_CV_TEXT);
      const { payload, headers } = multipartFile('file', 'Priya_CV.pdf', 'application/pdf', pdf);
      const res = await h.app.inject({ method: 'POST', url: '/api/cvs', payload, headers });
      expect(res.statusCode, res.body).toBe(201);
      const cv = res.json();
      cvId = cv.id;
      expect(cv).toMatchObject({ fileName: 'Priya_CV.pdf', isPrimary: true });
      expect(cv.skillCount).toBeGreaterThan(5);
    });

    it('builds the profile from the primary CV', async () => {
      const res = await h.app.inject({ method: 'GET', url: '/api/profile', headers: noAuth() });
      const profile = res.json();
      expect(profile.fullName).toBe('Priya Raman');
      expect(profile.skills).toEqual(expect.arrayContaining(['React', 'TypeScript']));
      expect(profile.experience[0].company).toBe('Orbit Analytics');
      expect(profile.education[0].institution).toBe('Anna University');
    });

    it('rejects a file whose content does not match its extension', async () => {
      const { payload, headers } = multipartFile('file', 'fake.pdf', 'application/pdf', Buffer.from('<html>not a pdf at all</html>'));
      const res = await h.app.inject({ method: 'POST', url: '/api/cvs', payload, headers });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/content matches its extension/);
    });

    it('stores a second CV as secondary and keeps the profile edits the user made', async () => {
      await h.app.inject({
        method: 'PATCH',
        url: '/api/profile',
        headers: noAuth(),
        payload: { headline: 'Senior Frontend Engineer' },
      });
      const pdf = await makeCvPdf('Priya Raman\nBackend notes\nSkills\nPython, Docker, Kubernetes\nExperience\nEngineer at Other Co\n2016 - 2018\n• Built pipelines.');
      const { payload, headers } = multipartFile('file', 'Priya_Backend.pdf', 'application/pdf', pdf);
      const res = await h.app.inject({ method: 'POST', url: '/api/cvs', payload, headers });
      expect(res.json().isPrimary).toBe(false);
      const profile = (await h.app.inject({ method: 'GET', url: '/api/profile', headers: noAuth() })).json();
      expect(profile.headline).toBe('Senior Frontend Engineer');
      expect(profile.skills).toEqual(expect.arrayContaining(['React', 'Python']));
    });

    it('lists CVs for the owner only', async () => {
      const res = await h.app.inject({ method: 'GET', url: '/api/cvs', headers: noAuth() });
      expect(res.json()).toHaveLength(2);
    });
  });

  describe('preferences', () => {
    it('saves valid preferences', async () => {
      const res = await h.app.inject({
        method: 'PUT',
        url: '/api/preferences',
        headers: noAuth(),
        payload: {
          targetRoles: ['Frontend Engineer'],
          locations: ['Bengaluru', 'Remote India'],
          minSalary: 2000000,
          maxSalary: 3500000,
          currency: 'INR',
          experienceLevel: 'mid',
          industries: ['Fintech'],
          workModes: ['hybrid', 'remote'],
          preferredCompanies: ['Northwind Payments'],
        },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().targetRoles).toEqual(['Frontend Engineer']);
    });

    it('rejects a minimum salary above the maximum', async () => {
      const res = await h.app.inject({
        method: 'PUT',
        url: '/api/preferences',
        headers: noAuth(),
        payload: {
          targetRoles: [],
          locations: [],
          minSalary: 5000000,
          maxSalary: 1000000,
          currency: 'INR',
          experienceLevel: 'mid',
          industries: [],
          workModes: [],
          preferredCompanies: [],
        },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/minSalary/);
    });
  });

  describe('job discovery and matching', () => {
    it('lists configured sources and marks unconfigured ones clearly', async () => {
      const res = await h.app.inject({ method: 'GET', url: '/api/jobs/sources', headers: noAuth() });
      const sources = res.json() as { id: string; configured: boolean }[];
      expect(sources.find((s) => s.id === 'mock')?.configured).toBe(true);
      expect(sources.find((s) => s.id === 'naukri')?.configured).toBe(false);
    });

    it('runs discovery, stores relevant jobs and scores them', async () => {
      const res = await h.app.inject({ method: 'POST', url: '/api/jobs/discover', headers: noAuth(), payload: {} });
      expect(res.statusCode).toBe(200);
      const run = res.json();
      const mock = run.sources.find((s: { source: string }) => s.source === 'mock');
      expect(mock.status, mock.message).toBe('ok');
      expect(mock.inserted).toBeGreaterThan(0);
      const skipped = run.sources.find((s: { source: string }) => s.source === 'naukri');
      expect(skipped.status).toBe('skipped');
      expect(run.newMatches).toBeGreaterThanOrEqual(0);
    });

    it('does not duplicate jobs when discovery runs again', async () => {
      const before = (await h.db.query('SELECT count(*) FROM jobs')).rows[0].count;
      const res = await h.app.inject({ method: 'POST', url: '/api/jobs/discover', headers: noAuth(), payload: {} });
      const mock = res.json().sources.find((s: { source: string }) => s.source === 'mock');
      expect(mock.inserted).toBe(0);
      const after = (await h.db.query('SELECT count(*) FROM jobs')).rows[0].count;
      expect(after).toBe(before);
    });

    it('returns jobs sorted by score with filters applied', async () => {
      const res = await h.app.inject({ method: 'GET', url: '/api/jobs?sort=score&pageSize=50', headers: noAuth() });
      const { items, total } = res.json();
      expect(total).toBeGreaterThan(0);
      const scores = items.map((j: { match: { score: number } | null }) => j.match?.score ?? -1);
      expect([...scores].sort((a, b) => b - a)).toEqual(scores);

      const filtered = await h.app.inject({ method: 'GET', url: '/api/jobs?minScore=60&pageSize=50', headers: noAuth() });
      for (const job of filtered.json().items) {
        expect(job.match.score).toBeGreaterThanOrEqual(60);
      }

      const searched = await h.app.inject({ method: 'GET', url: '/api/jobs?q=%25&pageSize=50', headers: noAuth() });
      expect(searched.json().total).toBe(0);
    });

    it('explains a job score with matched and missing skills and the chosen CV', async () => {
      const list = (await h.app.inject({ method: 'GET', url: '/api/jobs?sort=score&pageSize=50', headers: noAuth() })).json();
      const top = list.items.find((j: { match: unknown }) => j.match !== null);
      shortlistedJobId = top.id;
      const detail = (await h.app.inject({ method: 'GET', url: `/api/jobs/${top.id}`, headers: noAuth() })).json();
      expect(detail.match.breakdown).toBeDefined();
      expect(detail.match.reasons.length).toBeGreaterThan(0);
      expect(Array.isArray(detail.match.missingSkills)).toBe(true);
      expect(detail.match.cvId).toBe(cvId);
    });

    it('returns 404 for an unknown job id', async () => {
      const res = await h.app.inject({
        method: 'GET',
        url: '/api/jobs/00000000-0000-4000-8000-000000000000',
        headers: noAuth(),
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('application tracker', () => {
    it('shortlists a job and is idempotent', async () => {
      const first = await h.app.inject({ method: 'POST', url: `/api/applications/${shortlistedJobId}/shortlist`, headers: noAuth() });
      expect(first.statusCode).toBe(201);
      expect(first.json().status).toBe('Shortlisted');
      shortlistedAppId = first.json().id;
      const second = await h.app.inject({ method: 'POST', url: `/api/applications/${shortlistedJobId}/shortlist`, headers: noAuth() });
      expect(second.json().id).toBe(shortlistedAppId);
    });

    it('generates a tailored CV, cover letter and recruiter message without inventing skills', async () => {
      const res = await h.app.inject({ method: 'POST', url: `/api/applications/${shortlistedAppId}/customize`, headers: noAuth() });
      expect(res.statusCode).toBe(200);
      const app = res.json();
      expect(app.status).toBe('CV Customized');
      expect(app.tailoredCv.cvId).toBe(cvId);
      expect(app.tailoredCv.skills).toEqual(expect.arrayContaining(['React']));
      expect(app.coverLetter).toContain('Priya Raman');
      expect(app.recruiterMessage).toBeTruthy();
      for (const gap of app.tailoredCv.gaps) {
        expect(app.tailoredCv.skills).not.toContain(gap);
      }
      expect(app.events.map((e: { type: string }) => e.type)).toContain('cv_customized');
    });

    it('serves the tailored CV as a PDF and as a DOCX', async () => {
      const pdf = await h.app.inject({ method: 'GET', url: `/api/applications/${shortlistedAppId}/cv.pdf`, headers: noAuth() });
      expect(pdf.statusCode).toBe(200);
      expect(pdf.headers['content-type']).toBe('application/pdf');
      expect(pdf.rawPayload.subarray(0, 4).toString()).toBe('%PDF');

      const docx = await h.app.inject({ method: 'GET', url: `/api/applications/${shortlistedAppId}/cv.docx`, headers: noAuth() });
      expect(docx.statusCode).toBe(200);
      expect(docx.rawPayload.subarray(0, 2).toString()).toBe('PK');
    });

    it('refuses to record an application without explicit approval', async () => {
      const res = await h.app.inject({
        method: 'POST',
        url: `/api/applications/${shortlistedAppId}/mark-applied`,
        headers: noAuth(),
        payload: {},
      });
      expect(res.statusCode).toBe(400);
      const still = await h.app.inject({ method: 'GET', url: `/api/applications/${shortlistedAppId}`, headers: noAuth() });
      expect(still.json().status).toBe('CV Customized');
    });

    it('will not set Applied through a plain status update', async () => {
      const res = await h.app.inject({
        method: 'PATCH',
        url: `/api/applications/${shortlistedAppId}`,
        headers: noAuth(),
        payload: { status: 'Applied' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('records an application after approval, with a follow-up date', async () => {
      const res = await h.app.inject({
        method: 'POST',
        url: `/api/applications/${shortlistedAppId}/mark-applied`,
        headers: noAuth(),
        payload: { approved: true },
      });
      expect(res.statusCode).toBe(200);
      const app = res.json();
      expect(app.status).toBe('Applied');
      expect(app.appliedAt).not.toBeNull();
      expect(app.followUpAt).not.toBeNull();
    });

    it('updates status, notes and follow-up date with an activity trail', async () => {
      const inter = await h.app.inject({
        method: 'PATCH',
        url: `/api/applications/${shortlistedAppId}`,
        headers: noAuth(),
        payload: { status: 'Interview', notes: 'Panel on Thursday', followUpAt: '2026-11-05T09:00:00.000Z' },
      });
      const app = inter.json();
      expect(app.status).toBe('Interview');
      expect(app.notes).toBe('Panel on Thursday');
      expect(app.followUpAt).toBe('2026-11-05T09:00:00.000Z');
      const types = app.events.map((e: { type: string }) => e.type);
      expect(types).toEqual(expect.arrayContaining(['applied', 'status_changed', 'cv_customized']));
    });

    it('rejects unknown fields on update', async () => {
      const res = await h.app.inject({
        method: 'PATCH',
        url: `/api/applications/${shortlistedAppId}`,
        headers: noAuth(),
        payload: { appliedAt: '2020-01-01' },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('analytics', () => {
    it('summarises the pipeline and conversion for the owner', async () => {
      const res = await h.app.inject({ method: 'GET', url: '/api/analytics', headers: noAuth() });
      const stats = res.json();
      expect(stats.totals.jobs).toBeGreaterThan(0);
      expect(stats.totals.applications).toBe(1);
      expect(stats.totals.interviews).toBe(1);
      expect(stats.byStatus.Interview).toBe(1);
      expect(stats.conversion.appliedToInterview).toBe(100);
      expect(stats.activity).toHaveLength(14);
    });

  });

  describe('scheduled searches and notifications', () => {
    it('creates, pauses and deletes a saved search', async () => {
      const created = await h.app.inject({
        method: 'POST',
        url: '/api/searches',
        headers: noAuth(),
        payload: { name: 'Frontend in Bengaluru', keywords: ['React'], locations: ['Bengaluru'], sources: [], minScore: 70, frequency: 'daily', enabled: true },
      });
      expect(created.statusCode).toBe(201);
      const id = created.json().id;
      expect(created.json().nextRunAt).not.toBeNull();

      const paused = await h.app.inject({ method: 'PATCH', url: `/api/searches/${id}`, headers: noAuth(), payload: { enabled: false } });
      expect(paused.json().enabled).toBe(false);

      const removed = await h.app.inject({ method: 'DELETE', url: `/api/searches/${id}`, headers: noAuth() });
      expect(removed.statusCode).toBe(204);
    });

    it('runs due searches and follow-up reminders through the scheduler', async () => {
      await h.app.inject({
        method: 'POST',
        url: '/api/searches',
        headers: noAuth(),
        payload: { name: 'Due now', keywords: ['React'], locations: [], sources: ['mock'], minScore: 50, frequency: 'hourly', enabled: true },
      });
      await h.db.query("UPDATE applications SET follow_up_at = now() - interval '1 day' WHERE id = $1", [shortlistedAppId]);

      const scheduler = startScheduler(h.ctx, 3_600_000);
      try {
        const result = await scheduler.tick();
        expect(result.searchesRun).toBe(1);
        expect(result.followUpsNotified).toBe(1);
      } finally {
        scheduler.stop();
      }

      const notes = (await h.app.inject({ method: 'GET', url: '/api/notifications', headers: noAuth() })).json();
      expect(notes.some((n: { title: string }) => n.title.startsWith('Follow up:'))).toBe(true);
      const unread = notes.find((n: { readAt: string | null }) => n.readAt === null);
      if (unread) {
        const read = await h.app.inject({ method: 'POST', url: `/api/notifications/${unread.id}/read`, headers: noAuth() });
        expect(read.statusCode).toBe(204);
      }
    });

    it('does not run a search twice in a row', async () => {
      const scheduler = startScheduler(h.ctx, 3_600_000);
      try {
        const result = await scheduler.tick();
        expect(result.searchesRun).toBe(0);
      } finally {
        scheduler.stop();
      }
    });
  });

  describe('CV deletion', () => {
    it('promotes another CV to primary when the primary is deleted', async () => {
      const list = (await h.app.inject({ method: 'GET', url: '/api/cvs', headers: noAuth() })).json();
      const primary = list.find((cv: { isPrimary: boolean }) => cv.isPrimary);
      const removed = await h.app.inject({ method: 'DELETE', url: `/api/cvs/${primary.id}`, headers: noAuth() });
      expect(removed.statusCode).toBe(204);
      const after = (await h.app.inject({ method: 'GET', url: '/api/cvs', headers: noAuth() })).json();
      expect(after).toHaveLength(1);
      expect(after[0].isPrimary).toBe(true);
    });
  });
});
