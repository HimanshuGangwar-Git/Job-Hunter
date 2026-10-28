import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { customizeApplication, downloadTailoredCv, getJob, listApplications, markApplied, shortlistJob } from '../api';
import { ErrorBanner, Modal, Panel, ScoreBadge, Spinner, StatusBadge } from '../components/ui';
import { formatDate, formatSalary, relativeDate } from '../lib/format';
import type { Application, Job, ScoreBreakdown } from '../types';

const BREAKDOWN_LABELS: { key: keyof ScoreBreakdown; label: string; max: number }[] = [
  { key: 'skills', label: 'Skills', max: 40 },
  { key: 'experience', label: 'Experience', max: 20 },
  { key: 'role', label: 'Role', max: 15 },
  { key: 'education', label: 'Education', max: 10 },
  { key: 'preferences', label: 'Preferences', max: 10 },
  { key: 'industry', label: 'Industry', max: 5 },
];

export function JobDetail() {
  const { id = '' } = useParams();
  const [job, setJob] = useState<Job | null>(null);
  const [application, setApplication] = useState<Application | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);

  useEffect(() => {
    let active = true;
    getJob(id)
      .then(async (j) => {
        if (!active) return;
        setJob(j);
        if (j.status) {
          // The job is already tracked: load its application so that customise and approve work.
          const apps = await listApplications();
          if (active) setApplication(apps.find((a) => a.jobId === j.id) ?? null);
        }
      })
      .catch((err: unknown) => active && setError(err));
    return () => {
      active = false;
    };
  }, [id]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  const onShortlist = () =>
    run(async () => {
      const app = await shortlistJob(id);
      setApplication(app);
      setJob((j) => (j ? { ...j, status: app.status } : j));
      setNotice('Shortlisted. You can now generate a tailored CV.');
    });

  const onCustomize = () =>
    run(async () => {
      if (!application) throw new Error('Shortlist this job before customising the CV.');
      const app = await customizeApplication(application.id);
      setApplication(app);
      setJob((j) => (j ? { ...j, status: app.status } : j));
      setNotice('Tailored CV, cover letter and recruiter message are ready for review.');
    });

  const onMarkApplied = () =>
    run(async () => {
      if (!application) throw new Error('Shortlist this job first.');
      const app = await markApplied(application.id);
      setApplication(app);
      setJob((j) => (j ? { ...j, status: app.status } : j));
      setConfirmOpen(false);
      setAcknowledged(false);
      setNotice('Recorded as Applied. Follow-up reminders can be set in the tracker.');
    });

  if (error && !job) return <ErrorBanner error={error} />;
  if (!job) return <Spinner label="Loading job" />;

  const match = job.match;
  const status = application?.status ?? job.status;
  const isShortlisted = status !== null;
  const canCustomize = isShortlisted && status !== 'Applied' && status !== 'Interview' && status !== 'Offer' && status !== 'Rejected';
  // Mirrors the server rule: recording "Applied" needs an explicit confirmation from a shortlisted job.
  const canApprove = canCustomize;

  return (
    <>
      <div className="page-header">
        <div>
          <Link to="/jobs" className="small">
            ← Back to jobs
          </Link>
          <h1 style={{ marginTop: 6 }}>{job.title}</h1>
          <p>
            {job.company} · {job.location}
            {job.workMode ? ` · ${job.workMode}` : ''} · {formatSalary(job.salaryMin, job.salaryMax, job.salaryCurrency)}
          </p>
        </div>
        <div className="row">
          <StatusBadge status={status} />
          <a className="btn" href={job.url} target="_blank" rel="noreferrer">
            Open posting ↗
          </a>
        </div>
      </div>

      <ErrorBanner error={error} />
      {notice && <div className="banner banner-success">{notice}</div>}

      <div className="detail-grid">
        <div className="stack">
          <Panel title="Job description">
            <p className="description">{job.description}</p>
            <p className="muted small" style={{ marginTop: 14 }}>
              Source: {job.sources.join(', ')} · Posted {formatDate(job.postedAt)} ({relativeDate(job.postedAt)})
            </p>
          </Panel>

          <Panel title="Why this score">
            {match ? (
              <div className="stack">
                <div className="row">
                  <ScoreBadge score={match.score} />
                  <p className="muted">
                    Calculated from your primary CV and preferences. Scores are explanations, not guarantees.
                  </p>
                </div>
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {match.reasons.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
                {match.aiSummary && (
                  <div className="banner banner-success">
                    <strong>AI summary:</strong> {match.aiSummary}
                  </div>
                )}
              </div>
            ) : (
              <p className="muted">No match score yet. Run a discovery to score this job.</p>
            )}
          </Panel>

          <div className="grid grid-2">
            <Panel title="Matched skills">
              <div className="row">
                {match?.matchedSkills.length ? (
                  match.matchedSkills.map((s) => (
                    <span key={s} className="tag tag-matched">
                      ✓ {s}
                    </span>
                  ))
                ) : (
                  <span className="muted small">No matched skills yet.</span>
                )}
              </div>
            </Panel>
            <Panel title="Missing skills">
              <div className="row">
                {match?.missingSkills.length ? (
                  match.missingSkills.map((s) => (
                    <span key={s} className="tag tag-missing">
                      {s}
                    </span>
                  ))
                ) : (
                  <span className="muted small">Nothing missing from the posting.</span>
                )}
              </div>
              {match?.missingSkills.length ? (
                <p className="muted small" style={{ marginTop: 10 }}>
                  Missing skills are never added to your CV automatically. Only add them if you genuinely have them.
                </p>
              ) : null}
            </Panel>
          </div>

          {application && (application.coverLetter || application.tailoredCv) && (
            <Panel title="Tailored application">
              <div className="stack">
                {application.tailoredCv && (
                  <div>
                    <h3 style={{ fontSize: '0.95rem' }}>
                      Tailored CV from <span className="mono">{application.tailoredCv.cvFileName}</span>
                    </h3>
                    <p className="muted small" style={{ marginTop: 4 }}>
                      {application.tailoredCv.summary}
                    </p>
                    <div className="row" style={{ marginTop: 10 }}>
                      {application.tailoredCv.skills.slice(0, 14).map((s) => (
                        <span key={s} className="tag">
                          {s}
                        </span>
                      ))}
                    </div>
                    {application.tailoredCv.gaps.length > 0 && (
                      <p className="muted small" style={{ marginTop: 10 }}>
                        Not on your CV, so not added: {application.tailoredCv.gaps.join(', ')}. Add them only if they are true.
                      </p>
                    )}
                    <div className="row" style={{ marginTop: 12 }}>
                      <button
                        className="btn btn-sm"
                        onClick={() => run(() => downloadTailoredCv(application.tailoredCv!.pdfUrl, `${job.company}-cv.pdf`))}
                      >
                        Download PDF
                      </button>
                      <button
                        className="btn btn-sm"
                        onClick={() => run(() => downloadTailoredCv(application.tailoredCv!.docxUrl, `${job.company}-cv.docx`))}
                      >
                        Download DOCX
                      </button>
                    </div>
                  </div>
                )}
                {application.coverLetter && (
                  <div>
                    <h3 style={{ fontSize: '0.95rem' }}>Cover letter</h3>
                    <div className="pre" style={{ marginTop: 6 }}>
                      {application.coverLetter}
                    </div>
                  </div>
                )}
                {application.recruiterMessage && (
                  <div>
                    <h3 style={{ fontSize: '0.95rem' }}>Recruiter message</h3>
                    <div className="pre" style={{ marginTop: 6 }}>
                      {application.recruiterMessage}
                    </div>
                  </div>
                )}
              </div>
            </Panel>
          )}
        </div>

        <aside className="stack">
          <Panel title="Score breakdown">
            <div className="breakdown">
              {BREAKDOWN_LABELS.map(({ key, label, max }) => {
                const value = match?.breakdown[key] ?? 0;
                return (
                  <div key={key} className="breakdown-row">
                    <span>{label}</span>
                    <div className="bar" aria-hidden="true">
                      <span style={{ width: `${Math.min(100, (value / max) * 100)}%` }} />
                    </div>
                    <span className="mono small">
                      {value}/{max}
                    </span>
                  </div>
                );
              })}
            </div>
          </Panel>

          <Panel title="Actions">
            <div className="stack">
              {!isShortlisted && (
                <button className="btn btn-primary" onClick={onShortlist} disabled={busy}>
                  Shortlist this job
                </button>
              )}
              {canCustomize && (
                <button className="btn btn-primary" onClick={onCustomize} disabled={busy}>
                  {application?.tailoredCv ? 'Regenerate tailored CV' : 'Generate tailored CV & cover letter'}
                </button>
              )}
              {canApprove && (
                <button className="btn" onClick={() => setConfirmOpen(true)} disabled={busy}>
                  I applied on the employer&apos;s site…
                </button>
              )}
              <p className="muted small">
                The app never submits applications for you. Apply on the employer&apos;s site, then confirm here.
              </p>
            </div>
          </Panel>
        </aside>
      </div>

      <Modal open={confirmOpen} title="Confirm application" onClose={() => setConfirmOpen(false)}>
        <p>
          Only confirm if you have already submitted this application yourself on the employer&apos;s site. This records the
          application as <strong>Applied</strong> in your tracker and starts follow-up tracking.
        </p>
        <label className="checks">
          <input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} />
          <span>I have submitted this application myself.</span>
        </label>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn" onClick={() => setConfirmOpen(false)}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={!acknowledged || busy} onClick={onMarkApplied}>
            Record as applied
          </button>
        </div>
      </Modal>
    </>
  );
}
