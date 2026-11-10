import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, emit, getSocket, msToClock, mmss, useCountdown, useSocketEvent } from '../lib.js';
import TopBar from '../components/Brand.jsx';
import { MapCard, RideCard, TableCard, PlanCard } from '../components/Cards.jsx';

// The flow is three steps: Briefing (your table fills while you read the task and your private limit),
// Chat (no timer; the plan locks when everyone accepts it), and Results.
const STATUS = { open: 'Open', split: 'Undecided', leaning: 'Leaning', agreed: 'Most agree' };

// ---------- phone viewport ----------
// The chat screen is pinned to the visual viewport: the part of the screen above the on-screen keyboard.
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
  useSocketEvent('game:state', useCallback((s) => { if (s.id === id) setG({ ...s, clockOffset: s.serverNow - Date.now() }); }, [id]));
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
  const keyboard = usePhoneViewport(!!g && g.stage === 'chat');

  if (error) return <div className="wrap stack"><TopBar back /><div className="error">{error}</div><Link className="btn" to="/">Back home</Link></div>;
  if (!g) return <div className="wrap center-screen"><div className="spinner" aria-hidden="true" /><p className="muted">Joining your table...</p></div>;
  const send = (ev, extra) => getSocket().emit(ev, { sessionId: id, ...extra });

  if (g.stage === 'chat') return <ChatScreen g={g} send={send} keyboard={keyboard} typers={Object.values(typing).map((t) => t.name)} />;
  if (g.stage === 'done') return <Results g={g} />;
  return <Briefing g={g} send={send} left={left} />;
}

// ---------- shared pieces ----------
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

const AI_HELP = {
  listen: 'The AI reads the chat, keeps the plan above it up to date, and adds a map or a price when it helps. It never votes.',
  ask: 'The AI at this table stays quiet unless you ask it. Turn on the AI button next to the message box, or start a message with @AI. It never votes.'
};

