import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, emit, getSocket, msToClock, mmss, useCountdown, useSocketEvent } from '../lib.js';
import TopBar from '../components/Brand.jsx';

const STAGES = ['setup', 'chat', 'confirm', 'wrap'];
const TITLES = { setup: 'Set up', chat: 'Chat', confirm: 'Confirm', wrap: 'Wrap up', done: 'Wrap up' };

// On phones the chat stages fill the screen like a messaging app. visualViewport gives the height above the
// on-screen keyboard (iOS does not shrink 100dvh for the keyboard), so the message box stays visible while typing.
function useAppHeight(active) {
  useEffect(() => {
    if (!active) return;
    const vv = window.visualViewport;
    const set = () => {
      document.documentElement.style.setProperty('--app-h', `${vv ? vv.height : window.innerHeight}px`);
      if (vv && vv.offsetTop) window.scrollTo(0, 0);
    };
    set();
    vv?.addEventListener('resize', set); vv?.addEventListener('scroll', set); window.addEventListener('resize', set);
    document.body.classList.add('app-locked'); document.documentElement.classList.add('app-locked');
    return () => { vv?.removeEventListener('resize', set); vv?.removeEventListener('scroll', set); window.removeEventListener('resize', set); document.body.classList.remove('app-locked'); document.documentElement.classList.remove('app-locked'); };
  }, [active]);
}

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
  const shell = g && (g.stage === 'chat' || g.stage === 'confirm');
  useAppHeight(shell);

  if (error) return <div className="wrap stack"><TopBar back /><div className="error">{error}</div><Link className="btn" to="/">Back home</Link></div>;
  if (!g) return <div className="wrap muted">Joining your table...</div>;
  const send = (ev, extra) => getSocket().emit(ev, { sessionId: id, ...extra });
  const header = <StageHeader g={g} left={left} />;

  if (g.stage === 'chat') return <div className="shell">{header}<ChatStage g={g} send={send} /></div>;
  if (g.stage === 'confirm') return <div className="shell">{header}<ConfirmStage g={g} send={send} /></div>;
  return (
    <div className="wrap stack page">
      {header}
      {g.stage === 'setup' && <Setup g={g} send={send} />}
      {(g.stage === 'wrap' || g.stage === 'done') && <Wrap g={g} />}
      {g.stage === 'wrap' && <Thread g={g} send={send} title="Group chat" />}
    </div>
  );
}

function StageHeader({ g, left }) {
  const idx = STAGES.indexOf(g.stage === 'done' ? 'wrap' : g.stage);
  return (
    <header className="stagebar">
      <div className="row between">
        <span className="row" style={{ gap: 6, minWidth: 0 }}>
          {g.kind === 'class' && <span className="chip">Table {g.number}</span>}
          <span className="chip ok">{idx + 1} of 4 · {TITLES[g.stage]}</span>
        </span>
        <span className="timer" aria-live="off">{g.stage === 'done' ? 'Finished' : `${mmss(left)} left`}</span>
      </div>
      <div className="progress" aria-hidden="true">{STAGES.map((s, i) => <div key={s} className={i <= idx ? 'on' : ''} />)}</div>
    </header>
  );
}

