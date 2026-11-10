import React, { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../lib.js';
import { useMe } from '../me.js';

export const CONSENT = 'Cabrillo is a UC San Diego student project (COGS 123). In each session an AI reads the group chat to keep a summary of the plan; chat messages may be processed by an outside AI service, with a code in place of your name. To learn how groups decide, we record what happens, such as messages, choices, and timing, under a code like P01 instead of your name. Please do not share personal information in chat. You can stop at any time.';

export default function Login() {
  const { me, refresh } = useMe();
  const [params] = useSearchParams();
  const next = params.get('next') || '/';
  const joining = next.startsWith('/join/');
  const [tab, setTab] = useState(joining ? 'guest' : 'signin');
  const [form, setForm] = useState({ name: '', email: '', password: '', consent: false });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  async function submit(e) {
    e.preventDefault(); setError(''); setBusy(true);
    try {
      if (tab === 'guest') await api('/api/guest', { name: form.name, consent: form.consent });
      if (tab === 'signin') await api('/api/login', { email: form.email, password: form.password });
      if (tab === 'signup') await api('/api/signup', form);
      await refresh();
      nav(next, { replace: true });
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  return (
    <div className="wrap stack">
      <div className="brand"><span className="brand-mark" aria-hidden="true">C</span>Cabrillo</div>
      <div>
        <h1>Make a group plan together, with an AI that listens.</h1>
        <p className="muted">3 to 5 people plan something together in a group chat. A clearly labeled AI reads along, keeps the plan up to date above the chat, and asks a question now and then. Each person also holds one private limit. At the end, everyone sees whose limits made it into the plan.</p>
      </div>
      {me && <div className="card small">You are signed in as {me.name}. <Link to={next}>Continue</Link></div>}
      <div className="tabs" role="tablist">
        {[['guest', 'Play as guest'], ['signin', 'Sign in'], ['signup', 'Create account']].map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => { setTab(k); setError(''); }}>{label}</button>
        ))}
      </div>
      <form className="card stack" onSubmit={submit}>
        {tab !== 'signin' && (
          <label className="field">Display name
            <input type="text" value={form.name} onChange={set('name')} maxLength={24} placeholder="What others will see" autoComplete="nickname" required />
          </label>
        )}
        {tab !== 'guest' && (
          <>
            <label className="field">Email
              <input type="email" value={form.email} onChange={set('email')} autoComplete="email" required />
            </label>
            <label className="field">Password
              <input type="password" value={form.password} onChange={set('password')} minLength={tab === 'signup' ? 8 : 1} autoComplete={tab === 'signup' ? 'new-password' : 'current-password'} required />
            </label>
          </>
        )}
        {tab !== 'signin' && (
          <label className="check"><input type="checkbox" checked={form.consent} onChange={set('consent')} /><span>{CONSENT} <Link to="/about">More about the study</Link></span></label>
        )}
        {tab === 'guest' && <p className="small muted">Guests can play right away. Create an account to keep your history and host sessions.</p>}
        {error && <div className="error" role="alert">{error}</div>}
        <button className="btn block" disabled={busy}>{tab === 'guest' ? 'Continue as guest' : tab === 'signin' ? 'Sign in' : 'Create account'}</button>
      </form>
    </div>
  );
}
