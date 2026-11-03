import React, { useEffect, useState } from 'react';
import { api } from '../lib.js';
import TopBar from '../components/Brand.jsx';

const ROLE = { student: 'Student', faculty: 'Faculty member', club: 'Club leader', planner: 'Facilities planner', commuter: 'Commuter student' };

export default function History() {
  const [rows, setRows] = useState(null);
  useEffect(() => { api('/api/history').then(setRows).catch(() => setRows([])); }, []);
  return (
    <div className="wrap stack">
      <TopBar back />
      <h1>My past sessions</h1>
      {rows === null ? <p className="muted">Loading...</p> : rows.length === 0 ? <p className="muted">No sessions yet. Play one from the home page.</p> : rows.map((r) => (
        <div key={r.id} className="card row between">
          <div><strong>{ROLE[r.role_id] || r.role_id}</strong><div className="small muted">{new Date(r.started_at).toLocaleString()} · {r.kind === 'quick' ? 'Play now' : r.kind === 'class' ? 'Class session' : 'Private table'}</div></div>
          <div className="stack" style={{ gap: 4, alignItems: 'flex-end' }}>
            <span className={`chip ${r.outcome === 'deal' ? 'ok' : ''}`}>{r.outcome === 'deal' ? 'Deal' : r.outcome === 'no_deal' ? 'No deal' : 'Unfinished'}</span>
            <span className="small muted">{Number(r.shared) > 0 ? 'You shared your fact' : 'You held your fact'}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