// ---------- step 1: briefing ----------
// Three short screens while the table fills: the task, your private limit (keep it, swap it, or write your own),
// and how the chat works. Then Ready.
function Briefing({ g, send, left }) {
  const nav = useNavigate();
  const [step, setStep] = useState(0);
  const [writing, setWriting] = useState(false);
  const [own, setOwn] = useState('');
  const humans = g.players.filter((p) => !p.isAI);
  const forming = g.stage === 'forming';
  const empty = forming ? Math.max(0, g.target - humans.length) : 0;
  const l = g.me.limit;
  const status = forming ? `${humans.length} of ${g.target} here` : `Chat opens in ${mmss(left)}`;
  const head = (title, n) => (
    <header className="lobby-head">
      <div>
        <div className="label">{g.kind === 'class' ? `Table ${g.number}` : 'Your table'}{n ? ` · Step ${n} of 3` : ''}</div>
        <h1 style={{ margin: '2px 0 0' }}>{title}</h1>
      </div>
      <div className={`status-pill ${forming ? '' : 'go'}`} role="status">{status}</div>
    </header>
  );
  const dots = <div className="steps" aria-hidden="true">{[0, 1, 2].map((i) => <i key={i} className={i <= step ? 'on' : ''} />)}</div>;

  if (g.me.ready) {
    const readyN = humans.filter((p) => p.ready).length;
    return (
      <div className="wrap stack page">
        {head('You are ready')}
        <section className={`status-card ${forming ? '' : 'go'}`} aria-live="polite">
          <strong>{forming ? (empty ? `Waiting for ${empty} more ${empty === 1 ? 'person' : 'people'}` : 'Your table is full') : `${readyN} of ${humans.length} people are ready`}</strong>
          <span className="small">{forming ? (g.autoStart ? 'The chat opens as soon as your table is full and everyone is ready. Your host can also start it.' : 'Your host will start the table soon.') : `The chat opens when everyone is ready, or in ${mmss(left)} at the latest.`}</span>
        </section>
        <section className="card stack" style={{ gap: 8 }} aria-label="People at this table">
          <span className="label">At this table</span>
          {g.players.map((p) => (
            <div key={p.pcode} className="seat">
              <Avatar p={p} /><span className="grow">{p.name}{p.isYou ? ' (you)' : ''}</span>
              {p.isAI ? <span className="chip ai">AI player</span> : <span className={`chip ${p.ready ? 'ok' : ''}`}>{p.ready ? 'Ready' : 'Reading'}</span>}
            </div>
          ))}
          {Array.from({ length: empty }, (_, i) => <div key={i} className="seat empty"><span className="avatar empty" aria-hidden="true" /><span className="muted">Waiting for someone to join</span></div>)}
        </section>
        <section className="card stack" style={{ gap: 6 }}>
          <span className="label">Your task</span><span>{g.task.prompt}</span>
          <span className="label limit-label" style={{ marginTop: 6 }}>Your private limit</span><strong>{l.text}</strong>
        </section>
        {forming && <button className="linkbtn center" onClick={async () => { await emit('table:leave', { sessionId: g.id }); nav('/'); }}>Leave this table</button>}
      </div>
    );
  }

  return (
    <div className="wrap stack page">
      {step === 0 && <>
        {head(g.task.title, 1)}
        {dots}
        <section className="card stack" style={{ gap: 10 }}>
          <p style={{ margin: 0, fontSize: 16.5 }}>{g.task.prompt}</p>
          <span className="label">Together you decide</span>
          {g.task.fields.map((f) => <div key={f.id} className="decide"><strong>{f.name}</strong><span className="small muted">{f.options.map((o) => o.name).join(' · ')}</span></div>)}
        </section>
        <div className="sticky-foot"><button className="btn block" onClick={() => setStep(1)}>Next: your private limit</button></div>
      </>}

      {step === 1 && <>
        {head('Your private limit', 2)}
        {dots}
        <section className="limit-card">
          <div className="row between"><span className="label limit-label">{l.custom ? 'You wrote this one' : 'Yours for this chat'}</span><span className="chip">Only you can see this</span></div>
          <div className="limit-body">{l.text}</div>
          <p className="small muted" style={{ margin: 0 }}>The plan your group makes should work with this. Nobody else sees it unless you decide to share it during the chat.</p>
        </section>
        {writing ? (
          <section className="card stack">
            <label className="field">Write your own limit
              <textarea value={own} maxLength={140} autoFocus onChange={(e) => setOwn(e.target.value)} placeholder="Write it the way you would say it. For example: I need to be home by 9 pm." />
            </label>
            <div className="row"><button className="btn grow" disabled={own.trim().length < 8} onClick={() => { send('game:limit', { action: 'own', text: own }); setWriting(false); }}>Use this limit</button><button className="btn ghost" onClick={() => setWriting(false)}>Cancel</button></div>
          </section>
        ) : (
          <div className="row wrap-row">
            {l.canSwap && <button className="btn ghost grow" onClick={() => send('game:limit', { action: 'swap' })}>{l.custom ? 'Go back to the one I was given' : 'Give me a different one'}</button>}
            <button className="btn ghost grow" onClick={() => { setOwn(l.custom ? l.text : ''); setWriting(true); }}>Write my own</button>
          </div>
        )}
        {!writing && <div className="sticky-foot stack" style={{ gap: 4 }}>
          <button className="btn block" onClick={() => setStep(2)}>{l.custom ? 'Keep my own limit' : 'Keep this limit'}</button>
          <button className="linkbtn center" onClick={() => setStep(0)}>Back</button>
        </div>}
      </>}

      {step === 2 && <>
        {head('How the chat works', 3)}
        {dots}
        <section className="card stack how">
          <div className="how-row"><span className="how-n">1</span><span><strong>Say what you want, or tap it.</strong> Tap a part of the plan above the chat to pick an option. A tap counts the same as saying it.</span></div>
          <div className="how-row"><span className="how-n">2</span><span><strong>Your limit is yours to share.</strong> Tap "Your private limit" at any time. You can say it yourself, or ask the AI to pass it on with your name or without it.</span></div>
          <div className="how-row"><span className="how-n ai">AI</span><span>{AI_HELP[g.mode]}</span></div>
          <div className="how-row"><span className="how-n">3</span><span><strong>No timer.</strong> The plan is what most of the table wants. It locks when everyone taps Accept.</span></div>
        </section>
        <div className="sticky-foot stack" style={{ gap: 4 }}>
          <button className="btn block" onClick={() => send('game:ready')}>I am ready</button>
          <button className="linkbtn center" onClick={() => setStep(1)}>Back</button>
        </div>
      </>}
    </div>
  );
}

