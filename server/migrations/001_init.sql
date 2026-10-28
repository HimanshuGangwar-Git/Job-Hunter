-- Initial schema for Job Hunter.
-- Migrations are applied in filename order and recorded in schema_migrations.


CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL UNIQUE,
  name          text NOT NULL,
  password_hash text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE cv_documents (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  file_name     text NOT NULL,
  mime_type     text NOT NULL,
  storage_path  text NOT NULL,
  text_content  text NOT NULL,
  parsed        jsonb NOT NULL,
  is_primary    boolean NOT NULL DEFAULT false,
  word_count    integer NOT NULL DEFAULT 0,
  uploaded_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX cv_documents_user_idx ON cv_documents(user_id);
-- At most one primary CV per user.
CREATE UNIQUE INDEX cv_documents_one_primary_idx ON cv_documents(user_id) WHERE is_primary;

CREATE TABLE profiles (
  user_id    uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  data       jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE preferences (
  user_id           uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  target_roles      text[] NOT NULL DEFAULT '{}',
  locations         text[] NOT NULL DEFAULT '{}',
  min_salary        integer,
  max_salary        integer,
  currency          text NOT NULL DEFAULT 'INR',
  experience_level  text NOT NULL DEFAULT 'mid',
  industries        text[] NOT NULL DEFAULT '{}',
  work_modes        text[] NOT NULL DEFAULT '{}',
  preferred_companies text[] NOT NULL DEFAULT '{}',
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- Jobs are global. Duplicates across sources collapse onto one row via the fingerprint.
CREATE TABLE jobs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fingerprint    text NOT NULL UNIQUE,
  title          text NOT NULL,
  company        text NOT NULL,
  location       text NOT NULL DEFAULT '',
  work_mode      text CHECK (work_mode IN ('remote', 'hybrid', 'onsite')),
  salary_min     integer,
  salary_max     integer,
  salary_currency text,
  salary_text    text,
  description    text NOT NULL DEFAULT '',
  url            text NOT NULL,
  source         text NOT NULL,
  sources        text[] NOT NULL DEFAULT '{}',
  external_id    text NOT NULL,
  posted_at      timestamptz,
  discovered_at  timestamptz NOT NULL DEFAULT now(),
  last_seen_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX jobs_discovered_idx ON jobs(discovered_at DESC);
CREATE INDEX jobs_source_idx ON jobs(source);

CREATE TABLE job_matches (
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id        uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  score         integer NOT NULL CHECK (score BETWEEN 0 AND 100),
  breakdown     jsonb NOT NULL,
  matched_skills text[] NOT NULL DEFAULT '{}',
  missing_skills text[] NOT NULL DEFAULT '{}',
  reasons       text[] NOT NULL DEFAULT '{}',
  cv_id         uuid REFERENCES cv_documents(id) ON DELETE SET NULL,
  ai_summary    text,
  scored_at     timestamptz NOT NULL DEFAULT now(),
  notified_at   timestamptz,
  PRIMARY KEY (user_id, job_id)
);
CREATE INDEX job_matches_user_score_idx ON job_matches(user_id, score DESC);

CREATE TABLE applications (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id            uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  status            text NOT NULL DEFAULT 'Shortlisted' CHECK (status IN (
    'New', 'Shortlisted', 'CV Customized', 'Ready to Apply', 'Applied', 'Interview', 'Offer', 'Rejected')),
  notes             text NOT NULL DEFAULT '',
  cv_id             uuid REFERENCES cv_documents(id) ON DELETE SET NULL,
  tailored          jsonb,
  cover_letter      text,
  recruiter_message text,
  pdf_path          text,
  docx_path         text,
  applied_at        timestamptz,
  follow_up_at      timestamptz,
  follow_up_notified_at timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, job_id)
);
CREATE INDEX applications_user_status_idx ON applications(user_id, status);

CREATE TABLE application_events (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  type           text NOT NULL,
  description    text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX application_events_app_idx ON application_events(application_id, created_at DESC);

CREATE TABLE saved_searches (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         text NOT NULL,
  keywords     text[] NOT NULL DEFAULT '{}',
  locations    text[] NOT NULL DEFAULT '{}',
  sources      text[] NOT NULL DEFAULT '{}',
  min_score    integer NOT NULL DEFAULT 80 CHECK (min_score BETWEEN 0 AND 100),
  frequency    text NOT NULL CHECK (frequency IN ('hourly', 'daily', 'weekly')),
  enabled      boolean NOT NULL DEFAULT true,
  last_run_at  timestamptz,
  next_run_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX saved_searches_due_idx ON saved_searches(enabled, next_run_at);

CREATE TABLE notifications (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title      text NOT NULL,
  body       text NOT NULL,
  job_id     uuid REFERENCES jobs(id) ON DELETE CASCADE,
  read_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_idx ON notifications(user_id, created_at DESC);
