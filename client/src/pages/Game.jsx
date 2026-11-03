import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, emit, getSocket, msToClock, mmss, useCountdown, useSocketEvent } from '../lib.js';
import TopBar from '../components/Brand.jsx';
import LotMap from '../components/LotMap.jsx';

const STAGES = ['brief', 'explore', 'negotiate', 'reveal'];
const TITLES = { brief: 'Brief', explore: 'Explore', negotiate: 'Negotiate', reveal: 'Reveal', done: 'Reveal' };

export default function Game() {
  const { id } = useParams();
  const [g, setG] = useState(null);
  const [error, setError] = useState('');
  useSocketEvent('game:state', useCallback((s) => { if (s.id === id) setG(s); }, [id]));
  useEffect(() => {
    const join = () => emit('game:join', { sessionId: id }).then((r) => r.error && setError(r.error));
    join();
    const s = getSocket(); s.on('connect', join);
    return () => s.off('connect', join);
  }, [id]);
  const left = useCountdown(g?.stageEndsAt, g?.serverNow);

  if (error) return <div className="wrap stack"><TopBar back /><div className="error">{error}</div><Link className="btn" to="/">Back home</Link></div>;
  if (!g) return <div className="wrap muted">Joining your table...</div>;
  const send = (ev, extra) => getSocket().emit(ev, { sessionId: id, ...extra });
  const idx = STAGES.indexOf(g.stage === 'done' ? 'reveal' : g.stage);

  return (
    <div className="wrap stack">
      <div className="stagebar">
        <div className="row between">
          <span className="chip ok">{idx + 1} of 4 · {TITLES[g.stage]}</span>
          <span className="timer" aria-live="off">{g.stage === 'done' ? 'Finished' : `${mmss(left)} left`}</span>
        </div>
        <div className="progress" aria-hidden="true">{STAGES.map((s, i) => <div key={s} className={i <= idx ? 'on' : ''} />)}</div>
      </div>
      {g.stage === 'brief' && <Brief g={g} send={send} />}
      {g.stage === 'explore' && <Explore g={g} send={send} />}
      {g.stage === 'negotiate' && <Negotiate g={g} send={send} />}
      {(g.stage === 'reveal' || g.stage === 'done') && <Reveal g={g} />}
      {g.stage !== 'done' && <Chat g={g} send={send} />}
    </div>
  );
}

function RoleCard({ g, send, compact }) {
  const r = g.me.role;
  return (
    <div className="role-card">
      <div className="row">
        <div className="avatar" style={{ background: r.color }}>{r.initial}</div>
        <div><div className="label">You are</div><div style={{ fontSize: 24, fontWeight: 800 }}>{r.name}</div></div>
      </div>
      <div className="inner"><div className="label">Your goal</div><div style={{ fontWeight: 700 }}>{r.goal}</div>
        {g.stage === 'negotiate' && <div className={`chip ${r.goalMet ? 'ok' : 'warn'}`} style={{ marginTop: 6 }}>{r.goalMet ? 'Met by the current plan' : 'Not met by the current plan'}</div>}
      </div>
      {!compact || g.me.sharedAt === null ? (
        <div className="inner secret">
          <div className="row between"><span className="label">Your private fact</span><span className="chip">{g.me.sharedAt === null ? 'Only you can see this' : `Shared at ${msToClock(g.me.sharedAt)}`}</span></div>
          <div style={{ fontWeight: 600, marginTop: 4 }}>{r.fact}</div>
          {g.stage !== 'brief' && g.me.sharedAt === null && (
            <button className="btn ghost small" style={{ marginTop: 10 }} onClick={() => send('game:share')}>Share with the table</button>
          )}
        </div>
      ) : null}
    </div>
  );
}

function Brief({ g, send }) {
  return (
    <>
      <RoleCard g={g} send={send} />
      <p className="small muted">Share your fact when it helps your case, or hold it back to bargain. Either choice is yours. All facts in this game are fictional.</p>
      <div className="stack" style={{ gap: 8 }}>
        <div className="label">At the table</div>
        {g.players.map((p) => (
          <div key={p.pcode} className={`player-row ${p.isAI ? 'ai' : ''}`}>
            <div className="avatar sm" style={{ background: p.color }}>{p.initial}</div>
            <span className="grow" style={{ fontWeight: 700 }}>{p.name}{p.isYou ? ' (you)' : ''}</span>
            <span className="small muted">{p.role} · {p.isAI ? 'AI, no vote' : p.ready ? 'Ready' : 'Reading'}</span>
          </div>
        ))}
        <div className="player-row ai"><div className="avatar sm" style={{ background: '#46525c' }}>AI</div><span className="grow"><span style={{ fontWeight: 700 }}>Administrator</span><br /><span className="small muted">AI player: keeps time and rules, no vote</span></span></div>
      </div>
      <button className="btn block" disabled={g.me.ready} onClick={() => send('game:ready')}>{g.me.ready ? 'Waiting for the others...' : 'I am ready'}</button>
    </>
  );
}

