import { useEffect, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Link } from 'react-router-dom';
import { fetchAnalytics, listJobs } from '../api';
import { EmptyState, ErrorBanner, Panel, ScoreBadge, Spinner, Stat, StatusBadge } from '../components/ui';
import { formatSalary } from '../lib/format';
import { APPLICATION_STATUSES, type Analytics, type Job } from '../types';

const CHART_COLORS = ['#818cf8', '#22c55e', '#f59e0b', '#ef4444', '#06b6d4', '#a855f7', '#64748b', '#ec4899'];

export function Dashboard() {
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [highMatches, setHighMatches] = useState<Job[]>([]);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    let active = true;
    Promise.all([fetchAnalytics(), listJobs({ minScore: 80, sort: 'score', pageSize: 5 })])
      .then(([stats, jobs]) => {
        if (!active) return;
        setAnalytics(stats);
        setHighMatches(jobs.items);
      })
      .catch((err: unknown) => active && setError(err));
    return () => {
      active = false;
    };
  }, []);

  if (error) return <ErrorBanner error={error} />;
  if (!analytics) return <Spinner label="Loading dashboard" />;

  const { totals, conversion, byStatus, activity, bySource } = analytics;
  const pipeline = APPLICATION_STATUSES.map((status) => ({ status, count: byStatus[status] })).filter((row) => row.count > 0);

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Dashboard</h1>
          <p>Your job search at a glance.</p>
        </div>
        <Link className="btn btn-primary" to="/jobs">
          Browse jobs
        </Link>
      </div>

      <div className="grid grid-stats">
        <Stat label="Jobs discovered" value={totals.jobs} hint="Deduplicated across sources" />
        <Stat label="High matches (80+)" value={totals.highMatches} hint="Ranked against your profile" />
        <Stat label="Applied" value={totals.applications} />
        <Stat label="Interviews" value={totals.interviews} hint={`${conversion.appliedToInterview}% of applied`} />
        <Stat label="Offers" value={totals.offers} hint={`${conversion.interviewToOffer}% of interviews`} />
        <Stat label="Shortlist → applied" value={`${conversion.shortlistToApplied}%`} />
      </div>

      <div className="grid grid-2">
        <Panel title="Application activity (14 days)">
          <div style={{ height: 240 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={activity}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} tickFormatter={(d: string) => d.slice(5)} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: 'var(--text-muted)' }} />
                <Tooltip />
                <Line type="monotone" dataKey="count" stroke="#818cf8" strokeWidth={2} dot={false} name="Events" isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel title="Pipeline by status">
          {pipeline.length === 0 ? (
            <EmptyState title="No applications yet" body="Shortlist a job to start tracking it." />
          ) : (
            <div style={{ height: 240 }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={pipeline} dataKey="count" nameKey="status" innerRadius={55} outerRadius={85} paddingAngle={2} isAnimationActive={false}>
                    {pipeline.map((row, i) => (
                      <Cell key={row.status} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </Panel>
      </div>

      <div className="grid grid-2">
        <Panel title="Top matches" action={<Link to="/jobs?minScore=80">View all</Link>}>
          {highMatches.length === 0 ? (
            <EmptyState title="No high matches yet" body="Run a discovery from the Jobs page to find roles." />
          ) : (
            <div className="stack">
              {highMatches.map((job) => (
                <Link key={job.id} to={`/jobs/${job.id}`} className="row" style={{ textDecoration: 'none', color: 'inherit' }}>
                  <ScoreBadge score={job.match?.score} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <strong>{job.title}</strong>
                    <div className="muted small">
                      {job.company} · {job.location} · {formatSalary(job.salaryMin, job.salaryMax, job.salaryCurrency)}
                    </div>
                  </div>
                  <StatusBadge status={job.status} />
                </Link>
              ))}
            </div>
          )}
        </Panel>

        <Panel title="Source performance">
          <div style={{ height: 240 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={bySource}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="source" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} />
                <YAxis tick={{ fontSize: 11, fill: 'var(--text-muted)' }} />
                <Tooltip />
                <Bar dataKey="jobs" fill="#818cf8" radius={[6, 6, 0, 0]} name="Jobs" isAnimationActive={false} />
                <Bar dataKey="avgScore" fill="#c4b5fd" radius={[6, 6, 0, 0]} name="Avg score" isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="muted small" style={{ marginTop: 8 }}>
            Average scores are calculated against your current profile and preferences.
          </p>
        </Panel>
      </div>
    </>
  );
}