// ---------- step 2: chat ----------
function ChatScreen({ g, send, keyboard, typers }) {
  const [sheet, setSheet] = useState(null); // { type: 'field', id } | { type: 'board' } | { type: 'limit' } | { type: 'info' } | { type: 'accept' }
  const [draft, setDraft] = useState(null); // text placed in the message box by "Say it myself"
  const close = () => setSheet(null);
  const sayMyself = () => { setDraft({ text: g.me.limit.say, n: Date.now() }); close(); };
  const share = (mode) => { send('game:share', { mode }); close(); };
  const humans = g.players.filter((p) => !p.isAI);
  return (
    <div className="app">
      <header className={`appbar ${keyboard ? 'compact' : ''}`}>
        <div className="appbar-main">
          <div className="appbar-text">
            <div className="appbar-title">{g.task.short}</div>
            <div className="appbar-sub">{g.kind === 'class' ? `Table ${g.number} · ` : ''}{g.players.length} at the table</div>
          </div>
          <button className="btn ghost small" onClick={() => setSheet({ type: 'info' })}>Task</button>
        </div>
      </header>
      {!keyboard && <Board g={g} open={setSheet} />}
      <Messages g={g} send={send} typers={typers} sayMyself={sayMyself} share={share} onAccept={() => {
        if (g.me.accepted) return send('game:accept', { value: false });
        if (g.me.limit.custom || g.me.limit.ok === false) return setSheet({ type: 'accept' });
        send('game:accept', { value: true });
      }} />
      {!keyboard && <BottomBar g={g} send={send} open={setSheet} humans={humans} />}
      <Composer g={g} send={send} draft={draft} />

      {sheet?.type === 'field' && <FieldSheet g={g} send={send} id={sheet.id} onClose={close} />}
      {sheet?.type === 'board' && <BoardSheet g={g} send={send} onClose={close} open={setSheet} />}
      {sheet?.type === 'limit' && <LimitSheet g={g} onClose={close} sayMyself={sayMyself} share={share} />}
      {sheet?.type === 'info' && <InfoSheet g={g} send={send} onClose={close} humans={humans} />}
      {sheet?.type === 'accept' && <AcceptSheet g={g} send={send} onClose={close} open={setSheet} />}
    </div>
  );
}

// The plan, live above the chat. At listening tables the AI fills it in from the chat; taps count everywhere.
function Board({ g, open }) {
  const listen = g.mode === 'listen';
  const paused = listen && !!g.pausedBy;
  return (
    <section className="board" aria-label="The plan so far">
      <div className="planbar">
        <button className={`ai-status ${paused ? 'paused' : ''} ${listen ? '' : 'plain'}`} onClick={() => open({ type: 'board' })} aria-label="The plan so far, details">
          {listen && <span className="dot-live" aria-hidden="true" />}{paused ? 'AI paused' : listen ? 'AI is listening' : 'The plan'}
        </button>
        <div className="planbar-scroll">
          {g.panel.map((f) => (
            <button key={f.id} className={`pchip ${f.status}`} onClick={() => open({ type: 'field', id: f.id })} aria-label={`${f.name}: ${f.leaderName || 'open'}. Tap to pick.`}>
              <span className="pchip-name">{f.name}</span>
              <span className="pchip-value">{f.leaderName || 'Tap to pick'}</span>
              <span className="pchip-status">{f.status === 'open' ? 'Open' : f.status === 'agreed' ? 'Most agree' : f.status === 'split' ? 'Undecided' : `${f.count} of ${g.players.length} so far`}</span>
            </button>
          ))}
        </div>
      </div>
      {g.hearing && <button className="hearing" onClick={() => open({ type: 'board' })}><span className="hearing-k">AI hears</span><span className="hearing-v">{g.hearing}</span></button>}
    </section>
  );
}

