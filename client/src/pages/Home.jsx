import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib.js';
import { useMe } from '../me.js';
import TopBar from '../components/Brand.jsx';

const MODES = [
  ['listen', 'Listening AI', 'Reads the chat, keeps the Plan so far, asks a few questions.'],
  ['ask', 'Answer-only AI', 'Speaks only when someone asks it, like ChatGPT group chats.'],
  ['compare', 'Compare both', 'Tables alternate between the two, for a class test.']
];

export default function Home() {
  const { me } = useMe();
  const nav = useNavigate();
  const [code, setCode] = useState('');
  const [survey, setSurvey] = useState('');
  const [tasks, setTasks] = useState([]);
  const [task, setTask] = useState('outing');
  const [mode, setMode] = useState('compare');
  const [classTask, setClassTask] = useState('mixed');
  const [groupSize, setGroupSize] = useState(4);
  const [showHost, setShowHost] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { fetch('/api/tasks').then((r) => r.json()).then(setTasks).catch(() => {}); }, []);

  async function create(kind) {
    setError('');
    try {
      const r = await api('/api/rooms', { kind, task: kind === 'class' ? classTask : task, groupSize, aiMode: kind === 'class' ? mode : 'listen', surveyUrl: kind === 'class' ? survey : '' });
      nav(kind === 'class' ? `/host/${r.code}` : `/room/${r.code}`);
    } catch (e) { setError(e.message); }
  }

  const taskPicker = (label) => (
    <label className="field">{label}
      <select value={task} onChange={(e) => setTask(e.target.value)}>
        {tasks.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
      </select>
    </label>
  );

  return (
    <div className="wrap stack">
      <TopBar />
      <div>
        <div className="label">Hi {me.name}</div>
        <h1>Plan something together, with an AI that listens.</h1>
        <p className="muted">For 3 to 5 people, usually about 10 minutes. Chat to agree on one plan while the AI keeps track of what you have decided and what is still open. Each person holds one private limit. At the end, see whose limits made it into the plan.</p>
      </div>

      <div className="card stack">
        <h2>Join with a code</h2>
        <form className="row" onSubmit={(e) => { e.preventDefault(); if (code.trim()) nav(`/join/${code.trim().toUpperCase()}`); }}>
          <input type="text" className="grow" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="For example K7QPM" aria-label="Room code" maxLength={8} autoCapitalize="characters" />
          <button className="btn">Join</button>
        </form>
      </div>

      <div className="card stack">
        <h2>Play now</h2>
        <p className="small muted">Join the next table with whoever is online. If nobody else joins within a minute, clearly labeled AI players fill the empty seats.</p>
        <button className="btn ghost block" onClick={() => nav('/quick')}>Find a table</button>
      </div>

      <div className="card stack">
        <h2>Play with friends</h2>
        <p className="small muted">Create a private table and send your friends the code.</p>
        {taskPicker('Task')}
        <button className="btn ghost block" onClick={() => create('private')}>Create a private table</button>
      </div>

      <div className="card stack">
        <div className="row between"><h2 style={{ margin: 0 }}>Host a class session</h2>{me.isGuest && <span className="chip">Account needed</span>}</div>
        <p className="small muted">Everyone opens one link or scans a QR code. Each person is seated at a table the moment they join, each table gets its own scenario, and a table starts when it is full. You can watch every table and speak for the AI.</p>
        {showHost ? (
          <div className="stack">
            <label className="field">Scenario
              <select value={classTask} onChange={(e) => setClassTask(e.target.value)}>
                <option value="mixed">A different one for each table</option>
                {tasks.map((t) => <option key={t.id} value={t.id}>All tables: {t.short || t.title}</option>)}
              </select>
            </label>
            <label className="field">People per table
              <select value={groupSize} onChange={(e) => setGroupSize(Number(e.target.value))}>
                <option value={4}>About 4 (recommended)</option>
                <option value={5}>About 5</option>
                <option value={3}>About 3</option>
              </select>
            </label>
            <div className="stack" style={{ gap: 6 }} role="radiogroup" aria-label="AI at the tables">
              <span className="small" style={{ fontWeight: 600 }}>AI at the tables</span>
              {MODES.map(([v, label, help]) => (
                <label key={v} className="check"><input type="radio" name="mode" checked={mode === v} onChange={() => setMode(v)} /><span><strong>{label}.</strong> {help}</span></label>
              ))}
            </div>
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
