import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, emit, getSocket, msToClock, mmss, useCountdown, useSocketEvent } from '../lib.js';
import TopBar from '../components/Brand.jsx';

const STAGES = ['setup', 'chat', 'confirm', 'wrap'];
const TITLES = { forming: 'Waiting for your table', setup: 'Set up', chat: 'Chat', confirm: 'Confirm', wrap: 'Wrap up', done: 'Finished' };
const STATUS = { open: ['Not discussed', ''], split: ['Undecided', 'warn'], leaning: ['Leaning', ''], agreed: ['Most agree', 'ok'] };

// ---------- phone viewport ----------
// The chat screens are pinned to the visual viewport: the part of the screen above the on-screen keyboard.
// iOS keeps 100dvh at full height when the keyboard opens and scrolls the page instead, which hid the chat.
// Returns true while the keyboard is open, so the screen can fold away everything but the messages.
function usePhoneViewport(active) {
  const [keyboard, setKeyboard] = useState(false);
  useLayoutEffect(() => {
    if (!active) return;
    const vv = window.visualViewport;
    const root = document.documentElement;
    let full = window.innerHeight;
    const set = () => {
      const h = vv ? vv.height : window.innerHeight;
      full = Math.max(full, window.innerHeight);
      root.style.setProperty('--vv-h', `${h}px`);
      root.style.setProperty('--vv-top', `${vv ? vv.offsetTop : 0}px`);
      setKeyboard(h < full - 120);
    };
    set();
    root.classList.add('app-locked');
    vv?.addEventListener('resize', set); vv?.addEventListener('scroll', set); window.addEventListener('resize', set);
    return () => {
      vv?.removeEventListener('resize', set); vv?.removeEventListener('scroll', set); window.removeEventListener('resize', set);
      root.classList.remove('app-locked');
    };
  }, [active]);
  return keyboard;
}

// ---------- page ----------
export default function Game() {
  const { id } = useParams();
  const [g, setG] = useState(null);
  const [error, setError] = useState('');
  const [typing, setTyping] = useState({}); // pcode -> { name, until }
  useSocketEvent('game:state', useCallback((s) => { if (s.id === id) setG(s); }, [id]));
  useSocketEvent('game:typing', useCallback((t) => { if (t.sessionId === id) setTyping((x) => ({ ...x, [t.pcode]: { name: t.name, until: Date.now() + 3500 } })); }, [id]));
  useEffect(() => {
    const join = () => emit('game:join', { sessionId: id }).then((r) => r.error && setError(r.error));
    join();
    const s = getSocket(); s.on('connect', join);
    const t = setInterval(() => setTyping((x) => { const now = Date.now(); const y = Object.fromEntries(Object.entries(x).filter(([, v]) => v.until > now)); return Object.keys(y).length === Object.keys(x).length ? x : y; }), 1000);
    return () => { s.off('connect', join); clearInterval(t); };
  }, [id]);
  // a person stops "typing" as soon as their message arrives
  const lastMsg = g?.chat[g.chat.length - 1];
  useEffect(() => { if (lastMsg && typing[lastMsg.from]) setTyping((x) => { const y = { ...x }; delete y[lastMsg.from]; return y; }); }, [lastMsg?.id]);
  const left = useCountdown(g?.stageEndsAt, g?.serverNow);
  const full = !!g && (g.stage === 'chat' || g.stage === 'confirm');
  const keyboard = usePhoneViewport(full);

  if (error) return <div className="wrap stack"><TopBar back /><div className="error">{error}</div><Link className="btn" to="/">Back home</Link></div>;
  if (!g) return <div className="wrap center-screen"><div className="spinner" aria-hidden="true" /><p className="muted">Joining your table...</p></div>;
  const send = (ev, extra) => getSocket().emit(ev, { sessionId: id, ...extra });
  const typers = Object.values(typing).map((t) => t.name);

  if (g.stage === 'forming' || g.stage === 'setup') return <TableLobby g={g} send={send} left={left} />;
  if (g.stage === 'chat') return <ChatScreen g={g} send={send} left={left} keyboard={keyboard} typers={typers} />;
  if (g.stage === 'confirm') return <ConfirmScreen g={g} send={send} left={left} keyboard={keyboard} typers={typers} />;
  return <Results g={g} left={left} />;
}

