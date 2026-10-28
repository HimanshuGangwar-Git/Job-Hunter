import { useEffect, useMemo, useState } from 'react';
import { getApplication, listApplications, updateApplication } from '../api';
import { EmptyState, ErrorBanner, Panel, ScoreBadge, Spinner, StatusBadge } from '../components/ui';
import { formatDate, isOverdue, relativeDate, toDateInput } from '../lib/format';
import { APPLICATION_STATUSES, type Application, type ApplicationStatus } from '../types';

// "Applied" is set only through the explicit approval endpoint on the job page, never through this dropdown.
const EDITABLE_STATUSES = APPLICATION_STATUSES.filter((s) => s !== 'Applied');

export function Applications() {
  const [apps, setApps] = useState<Application[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Application | null>(null);
  const [view, setView] = useState<'board' | 'table'>('board');
  const [statusFilter, setStatusFilter] = useState<ApplicationStatus | ''>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [notes, setNotes] = useState('');
  const [followUp, setFollowUp] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    listApplications()
      .then((list) => {
        setApps(list);
        setSelectedId((current) => current ?? list[0]?.id ?? null);
      })
      .catch((err: unknown) => setError(err))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setSelected(null);
      return;
    }
    getApplication(selectedId)
      .then((app) => {
        setSelected(app);
        setNotes(app.notes);
        setFollowUp(toDateInput(app.followUpAt));
      })
      .catch((err: unknown) => setError(err));
  }, [selectedId]);

  const visible = useMemo(
    () => (statusFilter ? apps.filter((a) => a.status === statusFilter) : apps),
    [apps, statusFilter],
  );

  const overdueCount = apps.filter((a) => isOverdue(a.followUpAt) && a.status !== 'Rejected' && a.status !== 'Offer').length;

  async function patch(changes: Parameters<typeof updateApplication>[1]) {
    if (!selected) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await updateApplication(selected.id, changes);
      setSelected(updated);
      setApps((prev) => prev.map((a) => (a.id === updated.id ? { ...a, ...updated } : a)));
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <Spinner label="Loading applications" />;

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Applications</h1>
          <p>
            {apps.length} tracked · {overdueCount > 0 ? `${overdueCount} follow-up${overdueCount === 1 ? '' : 's'} overdue` : 'no overdue follow-ups'}
          </p>
        </div>
        <div className="row">
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as ApplicationStatus | '')} aria-label="Filter by status" style={{ width: 'auto' }}>
            <option value="">All statuses</option>
            {APPLICATION_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <div className="row" role="group" aria-label="View">
            <button className={`btn btn-sm${view === 'board' ? ' btn-primary' : ''}`} onClick={() => setView('board')}>
              Board
            </button>
            <button className={`btn btn-sm${view === 'table' ? ' btn-primary' : ''}`} onClick={() => setView('table')}>
              Table
            </button>
          </div>
        </div>
      </div>

      <ErrorBanner error={error} />

      {apps.length === 0 ? (
        <EmptyState title="No applications yet" body="Shortlist a job from the Jobs page to start your tracker." />
      ) : (
        <div className="detail-grid">
          <div>
            {view === 'board' ? (
              <div className="kanban">
                {APPLICATION_STATUSES.filter((s) => !statusFilter || s === statusFilter).map((status) => {
                  const column = visible.filter((a) => a.status === status);
                  return (
                    <div className="kanban-col" key={status}>
                      <h3>
                        <span>{status}</span>
                        <span className="muted">{column.length}</span>
                      </h3>
                      {column.map((app) => (
                        <button
                          key={app.id}
                          className="kanban-card"
                          onClick={() => setSelectedId(app.id)}
                          aria-pressed={app.id === selectedId}
                          style={app.id === selectedId ? { borderColor: 'var(--primary)' } : undefined}
                        >
                          <strong>{app.jobTitle}</strong>
                          <small>{app.company}</small>
                          <div className="row" style={{ justifyContent: 'space-between' }}>
                            <small>{app.score != null ? `Score ${app.score}` : 'No score'}</small>
                            {isOverdue(app.followUpAt) && app.status !== 'Rejected' && <small className="overdue">Follow up</small>}
                          </div>
                        </button>
                      ))}
                    </div>
                  );
                })}
              </div>
            ) : (
              <Panel>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Role</th>
                        <th>Score</th>
                        <th>Status</th>
                        <th>Applied</th>
                        <th>Follow-up</th>
                        <th>Updated</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visible.map((app) => (
                        <tr key={app.id} onClick={() => setSelectedId(app.id)} style={{ cursor: 'pointer' }}>
                          <td>
                            <strong>{app.jobTitle}</strong>
                            <div className="muted small">{app.company}</div>
                          </td>
                          <td>
                            <ScoreBadge score={app.score} />
                          </td>
                          <td>
                            <StatusBadge status={app.status} />
                          </td>
                          <td className="small">{formatDate(app.appliedAt)}</td>
                          <td className={`small${isOverdue(app.followUpAt) ? ' overdue' : ''}`}>{formatDate(app.followUpAt)}</td>
                          <td className="small">{relativeDate(app.updatedAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Panel>
            )}
          </div>

          <aside>
            {selected ? (
              <Panel>
                <div className="stack">
                  <div>
                    <h2>{selected.jobTitle}</h2>
                    <p className="muted small">
                      {selected.company} · {selected.location} · {selected.source}
                    </p>
                  </div>

                  <label className="field">
                    Status
                    <select
                      value={selected.status}
                      disabled={saving}
                      onChange={(e) => patch({ status: e.target.value as ApplicationStatus })}
                    >
                      {selected.status === 'Applied' && <option value="Applied">Applied</option>}
                      {EDITABLE_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                    <span className="field-hint">To mark a job as Applied, use the confirmation on its job page.</span>
                  </label>

                  <label className="field">
                    Notes
                    <textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
                  </label>

                  <label className="field">
                    Follow-up date
                    <input type="date" value={followUp} onChange={(e) => setFollowUp(e.target.value)} />
                    {isOverdue(selected.followUpAt) && <span className="overdue small">Overdue</span>}
                  </label>

                  <div className="row">
                    <button className="btn btn-primary btn-sm" disabled={saving} onClick={() => patch({ notes })}>
                      Save notes
                    </button>
                    <button
                      className="btn btn-sm"
                      disabled={saving}
                      onClick={() => patch({ followUpAt: followUp ? new Date(followUp).toISOString() : null })}
                    >
                      Save follow-up
                    </button>
                  </div>

                  <div className="small muted">
                    Applied: {formatDate(selected.appliedAt)} · Created: {formatDate(selected.createdAt)}
                  </div>

                  <div>
                    <h3 style={{ fontSize: '0.95rem', marginBottom: 8 }}>Activity</h3>
                    {selected.events.length === 0 ? (
                      <p className="muted small">No activity yet.</p>
                    ) : (
                      <ul className="timeline">
                        {selected.events.map((event) => (
                          <li key={event.id}>
                            <span>{event.description}</span>
                            <small>{relativeDate(event.createdAt)}</small>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              </Panel>
            ) : (
              <Panel>
                <p className="muted">Select an application to see details.</p>
              </Panel>
            )}
          </aside>
        </div>
      )}
    </>
  );
}
