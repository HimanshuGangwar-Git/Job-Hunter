import { useEffect, useState, type FormEvent } from 'react';
import { createSearch, deleteSearch, listSearches, listSources, updateSearch } from '../api';
import { EmptyState, ErrorBanner, Panel, Spinner } from '../components/ui';
import { relativeDate } from '../lib/format';
import type { SavedSearch, SourceInfo } from '../types';

type Draft = Omit<SavedSearch, 'id' | 'lastRunAt' | 'nextRunAt'>;

const EMPTY_DRAFT: Draft = {
  name: '',
  keywords: [],
  locations: [],
  sources: [],
  minScore: 80,
  frequency: 'daily',
  enabled: true,
};

function splitList(value: string): string[] {
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function Searches() {
  const [searches, setSearches] = useState<SavedSearch[]>([]);
  const [sources, setSources] = useState<SourceInfo[]>([]);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [keywordText, setKeywordText] = useState('');
  const [locationText, setLocationText] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    Promise.all([listSearches(), listSources()])
      .then(([list, src]) => {
        setSearches(list);
        setSources(src);
      })
      .catch((err: unknown) => setError(err))
      .finally(() => setLoading(false));
  }, []);

  async function onCreate(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const created = await createSearch({
        ...draft,
        keywords: splitList(keywordText),
        locations: splitList(locationText),
      });
      setSearches((prev) => [...prev, created]);
      setDraft(EMPTY_DRAFT);
      setKeywordText('');
      setLocationText('');
    } catch (err) {
      setError(err);
    }
  }

  async function toggle(search: SavedSearch) {
    try {
      const updated = await updateSearch(search.id, { enabled: !search.enabled });
      setSearches((prev) => prev.map((s) => (s.id === search.id ? { ...s, ...updated } : s)));
    } catch (err) {
      setError(err);
    }
  }

  async function remove(search: SavedSearch) {
    if (!window.confirm(`Delete the search "${search.name}"?`)) return;
    try {
      await deleteSearch(search.id);
      setSearches((prev) => prev.filter((s) => s.id !== search.id));
    } catch (err) {
      setError(err);
    }
  }

  function toggleSource(id: string) {
    setDraft((d) => ({
      ...d,
      sources: d.sources.includes(id) ? d.sources.filter((s) => s !== id) : [...d.sources, id],
    }));
  }

  if (loading) return <Spinner label="Loading searches" />;

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Scheduled searches</h1>
          <p>Run discovery on a schedule and get notified when a job scores above your threshold.</p>
        </div>
      </div>

      <ErrorBanner error={error} />

      <Panel title="Your searches">
        {searches.length === 0 ? (
          <EmptyState title="No scheduled searches" body="Create one below to receive alerts for new high-match jobs." />
        ) : (
          <div className="stack">
            {searches.map((s) => (
              <div key={s.id} className="row" style={{ justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: 12 }}>
                <div>
                  <strong>{s.name}</strong>
                  <div className="muted small">
                    {s.keywords.join(', ') || 'Your target roles'} · {s.locations.join(', ') || 'Any location'} · {s.frequency} · alert at{' '}
                    {s.minScore}+
                  </div>
                  <div className="muted small">
                    Last run: {relativeDate(s.lastRunAt)} · Sources: {s.sources.length ? s.sources.join(', ') : 'all configured'}
                  </div>
                </div>
                <div className="row">
                  <button className="btn btn-sm" onClick={() => toggle(s)}>
                    {s.enabled ? 'Pause' : 'Resume'}
                  </button>
                  <button className="btn btn-sm btn-danger" onClick={() => remove(s)}>
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel title="New scheduled search">
        <form className="stack" onSubmit={onCreate}>
          <div className="form-grid">
            <label className="field">
              Name
              <input required value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Frontend roles in Bengaluru" />
            </label>
            <label className="field">
              Keywords
              <input value={keywordText} onChange={(e) => setKeywordText(e.target.value)} placeholder="React, Frontend Engineer" />
            </label>
            <label className="field">
              Locations
              <input value={locationText} onChange={(e) => setLocationText(e.target.value)} placeholder="Bengaluru, Remote" />
            </label>
            <label className="field">
              Frequency
              <select value={draft.frequency} onChange={(e) => setDraft({ ...draft, frequency: e.target.value as Draft['frequency'] })}>
                <option value="hourly">Hourly</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
              </select>
            </label>
            <label className="field">
              Alert threshold (score)
              <input
                type="number"
                min={0}
                max={100}
                value={draft.minScore}
                onChange={(e) => setDraft({ ...draft, minScore: Number(e.target.value) })}
              />
            </label>
          </div>
          <div className="field">
            Sources
            <div className="checks">
              {sources.map((s) => (
                <label key={s.id} title={s.note}>
                  <input
                    type="checkbox"
                    checked={draft.sources.includes(s.id)}
                    onChange={() => toggleSource(s.id)}
                    disabled={!s.configured}
                  />
                  <span>
                    {s.name}
                    {!s.configured && <span className="muted small"> (not configured)</span>}
                  </span>
                </label>
              ))}
            </div>
            <span className="field-hint">Leave all unchecked to use every configured source.</span>
          </div>
          <div>
            <button className="btn btn-primary" type="submit">
              Create search
            </button>
          </div>
        </form>
      </Panel>
    </>
  );
}