function Explore({ g, send }) {
  const [layer, setLayer] = useState(g.scenario.layers[0].id);
  const pick = (id) => { setLayer(id); send('game:layer', { layer: id }); };
  const info = g.scenario.layers.find((l) => l.id === layer);
  return (
    <>
      <h2 style={{ margin: 0 }}>Explore the north lot</h2>
      <div className="layers">{g.scenario.layers.map((l) => <button key={l.id} className={l.id === layer ? 'on' : ''} aria-pressed={l.id === layer} onClick={() => pick(l.id)}>{l.name}</button>)}</div>
      <LotMap layer={layer} />
      <div className="card"><div className="row between"><strong>{info.name}</strong><span className="chip">Fictional data</span></div><p className="small" style={{ margin: '6px 0 0' }}>{info.fact}</p></div>
      <RoleCard g={g} send={send} compact />
    </>
  );
}

function PlanBar({ plan, uses }) {
  return (
    <div className="bar" role="img" aria-label={uses.map((u) => `${u.name} ${plan[u.id]}%`).join(', ')}>
      {uses.map((u) => plan[u.id] > 0 && <div key={u.id} style={{ width: `${plan[u.id]}%`, background: u.color, color: u.ink }}>{plan[u.id]}</div>)}
    </div>
  );
}

function Negotiate({ g, send }) {
  const humans = g.players.filter((p) => !p.isAI);
  const accepted = humans.filter((p) => p.accepted).length;
  const step = g.scenario.step;
  return (
    <>
      <div className="row between"><h2 style={{ margin: 0 }}>Shared plan</h2><span className={`chip ${g.total === 100 ? '' : 'warn'}`}>Total {g.total}%</span></div>
      <PlanBar plan={g.plan} uses={g.scenario.uses} />
      <div className="stack" style={{ gap: 8 }}>
        {g.scenario.uses.map((u) => (
          <div key={u.id} className="use-row">
            <div className="swatch" style={{ background: u.color }} />
            <span className="grow" style={{ fontWeight: 700 }}>{u.name}</span>
            <button className="icon-btn" aria-label={`Lower ${u.name}`} disabled={g.plan[u.id] <= 0 || !!g.deal} onClick={() => send('game:edit', { use: u.id, delta: -step })}>-</button>
            <span className="value">{g.plan[u.id]}%</span>
            <button className="icon-btn" aria-label={`Raise ${u.name}`} disabled={g.total >= 100 || !!g.deal} onClick={() => send('game:edit', { use: u.id, delta: step })}>+</button>
          </div>
        ))}
        <p className="small muted" style={{ margin: 0 }}>The plan must add up to 100%. To raise one use, lower another first. Any change clears everyone's Accept.</p>
      </div>
      <div className={`card small ${g.ruleOk ? '' : 'error'}`} style={g.ruleOk ? { background: 'var(--primary-tint)', border: 0 } : {}}>
        <strong>Administrator (AI):</strong> no single use above {g.scenario.maxUse}%. {g.ruleOk ? 'This plan follows the rule.' : `${g.breaks.map((b) => g.scenario.uses.find((u) => u.id === b).name).join(' and ')} is over the limit.`}
      </div>
      <div className="card stack">
        <div className="row between"><span className="label">Accepted</span><strong>{accepted} of {humans.length} humans</strong></div>
        <div className="meter"><div style={{ width: `${(accepted / humans.length) * 100}%` }} /></div>
        <div className="row wrap-row">{g.players.map((p) => <span key={p.pcode} className={`chip ${p.isAI ? 'ai' : p.accepted ? 'ok' : ''}`}>{p.name}{p.isYou ? ' (you)' : ''}: {p.isAI ? 'no vote' : p.accepted ? 'accepts' : 'not yet'}</span>)}</div>
        <button className={`btn block ${g.me.accepted ? 'ghost' : ''}`} disabled={!!g.deal} onClick={() => send('game:accept', { value: !g.me.accepted })}>
          {g.deal ? 'Deal locked' : g.me.accepted ? 'Withdraw my acceptance' : 'Accept this plan'}
        </button>
      </div>
      <RoleCard g={g} send={send} compact />
    </>
  );
}

