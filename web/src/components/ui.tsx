import type { ReactNode } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { listNotifications, markNotificationRead } from '../api';
import { useAuth } from '../lib/auth';
import { errorMessage, relativeDate, scoreTone, statusTone } from '../lib/format';
import type { ApplicationStatus, Notification } from '../types';

export function ScoreBadge({ score }: { score: number | null | undefined }) {
  const tone = scoreTone(score);
  return (
    <span className={`score score-${tone}`} aria-label={score == null ? 'No match score' : `Match score ${score}`}>
      {score == null ? '—' : score}
    </span>
  );
}

export function StatusBadge({ status }: { status: ApplicationStatus | null | undefined }) {
  if (!status) return <span className="badge badge-neutral">Not tracked</span>;
  return <span className={`badge badge-${statusTone(status)}`}>{status}</span>;
}

export function Panel({ title, action, children, className = '' }: { title?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`panel ${className}`}>
      {(title || action) && (
        <header className="panel-header">
          {title && <h2>{title}</h2>}
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      <p>{body}</p>
      {action}
    </div>
  );
}

export function ErrorBanner({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <div className="banner banner-error" role="alert">
      {errorMessage(error)}
    </div>
  );
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="spinner-wrap" role="status">
      <span className="spinner" aria-hidden="true" />
      <span>{label}…</span>
    </div>
  );
}

export function Modal({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: ReactNode }) {
  if (!open) return null;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <header className="panel-header">
          <h2>{title}</h2>
          <button className="btn btn-ghost" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {hint && <span className="stat-hint">{hint}</span>}
    </div>
  );
}

const NAV = [
  { to: '/dashboard', label: 'Dashboard', icon: '◧' },
  { to: '/jobs', label: 'Jobs', icon: '⌕' },
  { to: '/applications', label: 'Applications', icon: '☷' },
  { to: '/cvs', label: 'CVs', icon: '⎙' },
  { to: '/profile', label: 'Profile', icon: '◉' },
  { to: '/preferences', label: 'Preferences', icon: '⚙' },
  { to: '/searches', label: 'Scheduled searches', icon: '↻' },
];

export function AppLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [notes, setNotes] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    listNotifications()
      .then(setNotes)
      .catch(() => setNotes([]));
  }, []);

  const unread = notes.filter((n) => !n.readAt).length;

  async function openNotification(n: Notification) {
    setOpen(false);
    if (!n.readAt) {
      await markNotificationRead(n.id).catch(() => undefined);
      setNotes((prev) => prev.map((x) => (x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x)));
    }
    if (n.jobId) navigate(`/jobs/${n.jobId}`);
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">JH</span>
          <span>Job Hunter</span>
        </div>
        <nav aria-label="Main">
          {NAV.map((item) => (
            <NavLink key={item.to} to={item.to} className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
              <span className="nav-icon" aria-hidden="true">
                {item.icon}
              </span>
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="avatar" aria-hidden="true">
            {(user?.name ?? 'U').charAt(0)}
          </div>
          <div className="sidebar-user">
            <strong>{user?.name}</strong>
            <span>{user?.email}</span>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={logout}>
            Sign out
          </button>
        </div>
      </aside>

      <div className="main-column">
        <header className="topbar">
          <div className="topbar-spacer" />
          <div className="notif-wrap">
            <button className="btn btn-ghost" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-label="Notifications">
              🔔{unread > 0 && <span className="pill-count">{unread}</span>}
            </button>
            {open && (
              <div className="notif-menu" role="menu">
                {notes.length === 0 && <p className="muted">No notifications yet.</p>}
                {notes.map((n) => (
                  <button key={n.id} className={`notif-item${n.readAt ? '' : ' unread'}`} onClick={() => openNotification(n)}>
                    <strong>{n.title}</strong>
                    <span>{n.body}</span>
                    <small>{relativeDate(n.createdAt)}</small>
                  </button>
                ))}
              </div>
            )}
          </div>
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
