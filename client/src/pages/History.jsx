import React, { useEffect, useState } from 'react';
import { api } from '../lib.js';
import TopBar from '../components/Brand.jsx';

const TASK = { outing: 'Weekend outing', project: 'Group project', event: 'Club social' };
const MODE = { listen: 'listening AI', ask: 'answer-only AI' };

export default function History() {
  const [rows, setRows] = useState(null);
  useEffect(() => { api('/api/history').then(setRows).catch(() => setRows([])); }, []);
  return (
    <div className="wrap stack">
      <TopBar back />
      <h1>My past sessions</h1>
      {rows === null ? <p className="muted">Loading...</p> : rows.length === 0 ? <p className="muted">No sessions yet. Play one from the home page.</p> : rows.map((r) => (
        <div key={r.id} className="card row between">
          <div><strong>{TASK[String(r.scenario).split(':')[0]] || 'Session'}</strong><div className="small muted">{new Date(r.started_at).toLocaleString()} · {r.kind === 'quick' ? 'Play now' : r.kind === 'class' ? 'Class session' : 'Private table'} · {MODE[String(r.scenario).split(':')[1]] || ''}</div></div>
          <div className="stack" style={{ gap: 4, alignItems: 'flex-end' }}>
            <span className={`chip ${r.outcome === 'deal' ? 'ok' : ''}`}>{r.outcome === 'deal' ? 'Plan locked' : r.outcome === 'no_deal' ? 'No plan' : 'Unfinished'}</span>
            <span className="small muted">{Number(r.shared) > 0 ? 'Your limit came up' : 'Your limit never came up'}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