function Chat({ g, send }) {
  const [text, setText] = useState('');
  const box = useRef(null);
  useEffect(() => { if (box.current) box.current.scrollTop = box.current.scrollHeight; }, [g.chat.length]);
  const go = (ev) => { if (!text.trim()) return; send(ev, { text }); setText(''); };
  return (
    <div className="card stack">
      <div className="row between"><span className="label">Table chat</span>{g.aiPaused && <span className="chip ai">AI is being run by a teammate</span>}</div>
      <div className="chat" ref={box} aria-live="polite">
        {g.chat.map((m) => (
          <div key={m.id} className={`msg ${m.kind}`}>
            {m.kind === 'ai' && <span className="chip ai" style={{ marginRight: 6, padding: '1px 7px' }}>AI</span>}
            <span className="who">{m.kind === 'fact' ? `${m.name} shared a fact` : m.kind === 'question' ? `${m.name} asked the AI` : m.name}:</span> {m.text}
          </div>
        ))}
      </div>
      <form className="row" onSubmit={(e) => { e.preventDefault(); go('game:chat'); }}>
        <input type="text" className="grow" value={text} maxLength={300} onChange={(e) => setText(e.target.value)} placeholder="Say something to the table" aria-label="Message" />
        <button className="btn small">Send</button>
      </form>
      {g.stage !== 'brief' && g.stage !== 'reveal' && <button className="btn ghost small" type="button" onClick={() => go('game:ask')} disabled={!text.trim()}>Ask the AI instead</button>}
    </div>
  );
}

function Reveal({ g }) {
  const nav = useNavigate();
  const plan = g.deal ? g.deal.plan : g.plan;
  return (
    <>
      <div className="card stack">
        <h2 style={{ margin: 0 }}>{g.deal ? 'Deal reached' : 'No deal this time'}</h2>
        <p className="small muted" style={{ margin: 0 }}>{g.deal ? `Locked at ${msToClock(g.deal.t)}.` : 'Time ran out before every human accepted a valid plan.'}</p>
        <PlanBar plan={plan} uses={g.scenario.uses} />
        <div className="row wrap-row small">{g.scenario.uses.map((u) => <span key={u.id} className="row" style={{ gap: 5 }}><span className="swatch" style={{ background: u.color }} />{u.name}</span>)}</div>
      </div>
      <div className="label">What everyone was holding</div>
      {g.players.map((p) => (
        <div key={p.pcode} className={`card stack ${p.isAI ? 'player-row ai' : ''}`} style={{ gap: 4, display: 'flex', alignItems: 'stretch' }}>
          <div className="row between"><strong>{p.name}{p.isYou ? ' (you)' : ''} · {p.role}{p.isAI ? ' · AI' : ''}</strong>
            <span className={`chip ${p.sharedAt !== null ? 'ok' : ''}`}>{p.sharedAt !== null ? `Shared ${msToClock(p.sharedAt)}` : 'Never shared'}</span></div>
          <div className="small"><strong>Goal:</strong> {p.goal} {p.goalMet ? '(met)' : '(not met)'}</div>
          <div className="small muted"><strong>Fact:</strong> {p.fact}</div>
        </div>
      ))}
      {g.outcome && <div className="card" style={{ background: 'var(--primary-tint)', border: 0 }}><strong>{g.outcome.sharedBeforeDeal} of {g.outcome.of}</strong> private facts surfaced {g.outcome.deal ? 'before the deal' : 'during the game'}. Would the plan have changed if the others had spoken up?</div>}
      <Feedback g={g} />
      <div className="row"><button className="btn grow" onClick={() => nav('/quick')}>Play again</button><Link className="btn ghost grow" to="/">Home</Link></div>
    </>
  );
}

function Feedback({ g }) {
  const [f, setF] = useState({ aiHelpful: 0, playAgain: '', comment: '' });
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  if (sent) return <div className="card">Thank you for the feedback.{g.surveyUrl && <> Please also fill in the <a href={g.surveyUrl} target="_blank" rel="noreferrer">short survey</a>.</>}</div>;
  return (
    <div className="card stack">
      <h2 style={{ margin: 0 }}>Two quick questions</h2>
      <div className="stack" style={{ gap: 6 }}><span className="small" style={{ fontWeight: 700 }}>How helpful was the AI Administrator? (1 not at all, 5 very)</span>
        <div className="scale">{[1, 2, 3, 4, 5].map((n) => <button key={n} className={f.aiHelpful === n ? 'on' : ''} onClick={() => setF({ ...f, aiHelpful: n })}>{n}</button>)}</div></div>
      <div className="stack" style={{ gap: 6 }}><span className="small" style={{ fontWeight: 700 }}>Would you play again?</span>
        <div className="pick">{['yes', 'maybe', 'no'].map((v) => <button key={v} className={f.playAgain === v ? 'on' : ''} onClick={() => setF({ ...f, playAgain: v })}>{v[0].toUpperCase() + v.slice(1)}</button>)}</div></div>
      <label className="field small">Anything else? (optional)<textarea value={f.comment} maxLength={1000} onChange={(e) => setF({ ...f, comment: e.target.value })} /></label>
      {error && <div className="error">{error}</div>}
      <button className="btn" disabled={!f.aiHelpful || !f.playAgain} onClick={async () => { try { await api('/api/feedback', { sessionId: g.id, ...f }); setSent(true); } catch (e) { setError(e.message); } }}>Send feedback</button>
      {g.surveyUrl && <a href={g.surveyUrl} target="_blank" rel="noreferrer" className="small">Open the full feedback survey</a>}
    </div>
  );
}
