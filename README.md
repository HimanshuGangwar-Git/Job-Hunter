# Job Hunter

An AI-assisted job search platform. It discovers jobs from permitted sources, scores each one against your profile, tailors a CV for shortlisted roles, and tracks every application through to offer.

You stay in control: the app never submits an application for you. You apply on the employer's site, then confirm it here.

## What it does

- **CVs and profile.** Upload several PDF or DOCX CVs. Your profile (contact details, skills, experience, education, certifications, languages) is extracted automatically and you can edit it.
- **Preferences.** Target roles, locations, salary range and currency, experience level, industries, work mode (remote, hybrid, on-site) and preferred companies.
- **Job discovery.** Public APIs and feeds, plus licensed partner feeds. Jobs are stored once, with duplicates across sources merged by a fingerprint of company, title and location.
- **Match score (0–100).** Each job is scored with a deterministic rule set. The result shows matched skills, missing skills, a per-category breakdown and the reasons. An optional AI summary is added for strong matches when an API key is set.
- **Tailored applications.** For a shortlisted job, the app picks the CV that best covers the job's skills and produces an ATS-oriented CV (PDF and DOCX), a cover letter and a recruiter message. It never adds a skill, employer, role, bullet or figure that is not in the source CV. Skills the job asks for but your CV lacks are listed as gaps for you to address.
- **Application tracker.** Statuses: New, Shortlisted, CV Customized, Ready to Apply, Applied, Interview, Offer, Rejected. Notes, follow-up dates and an activity trail for each application.
- **Approval gate.** Marking an application as *Applied* requires you to tick a confirmation that you submitted it yourself. A plain status update cannot set *Applied*.
- **Dashboard.** Discovered jobs, high matches, applications, interviews, offers, conversion rates, 14-day activity, pipeline breakdown and per-source performance.
- **Search and filters.** Score, role, company, location, salary, source and status, with sorting and pagination.
- **Scheduled searches.** Recurring searches (hourly, daily or weekly) that notify you of new jobs at or above your threshold. Follow-up reminders are raised when a date passes.

## Architecture

```
Job-Hunter/
├── server/                 Fastify + TypeScript API, PostgreSQL
│   ├── migrations/         SQL migrations (applied in order, recorded in schema_migrations)
│   ├── fixtures/           Offline sample jobs (fictional companies)
│   ├── src/
│   │   ├── auth/           Password hashing (scrypt), JWT sessions
│   │   ├── cv/             Text extraction (PDF/DOCX), profile extraction, skills taxonomy, CV storage
│   │   ├── profile/        Profile and preferences
│   │   ├── jobs/
│   │   │   ├── connectors/ One file per source + registry.ts (the place to register new sources)
│   │   │   ├── normalize.ts  Salary and work-mode parsing, fingerprint, HTML to text
│   │   │   ├── repository.ts Upsert with cross-source merge, filtered list queries
│   │   │   └── discovery.ts  Runs all connectors, isolates failures, re-scores
│   │   ├── matching/       scorer.ts (pure, deterministic) and service.ts (persist scores, notify)
│   │   ├── applications/   tailor.ts (pure, anti-fabrication), documents.ts (PDF/DOCX), service.ts
│   │   ├── searches/       Saved searches, scheduler (SKIP LOCKED claims), follow-up reminders
│   │   ├── analytics/      Dashboard numbers
│   │   ├── ai/provider.ts  Optional Anthropic provider; every call falls back to deterministic output
│   │   └── app.ts          Fastify app, error handling, routes under /api
│   └── tests/              Unit tests plus integration tests against a real PostgreSQL
└── web/                    React + TypeScript + Vite dashboard
    └── src/
        ├── api.ts          Typed API client (switches to in-browser mock data when VITE_MOCK_DATA=true)
        ├── mocks/          Realistic mock data and an in-memory mock API
        └── pages/          Dashboard, Jobs, Job detail, Applications, CVs, Profile, Preferences, Scheduled searches
```

### Scoring model