// Options for one part of the plan: who wants what, and a tap to pick.
function Options({ g, send, id, compact }) {
  const field = g.task.fields.find((f) => f.id === id);
  const row = g.panel.find((f) => f.id === id);
  if (!field) return null;
  const who = (oid) => row?.options.find((o) => o.option === oid)?.who || [];
  const mine = g.me.prefs[id];
  return (
    <div className={`opts ${compact ? 'compact' : ''}`} role="group" aria-label={field.name}>
      {field.options.map((o) => {
        const names = who(o.id);
        const no = row?.blocked?.[o.id] || [];
        return (
          <button key={o.id} className={`opt ${mine === o.id ? 'mine' : ''} ${row?.leader === o.id && row.status === 'agreed' ? 'lead' : ''}`} aria-pressed={mine === o.id} disabled={!!g.deal}
            onClick={() => send('game:pick', { field: id, option: mine === o.id ? '' : o.id })}>
            <span className="opt-name">{o.name}</span>
            {names.length > 0 && <span className="opt-who">{names.join(', ')}</span>}
            {no.length > 0 && <span className="opt-warn">Does not work for {no.join(', ')}</span>}
            {mine === o.id && <span className="opt-check" aria-hidden="true">✓</span>}
          </button>
        );
      })}
    </div>
  );
}

function FieldSheet({ g, send, id, onClose }) {
  const row = g.panel.find((f) => f.id === id);
  return (
    <Sheet title={row?.name || 'Pick'} onClose={onClose}>
      <p className="small muted" style={{ margin: 0 }}>Tap what you want. It counts the same as saying it in the chat, and your group sees it. The plan takes what most of the table wants.</p>
      <Options g={g} send={send} id={id} />
      <div className="row between"><span className={`chip ${row?.status === 'agreed' ? 'ok' : ''}`}>{STATUS[row?.status || 'open']}</span><button className="btn small" onClick={onClose}>Done</button></div>
    </Sheet>
  );
}

function BoardSheet({ g, send, onClose, open }) {
  const listen = g.mode === 'listen';
  const paused = !!g.pausedBy;
  return (
    <Sheet title="The plan so far" onClose={onClose}>
      {listen && (
        <div className="row between">
          <span className="small muted grow">{paused ? `Paused by ${g.pausedBy}. The AI is not reading new messages. Taps still count.` : 'The AI updates this from your chat. It never votes.'}</span>
          <button className={`btn small ${paused ? '' : 'ghost'}`} onClick={() => send('game:pause-ai', { paused: !paused })}>{paused ? 'Resume AI' : 'Pause AI'}</button>
        </div>
      )}
      {!listen && <p className="small muted" style={{ margin: 0 }}>At this table the plan fills in from taps. Tap a part to pick what you want.</p>}
      {g.aiPaused && <div className="chip ai">A teammate is running the AI by hand</div>}
      {g.hearing && <div className="hearing-full"><span className="label">What the AI is hearing</span><span>{g.hearing}</span></div>}
      {g.panel.map((f) => (
        <button key={f.id} className="plan-row tap" onClick={() => open({ type: 'field', id: f.id })}>
          <div className="row between"><strong>{f.name}</strong><span className={`chip ${f.status === 'agreed' ? 'ok' : f.status === 'split' ? 'warn' : ''}`}>{STATUS[f.status]}</span></div>
          {f.options.length ? (
            <div className="stack" style={{ gap: 2, marginTop: 6 }}>
              {f.options.map((o) => <div key={o.option} className="small"><span style={{ fontWeight: o.option === f.leader ? 800 : 500 }}>{o.name}</span> <span className="muted">· {o.who.join(', ')}</span></div>)}
            </div>
          ) : <div className="small muted" style={{ marginTop: 6 }}>Nobody has picked this yet. Tap to pick.</div>}
        </button>
      ))}
      {g.quiet.length > 0 && <div className="small muted">Not heard from yet: {g.quiet.join(', ')}</div>}
    </Sheet>
  );
}

// The three ways to let the group know about your limit.
function ShareOptions({ sayMyself, share }) {
  return (
    <div className="share-opts">
      <button className="share-opt" onClick={sayMyself}><strong>Say it myself</strong><span>Puts a draft in your message box. Change the words if you like, then send.</span></button>
      <button className="share-opt" onClick={() => share('named')}><strong>AI passes it on, with my name</strong><span>The AI tells the group for you, right now.</span></button>
      <button className="share-opt" onClick={() => share('anon')}><strong>AI passes it on, without my name</strong><span>The group learns the limit, but not whose it is.</span></button>
    </div>
  );
}