// A panel that slides up from the bottom of the screen; closes with the button, a tap outside, or Escape.
function Sheet({ title, onClose, children }) {
  useEffect(() => { const k = (e) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head"><strong>{title}</strong><button className="btn ghost small" onClick={onClose}>Close</button></div>
        <div className="sheet-body stack">{children}</div>
      </div>
    </div>
  );
}

// Your private limit, folded to one line on the chat screens; tap to read it in full and to post it.
function LimitBar({ g, send }) {
  const [open, setOpen] = useState(false);
  const l = g.me.limit;
  const shared = l.sharedAt !== null;
  return (
    <>
      <button className="limit-bar" aria-expanded={open} onClick={() => setOpen(true)}>
        <span className="label" style={{ color: '#2f4ea0' }}>{shared ? 'Your limit · shared' : 'Your private limit'}</span>
        <span className="limit-text">{l.text}</span>
        {g.stage === 'confirm' && l.ok !== null && <span className={`chip ${l.ok ? 'ok' : 'warn'}`}>{l.ok ? 'Plan works' : 'Plan breaks it'}</span>}
      </button>
      {open && <Sheet title="Your private limit" onClose={() => setOpen(false)}><LimitCard g={g} send={(ev) => { send(ev); setOpen(false); }} /></Sheet>}
    </>
  );
}

function TaskCard({ g }) {
  return (
    <div className="card stack" style={{ gap: 6 }}>
      <div className="label">Your group's task</div>
      <div style={{ fontSize: 22, fontWeight: 800 }}>{g.task.title}</div>
      <p className="small" style={{ margin: 0 }}>{g.task.prompt}</p>
      <div className="row wrap-row">{g.task.fields.map((f) => <span key={f.id} className="chip">{f.name}</span>)}</div>
    </div>
  );
}

function LimitCard({ g, send, compact }) {
  const l = g.me.limit;
  return (
    <div className="role-card">
      <div className="row between"><span className="label">Your private limit</span><span className="chip">{l.sharedAt !== null ? `Shared ${msToClock(l.sharedAt)}` : 'Only you can see this'}</span></div>
      <div className="inner secret" style={{ fontWeight: 700 }}>{l.text}
        {g.stage === 'confirm' && l.ok !== null && <div className={`chip ${l.ok ? 'ok' : 'warn'}`} style={{ marginTop: 8 }}>{l.ok ? 'This plan works with your limit' : 'This plan breaks your limit'}</div>}
      </div>
      {!compact && <p className="small muted" style={{ margin: 0 }}>Bring it up in the chat whenever you like, in your own words, or tap the button. It is your choice. The AI cannot see this card.</p>}
      {l.sharedAt === null && g.stage !== 'setup' && <button className="btn ghost small" onClick={() => send('game:share')}>Post my limit to the group</button>}
    </div>
  );
}

function AIRow({ g }) {
  return (
    <div className="player-row ai">
      <div className="avatar sm" style={{ background: '#46525c' }}>AI</div>
      <span className="grow"><span style={{ fontWeight: 700 }}>AI</span><br />
        <span className="small muted">{g.mode === 'listen' ? 'Reads the chat, keeps the Plan so far, asks a question now and then. No vote.' : 'Answers only when asked with @AI. No vote.'}</span></span>
    </div>
  );
}

function Setup({ g, send }) {
  return (
    <>
      <TaskCard g={g} />
      <LimitCard g={g} send={send} />
      <div className="stack" style={{ gap: 8 }}>
        <div className="label">At the table</div>
        {g.players.map((p) => (
          <div key={p.pcode} className={`player-row ${p.isAI ? 'ai' : ''}`}>
            <div className="avatar sm" style={{ background: p.color }}>{p.initial}</div>
            <span className="grow" style={{ fontWeight: 700 }}>{p.name}{p.isYou ? ' (you)' : ''}</span>
            <span className="small muted">{p.isAI ? 'AI player, no vote' : p.ready ? 'Ready' : 'Reading'}</span>
          </div>
        ))}
        <AIRow g={g} />
      </div>
      <p className="small muted" style={{ margin: 0 }}>{g.mode === 'listen'
        ? 'The chat starts only when everyone taps "I am ready". By tapping it you agree that the AI may read this table\'s chat to keep the Plan so far. It speaks up at most twice, and anyone can pause it.'
        : 'The chat starts only when everyone taps "I am ready". At this table the AI reads a message only when someone starts it with @AI.'}</p>
      <div className="sticky-foot"><button className="btn block" disabled={g.me.ready} onClick={() => send('game:ready')}>{g.me.ready ? 'Waiting for the others...' : 'I am ready'}</button></div>
    </>
  );
}

const STATUS = { open: ['Not discussed', ''], split: ['Undecided', 'warn'], leaning: ['Leaning', ''], agreed: ['Most agree', 'ok'] };

// Compact Plan so far: one tile per plan field, always visible above the chat; "Details" shows who said what.
function PlanStrip({ g, send }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="plan-strip" aria-label="Plan so far">
      <div className="row between">
        <span className="label">Plan so far</span>
        <span className="row" style={{ gap: 6 }}>
          <button className="btn ghost tiny" onClick={() => setOpen(true)}>Details</button>
          <button className="btn ghost tiny" onClick={() => send('game:pause-ai', { paused: !g.pausedBy })}>{g.pausedBy ? 'Resume AI' : 'Pause AI'}</button>
        </span>
      </div>
      {g.pausedBy && <div className="chip warn">Paused by {g.pausedBy}. The AI is not reading the chat.</div>}
      {g.aiPaused && <div className="chip ai">A teammate is running the AI by hand</div>}
      <div className="plan-tiles">
        {g.panel.map((f) => {
          const lead = f.options.find((o) => o.option === f.leader) || f.options[0];
          return (
            <div key={f.id} className={`plan-tile ${f.status}`}>
              <span className="tile-name">{f.name}{f.status !== 'open' && <span className="tile-status"> · {STATUS[f.status][0]}</span>}</span>
              <span className="tile-value">{lead ? lead.name : 'Not discussed'}</span>
            </div>
          );
        })}
      </div>
      {open && (
        <Sheet title="Plan so far" onClose={() => setOpen(false)}>
          <p className="small muted" style={{ margin: 0 }}>Kept by the AI from your chat. Names show who mentioned each option.</p>
          {g.panel.map((f) => (
            <div key={f.id} className="plan-row">
              <div className="row between"><strong>{f.name}</strong><span className={`chip ${STATUS[f.status][1]}`}>{STATUS[f.status][0]}</span></div>
              {f.options.length ? (
                <div className="stack" style={{ gap: 2, marginTop: 4 }}>
                  {f.options.map((o) => <div key={o.option} className="small"><span style={{ fontWeight: o.option === f.leader ? 800 : 500 }}>{o.name}</span> <span className="muted">· {o.who.join(', ')}</span></div>)}
                </div>
              ) : <div className="small muted" style={{ marginTop: 4 }}>Nobody has mentioned this yet.</div>}
            </div>
          ))}
          {g.quiet.length > 0 && <div className="small muted">Not heard from yet: {g.quiet.join(', ')}</div>}
        </Sheet>
      )}
    </section>
  );
}