// ---------- shared pieces ----------
function Progress({ stage }) {
  const idx = STAGES.indexOf(stage === 'done' ? 'wrap' : stage);
  return <div className="progress" aria-hidden="true">{STAGES.map((s, i) => <div key={s} className={i < idx ? 'on' : i === idx ? 'now' : ''} />)}</div>;
}

function AppBar({ g, left, compact }) {
  const idx = STAGES.indexOf(g.stage) + 1;
  return (
    <header className={`appbar ${compact ? 'compact' : ''}`}>
      <div className="appbar-main">
        <div className="appbar-text">
          <div className="appbar-title">{g.task.short}</div>
          <div className="appbar-sub">{g.kind === 'class' ? `Table ${g.number} · ` : ''}Step {idx} of 4: {TITLES[g.stage]}</div>
        </div>
        <div className={`timer-pill ${left <= 60 ? 'low' : ''}`} role="timer" aria-label={`${mmss(left)} left`}>{mmss(left)}</div>
      </div>
      <Progress stage={g.stage} />
    </header>
  );
}

function Sheet({ title, onClose, children }) {
  useEffect(() => { const k = (e) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grab" aria-hidden="true" />
        <div className="sheet-head"><strong>{title}</strong><button className="btn ghost small" onClick={onClose}>Close</button></div>
        <div className="sheet-body stack">{children}</div>
      </div>
    </div>
  );
}

function Avatar({ p, size }) {
  return <span className={`avatar ${p.isAI ? 'ai' : ''}`} style={{ background: p.isAI ? undefined : p.color, width: size, height: size }} aria-hidden="true">{p.isAI ? 'AI' : p.name.slice(0, 1).toUpperCase()}</span>;
}

function LimitCard({ g, send, onShared }) {
  const l = g.me.limit;
  return (
    <div className="limit-card">
      <div className="row between"><span className="label limit-label">Your private limit</span><span className="chip">{l.sharedAt !== null ? `Shared at ${msToClock(l.sharedAt)}` : 'Only you can see this'}</span></div>
      <div className="limit-body">{l.text}</div>
      {g.stage === 'confirm' && l.ok !== null && <div className={`chip ${l.ok ? 'ok' : 'warn'}`}>{l.ok ? 'This plan works with your limit' : 'This plan breaks your limit'}</div>}
      <p className="small muted" style={{ margin: 0 }}>Bring it up in the chat in your own words whenever you like, or post it with the button. It is your choice. The AI cannot see this card.</p>
      {l.sharedAt === null && ['chat', 'confirm'].includes(g.stage) && <button className="btn ghost" onClick={() => { send('game:share'); onShared?.(); }}>Post my limit to the group</button>}
    </div>
  );
}

const AI_TEXT = {
  listen: ['Listening AI', 'Reads the chat, keeps the Plan so far, and may ask the group up to two short questions. It cannot see private limits and never votes. Anyone can pause it.'],
  ask: ['Answer-only AI', 'Stays quiet unless someone asks it a question. Start a message with @AI or switch on AI next to the message box. It cannot see private limits and never votes.']
};

// ---------- stage 1: your table fills, then Set up ----------
function TableLobby({ g, send, left }) {
  const nav = useNavigate();
  const humans = g.players.filter((p) => !p.isAI);
  const forming = g.stage === 'forming';
  const empty = forming ? Math.max(0, g.target - humans.length) : 0;
  const readyN = humans.filter((p) => p.ready).length;
  const [ai, aiHelp] = AI_TEXT[g.mode];
  return (
    <div className="wrap stack page lobby">
      <header className="lobby-head">
        <div>
          <div className="label">{g.kind === 'class' ? `Table ${g.number}` : 'Your table'}</div>
          <h1 style={{ margin: '2px 0 0' }}>{g.task.title}</h1>
        </div>
        {!forming && <div className={`timer-pill ${left <= 15 ? 'low' : ''}`} role="timer">{mmss(left)}</div>}
      </header>

      <section className={`status-card ${forming ? '' : 'go'}`} aria-live="polite">
        {forming ? (
          <>
            <strong>{humans.length} of {g.target} people are here</strong>
            <span className="small">{empty > 0
              ? (g.autoStart ? `The chat starts when ${empty === 1 ? 'one more person joins' : `${empty} more people join`}, or when the host starts it.` : 'Your host will start the table soon.')
              : 'Your table is full. The host will start it soon.'}</span>
          </>
        ) : (
          <>
            <strong>Your table is starting</strong>
            <span className="small">The chat opens in {left} seconds, or as soon as everyone taps Ready ({readyN} of {humans.length} ready).</span>
          </>
        )}
      </section>

      <section className="card stack" style={{ gap: 8 }}>
        <span className="label">Your group's task</span>
        <p style={{ margin: 0, fontSize: 16 }}>{g.task.prompt}</p>
        <div className="small muted">Together you will decide:</div>
        <div className="row wrap-row" style={{ gap: 6 }}>{g.task.fields.map((f) => <span key={f.id} className="chip">{f.name}</span>)}</div>
      </section>

      <LimitCard g={g} send={send} />

      <section className="card stack" style={{ gap: 6 }}>
        <div className="row" style={{ gap: 8 }}><span className="chip ai">AI</span><strong>{ai} at this table</strong></div>
        <span className="small muted">{aiHelp}</span>
      </section>

      <section className="card stack" style={{ gap: 8 }} aria-label="People at this table">
        <span className="label">At this table</span>
        {g.players.map((p) => (
          <div key={p.pcode} className="seat">
            <Avatar p={p} /><span className="grow">{p.name}{p.isYou ? ' (you)' : ''}</span>
            {!p.isAI && <span className={`chip ${p.ready ? 'ok' : ''}`}>{p.ready ? 'Ready' : 'Reading'}</span>}
            {p.isAI && <span className="chip ai">AI player</span>}
          </div>
        ))}
        {Array.from({ length: empty }, (_, i) => <div key={i} className="seat empty"><span className="avatar empty" aria-hidden="true" /><span className="muted">Waiting for someone to join</span></div>)}
      </section>

      <div className="sticky-foot stack" style={{ gap: 8 }}>
        <button className="btn block" disabled={g.me.ready} onClick={() => send('game:ready')}>{g.me.ready ? (forming ? 'Ready. Waiting for your table to fill' : 'Ready. Waiting for the others') : 'I am ready'}</button>
        {forming && <button className="linkbtn center" onClick={async () => { await emit('table:leave', { sessionId: g.id }); nav('/'); }}>Leave this table</button>}
      </div>
    </div>
  );
}

// ---------- stage 2: chat ----------
function PlanBar({ g, send }) {
  const [open, setOpen] = useState(false);
  const paused = !!g.pausedBy;
  return (
    <section className="planbar" aria-label="Plan so far">
      <button className={`ai-status ${paused ? 'paused' : ''}`} onClick={() => setOpen(true)} aria-label="Plan so far details and AI controls">
        <span className="dot-live" aria-hidden="true" />{paused ? 'AI paused' : 'Plan so far'}
      </button>
      <div className="planbar-scroll">
        {g.panel.map((f) => (
          <button key={f.id} className={`pchip ${f.status}`} onClick={() => setOpen(true)}>
            <span className="pchip-name">{f.name}</span>
            <span className="pchip-value">{f.leaderName || 'Not discussed'}</span>
            {f.status !== 'open' && <span className="pchip-status">{STATUS[f.status][0]}</span>}
          </button>
        ))}
      </div>
      {open && (
        <Sheet title="Plan so far" onClose={() => setOpen(false)}>
          <div className="row between">
            <span className="small muted grow">{paused ? `Paused by ${g.pausedBy}. The AI is not reading new messages.` : 'The AI updates this from your chat. It never votes.'}</span>
            <button className={`btn small ${paused ? '' : 'ghost'}`} onClick={() => send('game:pause-ai', { paused: !paused })}>{paused ? 'Resume AI' : 'Pause AI'}</button>
          </div>
          {g.aiPaused && <div className="chip ai">A teammate is running the AI by hand</div>}
          {g.panel.map((f) => (
            <div key={f.id} className="plan-row">
              <div className="row between"><strong>{f.name}</strong><span className={`chip ${STATUS[f.status][1]}`}>{STATUS[f.status][0]}</span></div>
              {f.options.length ? (
                <div className="stack" style={{ gap: 2, marginTop: 6 }}>
                  {f.options.map((o) => <div key={o.option} className="small"><span style={{ fontWeight: o.option === f.leader ? 800 : 500 }}>{o.name}</span> <span className="muted">· {o.who.join(', ')}</span></div>)}
                </div>
              ) : <div className="small muted" style={{ marginTop: 6 }}>Nobody has mentioned this yet.</div>}
            </div>
          ))}
          {g.quiet.length > 0 && <div className="small muted">Not heard from yet: {g.quiet.join(', ')}</div>}
        </Sheet>
      )}
    </section>
  );
}

function ActionBar({ g, send }) {
  const [limitOpen, setLimitOpen] = useState(false);
  const humans = g.players.filter((p) => !p.isAI);
  const n = humans.filter((p) => p.confirmReady).length;
  const shared = g.me.limit.sharedAt !== null;
  return (
    <div className="actionbar">
      <button className="action limit" onClick={() => setLimitOpen(true)} aria-label="Your private limit">
        <span className="action-k">{shared ? 'Your limit · shared' : 'Your private limit'}</span>
        <span className="action-v">{g.me.limit.text}</span>
      </button>
      <button className={`action ready ${g.me.confirmReady ? 'done' : ''}`} disabled={g.me.confirmReady} onClick={() => send('game:confirm-ready')} aria-label={g.me.confirmReady ? 'Waiting for others' : 'Ready to confirm'}>
        <span className="action-k">{n} of {humans.length} ready</span>
        <span className="action-v">{g.me.confirmReady ? 'Waiting' : 'Ready to confirm'}</span>
      </button>
      {limitOpen && <Sheet title="Your private limit" onClose={() => setLimitOpen(false)}><LimitCard g={g} send={send} onShared={() => setLimitOpen(false)} /></Sheet>}
    </div>
  );
}

function ChatScreen({ g, send, left, keyboard, typers }) {
  return (
    <div className="app">
      <AppBar g={g} left={left} compact={keyboard} />
      {!keyboard && (g.mode === 'listen' ? <PlanBar g={g} send={send} /> : <div className="ask-hint"><span className="chip ai">AI</span> Answers only when asked. Turn on <strong>AI</strong> by the message box, or start with @AI.</div>)}
      <Messages g={g} send={send} typers={typers} />
      {!keyboard && <ActionBar g={g} send={send} />}
      <Composer g={g} send={send} />
    </div>
  );
}

// ---------- stage 3: confirm ----------
function ConfirmScreen({ g, send, left, keyboard, typers }) {
  const [tab, setTab] = useState('plan');
  const lastId = g.chat.length ? g.chat[g.chat.length - 1].id : 0;
  const [seen, setSeen] = useState(lastId);
  useEffect(() => { if (tab === 'chat') setSeen(lastId); }, [tab, lastId]);
  // Messages are counted by id: the server sends only the latest 80, so the list length stops growing.
  const unread = tab === 'plan' ? g.chat.filter((m) => m.id > seen && m.from !== g.me.pcode).length : 0;
  const humans = g.players.filter((p) => !p.isAI);
  const accepted = humans.filter((p) => p.accepted).length;
  const l = g.me.limit;
  return (
    <div className="app">
      <AppBar g={g} left={left} compact={keyboard} />
      {!keyboard && (
        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'plan'} className={tab === 'plan' ? 'on' : ''} onClick={() => setTab('plan')}>Final plan</button>
          <button role="tab" aria-selected={tab === 'chat'} className={tab === 'chat' ? 'on' : ''} onClick={() => setTab('chat')}>Chat{unread ? <span className="dot">{unread}</span> : null}</button>
        </div>
      )}
      {tab === 'chat' ? <><Messages g={g} send={send} typers={typers} /><Composer g={g} send={send} /></> : (
        <>
          <div className="scroll-area stack">
            <div className="row between"><h2 style={{ margin: 0 }}>Final plan</h2><span className={`chip ${g.complete ? 'ok' : 'warn'}`}>{g.complete ? 'Complete' : `${g.task.fields.filter((f) => !g.plan[f.id]).length} left to choose`}</span></div>
            <p className="small muted" style={{ margin: 0 }}>Anyone can change a choice. A change clears everyone's Accept, so talk it over in Chat first.</p>
            {g.task.fields.map((f) => (
              <div key={f.id} className="card stack" style={{ gap: 8 }}>
                <strong>{f.name}</strong>
                <div className="pick" role="group" aria-label={f.name}>
                  {f.options.map((o) => <button key={o.id} className={g.plan[f.id] === o.id ? 'on' : ''} aria-pressed={g.plan[f.id] === o.id} disabled={!!g.deal} onClick={() => send('game:set', { field: f.id, option: o.id })}>{o.name}</button>)}
                </div>
              </div>
            ))}
            <div className={`limit-check ${l.ok === false ? 'bad' : l.ok ? 'good' : ''}`}>
              <span className="label limit-label">Your private limit</span>
              <span>{l.text}</span>
              <strong className="small">{l.ok === null ? 'Choose every part to check it.' : l.ok ? 'This plan works with your limit.' : 'This plan breaks your limit.'}</strong>
            </div>
          </div>
          <div className="footbar stack" style={{ gap: 10 }}>
            <div className="row between">
              <div className="row" style={{ gap: 4 }}>{humans.map((p) => <span key={p.pcode} className={`face ${p.accepted ? 'yes' : ''}`} title={p.name}><Avatar p={p} size={28} /></span>)}</div>
              <strong className="small">{accepted} of {humans.length} accepted</strong>
            </div>
            <button className={`btn block ${g.me.accepted ? 'ghost' : ''}`} disabled={!!g.deal || (!g.me.accepted && !g.complete)} onClick={() => send('game:accept', { value: !g.me.accepted })}>
              {g.deal ? 'Plan locked' : g.me.accepted ? 'Withdraw my acceptance' : g.complete ? 'Accept this plan' : 'Choose every part first'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ---------- messages and the message box ----------
function Messages({ g, send, typers }) {
  const box = useRef(null);
  const atBottom = useRef(true);
  const [newBelow, setNewBelow] = useState(false);
  const last = g.chat[g.chat.length - 1];
  useLayoutEffect(() => {
    const el = box.current; if (!el) return;
    if (atBottom.current || last?.from === g.me.pcode) { el.scrollTop = el.scrollHeight; setNewBelow(false); } else setNewBelow(true);
  }, [last?.id, g.bookings, typers.length]);
  // keep the newest message in view when the keyboard opens and the list gets shorter
  useEffect(() => {
    const el = box.current; if (!el || !window.ResizeObserver) return;
    const ro = new ResizeObserver(() => { if (atBottom.current) el.scrollTop = el.scrollHeight; });
    ro.observe(el); return () => ro.disconnect();
  }, []);
  const byCode = Object.fromEntries(g.players.map((p) => [p.pcode, p]));
  return (
    <div className="messages-wrap">
      <div className="messages" ref={box} aria-live="polite" onScroll={(e) => { const el = e.currentTarget; atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60; if (atBottom.current) setNewBelow(false); }}>
        {g.chat.map((m, i) => {
          if (m.kind === 'booking') return <BookingCard key={m.id} b={(g.bookings || []).find((x) => x.id === m.bookingId)} send={send} />;
          if (m.kind === 'system') return <div key={m.id} className="m-system">{m.text}</div>;
          const prev = g.chat[i - 1];
          const mine = m.from === g.me.pcode;
          const first = !prev || prev.from !== m.from || prev.kind === 'system' || prev.kind === 'booking' || m.kind !== prev.kind;
          const p = byCode[m.from];
          if (m.kind === 'ai' || m.kind === 'private') {
            return (
              <div key={m.id} className={`m-row ai ${first ? 'first' : ''}`}>
                {first ? <span className="avatar ai" aria-hidden="true">AI</span> : <span className="avatar-gap" />}
                <div className="bubble ai">{first && <div className="m-name">AI{m.kind === 'private' ? <span className="only-you">Only you see this</span> : null}</div>}{m.text}</div>
              </div>
            );
          }
          const label = m.kind === 'limit' ? 'shared a private limit' : m.kind === 'question' ? 'asked the AI' : null;
          return (
            <div key={m.id} className={`m-row ${mine ? 'mine' : ''} ${first ? 'first' : ''}`}>
              {!mine && (first && p ? <Avatar p={p} /> : <span className="avatar-gap" />)}
              <div className={`bubble ${mine ? 'mine' : ''} ${m.kind}`}>
                {(first || label) && !mine && <div className="m-name" style={{ color: p?.color }}>{m.name}{label ? <span className="m-tag"> {label}</span> : null}</div>}
                {mine && label && <div className="m-name m-tag">You {label}</div>}
                {m.text}
              </div>
            </div>
          );
        })}
        {typers.length > 0 && <div className="typing" aria-live="off"><span className="typing-dots" aria-hidden="true"><i /><i /><i /></span>{typers.join(', ')} {typers.length === 1 ? 'is' : 'are'} typing</div>}
      </div>
      {newBelow && <button className="new-below" onClick={() => { box.current.scrollTop = box.current.scrollHeight; setNewBelow(false); }}>New messages</button>}
    </div>
  );
}

function Composer({ g, send }) {
  const [text, setText] = useState('');
  const [askAI, setAskAI] = useState(false);
  const input = useRef(null);
  const lastTyping = useRef(0);
  const go = () => {
    const t = text.trim(); if (!t) return;
    send(askAI ? 'game:ask' : 'game:chat', { text: t });
    setText(''); setAskAI(false);
    input.current?.focus(); // keep the keyboard open between messages
  };
  return (
    <form className="composer" onSubmit={(e) => { e.preventDefault(); go(); }}>
      <button type="button" className={`ai-toggle ${askAI ? 'on' : ''}`} aria-pressed={askAI} aria-label="Ask AI" onMouseDown={(e) => e.preventDefault()} onClick={() => { setAskAI(!askAI); input.current?.focus(); }}>AI</button>
      <input ref={input} type="text" value={text} maxLength={300} aria-label="Message" enterKeyHint="send" autoComplete="off" autoCorrect="on"
        placeholder={askAI ? 'Ask the AI a question' : 'Message your group'}
        onChange={(e) => { setText(e.target.value); if (Date.now() - lastTyping.current > 2000) { lastTyping.current = Date.now(); send('game:typing'); } }} />
      <button className="send" aria-label="Send" disabled={!text.trim()} onMouseDown={(e) => e.preventDefault()}>
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M4 12l16-8-6 16-2.5-6.5L4 12z" fill="currentColor" /></svg>
      </button>
    </form>
  );
}

const BOOK_STATUS = { pending: ['Waiting for everyone', ''], booked: ['Booked (demo)', 'ok'], declined: ['Not booked', 'warn'] };
function BookingCard({ b, send }) {
  if (!b) return null;
  const [label, tone] = BOOK_STATUS[b.status];
  return (
    <div className="booking" role="group" aria-label={`Booking: ${b.title}`}>
      <div className="row between" style={{ gap: 6 }}>
        <span className="row" style={{ gap: 6 }}><span className="avatar ai small" aria-hidden="true">AI</span><strong>{b.kind === 'ride' ? 'Ride request' : 'Table request'}</strong></span>
        <span className={`chip ${tone}`}>{label}</span>
      </div>
      <div className="booking-title">{b.title}</div>
      {b.details.map((d) => <div key={d} className="small muted">{d}</div>)}
      <div className="booking-split">Split {b.n} ways: <strong>${b.perPerson.toFixed(2)} each</strong></div>
      {b.status === 'pending' && (b.mine === null
        ? <div className="row" style={{ gap: 8 }}>
            <button className="btn small grow" onClick={() => send('game:booking', { bookingId: b.id, value: true })}>Price looks right</button>
            <button className="btn ghost small grow" onClick={() => send('game:booking', { bookingId: b.id, value: false })}>Not for me</button>
          </div>
        : <div className="small muted">You answered. Waiting for: {b.waiting.join(', ') || 'no one'}.</div>)}
      {b.status === 'booked' && <div className="small">Confirmation {b.code}. Payment requests sent. Nothing was really booked or charged in this demo.</div>}
      {b.status === 'declined' && <div className="small muted">Someone said the price does not work, so nothing was booked.</div>}
      <div className="small muted">Approved: {b.approved.length ? b.approved.join(', ') : 'nobody yet'}</div>
    </div>
  );
}

// ---------- stage 4: results ----------
function Results({ g, left }) {
  const nav = useNavigate();
  const plan = g.deal ? g.deal.plan : g.plan;
  const name = (f) => f.options.find((o) => o.id === plan[f.id])?.name || 'Not chosen';
  const o = g.outcome;
  return (
    <div className="wrap stack page">
      <header className="lobby-head">
        <div><div className="label">{g.kind === 'class' ? `Table ${g.number} · ` : ''}{g.stage === 'done' ? 'Finished' : 'Wrap up'}</div><h1 style={{ margin: '2px 0 0' }}>{g.deal ? 'Your group made a plan' : 'No plan this time'}</h1></div>
        {g.stage === 'wrap' && <div className="timer-pill">{mmss(left)}</div>}
      </header>
      <section className={`result-card ${g.deal ? 'good' : ''}`}>
        <span className="small">{g.deal ? `Everyone accepted at ${msToClock(g.deal.t)}.` : 'Time ran out before everyone accepted a complete plan.'}</span>
        {g.task.fields.map((f) => <div key={f.id} className="row between"><span className="muted small">{f.name}</span><strong>{name(f)}</strong></div>)}
      </section>
      {o && (
        <div className="stats">
          <div className="stat"><strong>{o.surfaced} of {o.of}</strong><span>private limits came up{o.deal ? ' before the plan locked' : ''}</span></div>
          {o.complete && <div className="stat"><strong>{o.respected} of {o.of}</strong><span>people's limits the plan respects</span></div>}
        </div>
      )}
      <div className="label">What everyone was holding</div>
      {g.players.map((p) => {
        const t = Math.min(p.limitSharedAt ?? Infinity, p.limitMentionedAt ?? Infinity);
        return (
          <div key={p.pcode} className="card stack reveal" style={{ gap: 6 }}>
            <div className="row" style={{ gap: 8 }}><Avatar p={p} size={28} /><strong className="grow">{p.name}{p.isYou ? ' (you)' : ''}</strong><span className={`chip ${t < Infinity ? 'ok' : ''}`}>{t < Infinity ? `Came up at ${msToClock(t)}` : 'Never came up'}</span></div>
            <div className="small">{p.limit}</div>
            {p.limitOk !== null && <div className="small" style={p.limitOk ? { color: 'var(--primary)', fontWeight: 700 } : { color: 'var(--warn)', fontWeight: 700 }}>{p.limitOk ? 'The plan works with this limit.' : 'The plan breaks this limit.'}</div>}
          </div>
        );
      })}
      <Feedback g={g} />
      <div className="row"><button className="btn ghost grow" onClick={() => nav('/quick')}>Play again</button><Link className="btn ghost grow" to="/">Home</Link></div>
    </div>
  );
}

function Feedback({ g }) {
  const [f, setF] = useState({ aiHelpful: 0, aiAmount: '', playAgain: '', comment: '' });
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  if (sent) return <div className="card thanks"><strong>Thank you.</strong> Your answers help our class project.{g.surveyUrl && <> Please also fill in the <a href={g.surveyUrl} target="_blank" rel="noreferrer">short survey</a>.</>}</div>;
  const pick = (k, opts) => <div className="pick even">{opts.map(([v, label]) => <button key={v} className={f[k] === v ? 'on' : ''} aria-pressed={f[k] === v} onClick={() => setF({ ...f, [k]: v })}>{label}</button>)}</div>;
  return (
    <section className="card stack">
      <h2 style={{ margin: 0 }}>Three quick questions</h2>
      <div className="stack" style={{ gap: 6 }}><span className="q">How much did the AI help your group?</span>
        <div className="scale">{[1, 2, 3, 4, 5].map((n) => <button key={n} className={f.aiHelpful === n ? 'on' : ''} aria-pressed={f.aiHelpful === n} onClick={() => setF({ ...f, aiHelpful: n })}>{n}</button>)}</div>
        <div className="row between small muted"><span>Not at all</span><span>A lot</span></div></div>
      <div className="stack" style={{ gap: 6 }}><span className="q">The AI spoke up...</span>
        {pick('aiAmount', [['too_little', 'Too little'], ['about_right', 'About right'], ['too_much', 'Too much']])}</div>
      <div className="stack" style={{ gap: 6 }}><span className="q">Would you use this again?</span>
        {pick('playAgain', [['yes', 'Yes'], ['maybe', 'Maybe'], ['no', 'No']])}</div>
      <label className="field small">Anything else? (optional)<textarea value={f.comment} maxLength={1000} onChange={(e) => setF({ ...f, comment: e.target.value })} /></label>
      {error && <div className="error">{error}</div>}
      <button className="btn" disabled={!f.aiHelpful || !f.aiAmount || !f.playAgain} onClick={async () => { try { await api('/api/feedback', { sessionId: g.id, ...f }); setSent(true); } catch (e) { setError(e.message); } }}>Send feedback</button>
      {g.surveyUrl && <a href={g.surveyUrl} target="_blank" rel="noreferrer" className="small">Open the full feedback survey</a>}
    </section>
  );
}
