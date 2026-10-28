import { useEffect, useState } from 'react';
import { fetchPreferences, updatePreferences } from '../api';
import { ErrorBanner, Panel, Spinner } from '../components/ui';
import { EXPERIENCE_LEVELS, WORK_MODES, type ExperienceLevel, type Preferences as PreferencesType, type WorkMode } from '../types';

const LEVEL_LABELS: Record<ExperienceLevel, string> = {
  intern: 'Internship',
  entry: 'Entry level (0–2 years)',
  mid: 'Mid level (2–5 years)',
  senior: 'Senior (5–8 years)',
  lead: 'Lead / Staff',
  executive: 'Executive',
};

function splitList(value: string): string[] {
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function Preferences() {
  const [prefs, setPrefs] = useState<PreferencesType | null>(null);
  const [text, setText] = useState({ targetRoles: '', locations: '', industries: '', preferredCompanies: '' });
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchPreferences()
      .then((p) => {
        setPrefs(p);
        setText({
          targetRoles: p.targetRoles.join(', '),
          locations: p.locations.join(', '),
          industries: p.industries.join(', '),
          preferredCompanies: p.preferredCompanies.join(', '),
        });
      })
      .catch((err: unknown) => setError(err));
  }, []);

  if (!prefs) return error ? <ErrorBanner error={error} /> : <Spinner label="Loading preferences" />;

  const update = (patch: Partial<PreferencesType>) => {
    setPrefs({ ...prefs, ...patch });
    setSaved(false);
  };

  function toggleMode(mode: WorkMode) {
    if (!prefs) return;
    const next = prefs.workModes.includes(mode) ? prefs.workModes.filter((m) => m !== mode) : [...prefs.workModes, mode];
    update({ workModes: next });
  }

  async function onSave() {
    if (!prefs) return;
    setSaving(true);
    setError(null);
    try {
      const next = await updatePreferences({
        ...prefs,
        targetRoles: splitList(text.targetRoles),
        locations: splitList(text.locations),
        industries: splitList(text.industries),
        preferredCompanies: splitList(text.preferredCompanies),
      });
      setPrefs(next);
      setSaved(true);
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Preferences</h1>
          <p>These shape the preferences part of every match score and decide what counts as relevant.</p>
        </div>
        <button className="btn btn-primary" onClick={onSave} disabled={saving}>
          {saving ? 'Saving…' : saved ? 'Saved' : 'Save preferences'}
        </button>
      </div>

      <ErrorBanner error={error} />

      <Panel title="Roles & seniority">
        <div className="form-grid">
          <label className="field">
            Target roles
            <input
              value={text.targetRoles}
              onChange={(e) => {
                setText({ ...text, targetRoles: e.target.value });
                setSaved(false);
              }}
            />
            <span className="field-hint">Comma-separated, e.g. Frontend Engineer, Full Stack Engineer</span>
          </label>
          <label className="field">
            Experience level
            <select value={prefs.experienceLevel} onChange={(e) => update({ experienceLevel: e.target.value as ExperienceLevel })}>
              {EXPERIENCE_LEVELS.map((level) => (
                <option key={level} value={level}>
                  {LEVEL_LABELS[level]}
                </option>
              ))}
            </select>
          </label>
        </div>
      </Panel>

      <Panel title="Location & work mode">
        <div className="stack">
          <label className="field">
            Preferred locations
            <input
              value={text.locations}
              onChange={(e) => {
                setText({ ...text, locations: e.target.value });
                setSaved(false);
              }}
            />
          </label>
          <div className="field">
            Work mode
            <div className="checks">
              {WORK_MODES.map((mode) => (
                <label key={mode}>
                  <input type="checkbox" checked={prefs.workModes.includes(mode)} onChange={() => toggleMode(mode)} />
                  <span style={{ textTransform: 'capitalize' }}>{mode}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
      </Panel>

      <Panel title="Compensation">
        <div className="form-grid">
          <label className="field">
            Minimum salary (per year)
            <input
              type="number"
              min={0}
              step={50000}
              value={prefs.minSalary ?? ''}
              onChange={(e) => update({ minSalary: e.target.value ? Number(e.target.value) : null })}
            />
          </label>
          <label className="field">
            Maximum salary (per year)
            <input
              type="number"
              min={0}
              step={50000}
              value={prefs.maxSalary ?? ''}
              onChange={(e) => update({ maxSalary: e.target.value ? Number(e.target.value) : null })}
            />
          </label>
          <label className="field">
            Currency
            <select value={prefs.currency} onChange={(e) => update({ currency: e.target.value })}>
              <option value="INR">INR (₹)</option>
              <option value="USD">USD ($)</option>
              <option value="EUR">EUR (€)</option>
              <option value="GBP">GBP (£)</option>
            </select>
          </label>
        </div>
      </Panel>

      <Panel title="Industries & companies">
        <div className="form-grid">
          <label className="field">
            Industries
            <input
              value={text.industries}
              onChange={(e) => {
                setText({ ...text, industries: e.target.value });
                setSaved(false);
              }}
            />
          </label>
          <label className="field">
            Preferred companies
            <input
              value={text.preferredCompanies}
              onChange={(e) => {
                setText({ ...text, preferredCompanies: e.target.value });
                setSaved(false);
              }}
            />
            <span className="field-hint">Jobs at these companies get a bonus in the preferences score.</span>
          </label>
        </div>
      </Panel>
    </>
  );
}