function ReadyButton({ g, send }) {
  const humans = g.players.filter((p) => !p.isAI);
  const n = humans.filter((p) => p.confirmReady).length;
  return (
    <button className="btn small ready-btn" disabled={g.me.confirmReady} onClick={() => send('game:confirm-ready')}
      aria-label={g.me.confirmReady ? 'Waiting for others' : 'Ready to confirm'}>
      {g.me.confirmReady ? 'Waiting' : <>Ready<span className="long"> to confirm</span></>} <span className="count">{n}/{humans.length}</span>
    </button>
  );
}

function ChatStage({ g, send }) {
  return (
    <>
      <div className="shell-top">
        {g.mode === 'listen' ? <PlanStrip g={g} send={send} /> : (
          <div className="hint">This AI answers only when asked. Start a message with <strong>@AI</strong> or tap <strong>Ask AI</strong>.</div>
        )}
        <div className="row" style={{ gap: 8 }}>
          <div className="grow"><LimitBar g={g} send={send} /></div>
          <ReadyButton g={g} send={send} />
        </div>
      </div>
      <Thread g={g} send={send} fill />
    </>
  );
}

function ConfirmStage({ g, send }) {
  const [tab, setTab] = useState('plan');
  // Count new messages by id: the server sends only the latest 80, so the list length stops growing.
  const lastId = g.chat.length ? g.chat[g.chat.length - 1].id : 0;
  const [seen, setSeen] = useState(lastId);
  useEffect(() => { if (tab === 'chat') setSeen(lastId); }, [tab, lastId]);
  const unread = tab === 'plan' ? g.chat.filter((m) => m.id > seen && m.from !== g.me.pcode).length : 0;
  const humans = g.players.filter((p) => !p.isAI);
  const accepted = humans.filter((p) => p.accepted).length;
  return (
    <>
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'plan'} className={tab === 'plan' ? 'on' : ''} onClick={() => setTab('plan')}>Final plan</button>
        <button role="tab" aria-selected={tab === 'chat'} className={tab === 'chat' ? 'on' : ''} onClick={() => setTab('chat')}>Chat{unread ? <span className="dot">{unread}</span> : null}</button>
      </div>
      {tab === 'chat' ? <Thread g={g} send={send} fill /> : (
        <>
          <div className="shell-scroll stack">
            <div className="row between"><h2 style={{ margin: 0 }}>Final plan</h2><span className={`chip ${g.complete ? 'ok' : 'warn'}`}>{g.complete ? 'Complete' : 'Not complete'}</span></div>
            <p className="small muted" style={{ margin: 0 }}>Anyone can change a choice. Any change clears everyone's Accept.</p>
            {g.task.fields.map((f) => (
              <div key={f.id} className="card stack" style={{ gap: 8 }}>
                <strong>{f.name}</strong>
                <div className="pick" role="group" aria-label={f.name}>
                  {f.options.map((o) => <button key={o.id} className={g.plan[f.id] === o.id ? 'on' : ''} aria-pressed={g.plan[f.id] === o.id} disabled={!!g.deal} onClick={() => send('game:set', { field: f.id, option: o.id })}>{o.name}</button>)}
                </div>
              </div>
            ))}
            <LimitBar g={g} send={send} />
            <div className="row wrap-row">{g.players.map((p) => <span key={p.pcode} className={`chip ${p.isAI ? 'ai' : p.accepted ? 'ok' : ''}`}>{p.name}{p.isYou ? ' (you)' : ''}: {p.isAI ? 'no vote' : p.accepted ? 'accepts' : 'not yet'}</span>)}</div>
          </div>
          <div className="shell-foot stack" style={{ gap: 8 }}>
            <div className="row between small"><span className="label">Accepted</span><strong>{accepted} of {humans.length} people</strong></div>
            <div className="meter"><div style={{ width: `${(accepted / humans.length) * 100}%` }} /></div>
            <button className={`btn block ${g.me.accepted ? 'ghost' : ''}`} disabled={!!g.deal} onClick={() => send('game:accept', { value: !g.me.accepted })}>
              {g.deal ? 'Plan locked' : g.me.accepted ? 'Withdraw my acceptance' : 'Accept this plan'}
            </button>
          </div>
        </>
      )}
    </>
  );
}