The score is calculated by `server/src/matching/scorer.ts`. The weights sum to 100:

| Component   | Weight | What it measures                                                    |
|-------------|--------|---------------------------------------------------------------------|
| Skills      | 40     | Share of the skills named in the posting that appear on your profile |
| Experience  | 20     | Stated years required vs. your estimated years                      |
| Role        | 15     | Overlap between the job title and your target roles                 |
| Education   | 10     | Degree requirement vs. your education                               |
| Preferences | 10     | Location, work mode, salary overlap, preferred companies            |
| Industry    | 5      | Your preferred industries mentioned in the posting                  |

The same input always gives the same score, which makes it explainable and testable. The AI layer explains a score; it does not set it.

### Anti-fabrication

`server/src/applications/tailor.ts` builds every tailored output from the selected CV only. `checkNoFabrication` then verifies that every skill, role, bullet and figure in the output exists in that CV. AI drafts go through the same check, and any draft that fails is discarded in favour of the deterministic version.

## Job sources and compliance

The app only uses sources that are public APIs, feeds you are entitled to read, or licensed partner endpoints. It does not scrape pages, log in on your behalf, or bypass CAPTCHA or anti-bot protection.

| Source                          | How it is connected                                                  | Needs                                             |
|---------------------------------|----------------------------------------------------------------------|---------------------------------------------------|
| Greenhouse career boards        | Public Job Board API                                                 | `GREENHOUSE_BOARDS` (board tokens, e.g. `stripe`) |
| Lever career sites              | Public Postings API                                                  | `LEVER_COMPANIES` (company slugs)                 |
| RSS / Atom feeds                | Any feed you are allowed to read                                     | `RSS_FEEDS` (comma-separated URLs)                |
| LinkedIn, Indeed, Naukri, Internshala, Apna, Job Hai | Licensed or partner feed (see below)            | `<PORTAL>_FEED_URL` and optionally `LICENSED_FEED_API_KEY` |
| Sample jobs (offline)           | Local fixture file                                                   | `ENABLE_MOCK_SOURCE=true`                         |

**About the six portals.** LinkedIn, Indeed, Naukri, Internshala, Apna and Job Hai do not offer a general public job-search API. Their terms generally prohibit scraping. These connectors stay *not configured* until you have partner or licensed access. Once you have it, point the matching `*_FEED_URL` at a feed that returns this shape:

```json
{
  "jobs": [
    {
      "id": "abc-123",
      "title": "Frontend Engineer",
      "company": "Example Co",
      "location": "Bengaluru, India",
      "url": "https://partner.example.com/jobs/abc-123",
      "description": "Plain text or HTML job description",
      "postedAt": "2026-10-20T09:00:00Z",
      "salaryMin": 2400000,
      "salaryMax": 3300000,
      "salaryCurrency": "INR",
      "workMode": "hybrid"
    }
  ]
}
```

Only `id`, `title`, `company` and `url` are required. The `LICENSED_FEED_API_KEY`, if set, is sent as a bearer token.

**Adding a new source.** Implement `JobConnector` in `server/src/jobs/connectors/types.ts`, add it to `createDefaultRegistry` in `registry.ts`, and add configuration to `config.ts`. Use `settleAll` if the source has several endpoints, so one failure does not hide the others. Existing connectors show how to map fields with `normalizeJob`.

## Getting started

Requirements: Node.js 20 or newer. No Docker or system PostgreSQL is needed. The local database runs as an embedded PostgreSQL process.

```bash
# 1. Install all workspace dependencies (from the repository root)
npm install

# 2. Configure the server
cp server/.env.example server/.env
#    Edit server/.env and set JWT_SECRET to a random string of 32+ characters.
#    ENABLE_MOCK_SOURCE=true gives you sample jobs immediately.

# 3. Start the local database (keep this terminal open)
npm run db:dev

# 4. In a second terminal: apply migrations, then start the API and the web app
npm run migrate
npm run dev            # API on http://localhost:4000, web on http://localhost:5173
```

Open http://localhost:5173, create an account, then:

1. Upload a CV on **CVs**.
2. Review the extracted data on **Profile** and set **Preferences**.
3. Run **Run discovery** on **Jobs**.
4. Open a job, shortlist it, generate the tailored application, download the CV, and record the application only after you have submitted it yourself.

### UI only, with mock data

To work on the interface without a backend:

```bash
cd web
VITE_MOCK_DATA=true npm run dev
```

A banner shows that mock mode is active. Mutations are kept in memory for the session.

### Scripts

| Command                 | What it does                                                 |
|-------------------------|--------------------------------------------------------------|
| `npm run db:dev`        | Local PostgreSQL on port 54329 (data kept in `server/.embedded-postgres-data`) |
| `npm run migrate`       | Apply pending migrations                                     |
| `npm run dev`           | API and web app with hot reload                              |
| `npm run build`         | Production build of the API (`server/dist`) and web app (`web/dist`) |
| `npm run lint`          | ESLint for both packages                                     |
| `npm run typecheck`    | TypeScript checks for both packages                          |
| `npm run test`          | Server tests (unit and integration) and web tests            |

The integration tests start their own throwaway PostgreSQL cluster. Set `TEST_DATABASE_URL` to use an existing database instead.

## Configuration

All configuration is read from environment variables, validated at start-up. See `server/.env.example` for the full list.

| Variable                | Required | Purpose                                                              |
|-------------------------|----------|----------------------------------------------------------------------|
| `DATABASE_URL`          | Yes      | PostgreSQL connection string                                         |
| `JWT_SECRET`            | Yes      | Signing key for sessions (32+ characters; must be changed in production) |
| `ANTHROPIC_API_KEY`     | No       | Enables AI match summaries and drafting. Without it, deterministic output is used |
| `ANTHROPIC_MODEL`       | No       | Defaults to `claude-sonnet-5-5`                                      |
| `GREENHOUSE_BOARDS`, `LEVER_COMPANIES`, `RSS_FEEDS` | No | Public sources to read                       |
| `*_FEED_URL`, `LICENSED_FEED_API_KEY` | No | Licensed or partner feeds                                 |
| `ENABLE_MOCK_SOURCE`    | No       | Offline sample jobs for development                                  |
| `SCHEDULER_ENABLED`, `SCHEDULER_INTERVAL_MS` | No | Scheduled searches and reminders                       |
| `STORAGE_DIR`           | No       | Where uploaded CVs and generated documents are stored (default `./storage`) |

### Credentials you need to provide

Nothing outside the app is required to run it in development. For real data:

- **Anthropic API key**, optional, for AI explanations and drafting.
- **Greenhouse and Lever**: no credentials. Add the company board tokens or slugs you want to watch.
- **LinkedIn, Indeed, Naukri, Internshala, Apna, Job Hai**: partner or licensed feed URLs and, where applicable, an API key. Each provider issues these on its own terms.

## Security notes

- Passwords are hashed with scrypt and a random salt. Login attempts are rate-limited per email.
- Sessions are HS256 JWTs with issuer, audience and expiry checks. The token is kept in `localStorage` in the browser; use HTTPS and a short expiry in production.
- Uploads are limited to 5 MB and PDF or DOCX. The file's content must match its extension.
- Stored files get generated names, and path traversal outside the storage root is rejected.
- Every query is scoped to the signed-in user. Another user's applications, CVs and documents return 404.
- Logs redact authorization headers and passwords.
- The AI prompt receives only the selected CV's facts. Its output is validated before use.

## Limitations

- Scheduled searches run inside the API process. For several instances, run the scheduler in one of them, or split it out.
- Notifications appear in the app. Email or push delivery is not implemented.
- Rate limiting is in memory, which suits one instance.
- Profile extraction is rule-based. Scanned image PDFs are not supported, and the Profile page is where you correct anything it misses.
- Re-uploading a CV as the primary one replaces the stored profile with what was extracted from it. Secondary uploads only add skills.
- Matching is designed around English-language postings.
