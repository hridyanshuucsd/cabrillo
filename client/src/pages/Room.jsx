import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { emit, useSocketEvent } from '../lib.js';
import { useMe } from '../me.js';
import TopBar from '../components/Brand.jsx';

export default function Room({ quick }) {
  const params = useParams();
  const code = quick ? 'QUICK' : String(params.code || '').toUpperCase();
  const { me } = useMe();
  const nav = useNavigate();
  const [state, setState] = useState(null);
  const [error, setError] = useState('');
  const [since] = useState(Date.now());
  const [, force] = useState(0);

  useSocketEvent('room:state', useCallback((s) => { if (s.code === code) setState(s); }, [code]));
  useSocketEvent('game:start', useCallback(({ sessionId }) => nav(`/play/${sessionId}`), [nav]));

  useEffect(() => {
    let alive = true;
    emit(quick ? 'quick:join' : 'room:join', { code }).then((r) => {
      if (!alive) return;
      if (r.error) setError(r.error);
      if (r.host) nav(`/host/${code}`, { replace: true });
    });
    const t = setInterval(() => force((x) => x + 1), 1000);
    return () => { alive = false; clearInterval(t); emit('room:leave', { code }); };
  }, [code, quick, nav]);

  const isOwner = state && me && state.ownerKey === me.key;
  const link = `${window.location.origin}/join/${code}`;
  const waited = Math.floor((Date.now() - since) / 1000);

  return (
    <div className="wrap stack">
      <TopBar back />
      {error ? <div className="error">{error}</div> : (
        <>
          <div>
            <div className="label">{quick ? 'Play now' : state?.kind === 'class' ? 'Class session' : 'Private table'}</div>
            <h1>{quick ? 'Finding a table...' : 'Waiting room'}</h1>
            {quick && <p className="muted">A table starts as soon as 3 people are here. If you wait more than a minute, clearly labeled AI players fill the empty seats. Waited {waited} s.</p>}
          </div>
          {!quick && (
            <div className="card stack">
              <div className="label">Room code</div>
              <div className="big-code">{code}</div>
              <div className="row">
                <input type="text" readOnly value={link} aria-label="Invite link" onFocus={(e) => e.target.select()} />
                <button className="btn small ghost" onClick={() => navigator.clipboard?.writeText(link)}>Copy</button>
              </div>
            </div>
          )}
          <div className="card stack">
            <div className="row between"><h2 style={{ margin: 0 }}>Here now</h2><span className="chip">{state?.waiting.length || 0}</span></div>
            {(state?.waiting || []).map((w, i) => <div key={i} className="player-row">{w.name}{w.name === me?.name ? ' (you)' : ''}</div>)}
            {!quick && !isOwner && <p className="small muted">The game starts when the host presses Start.</p>}
          </div>
          {!quick && isOwner && (
            <button className="btn block" onClick={async () => { const r = await emit('room:start', { code }); if (r.error) setError(r.error); }}>
              Start {state?.waiting.length < 3 ? 'with AI players filling empty seats' : 'the game'}
            </button>
          )}
        </>
      )}
    </div>
  );
}