// The message list and the message box. With fill, it takes the rest of the screen and the box sits at the bottom.
function Thread({ g, send, fill, title }) {
  const [text, setText] = useState('');
  const box = useRef(null);
  const nearBottom = useRef(true);
  useEffect(() => { if (box.current && nearBottom.current) box.current.scrollTop = box.current.scrollHeight; }, [g.chat.length, g.bookings]);
  const go = (ev) => { if (!text.trim()) return; send(ev, { text }); setText(''); nearBottom.current = true; };
  const open = g.stage === 'chat' || g.stage === 'confirm';
  return (
    <section className={fill ? 'thread fill' : 'card stack'}>
      {title && <span className="label">{title}</span>}
      <div className="chat" ref={box} aria-live="polite" onScroll={(e) => { const el = e.currentTarget; nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }}>
        {g.chat.map((m) => m.kind === 'booking' ? <BookingCard key={m.id} b={(g.bookings || []).find((x) => x.id === m.bookingId)} send={send} /> : (
          <div key={m.id} className={`msg ${m.kind === 'chat' ? (m.from === g.me.pcode ? 'human mine' : 'human') : m.kind}`}>
            {(m.kind === 'ai' || m.kind === 'private') && <span className="chip ai" style={{ marginRight: 6, padding: '1px 7px' }}>AI</span>}
            {m.kind === 'private' && <span className="chip" style={{ marginRight: 6, padding: '1px 7px' }}>Only you see this</span>}
            {m.kind !== 'system' && <span className="who">{m.kind === 'limit' ? `${m.name} shared a limit` : m.kind === 'question' ? `${m.name} asked the AI` : m.name}:</span>} {m.text}
          </div>
        ))}
      </div>
      {open && (
        <form className="composer" onSubmit={(e) => { e.preventDefault(); go('game:chat'); }}>
          <button className="btn ghost small ask" type="button" onClick={() => go('game:ask')} disabled={!text.trim()} aria-label="Ask the AI instead">Ask AI</button>
          <input type="text" className="grow" value={text} maxLength={300} onChange={(e) => setText(e.target.value)} placeholder="Message" aria-label="Message" enterKeyHint="send" autoComplete="off" />
          <button className="btn small">Send</button>
        </form>
      )}
    </section>
  );
}

