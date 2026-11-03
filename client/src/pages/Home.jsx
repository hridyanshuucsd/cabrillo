import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib.js';
import { useMe } from '../me.js';
import TopBar from '../components/Brand.jsx';

export default function Home() {
  const { me } = useMe();
  const nav = useNavigate();
  const [code, setCode] = useState('');
  const [survey, setSurvey] = useState('');
  const [showHost, setShowHost] = useState(false);
  const [error, setError] = useState('');

  async function create(kind) {
    setError('');
    try {
      const r = await api('/api/rooms', { kind, surveyUrl: kind === 'class' ? survey : '' });
      nav(kind === 'class' ? `/host/${r.code}` : `/room/${r.code}`);
    } catch (e) { setError(e.message); }
  }

  return (
    <div className="wrap stack">
      <TopBar />
      <div>
        <div className="label">Hi {me.name}</div>
        <h1>What should happen to the north lot?</h1>
        <p className="muted">A 10 minute game for 3 to 5 players. Read your secret role card, explore the lot, negotiate one shared plan, then see what everyone was holding.</p>
      </div>

      <div className="card stack">
        <h2>Play now</h2>
        <p className="small muted">Join the next table with whoever is online. If nobody else joins within a minute, clearly labeled AI players fill the empty seats.</p>
        <button className="btn block" onClick={() => nav('/quick')}>Find a table</button>
      </div>

      <div className="card stack">
        <h2>Join with a code</h2>
        <form className="row" onSubmit={(e) => { e.preventDefault(); if (code.trim()) nav(`/join/${code.trim().toUpperCase()}`); }}>
          <input type="text" className="grow" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="For example K7QPM" aria-label="Room code" maxLength={8} autoCapitalize="characters" />
          <button className="btn">Join</button>
        </form>
      </div>

      <div className="card stack">
        <h2>Play with friends</h2>
        <p className="small muted">Create a private table and send your friends the code.</p>
        <button className="btn ghost block" onClick={() => create('private')}>Create a private table</button>
      </div>

      <div className="card stack">
        <div className="row between"><h2 style={{ margin: 0 }}>Host a class session</h2>{me.isGuest && <span className="chip">Account needed</span>}</div>
        <p className="small muted">Everyone joins one code. When you press Start, the app splits them into tables of 3 to 5. You can watch every table and speak for the AI.</p>
        {showHost ? (
          <div className="stack">
            <label className="field">Feedback survey link (optional)
              <input type="url" value={survey} onChange={(e) => setSurvey(e.target.value)} placeholder="https://forms.gle/..." />
            </label>
            <button className="btn dark block" onClick={() => create('class')} disabled={me.isGuest}>Create class session</button>
          </div>
        ) : (
          <button className="btn ghost block" onClick={() => setShowHost(true)} disabled={me.isGuest}>Set up a class session</button>
        )}
        {me.isGuest && <p className="small muted">Sign out and create an account to host.</p>}
      </div>

      {error && <div className="error" role="alert">{error}</div>}
      <div className="row between small">
        {!me.isGuest ? <Link to="/history">My past sessions</Link> : <span className="muted">Guest sessions are not saved to a history.</span>}
        <Link to="/about">About the study</Link>
      </div>
    </div>
  );
}