function LimitSheet({ g, onClose, sayMyself, share }) {
  const l = g.me.limit;
  const shared = l.sharedAt !== null;
  return (
    <Sheet title="Your private limit" onClose={onClose}>
      <div className="limit-body">{l.text}</div>
      {l.custom ? <div className="small muted">You wrote this one, so only you can tell whether a plan fits it.</div>
        : l.now === 'breaks' ? <div className="warnline">The plan so far breaks this limit{shared ? '.' : ', and the group does not know.'}</div>
        : l.now === 'fits' ? <div className="okline">The plan so far works with this limit.</div> : null}
      {shared ? (
        <div className="okline">{l.via === 'self' ? 'You told the group yourself' : l.anon ? 'The AI passed it on without your name' : 'The AI passed it on with your name'} at {msToClock(l.sharedAt)}.</div>
      ) : (
        <>
          <span className="label">Let the group know</span>
          <ShareOptions sayMyself={sayMyself} share={share} />
          <p className="small muted" style={{ margin: 0 }}>It stays private until you choose one of these. Sharing is your choice.</p>
        </>
      )}
    </Sheet>
  );
}

function InfoSheet({ g, send, onClose, humans }) {
  const ending = humans.filter((p) => p.wantsEnd).length;
  return (
    <Sheet title={g.task.title} onClose={onClose}>
      <p style={{ margin: 0 }}>{g.task.prompt}</p>
      <div className="small muted">{AI_HELP[g.mode]}</div>
      <span className="label">At this table</span>
      {g.players.map((p) => (
        <div key={p.pcode} className="seat">
          <Avatar p={p} /><span className="grow">{p.name}{p.isYou ? ' (you)' : ''}{p.limit && !p.isYou ? <><br /><span className="small muted">Shared: {p.limit}</span></> : null}</span>
          {p.isAI ? <span className="chip ai">AI player</span> : p.away ? <span className="chip warn">Away</span> : null}
        </div>
      ))}
      <div className="plan-row stack" style={{ gap: 8 }}>
        <span className="small muted">There is no timer. If your group cannot agree, you can end without a plan once every person asks to ({ending} of {humans.length} so far).</span>
        <button className="btn ghost small" onClick={() => send('game:end-vote', { value: !g.me.wantsEnd })}>{g.me.wantsEnd ? 'Keep planning instead' : 'End without a plan'}</button>
      </div>
    </Sheet>
  );
}

// Above the message box: your private limit on the left, the plan's progress and Accept on the right.
function BottomBar({ g, send, open, humans }) {
  const l = g.me.limit;
  const shared = l.sharedAt !== null;
  const alert = !shared && l.now === 'breaks';
  const set = g.panel.filter((f) => f.status === 'agreed').length;
  const accepted = humans.filter((p) => p.accepted).length;
  const accept = () => {
    if (g.me.accepted) return send('game:accept', { value: false });
    if (l.custom || l.ok === false) return open({ type: 'accept' });
    send('game:accept', { value: true });
  };
  return (
    <div className="actionbar">
      <button className={`action limit ${alert ? 'alert' : ''}`} onClick={() => open({ type: 'limit' })} aria-label="Your private limit">
        <span className="action-k">{shared ? 'Your limit · shared' : alert ? 'Your limit · the plan breaks it' : 'Your limit · tap to share'}</span>
        <span className="action-v">{l.text}</span>
      </button>
      {g.deal ? <div className="action ready done"><span className="action-k">Done</span><span className="action-v">Plan locked</span></div>
        : g.complete ? (
          <button className={`action ready ${g.me.accepted ? 'done' : ''}`} onClick={accept} aria-label={g.me.accepted ? 'Withdraw my acceptance' : 'Accept the plan'}>
            <span className="action-k">{accepted} of {humans.length} accepted</span>
            <span className="action-v">{g.me.accepted ? 'Accepted' : 'Accept plan'}</span>
          </button>
        ) : (
          <button className="action ready wait" onClick={() => open({ type: 'board' })} aria-label="Plan progress">
            <span className="action-k">Plan</span>
            <span className="action-v">{set} of {g.panel.length} set</span>
          </button>
        )}
    </div>
  );
}

