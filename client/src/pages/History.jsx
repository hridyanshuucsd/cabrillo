import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib.js';
import TopBar from '../components/Brand.jsx';

const MODE = { listen: 'listening AI', ask: 'answer-only AI', compare: 'both AI modes' };

export default function History() {
  const [rows, setRows] = useState(null);
  const [hosted, setHosted] = useState([]);
  const [tasks, setTasks] = useState({});
  useEffect(() => {
    api('/api/history').then(setRows).catch(() => setRows([]));
    api('/api/my-sessions').then(setHosted).catch(() => {});
    fetch('/api/tasks').then((r) => r.json()).then((t) => setTasks(Object.fromEntries(t.map((x) => [x.id, x.short || x.title])))).catch(() => {});
  }, []);
  return (
    <div className="wrap stack">
      <TopBar back />
      {hosted.length > 0 && (
        <>
          <h1>Class sessions I hosted</h1>
          {hosted.map((r) => (
            <div key={r.code} className="card row between wrap-row">
              <div><strong>Session {r.code}</strong><div className="small muted">{new Date(r.created_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })} · {r.people} people · {r.tables} tables finished · {r.task === 'mixed' ? 'a different scenario per table' : tasks[r.task] || r.task} · {MODE[r.ai_mode] || ''}</div></div>
              <div className="row" style={{ gap: 8 }}><Link className="btn small" to={`/analytics/${r.code}`}>Analytics</Link><Link className="btn small ghost" to={`/host/${r.code}`}>Console</Link></div>
            </div>
          ))}
        </>
      )}
      <h1>Sessions I played</h1>
      {rows === null ? <p className="muted">Loading...</p> : rows.length === 0 ? <p className="muted">No sessions yet. Play one from the home page.</p> : rows.map((r) => (
        <div key={r.id} className="card row between">
          <div><strong>{tasks[String(r.scenario).split(':')[0]] || 'Session'}</strong><div className="small muted">{new Date(r.started_at).toLocaleString()} · {r.kind === 'quick' ? 'Play now' : r.kind === 'class' ? 'Class session' : 'Private table'} · {MODE[String(r.scenario).split(':')[1]] || ''}</div></div>
          <div className="stack" style={{ gap: 4, alignItems: 'flex-end' }}>
            <span className={`chip ${r.outcome === 'deal' ? 'ok' : ''}`}>{r.outcome === 'deal' ? 'Plan locked' : r.outcome === 'no_deal' ? 'No plan' : 'Unfinished'}</span>
            <span className="small muted">{Number(r.shared) > 0 ? 'Your limit came up' : 'Your limit never came up'}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
