import React, { useCallback, useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { useParams } from 'react-router-dom';
import { emit, getSocket, mmss, useCountdown, useSocketEvent } from '../lib.js';
import TopBar from '../components/Brand.jsx';

const STAGE_LABEL = { forming: 'filling', setup: 'set up', chat: 'chat', confirm: 'confirm', wrap: 'wrap up', done: 'done' };

function useQr(text) {
  const [svg, setSvg] = useState('');
  useEffect(() => { QRCode.toString(text, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#10202b', light: '#ffffff' } }).then(setSvg).catch(() => {}); }, [text]);
  return svg;
}

export default function Host() {
  const code = String(useParams().code || '').toUpperCase();
  const [room, setRoom] = useState(null);
  const [tables, setTables] = useState({});
  const [error, setError] = useState('');
  const [present, setPresent] = useState(false);
  useSocketEvent('room:state', useCallback((s) => { if (s.code === code) setRoom(s); }, [code]));
  useSocketEvent('host:table', useCallback((t) => setTables((all) => ({ ...all, [t.id]: t })), []));
  useEffect(() => {
    const watch = () => emit('host:watch', { code }).then((r) => r.error && setError(r.error));
    watch(); const s = getSocket(); s.on('connect', watch); return () => s.off('connect', watch);
  }, [code]);
  const link = `${window.location.origin}/join/${code}`;
  const shortLink = link.replace(/^https?:\/\//, '');
  const qr = useQr(link);
  // tables that closed while empty drop out of room.tables
  const ids = new Set((room?.tables || []).map((t) => t.id));
  const list = Object.values(tables).filter((t) => !room || ids.has(t.id)).sort((a, b) => a.number - b.number);
  const filling = list.filter((t) => t.stage === 'forming');
  const playing = list.filter((t) => !['forming', 'done'].includes(t.stage));
  const done = list.filter((t) => t.stage === 'done');
  const people = list.reduce((a, t) => a + t.players.filter((p) => !p.isAI).length, 0);
  const exp = (f) => `/api/export/${code}/${f}`;
  const act = async (ev, extra) => { const r = await emit(ev, { code, ...extra }); if (r.error) setError(r.error); };

  return (
    <div className="wide stack host">
      <TopBar back />
      {error && <div className="error" role="alert">{error}</div>}
      <div className="host-top">
        <section className="card join-card">
          <div className="qr" aria-label="QR code for the join link" dangerouslySetInnerHTML={{ __html: qr }} />
          <div className="stack" style={{ gap: 6, minWidth: 0 }}>
            <span className="label">Students join at</span>
            <strong className="join-link">{shortLink}</strong>
            <div className="big-code" aria-label={`Code ${code}`}>{code}</div>
            <div className="row wrap-row">
              <button className="btn small" onClick={() => setPresent(true)}>Show on projector</button>
              <button className="btn small ghost" onClick={() => navigator.clipboard?.writeText(link)}>Copy link</button>
            </div>
          </div>
        </section>
        <section className="card stack">
          <div className="stats">
            <div className="stat"><strong>{people}</strong><span>joined</span></div>
            <div className="stat"><strong>{filling.length}</strong><span>filling</span></div>
            <div className="stat"><strong>{playing.length}</strong><span>playing</span></div>
            <div className="stat"><strong>{done.length}</strong><span>finished</span></div>
          </div>
          <label className="switch">
            <input type="checkbox" checked={room?.autoStart ?? true} onChange={(e) => act('host:auto-start', { value: e.target.checked })} />
            <span><strong>Start each table when it is full</strong><br /><span className="small muted">People are seated as they join, about {room?.groupSize || 4} per table. Turn this off to hold every table until you start it.</span></span>
          </label>
          <button className="btn" disabled={!filling.length} onClick={() => act('host:start-all')}>{filling.length > 1 ? `Start all ${filling.length} filling tables now` : filling.length ? 'Start the filling table now' : 'No tables are filling'}</button>
          <p className="small muted" style={{ margin: 0 }}>People alone or in pairs move to another table first; anyone left plays with labeled AI players. {room && `Scenario: ${room.task === 'mixed' ? 'a different one for each table' : room.task}. AI: ${room.aiMode === 'compare' ? 'tables alternate listening and answer-only' : room.aiMode === 'ask' ? 'answer-only' : 'listening'}.`}</p>
        </section>
      </div>
      <h2 style={{ margin: '6px 0 0' }}>Tables</h2>
      {!list.length && <div className="card muted">No one has joined yet. Show the QR code; each person is seated at a table the moment they join.</div>}
      <div className="grid-tables">{list.map((t) => <TableCard key={t.id} t={t} code={code} act={act} />)}</div>
      <section className="card stack">
        <div className="label">Download data (CSV)</div>
        <div className="row wrap-row" style={{ gap: 14 }}>{['logs.csv', 'players.csv', 'sessions.csv', 'feedback.csv'].map((f) => <a key={f} href={exp(f)}>{f}</a>)}</div>
        <p className="small muted" style={{ margin: 0 }}>Codes only, no names or emails.</p>
      </section>
      {present && (
        <div className="projector" role="dialog" aria-label="Join screen for the projector" onClick={() => setPresent(false)}>
          <div className="projector-inner">
            <div className="qr big" dangerouslySetInnerHTML={{ __html: qr }} />
            <div className="stack" style={{ gap: 18 }}>
              <div className="projector-k">Scan, or go to</div>
              <div className="projector-link">{shortLink}</div>
              <div className="projector-k">Code</div>
              <div className="projector-code">{code}</div>
              <div className="projector-count">{people} joined · {playing.length + done.length} tables started</div>
              <div className="small muted">Click anywhere to close</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TableCard({ t, code, act }) {
  const left = useCountdown(t.stageEndsAt, t.serverNow);
  const [say, setSay] = useState('');
  // On a phone the host sees one line per table and opens the ones that need attention; on a wide screen all are open.
  const [open, setOpen] = useState(() => window.innerWidth >= 720);
  const send = (ev, extra) => getSocket().emit(ev, { code, sessionId: t.id, ...extra });
  const head = (
    <button className="table-head" aria-expanded={open} onClick={() => setOpen(!open)}>
      <span className="grow" style={{ minWidth: 0 }}><strong>Table {t.number} · {t.task}</strong><br />
        <span className="small muted">{t.mode === 'listen' ? 'Listening AI' : 'Answer-only AI'} · {t.stage === 'forming' ? `${t.humans} of ${t.target} here, ${t.ready} ready` : `${t.players.filter((p) => !p.isAI).length} people`}{t.pendingQuestions.length ? ' · question waiting' : ''}</span></span>
      <span className={`chip ${t.pendingQuestions.length ? 'warn' : t.stage === 'forming' ? '' : 'ok'}`}>{STAGE_LABEL[t.stage]}{!['done', 'forming'].includes(t.stage) ? ` · ${mmss(left)}` : ''}</span>
    </button>
  );
  const startNow = t.stage === 'forming' && <button className="btn small" onClick={() => act('host:start-table', { sessionId: t.id })}>Start this table now{t.humans < 3 ? ' with AI players' : ''}</button>;
  if (!open) return <div className="card" style={{ padding: 0 }}>{head}{startNow && <div style={{ padding: '0 14px 12px' }}>{startNow}</div>}</div>;
  if (t.stage === 'forming') return <div className="card stack">{head}<div className="row wrap-row">{t.players.map((p) => <span key={p.pcode} className="chip">{p.name}</span>)}</div>{startNow}</div>;
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
      <div className="host-chat">{t.chat.map((m) => <div key={m.id} className={`hc ${m.kind}`}><b>{m.name}{m.to ? ` to ${m.to} (private)` : ''}:</b> {m.text}</div>)}</div>
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
