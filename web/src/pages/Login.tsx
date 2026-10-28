import { useState, type FormEvent } from 'react';
import { useAuth } from '../lib/auth';
import { errorMessage } from '../lib/format';

export function Login() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === 'login') await login(email, password);
      else await register(name, email, password);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-page">
      <form className="panel auth-card" onSubmit={onSubmit}>
        <div className="row">
          <span className="brand-mark">JH</span>
          <div>
            <h1>{mode === 'login' ? 'Welcome back' : 'Create your account'}</h1>
            <p className="muted small">AI-powered job discovery, matching and applications.</p>
          </div>
        </div>

        {mode === 'register' && (
          <label className="field">
            Full name
            <input value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" />
          </label>
        )}
        <label className="field">
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
        </label>
        <label className="field">
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          />
          {mode === 'register' && <span className="field-hint">At least 8 characters.</span>}
        </label>

        {error && (
          <div className="banner banner-error" role="alert">
            {error}
          </div>
        )}

        <button className="btn btn-primary" type="submit" disabled={busy}>
          {busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
        </button>
        <button
          className="btn btn-ghost"
          type="button"
          onClick={() => setMode(mode === 'login' ? 'register' : 'login')}
        >
          {mode === 'login' ? "New here? Create an account" : 'Already have an account? Sign in'}
        </button>
      </form>
    </div>
  );
}
