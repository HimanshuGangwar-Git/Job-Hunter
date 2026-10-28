import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { listJobs, listSources, runDiscovery, shortlistJob } from '../api';
import { EmptyState, ErrorBanner, Panel, ScoreBadge, Spinner, StatusBadge } from '../components/ui';
import { formatSalary, relativeDate } from '../lib/format';
import { APPLICATION_STATUSES, type ApplicationStatus, type Job, type JobFilters, type SourceInfo } from '../types';

const PAGE_SIZE = 15;

function filtersFromParams(params: URLSearchParams): JobFilters {
  const num = (key: string) => (params.get(key) ? Number(params.get(key)) : undefined);
  return {
    q: params.get('q') ?? '',
    minScore: num('minScore'),
    role: params.get('role') ?? '',
    company: params.get('company') ?? '',
    location: params.get('location') ?? '',
    minSalary: num('minSalary'),
    source: params.get('source') ?? '',
    status: (params.get('status') as ApplicationStatus | null) ?? '',
    sort: (params.get('sort') as JobFilters['sort']) ?? 'score',
    page: num('page') ?? 1,
    pageSize: PAGE_SIZE,
  };
}

export function Jobs() {
  const [params, setParams] = useSearchParams();
  const filters = filtersFromParams(params);
  const [draft, setDraft] = useState<JobFilters>(filters);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [total, setTotal] = useState(0);
  const [sources, setSources] = useState<SourceInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [discovering, setDiscovering] = useState(false);

  const paramsKey = params.toString();

  const load = useCallback(() => {
    setLoading(true);
    return listJobs(filtersFromParams(new URLSearchParams(paramsKey)))
      .then((page) => {
        setJobs(page.items);
        setTotal(page.total);
        setError(null);
      })
      .catch((err: unknown) => setError(err))
      .finally(() => setLoading(false));
  }, [paramsKey]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    listSources()
      .then(setSources)
      .catch(() => setSources([]));
  }, []);

  useEffect(() => {
    setDraft(filtersFromParams(new URLSearchParams(paramsKey)));
  }, [paramsKey]);

  function applyFilters(event: FormEvent) {
    event.preventDefault();
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries(draft)) {
      if (value !== undefined && value !== '' && value !== null && key !== 'pageSize' && key !== 'page') {
        next.set(key, String(value));
      }
    }
    setParams(next);
  }

  function resetFilters() {
    setParams(new URLSearchParams());
  }

  function goToPage(page: number) {
    const next = new URLSearchParams(params);
    next.set('page', String(page));
    setParams(next);
  }

  async function onDiscover() {
    setDiscovering(true);
    setNotice(null);
    try {
      const run = await runDiscovery();
      const inserted = run.sources.reduce((n, s) => n + s.inserted, 0);
      setNotice(`Discovery finished: ${inserted} new jobs, ${run.newMatches} new high matches.`);
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setDiscovering(false);
    }
  }

  async function onShortlist(jobId: string) {
    try {
      await shortlistJob(jobId);
      setJobs((prev) => prev.map((j) => (j.id === jobId ? { ...j, status: j.status ?? 'Shortlisted' } : j)));
      setNotice('Added to your applications as Shortlisted.');
    } catch (err) {
      setError(err);
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = filters.page ?? 1;

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Jobs</h1>
          <p>
            {total} jobs found · sorted by {filters.sort === 'posted' ? 'posting date' : filters.sort === 'salary' ? 'salary' : 'match score'}
          </p>
        </div>
        <button className="btn btn-primary" onClick={onDiscover} disabled={discovering}>
          {discovering ? 'Discovering…' : 'Run discovery'}
        </button>
      </div>

      {notice && <div className="banner banner-success">{notice}</div>}
      <ErrorBanner error={error} />

      <Panel>
        <form onSubmit={applyFilters} className="stack">
          <div className="filters">
            <label className="field">
              Keyword
              <input value={draft.q ?? ''} onChange={(e) => setDraft({ ...draft, q: e.target.value })} placeholder="React, payments…" />
            </label>
            <label className="field">
              Role
              <input value={draft.role ?? ''} onChange={(e) => setDraft({ ...draft, role: e.target.value })} placeholder="Frontend" />
            </label>
            <label className="field">
              Company
              <input value={draft.company ?? ''} onChange={(e) => setDraft({ ...draft, company: e.target.value })} />
            </label>
            <label className="field">
              Location
              <input value={draft.location ?? ''} onChange={(e) => setDraft({ ...draft, location: e.target.value })} />
            </label>
            <label className="field">
              Min. match score
              <input
                type="number"
                min={0}
                max={100}
                value={draft.minScore ?? ''}
                onChange={(e) => setDraft({ ...draft, minScore: e.target.value ? Number(e.target.value) : undefined })}
              />
            </label>
            <label className="field">
              Min. salary (₹ per year)
              <input
                type="number"
                min={0}
                step={100000}
                value={draft.minSalary ?? ''}
                onChange={(e) => setDraft({ ...draft, minSalary: e.target.value ? Number(e.target.value) : undefined })}
              />
            </label>
            <label className="field">
              Source
              <select value={draft.source ?? ''} onChange={(e) => setDraft({ ...draft, source: e.target.value })}>
                <option value="">All sources</option>
                {sources.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                    {s.configured ? '' : ' (not configured)'}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Status
              <select value={draft.status ?? ''} onChange={(e) => setDraft({ ...draft, status: e.target.value as ApplicationStatus | '' })}>
                <option value="">Any status</option>
                {APPLICATION_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Sort by
              <select value={draft.sort ?? 'score'} onChange={(e) => setDraft({ ...draft, sort: e.target.value as JobFilters['sort'] })}>
                <option value="score">Match score</option>
                <option value="posted">Posting date</option>
                <option value="salary">Salary</option>
              </select>
            </label>
          </div>
          <div className="row">
            <button className="btn btn-primary" type="submit">
              Apply filters
            </button>
            <button className="btn" type="button" onClick={resetFilters}>
              Reset
            </button>
          </div>
        </form>
      </Panel>

      <Panel>
        {loading ? (
          <Spinner label="Loading jobs" />
        ) : jobs.length === 0 ? (
          <EmptyState
            title="No jobs match these filters"
            body="Loosen the filters or run a discovery to fetch new postings."
          />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Score</th>
                  <th>Role</th>
                  <th>Location</th>
                  <th>Salary</th>
                  <th>Source</th>
                  <th>Posted</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => (
                  <tr key={job.id}>
                    <td>
                      <ScoreBadge score={job.match?.score} />
                    </td>
                    <td>
                      <Link className="job-link" to={`/jobs/${job.id}`}>
                        {job.title}
                      </Link>
                      <div className="muted small">{job.company}</div>
                    </td>
                    <td>
                      {job.location}
                      {job.workMode && <div className="muted small">{job.workMode}</div>}
                    </td>
                    <td>{formatSalary(job.salaryMin, job.salaryMax, job.salaryCurrency)}</td>
                    <td className="small">
                      {job.sources.join(', ')}
                    </td>
                    <td className="small">{relativeDate(job.postedAt)}</td>
                    <td>
                      <StatusBadge status={job.status} />
                    </td>
                    <td>
                      {!job.status && (
                        <button className="btn btn-sm" onClick={() => onShortlist(job.id)}>
                          Shortlist
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {totalPages > 1 && (
          <div className="row" style={{ marginTop: 14, justifyContent: 'flex-end' }}>
            <button className="btn btn-sm" disabled={page <= 1} onClick={() => goToPage(page - 1)}>
              Previous
            </button>
            <span className="small muted">
              Page {page} of {totalPages}
            </span>
            <button className="btn btn-sm" disabled={page >= totalPages} onClick={() => goToPage(page + 1)}>
              Next
            </button>
          </div>
        )}
      </Panel>
    </>
  );
}