const BOOK_STATUS = { pending: ['Waiting for everyone', ''], booked: ['Booked (demo)', 'ok'], declined: ['Not booked', 'warn'] };
function BookingCard({ b, send }) {
  if (!b) return null;
  const [label, tone] = BOOK_STATUS[b.status];
  return (
    <div className="msg booking" role="group" aria-label={`Booking: ${b.title}`}>
      <div className="row between" style={{ gap: 6 }}>
        <span><span className="chip ai" style={{ marginRight: 6, padding: '1px 7px' }}>AI</span><strong>{b.kind === 'ride' ? 'Ride request' : 'Table request'}</strong></span>
        <span className={`chip ${tone}`}>{label}</span>
      </div>
      <div style={{ fontWeight: 700, margin: '6px 0 2px' }}>{b.title}</div>
      {b.details.map((d) => <div key={d} className="small muted">{d}</div>)}
      <div className="split">Split {b.n} ways: <strong>${b.perPerson.toFixed(2)} each</strong></div>
      {b.status === 'pending' && (b.mine === null
        ? <div className="row" style={{ gap: 8 }}>
            <button className="btn small" onClick={() => send('game:booking', { bookingId: b.id, value: true })}>Price looks right</button>
            <button className="btn ghost small" onClick={() => send('game:booking', { bookingId: b.id, value: false })}>Not for me</button>
          </div>
        : <div className="small muted">You approved. Waiting for: {b.waiting.join(', ') || 'no one'}.</div>)}
      {b.status === 'booked' && <div className="small">Confirmation {b.code}. Payment requests sent. Nothing was really booked or charged in this demo.</div>}
      {b.status === 'declined' && <div className="small muted">Someone said the price does not work, so nothing was booked.</div>}
      <div className="small muted" style={{ marginTop: 4 }}>Approved: {b.approved.length ? b.approved.join(', ') : 'nobody yet'}</div>
    </div>
  );
}

