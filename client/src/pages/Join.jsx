import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, emit } from '../lib.js';
import { useMe } from '../me.js';
import { CONSENT } from './Login.jsx';

// The page students open from the class link or QR code: type a name, agree, and land at a table in one step.
export default function Join() {
  const { code: raw } = useParams();
  const code = String(raw || '').toUpperCase();
  const { me, refresh } = useMe();
  const nav = useNavigate();
  const [name, setName] = useState(() => { try { return localStorage.getItem('cabrillo-name') || ''; } catch { return ''; } });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [details, setDetails] = useState(false);
  const tried = useRef(false);

  async function enter() {
    setBusy(true); setError('');
    const r = await emit('room:join', { code });
    if (r.error) { setError(r.error); setBusy(false); return; }
    if (r.host) return nav(`/host/${code}`, { replace: true });
    if (r.sessionId) return nav(`/play/${r.sessionId}`, { replace: true });
    nav(`/room/${code}`, { replace: true }); // private tables still use a waiting room
  }

  // Already signed in (or came back after a reload): go straight to the table.
  useEffect(() => { if (me && !tried.current) { tried.current = true; enter(); } }, [me]);

  async function submit(e) {
    e.preventDefault(); setError(''); setBusy(true);
    try {
      await api('/api/guest', { name: name.trim(), consent: true });
      try { localStorage.setItem('cabrillo-name', name.trim()); } catch {}
      await refresh(); // the effect above then joins
    } catch (err) { setError(err.message); setBusy(false); }
  }

  if (me) return (
    <div className="wrap center-screen">
      <div className="spinner" aria-hidden="true" />
      <p className="muted">{error ? '' : 'Finding your table...'}</p>
      {error && <div className="stack" style={{ width: '100%' }}><div className="error">{error}</div><Link className="btn ghost" to="/">Go home</Link></div>}
    </div>
  );

  return (
    <div className="wrap stack join">
      <div className="brand"><span className="brand-mark" aria-hidden="true">C</span>Cabrillo</div>
      <div>
        <div className="label">Session {code}</div>
        <h1>Plan something with a small group, with an AI that listens.</h1>
        <p className="muted" style={{ margin: 0 }}>You will be seated at a table of about 4 people. Most groups finish in about 10 minutes.</p>
      </div>
      <form className="card stack" onSubmit={submit}>
        <label className="field">Your first name
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} maxLength={24} autoComplete="given-name" autoCapitalize="words" enterKeyHint="go" placeholder="What your group will see" required minLength={2} />
        </label>
        <div className="consent small muted">
          Cabrillo is a UC San Diego class project (COGS 123). We record what happens at your table under a code like P01, not your name.
          {' '}<button type="button" className="linkbtn" onClick={() => setDetails(!details)} aria-expanded={details}>{details ? 'Hide details' : 'Details'}</button>
          {details && <p style={{ margin: '8px 0 0' }}>{CONSENT}</p>}
        </div>
        {error && <div className="error">{error}</div>}
        <button className="btn block" disabled={busy || name.trim().length < 2}>{busy ? 'Joining...' : 'Agree and join'}</button>
      </form>
      <p className="small muted center">Have an account? <Link to={`/login?next=/join/${code}`}>Sign in</Link></p>
    </div>
  );
}
