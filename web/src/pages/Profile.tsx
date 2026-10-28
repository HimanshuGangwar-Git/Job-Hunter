import { useEffect, useState } from 'react';
import { fetchProfile, updateProfile } from '../api';
import { ErrorBanner, Panel, Spinner } from '../components/ui';
import type { Profile as ProfileType } from '../types';

function splitList(value: string): string[] {
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function Profile() {
  const [profile, setProfile] = useState<ProfileType | null>(null);
  const [skillsText, setSkillsText] = useState('');
  const [certText, setCertText] = useState('');
  const [langText, setLangText] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchProfile()
      .then((p) => {
        setProfile(p);
        setSkillsText(p.skills.join(', '));
        setCertText(p.certifications.join(', '));
        setLangText(p.languages.join(', '));
      })
      .catch((err: unknown) => setError(err));
  }, []);

  if (!profile) return error ? <ErrorBanner error={error} /> : <Spinner label="Loading profile" />;

  const update = (patch: Partial<ProfileType>) => {
    setProfile({ ...profile, ...patch });
    setSaved(false);
  };

  async function onSave() {
    if (!profile) return;
    setSaving(true);
    setError(null);
    try {
      const next = await updateProfile({
        ...profile,
        skills: splitList(skillsText),
        certifications: splitList(certText),
        languages: splitList(langText),
      });
      setProfile(next);
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
          <h1>Profile</h1>
          <p>Extracted from your primary CV. Edit anything that is missing or wrong; matching uses this data.</p>
        </div>
        <button className="btn btn-primary" onClick={onSave} disabled={saving}>
          {saving ? 'Saving…' : saved ? 'Saved' : 'Save profile'}
        </button>
      </div>

      <ErrorBanner error={error} />

      <Panel title="Contact & summary">
        <div className="form-grid">
          <label className="field">
            Full name
            <input value={profile.fullName} onChange={(e) => update({ fullName: e.target.value })} />
          </label>
          <label className="field">
            Headline
            <input value={profile.headline} onChange={(e) => update({ headline: e.target.value })} />
          </label>
          <label className="field">
            Email
            <input value={profile.email ?? ''} onChange={(e) => update({ email: e.target.value || null })} />
          </label>
          <label className="field">
            Phone
            <input value={profile.phone ?? ''} onChange={(e) => update({ phone: e.target.value || null })} />
          </label>
          <label className="field">
            Location
            <input value={profile.location ?? ''} onChange={(e) => update({ location: e.target.value || null })} />
          </label>
          <label className="field">
            Years of experience
            <input
              type="number"
              min={0}
              max={60}
              value={profile.totalYearsExperience}
              onChange={(e) => update({ totalYearsExperience: Number(e.target.value) || 0 })}
            />
          </label>
        </div>
        <label className="field" style={{ marginTop: 14 }}>
          Summary
          <textarea value={profile.summary} onChange={(e) => update({ summary: e.target.value })} />
        </label>
      </Panel>

      <Panel title="Skills, certifications & languages">
        <div className="stack">
          <label className="field">
            Skills
            <textarea value={skillsText} onChange={(e) => { setSkillsText(e.target.value); setSaved(false); }} />
            <span className="field-hint">Comma-separated. Only list skills you can back up in an interview.</span>
          </label>
          <label className="field">
            Certifications
            <input value={certText} onChange={(e) => { setCertText(e.target.value); setSaved(false); }} />
          </label>
          <label className="field">
            Languages
            <input value={langText} onChange={(e) => { setLangText(e.target.value); setSaved(false); }} />
          </label>
        </div>
      </Panel>

      <Panel title="Experience">
        <div className="stack">
          {profile.experience.map((exp, i) => (
            <div key={`${exp.company}-${i}`} className="stack" style={{ borderBottom: '1px solid var(--border)', paddingBottom: 14 }}>
              <div className="form-grid">
                <label className="field">
                  Title
                  <input
                    value={exp.title}
                    onChange={(e) => update({ experience: profile.experience.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)) })}
                  />
                </label>
                <label className="field">
                  Company
                  <input
                    value={exp.company}
                    onChange={(e) => update({ experience: profile.experience.map((x, j) => (j === i ? { ...x, company: e.target.value } : x)) })}
                  />
                </label>
                <label className="field">
                  Start (YYYY-MM)
                  <input
                    value={exp.start}
                    onChange={(e) => update({ experience: profile.experience.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)) })}
                  />
                </label>
                <label className="field">
                  End (blank = current)
                  <input
                    value={exp.end ?? ''}
                    onChange={(e) =>
                      update({ experience: profile.experience.map((x, j) => (j === i ? { ...x, end: e.target.value || null } : x)) })
                    }
                  />
                </label>
              </div>
              <label className="field">
                Achievements (one per line)
                <textarea
                  value={exp.bullets.join('\n')}
                  onChange={(e) =>
                    update({
                      experience: profile.experience.map((x, j) =>
                        j === i ? { ...x, bullets: e.target.value.split('\n').filter((line) => line.trim() !== '') } : x,
                      ),
                    })
                  }
                />
              </label>
              <div>
                <button
                  className="btn btn-sm btn-danger"
                  onClick={() => update({ experience: profile.experience.filter((_, j) => j !== i) })}
                >
                  Remove role
                </button>
              </div>
            </div>
          ))}
          <div>
            <button
              className="btn btn-sm"
              onClick={() =>
                update({ experience: [...profile.experience, { company: '', title: '', start: '', end: null, bullets: [] }] })
              }
            >
              Add role
            </button>
          </div>
        </div>
      </Panel>

      <Panel title="Education">
        <div className="stack">
          {profile.education.map((edu, i) => (
            <div key={`${edu.institution}-${i}`} className="form-grid">
              <label className="field">
                Institution
                <input
                  value={edu.institution}
                  onChange={(e) => update({ education: profile.education.map((x, j) => (j === i ? { ...x, institution: e.target.value } : x)) })}
                />
              </label>
              <label className="field">
                Degree
                <input
                  value={edu.degree}
                  onChange={(e) => update({ education: profile.education.map((x, j) => (j === i ? { ...x, degree: e.target.value } : x)) })}
                />
              </label>
              <label className="field">
                Field
                <input
                  value={edu.field}
                  onChange={(e) => update({ education: profile.education.map((x, j) => (j === i ? { ...x, field: e.target.value } : x)) })}
                />
              </label>
              <label className="field">
                Year
                <input
                  value={edu.year ?? ''}
                  onChange={(e) => update({ education: profile.education.map((x, j) => (j === i ? { ...x, year: e.target.value || null } : x)) })}
                />
              </label>
            </div>
          ))}
        </div>
      </Panel>
    </>
  );
}