// Shown before accepting when the plan breaks your limit, or when you wrote your own limit and only you can judge.
function AcceptSheet({ g, send, onClose, open }) {
  const l = g.me.limit;
  const go = (fits) => { send('game:accept', { value: true, fits }); onClose(); };
  return (
    <Sheet title="Accept this plan?" onClose={onClose}>
      <div className="plan-row">{g.task.fields.map((f) => <div key={f.id} className="row between"><span className="small muted">{f.name}</span><strong>{f.options.find((o) => o.id === g.plan[f.id])?.name}</strong></div>)}</div>
      <div className="limit-body">{l.text}</div>
      {l.custom ? (
        <>
          <span>Does this plan fit the limit you wrote?</span>
          <button className="btn" onClick={() => go(true)}>Yes, it fits. Accept</button>
          <button className="btn ghost" onClick={() => go(false)}>It does not fit, but accept anyway</button>
        </>
      ) : (
        <>
          <div className="warnline">This plan breaks your limit.</div>
          <button className="btn" onClick={() => open({ type: 'limit' })}>Tell the group first</button>
          <button className="btn ghost" onClick={() => go(false)}>Accept anyway</button>
        </>
      )}
    </Sheet>
  );
}

// ---------- messages and the message box ----------
function Messages({ g, send, typers, sayMyself, share, onAccept }) {
  const box = useRef(null);
  const atBottom = useRef(true);
  const [newBelow, setNewBelow] = useState(false);
  const last = g.chat[g.chat.length - 1];
  useLayoutEffect(() => {
    const el = box.current; if (!el) return;
    if (atBottom.current || last?.from === g.me.pcode) { el.scrollTop = el.scrollHeight; setNewBelow(false); } else setNewBelow(true);
  }, [last?.id, g.bookings, g.maps?.length, typers.length]);
  // keep the newest message in view when the keyboard opens and the list gets shorter
  useEffect(() => {
    const el = box.current; if (!el || !window.ResizeObserver) return;
    const ro = new ResizeObserver(() => { if (atBottom.current) el.scrollTop = el.scrollHeight; });
    ro.observe(el); return () => ro.disconnect();
  }, []);
  const byCode = Object.fromEntries(g.players.map((p) => [p.pcode, p]));
  const unshared = g.me.limit.sharedAt === null;
  return (
    <div className="messages-wrap">
      <div className="messages" ref={box} aria-live="polite" onScroll={(e) => { const el = e.currentTarget; atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60; if (atBottom.current) setNewBelow(false); }}>
        {g.chat.map((m, i) => {
          if (m.kind === 'booking') {
            const b = (g.bookings || []).find((x) => x.id === m.bookingId);
            return b?.kind === 'ride' ? <RideCard key={m.id} b={b} send={send} offset={g.clockOffset} /> : <TableCard key={m.id} b={b} send={send} />;
          }
          if (m.kind === 'map') return <MapCard key={m.id} m={(g.maps || []).find((x) => x.id === m.mapId)} />;
          if (m.kind === 'plan') return <PlanCard key={m.id} g={g} m={m} onAccept={onAccept} />;
          if (m.kind === 'system') return <div key={m.id} className="m-system">{m.text}</div>;
          if (m.kind === 'pick') return <div key={m.id} className="m-pick">{m.from === g.me.pcode ? m.text.replace(m.name, 'You').replace('their pick', 'your pick') : m.text}</div>;
          const prev = g.chat[i - 1];
          const mine = m.from === g.me.pcode;
          const first = !prev || prev.from !== m.from || ['system', 'booking', 'map', 'pick', 'plan'].includes(prev.kind) || m.kind !== prev.kind;
          const p = byCode[m.from];
          if (m.kind === 'ai' || m.kind === 'private') {
            return (
              <div key={m.id} className={`m-row ai ${first ? 'first' : ''}`}>
                {first ? <span className="avatar ai" aria-hidden="true">AI</span> : <span className="avatar-gap" />}
                <div className={`bubble ai ${m.kind === 'private' ? 'private' : ''}`}>
                  {(first || m.kind === 'private') && <div className="m-name">{m.kind === 'private' ? <span className="only-you">Only you see this</span> : m.passedOn ? 'AI · passing on a limit' : 'AI'}</div>}
                  {m.text}
                  {m.poll && <Options g={g} send={send} id={m.poll} compact />}
                  {m.actions === 'limit' && unshared && <ShareOptions sayMyself={sayMyself} share={share} />}
                </div>
              </div>
            );
          }
          const label = m.kind === 'limit' ? 'shared a limit' : m.kind === 'question' ? 'asked the AI' : null;
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

function Composer({ g, send, draft }) {
  const [text, setText] = useState('');
  const [askAI, setAskAI] = useState(false);
  const [isLimit, setIsLimit] = useState(false); // the text started as the "Say it myself" draft
  const input = useRef(null);
  const lastTyping = useRef(0);
  useEffect(() => { if (draft) { setText(draft.text); setIsLimit(true); setAskAI(false); input.current?.focus(); } }, [draft?.n]);
  const go = () => {
    const t = text.trim(); if (!t) return;
    send(askAI ? 'game:ask' : 'game:chat', { text: t, limit: isLimit && !askAI });
    setText(''); setAskAI(false); setIsLimit(false);
    input.current?.focus(); // keep the keyboard open between messages
  };
  return (
    <form className="composer" onSubmit={(e) => { e.preventDefault(); go(); }}>
      {isLimit && <div className="composer-note">Draft of your limit. Change the words if you like, then send. <button type="button" className="linkbtn" onClick={() => { setText(''); setIsLimit(false); }}>Discard</button></div>}
      <div className="composer-row">
        <button type="button" className={`ai-toggle ${askAI ? 'on' : ''}`} aria-pressed={askAI} aria-label="Ask AI" onMouseDown={(e) => e.preventDefault()} onClick={() => { setAskAI(!askAI); input.current?.focus(); }}>AI</button>
        <input ref={input} type="text" value={text} maxLength={300} aria-label="Message" enterKeyHint="send" autoComplete="off" autoCorrect="on" disabled={!!g.deal}
          placeholder={askAI ? 'Ask the AI a question' : 'Message your group'}
          onChange={(e) => { setText(e.target.value); if (!e.target.value) setIsLimit(false); if (Date.now() - lastTyping.current > 2000) { lastTyping.current = Date.now(); send('game:typing'); } }} />
        <button className="send" aria-label="Send" disabled={!text.trim()} onMouseDown={(e) => e.preventDefault()}>
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M4 12l16-8-6 16-2.5-6.5L4 12z" fill="currentColor" /></svg>
        </button>
      </div>
    </form>
  );
}

// ---------- step 3: results ----------
function Results({ g }) {
  const nav = useNavigate();
  const plan = g.deal ? g.deal.plan : g.plan;
  const name = (f) => f.options.find((o) => o.id === plan[f.id])?.name || 'Not decided';
  const o = g.outcome;
  return (
    <div className="wrap stack page">
      <header className="lobby-head">
        <div><div className="label">{g.kind === 'class' ? `Table ${g.number} · ` : ''}Finished</div><h1 style={{ margin: '2px 0 0' }}>{g.deal ? 'Your group made a plan' : 'No plan this time'}</h1></div>
      </header>
      <section className={`result-card ${g.deal ? 'good' : ''}`}>
        <span className="small">{g.deal ? `Everyone accepted after ${msToClock(g.deal.t)}.` : 'The chat ended before everyone accepted a complete plan.'}</span>
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
            <div className="row" style={{ gap: 8 }}><Avatar p={p} size={28} /><strong className="grow">{p.name}{p.isYou ? ' (you)' : ''}</strong>
              <span className={`chip ${t < Infinity ? 'ok' : ''}`}>{t < Infinity ? `${p.limitAnon ? 'Shared without a name' : 'Came up'} at ${msToClock(t)}` : 'Never came up'}</span></div>
            <div className="small">{p.limit}{p.limitCustom ? ' (written by them)' : ''}</div>
            {p.limitOk !== null && <div className="small" style={p.limitOk ? { color: 'var(--primary)', fontWeight: 700 } : { color: 'var(--warn)', fontWeight: 700 }}>
              {p.limitCustom ? (p.limitOk ? 'They said the plan fits this limit.' : 'They said the plan does not fit this limit.') : (p.limitOk ? 'The plan works with this limit.' : 'The plan breaks this limit.')}</div>}
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
