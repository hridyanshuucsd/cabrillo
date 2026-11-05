import React, { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { emit, getSocket, mmss, useCountdown, useSocketEvent } from '../lib.js';
import TopBar from '../components/Brand.jsx';

export default function Host() {
  const code = String(useParams().code || '').toUpperCase();
  const [room, setRoom] = useState(null);
  const [tables, setTables] = useState({});
  const [error, setError] = useState('');
  useSocketEvent('room:state', useCallback((s) => { if (s.code === code) setRoom(s); }, [code]));
  useSocketEvent('host:table', useCallback((t) => setTables((all) => ({ ...all, [t.id]: t })), []));
  useEffect(() => {
    const watch = () => emit('host:watch', { code }).then((r) => r.error && setError(r.error));
    watch(); const s = getSocket(); s.on('connect', watch); return () => s.off('connect', watch);
  }, [code]);
  const link = `${window.location.origin}/join/${code}`;
  const list = Object.values(tables);
  const exp = (f) => `/api/export/${code}/${f}`;

  return (
    <div className="wide stack">
      <TopBar back />
      {error && <div className="error">{error}</div>}
      <div className="row wrap-row" style={{ gap: 14, alignItems: 'stretch' }}>
        <div className="card stack" style={{ flex: '1 1 320px' }}>
          <div className="label">Class session · join code</div>
          {room && <div className="small muted">Task: {room.task} · AI: {room.aiMode === 'compare' ? 'tables alternate listening and answer-only' : room.aiMode === 'ask' ? 'answer-only' : 'listening'}</div>}
          <div className="big-code">{code}</div>
          <div className="small">Students open <strong>{link}</strong></div>
          <button className="btn small ghost" onClick={() => navigator.clipboard?.writeText(link)}>Copy link</button>
        </div>
        <div className="card stack" style={{ flex: '1 1 320px' }}>
          <div className="row between"><span className="label">Waiting</span><span className="chip">{room?.waiting.length || 0} people</span></div>
          <div className="row wrap-row">{(room?.waiting || []).map((w, i) => <span key={i} className="chip">{w.name}</span>)}</div>
          <button className="btn" disabled={!room?.waiting.length} onClick={async () => { const r = await emit('room:start', { code }); if (r.error) setError(r.error); }}>
            Start tables ({room?.waiting.length || 0} waiting)
          </button>
          <p className="small muted" style={{ margin: 0 }}>Groups of 3 to 5. Late arrivals wait here; press Start again to seat them.</p>
        </div>
        <div className="card stack" style={{ flex: '1 1 220px' }}>
          <div className="label">Download data (CSV)</div>
          {['logs.csv', 'players.csv', 'sessions.csv', 'feedback.csv'].map((f) => <a key={f} href={exp(f)}>{f}</a>)}
          <p className="small muted" style={{ margin: 0 }}>Codes only, no names or emails.</p>
        </div>
      </div>
      <h2>Tables ({list.length})</h2>
      <div className="grid-tables">{list.map((t) => <TableCard key={t.id} t={t} code={code} />)}</div>
    </div>
  );
}

function TableCard({ t, code }) {
  const left = useCountdown(t.stageEndsAt, t.serverNow);
  const [say, setSay] = useState('');
  const send = (ev, extra) => getSocket().emit(ev, { code, sessionId: t.id, ...extra });
  return (
    <div className="card stack">
      <div className="row between"><strong>Table {t.id.slice(0, 4)}</strong><span className="chip ok">{t.stage}{t.stage !== 'done' ? ` · ${mmss(left)}` : ''}</span></div>
      <div className="row wrap-row"><span className="chip">{t.task}</span><span className="chip ai">{t.mode === 'listen' ? 'Listening AI' : 'Answer-only AI'}</span>{t.mode === 'listen' && <span className="chip">{t.interjections} of 2 interjections</span>}{t.pausedBy && <span className="chip warn">Paused by {t.pausedBy}</span>}</div>
      <div className="small"><strong>Plan so far:</strong> {t.summary}</div>
      {t.deal && <div className="chip ok">Plan locked</div>}
      {t.outcome && <div className="small">Limits that came up: {t.outcome.surfaced} of {t.outcome.of}{t.outcome.complete ? ` · plan works for ${t.outcome.respected} of ${t.outcome.of}` : ''}</div>}
      <div className="stack" style={{ gap: 4 }}>
        {t.players.map((p) => (
          <div key={p.pcode} className="small row between">
            <span>{p.pcode} {p.name}{p.isAI ? ' (AI)' : ''}</span>
            <span className="muted">{p.msgs} msgs · {p.limitUp ? 'limit came up' : 'limit hidden'}{p.isAI ? '' : p.accepted ? ' · accepts' : ''}</span>
          </div>
        ))}
      </div>
      <div className="chat" style={{ maxHeight: 160 }}>{t.chat.map((m) => <div key={m.id} className={`msg ${m.kind === "chat" ? "human" : m.kind}`} style={{ fontSize: 12 }}><b>{m.name}{m.to ? ` to ${m.to} (private)` : ''}:</b> {m.text}</div>)}</div>
      {t.pendingQuestions.length > 0 && <div className="error small">Waiting for the AI to answer: {t.pendingQuestions.map((p) => `${p.name}: "${p.text}"`).join(' | ')}</div>}
      <div className="row wrap-row">
        <button className="btn small ghost" onClick={() => send('host:advance')} disabled={t.stage === 'done'}>Next stage</button>
        <button className="btn small ghost" onClick={() => send('host:pause', { paused: !t.aiPaused })}>{t.aiPaused ? 'Resume automatic AI' : 'Run the AI myself'}</button>
      </div>
      <form className="row" onSubmit={(e) => { e.preventDefault(); if (say.trim()) { send('host:say', { text: say }); setSay(''); } }}>
        <input type="text" className="grow" value={say} onChange={(e) => setSay(e.target.value)} placeholder="Speak as the AI" aria-label="Speak as the AI" />
        <button className="btn small dark">Send</button>
      </form>
    </div>
  );
}
