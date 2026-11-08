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
  const list = Object.values(tables).sort((a, b) => a.number - b.number);
  const live = list.filter((t) => t.stage !== 'done').length;
  const exp = (f) => `/api/export/${code}/${f}`;

  return (
    <div className="wide stack">
      <TopBar back />
      {error && <div className="error">{error}</div>}
      <div className="row wrap-row" style={{ gap: 14, alignItems: 'stretch' }}>
        <div className="card stack" style={{ flex: '1 1 320px' }}>
          <div className="label">Class session · join code</div>
          {room && <div className="small muted">Scenario: {room.task === 'mixed' ? 'a different one for each table' : room.task} · About {room.groupSize} per table · AI: {room.aiMode === 'compare' ? 'tables alternate listening and answer-only' : room.aiMode === 'ask' ? 'answer-only' : 'listening'}</div>}
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
          <p className="small muted" style={{ margin: 0 }}>Tables of about {room?.groupSize || 4} (never fewer than 3 or more than 5). Late arrivals wait here; press Start again. One or two late arrivals join a table that is still in Set up{room?.openSeats ? ` (${room.openSeats} can take them now)` : ''}; otherwise they get a new table with AI players in the empty seats.</p>
        </div>
      </div>
      <h2>Tables ({list.length}{list.length ? `, ${live} still running` : ''})</h2>
      <div className="grid-tables">{list.map((t) => <TableCard key={t.id} t={t} code={code} />)}</div>
      <div className="card stack">
        <div className="label">Download data (CSV)</div>
        <div className="row wrap-row" style={{ gap: 14 }}>{['logs.csv', 'players.csv', 'sessions.csv', 'feedback.csv'].map((f) => <a key={f} href={exp(f)}>{f}</a>)}</div>
        <p className="small muted" style={{ margin: 0 }}>Codes only, no names or emails.</p>
      </div>
    </div>
  );
}

function TableCard({ t, code }) {
  const left = useCountdown(t.stageEndsAt, t.serverNow);
  const [say, setSay] = useState('');
  // On a phone the host sees one line per table and opens the ones that need attention; on a wide screen all are open.
  const [open, setOpen] = useState(() => window.innerWidth >= 720);
  const send = (ev, extra) => getSocket().emit(ev, { code, sessionId: t.id, ...extra });
  const head = (
    <button className="table-head" aria-expanded={open} onClick={() => setOpen(!open)}>
      <span className="grow" style={{ minWidth: 0 }}><strong>Table {t.number} · {t.task}</strong><br />
        <span className="small muted">{t.mode === 'listen' ? 'Listening AI' : 'Answer-only AI'} · {t.players.filter((p) => !p.isAI).length} people{t.pendingQuestions.length ? ' · question waiting' : ''}</span></span>
      <span className={`chip ${t.pendingQuestions.length ? 'warn' : 'ok'}`}>{t.stage}{t.stage !== 'done' ? ` · ${mmss(left)}` : ''}</span>
    </button>
  );
  if (!open) return <div className="card" style={{ padding: 0 }}>{head}</div>;
  return (
    <div className="card stack">
      {head}
      <div className="row wrap-row"><span className="chip ai">{t.mode === 'listen' ? 'Listening AI' : 'Answer-only AI'}</span>{t.mode === 'listen' && <span className="chip">{t.interjections} of 2 interjections</span>}{t.pausedBy && <span className="chip warn">Paused by {t.pausedBy}</span>}</div>
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