function Wrap({ g }) {
  const nav = useNavigate();
  const plan = g.deal ? g.deal.plan : g.plan;
  const name = (f) => f.options.find((o) => o.id === plan[f.id])?.name || 'Not chosen';
  return (
    <>
      <div className="card stack">
        <h2 style={{ margin: 0 }}>{g.deal ? 'Plan locked' : 'No locked plan this time'}</h2>
        <p className="small muted" style={{ margin: 0 }}>{g.deal ? `Locked at ${msToClock(g.deal.t)}.` : 'Time ran out before everyone accepted a complete plan.'}</p>
        {g.task.fields.map((f) => <div key={f.id} className="row between small"><span className="muted">{f.name}</span><strong>{name(f)}</strong></div>)}
      </div>
      {g.outcome && <div className="card" style={{ background: 'var(--primary-tint)', border: 0 }}><strong>{g.outcome.surfaced} of {g.outcome.of}</strong> private limits came up{g.outcome.deal ? ' before the plan locked' : ''}{g.outcome.complete ? <>, and the plan works for <strong>{g.outcome.respected} of {g.outcome.of}</strong> people.</> : '.'}</div>}
      <div className="label">What everyone was holding</div>
      {g.players.map((p) => {
        const t = Math.min(p.limitSharedAt ?? Infinity, p.limitMentionedAt ?? Infinity);
        return (
          <div key={p.pcode} className={`card stack ${p.isAI ? 'ai-card' : ''}`} style={{ gap: 4 }}>
            <div className="row between"><strong>{p.name}{p.isYou ? ' (you)' : ''}</strong><span className={`chip ${t < Infinity ? 'ok' : ''}`}>{t < Infinity ? `Came up ${msToClock(t)}` : 'Never came up'}</span></div>
            <div className="small">{p.limit}</div>
            {p.limitOk !== null && <div className={`small ${p.limitOk ? 'muted' : ''}`} style={p.limitOk ? {} : { color: 'var(--warn)', fontWeight: 700 }}>{p.limitOk ? 'The plan works with this limit.' : 'The plan breaks this limit.'}</div>}
          </div>
        );
      })}
      <Feedback g={g} />
      <div className="row"><button className="btn grow" onClick={() => nav('/quick')}>Play again</button><Link className="btn ghost grow" to="/">Home</Link></div>
    </>
  );
}

function Feedback({ g }) {
  const [f, setF] = useState({ aiHelpful: 0, aiAmount: '', playAgain: '', comment: '' });
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  if (sent) return <div className="card">Thank you for the feedback.{g.surveyUrl && <> Please also fill in the <a href={g.surveyUrl} target="_blank" rel="noreferrer">short survey</a>.</>}</div>;
  const pick = (k, opts) => <div className="pick">{opts.map(([v, label]) => <button key={v} className={f[k] === v ? 'on' : ''} aria-pressed={f[k] === v} onClick={() => setF({ ...f, [k]: v })}>{label}</button>)}</div>;
  return (
    <div className="card stack">
      <h2 style={{ margin: 0 }}>Three quick questions</h2>
      <div className="stack" style={{ gap: 6 }}><span className="small" style={{ fontWeight: 700 }}>How much did the AI help your group? (1 not at all, 5 a lot)</span>
        <div className="scale">{[1, 2, 3, 4, 5].map((n) => <button key={n} className={f.aiHelpful === n ? 'on' : ''} aria-pressed={f.aiHelpful === n} onClick={() => setF({ ...f, aiHelpful: n })}>{n}</button>)}</div></div>
      <div className="stack" style={{ gap: 6 }}><span className="small" style={{ fontWeight: 700 }}>The AI spoke up...</span>
        {pick('aiAmount', [['too_little', 'Too little'], ['about_right', 'About right'], ['too_much', 'Too much']])}</div>
      <div className="stack" style={{ gap: 6 }}><span className="small" style={{ fontWeight: 700 }}>Would you use this again?</span>
        {pick('playAgain', [['yes', 'Yes'], ['maybe', 'Maybe'], ['no', 'No']])}</div>
      <label className="field small">Anything else? (optional)<textarea value={f.comment} maxLength={1000} onChange={(e) => setF({ ...f, comment: e.target.value })} /></label>
      {error && <div className="error">{error}</div>}
      <button className="btn" disabled={!f.aiHelpful || !f.aiAmount || !f.playAgain} onClick={async () => { try { await api('/api/feedback', { sessionId: g.id, ...f }); setSent(true); } catch (e) { setError(e.message); } }}>Send feedback</button>
      {g.surveyUrl && <a href={g.surveyUrl} target="_blank" rel="noreferrer" className="small">Open the full feedback survey</a>}
    </div>
  );
}
