import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, emit, getSocket, msToClock, mmss, useCountdown, useSocketEvent } from '../lib.js';
import TopBar from '../components/Brand.jsx';
import { PlanCard } from '../components/Cards.jsx';
import PlanBoard, { Options, PartWidget, CalendarLinks } from '../components/Board.jsx';
import { emit as emitAck } from '../lib.js';

// The flow is three steps: Briefing (your table fills while you read the task and your private limit),
// Chat (no timer; the plan locks when everyone accepts it), and Results.
const STATUS = { open: 'Open', split: 'Undecided', leaning: 'Leaning', agreed: 'Most agree' };
// "Kai: Bus or trolley": who goes their own way for a part where people may differ (Getting there).
const ownText = (own) => (own.length > 2 ? `${own.length} go their own way` : own.map((x) => `${x.name}: ${x.optionName}`).join(', '));
// What a person knows about their own situation (fine to share), and what everyone knows about the scenario.
function AboutYou({ g }) {
  if (!g.me.facts?.length) return null;
  return (
    <div className="about-you">
      {g.me.facts.map((f, i) => <div key={i} className="fact"><span className="fact-k">{f.label}</span><span>{f.text}{f.private && <span className="fact-note"> Part of your private limit.</span>}</span></div>)}
    </div>
  );
}
const GoodToKnow = ({ g }) => (g.task.info?.length ? <ul className="good-to-know">{g.task.info.map((t, i) => <li key={i}>{t}</li>)}</ul> : null);
const OwnLine = ({ own }) => (own?.length ? <span className="own-line">{own.map((x) => `${x.name}: ${x.optionName}`).join(' · ')}</span> : null);

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

// True while the connection to the server is up. A short drop (under 1.5 seconds) is not shown.
function useOnline() {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const s = getSocket(); let t = null;
    const up = () => { clearTimeout(t); setOnline(true); };
    const down = () => { clearTimeout(t); t = setTimeout(() => setOnline(false), 1500); };
    s.on('connect', up); s.on('disconnect', down);
    if (!s.connected) down();
    return () => { clearTimeout(t); s.off('connect', up); s.off('disconnect', down); };
  }, []);
  return online;
}
// A wide screen shows the plan board beside the chat; a phone opens it as a sheet.
function useWide() {
  const q = '(min-width: 1000px)';
  const [wide, setWide] = useState(() => typeof window !== 'undefined' && window.matchMedia(q).matches);
  useEffect(() => { const m = window.matchMedia(q); const f = () => setWide(m.matches); m.addEventListener('change', f); return () => m.removeEventListener('change', f); }, []);
  return wide;
}
const Offline = () => <div className="offline" role="status">Connection lost. Reconnecting...</div>;

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
  const online = useOnline();

  if (error) return <div className="wrap stack"><TopBar back /><div className="error">{error}</div><Link className="btn" to="/">Back home</Link></div>;
  if (!g) return <div className="wrap center-screen"><div className="spinner" aria-hidden="true" /><p className="muted">Joining your table...</p></div>;
  const send = (ev, extra) => getSocket().emit(ev, { sessionId: id, ...extra });

  if (g.stage === 'chat') return <ChatScreen g={g} send={send} keyboard={keyboard} online={online} typers={[...(g.aiThinking ? ['The AI'] : []), ...Object.values(typing).map((t) => t.name)]} />;
  if (g.stage === 'done') return <Results g={g} />;
  return <>{!online && <Offline />}<Briefing g={g} send={send} left={left} /></>;
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
          {g.me.facts?.length > 0 && <><span className="label" style={{ marginTop: 6 }}>About you</span><AboutYou g={g} /></>}
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
          {g.task.info?.length > 0 && <><span className="label">Good to know</span><GoodToKnow g={g} /></>}
        </section>
        <div className="sticky-foot"><button className="btn block" onClick={() => setStep(1)}>Next: your private limit</button></div>
      </>}

      {step === 1 && <>
        {head('You in this scenario', 2)}
        {dots}
        {g.me.facts?.length > 0 && <section className="card stack" style={{ gap: 8 }}>
          <div className="row between"><span className="label">About you</span><span className="chip">Fine to share</span></div>
          <AboutYou g={g} />
          <p className="small muted" style={{ margin: 0 }}>Use these when people ask. You can see them again under Task.</p>
        </section>}
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
          <div className="how-row"><span className="how-n">1</span><span><strong>Say what you want, or tap it.</strong> Tap a part of the plan above the chat to pick an option. A tap counts the same as saying it.{g.mode === 'listen' ? ' Under someone else\'s message, "Me too" picks what they asked for.' : ''}</span></div>
          <div className="how-row"><span className="how-n">2</span><span><strong>Your limit is yours to share.</strong> Tap "Your private limit" at any time. You can say it yourself, or ask the AI to pass it on with your name or without it.</span></div>
          <div className="how-row"><span className="how-n ai">AI</span><span>{AI_HELP[g.mode]} Ask it anything with the AI button: in the group, or privately so only you see the answer.</span></div>
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
function ChatScreen({ g, send, keyboard, typers, online }) {
  const [sheet, setSheet] = useState(null); // { type: 'field', id } | { type: 'board' } | { type: 'limit' } | { type: 'info' } | { type: 'accept' }
  const [draft, setDraft] = useState(null); // text placed in the message box by "Say it myself"
  const [ask, setAsk] = useState('off');    // 'off' | 'group' (everyone sees the question) | 'private' (only you do)
  const wide = useWide();
  const close = () => setSheet(null);
  const sayMyself = () => { setAsk('off'); setDraft({ text: g.me.limit.say, n: Date.now() }); close(); };
  const share = (mode) => { send('game:share', { mode }); close(); };
  const humans = g.players.filter((p) => !p.isAI);
  const onAccept = () => {
    if (g.me.accepted) return send('game:accept', { value: false });
    if (g.me.limit.custom || g.me.limit.ok === false) return setSheet({ type: 'accept' });
    send('game:accept', { value: true });
  };
  // Open the board (a sheet on a phone; already beside the chat on a wide screen) and bring one card or part into view.
  const openBoard = (target) => {
    if (!wide) setSheet({ type: 'board' });
    if (target) setTimeout(() => document.getElementById(target)?.scrollIntoView({ block: 'start', behavior: 'smooth' }), wide ? 0 : 300);
  };
  return (
    <div className={`app ${wide ? 'with-board' : ''}`}>
      <div className="chat-col">
        <header className={`appbar ${keyboard ? 'compact' : ''}`}>
          <div className="appbar-main">
            <div className="appbar-text">
              <div className="appbar-title">{g.task.short}</div>
              <div className="appbar-sub">{g.kind === 'class' ? `Table ${g.number} · ` : ''}{g.players.length} at the table</div>
            </div>
            {!wide && <button className="btn small" onClick={() => openBoard()}>Plan board</button>}
            <button className="btn ghost small" onClick={() => setSheet({ type: 'info' })}>Task</button>
          </div>
        </header>
        {!online && <Offline />}
        {!keyboard && <Board g={g} open={setSheet} openBoard={openBoard} wide={wide} />}
        <Messages g={g} send={send} typers={typers} sayMyself={sayMyself} share={share} followUp={() => setAsk('private')} openField={(id) => setSheet({ type: 'field', id })} openBoard={openBoard} onAccept={onAccept} />
        {!keyboard && <Waiting g={g} openBoard={openBoard} />}
        {!keyboard && <BottomBar g={g} send={send} open={setSheet} humans={humans} />}
        <Composer g={g} send={send} draft={draft} ask={ask} setAsk={setAsk} />
      </div>
      {wide && <aside className="board-col" aria-label="Plan board"><PlanBoard g={g} send={send} onAccept={onAccept} /></aside>}

      {sheet?.type === 'field' && <FieldSheet g={g} send={send} id={sheet.id} onClose={close} openBoard={openBoard} />}
      {sheet?.type === 'board' && <BoardSheet g={g} send={send} onClose={close} onAccept={onAccept} />}
      {sheet?.type === 'limit' && <LimitSheet g={g} onClose={close} sayMyself={sayMyself} share={share} />}
      {sheet?.type === 'info' && <InfoSheet g={g} send={send} onClose={close} humans={humans} />}
      {sheet?.type === 'accept' && <AcceptSheet g={g} send={send} onClose={close} open={setSheet} />}
    </div>
  );
}

// The plan, live above the chat. At listening tables the AI fills it in from the chat; taps count everywhere.
function Board({ g, open, openBoard, wide }) {
  const listen = g.mode === 'listen';
  const paused = listen && !!g.pausedBy;
  return (
    <section className="board" aria-label="The plan so far">
      <div className="planbar">
        <button className={`ai-status ${paused ? 'paused' : ''} ${listen ? '' : 'plain'}`} onClick={() => openBoard()} aria-label="The plan so far, details">
          {listen && <span className="dot-live" aria-hidden="true" />}{paused ? 'AI paused' : listen ? 'AI is listening' : 'The plan'}
        </button>
        <div className="planbar-scroll">
          {g.panel.map((f) => (
            <button key={f.id} className={`pchip ${f.status}`} onClick={() => open({ type: 'field', id: f.id })} aria-label={`${f.name}: ${f.leaderName || 'open'}. Tap to pick.`}>
              <span className="pchip-name">{f.name}</span>
              <span className="pchip-value">{f.leaderName || 'Tap to pick'}</span>
              <span className="pchip-status">{f.status === 'open' ? 'Open' : f.status === 'agreed' ? (f.own?.length ? ownText(f.own) : 'Most agree') : f.status === 'split' ? 'Undecided' : `${f.count} of ${g.players.length} so far`}</span>
            </button>
          ))}
        </div>
      </div>
      {g.hearing && !wide && <button className="hearing" onClick={() => openBoard()}><span className="hearing-k">AI hears</span><span className="hearing-v">{g.hearing}</span></button>}
    </section>
  );
}

function FieldSheet({ g, send, id, onClose, openBoard }) {
  const row = g.panel.find((f) => f.id === id);
  const f = g.task.fields.find((x) => x.id === id);
  const menu = (pid) => { onClose(); emitAck('game:menu', { sessionId: g.id, placeId: pid }); openBoard(`menu-${pid}`); };
  return (
    <Sheet title={row?.name || 'Pick'} onClose={onClose}>
      <p className="small muted" style={{ margin: 0 }}>{row?.personal
        ? 'Tap how you will do this. Each person can go their own way here: the plan shows what most people picked and lists anyone who differs.'
        : f?.kind === 'time' ? 'Mark every time you could make it, or tap one option. The plan takes what most of the table wants.'
        : 'Tap what you want, or add your own option. It counts the same as saying it in the chat. The plan takes what most of the table wants.'}</p>
      <PartWidget g={g} send={send} id={id} onMenu={menu} />
      <div className="row between"><span className={`chip ${row?.status === 'agreed' ? 'ok' : ''}`}>{STATUS[row?.status || 'open']}</span>
        <span className="row" style={{ gap: 6 }}><button className="btn small ghost" onClick={() => { onClose(); openBoard(`part-${id}`); }}>Whole board</button><button className="btn small" onClick={onClose}>Done</button></span></div>
    </Sheet>
  );
}

function BoardSheet({ g, send, onClose, onAccept }) {
  useEffect(() => { const k = (e) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet tall" role="dialog" aria-modal="true" aria-label="The plan so far" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grab" aria-hidden="true" />
        <div className="sheet-body stack"><PlanBoard g={g} send={send} onAccept={onAccept} onClose={onClose} /></div>
      </div>
    </div>
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
      {g.me.facts?.length > 0 && <><span className="label">About you</span><AboutYou g={g} /></>}
      {g.task.info?.length > 0 && <><span className="label">Good to know</span><GoodToKnow g={g} /></>}
      <div className="small muted">{AI_HELP[g.mode]}</div>
      <span className="label">At this table</span>
      {g.players.map((p) => (
        <div key={p.pcode} className="seat">
          <Avatar p={p} /><span className="grow">{p.name}{p.isYou ? ' (you)' : ''}{p.limit && !p.isYou ? <><br /><span className="small muted">Shared: "{p.limitSay || p.limit}"</span></> : null}</span>
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

// Shown when the AI is waiting for a private answer from you (which rides or times work), so it does not scroll away.
function Waiting({ g, openBoard }) {
  const b = (g.bookings || []).find((x) => x.status === 'asking' && x.mine === null && x.rider !== false);
  const bill = !b && (g.bills || []).find((x) => x.status === 'open' && x.rows.some((r) => r.mine && !r.paid));
  if (bill) return (
    <button className="todo-bar" onClick={() => openBoard(`bill-${bill.id}`)}><span className="only-you">Only you</span><span className="grow">You have a payment waiting on the board.</span><strong>Pay</strong></button>
  );
  if (!b) return null;
  return (
    <button className="todo-bar" onClick={() => openBoard(`booking-${b.id}`)}>
      <span className="only-you">Only you</span><span className="grow">The AI is waiting for your answer about the {b.kind === 'ride' ? 'ride' : 'table'}.</span><strong>Answer</strong>
    </button>
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
        <span className="action-k">{shared ? 'Your limit · shared' : alert ? 'Limit · plan breaks it' : 'Your limit · tap to share'}</span>
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
      <div className="plan-row">{g.task.fields.map((f) => <div key={f.id} className="row between"><span className="small muted">{f.name}</span><strong className="plan-val">{f.options.find((o) => o.id === g.plan[f.id])?.name}<OwnLine own={g.ways?.[f.id]} /></strong></div>)}</div>
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
const REACTIONS = ['👍', '❤️', '😂', '😮', '🎉', '👎'];
function Reacts({ m, send }) {
  if (!m.reacts?.length) return null;
  return <div className="reacts">{m.reacts.map((r) => <button key={r.e} className={`react ${r.mine ? 'mine' : ''}`} title={r.who.join(', ')} aria-label={`${r.e} ${r.n}, from ${r.who.join(', ')}`} onClick={() => send('game:react', { msgId: m.id, emoji: r.e })}>{r.e} {r.n}</button>)}</div>;
}
const CARD_LABEL = { ride: 'Ride', table: 'Table booking', bill: 'Who owes what', map: 'Map', route: 'Route' };
function Messages({ g, send, typers, sayMyself, share, onAccept, followUp, openField, openBoard }) {
  const [picker, setPicker] = useState(null);
  const box = useRef(null);
  const atBottom = useRef(true);
  const [newBelow, setNewBelow] = useState(0); // messages that arrived while you were reading further up
  const seenId = useRef(0);
  const last = g.chat[g.chat.length - 1];
  useLayoutEffect(() => {
    const el = box.current; if (!el) return;
    if (atBottom.current || last?.from === g.me.pcode) { el.scrollTop = el.scrollHeight; setNewBelow(0); seenId.current = last?.id || 0; }
    else setNewBelow(g.chat.filter((m) => m.id > seenId.current).length);
  }, [last?.id, g.bookings, g.bills, g.maps?.length, typers.length]);
  // keep the newest message in view when the keyboard opens and the list gets shorter
  useEffect(() => {
    const el = box.current; if (!el || !window.ResizeObserver) return;
    const ro = new ResizeObserver(() => { if (atBottom.current) el.scrollTop = el.scrollHeight; });
    ro.observe(el); return () => ro.disconnect();
  }, []);
  const byCode = Object.fromEntries(g.players.map((p) => [p.pcode, p]));
  const unshared = g.me.limit.sharedAt === null;
  return (
    <div className={`messages-wrap ${newBelow ? 'has-new' : ''}`}>
      <div className="messages" ref={box} aria-live="polite" onScroll={(e) => { const el = e.currentTarget; atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60; if (atBottom.current) { setNewBelow(0); seenId.current = last?.id || 0; } }}>
        {g.chat.map((m, i) => {
          // Cards live on the plan board; the chat keeps one line that opens them.
          if (m.kind === 'booking' || m.kind === 'bill' || m.kind === 'map') {
            const bk = m.kind === 'booking' ? (g.bookings || []).find((x) => x.id === m.bookingId) : null;
            const mp = m.kind === 'map' ? (g.maps || []).find((x) => x.id === m.mapId) : null;
            const label = bk ? CARD_LABEL[bk.kind] : m.kind === 'bill' ? CARD_LABEL.bill : mp?.kind === 'route' ? CARD_LABEL.route : CARD_LABEL.map;
            // a map of the options is the board's map of the place part; a route is its own card
            const placePart = g.board?.placeField ? `part-${g.board.placeField}` : null;
            const target = bk ? `booking-${bk.id}` : m.kind === 'bill' ? `bill-${m.billId}` : mp?.kind === 'route' || !placePart ? `map-${m.mapId}` : placePart;
            return (
              <div key={m.id} className="m-row ai first">
                <span className="avatar ai" aria-hidden="true">AI</span>
                <button className="card-ref" onClick={() => openBoard(target)}><span className="card-ref-k">{label}</span><span className="card-ref-v">{m.text}</span><span className="card-ref-go">On the board ›</span></button>
              </div>
            );
          }
          if (m.kind === 'plan') return <PlanCard key={m.id} g={g} m={m} onAccept={onAccept} />;
          if (m.kind === 'system') return <div key={m.id} className={`m-system ${m.host ? 'host' : ''}`}>{m.text}</div>;
          if (m.kind === 'pick') return <div key={m.id} className="m-pick">{m.from === g.me.pcode ? m.text.replace(m.name, 'You').replace('their pick', 'your pick') : m.text.replace(`with ${g.me.name}:`, 'with you:')}</div>;
          const prev = g.chat[i - 1];
          const mine = m.from === g.me.pcode;
          const first = !prev || prev.from !== m.from || ['system', 'booking', 'map', 'pick', 'plan'].includes(prev.kind) || m.kind !== prev.kind;
          const p = byCode[m.from];
          if (m.kind === 'ai' || m.kind === 'private') {
            // A question about one part that has since been settled folds to one line, so old polls do not look open.
            const pr = m.poll && m.kind === 'ai' && !m.answer ? g.panel.find((f) => f.id === m.poll) : null;
            if (pr?.status === 'agreed') return (
              <div key={m.id} className="m-settled">
                <span><span className="muted">{pr.name}:</span> <strong>{pr.leaderName}</strong>{pr.own?.length ? <span className="muted"> ({ownText(pr.own)})</span> : null}</span>
                {!g.deal && <button className="linkbtn" onClick={() => openField(pr.id)}>Change</button>}
              </div>
            );
            return (
              <div key={m.id} className={`m-row ai ${first ? 'first' : ''}`}>
                {first ? <span className="avatar ai" aria-hidden="true">AI</span> : <span className="avatar-gap" />}
                <div className={`bubble ai ${m.kind === 'private' ? 'private' : ''}`}>
                  {(first || m.kind === 'private') && <div className="m-name">{m.kind === 'private' ? <span className="only-you">Only you see this</span> : m.passedOn ? 'AI · passing on a limit' : 'AI'}</div>}
                  {m.text}
                  {m.poll && <Options g={g} send={send} id={m.poll} compact />}
                  {m.card === 'compare' && m.compare && <Compare c={m.compare} g={g} send={send} />}
                  {m.blocks?.map((b, k) => <Block key={k} b={b} g={g} send={send} />)}
                  {m.actions === 'limit' && unshared && <ShareOptions sayMyself={sayMyself} share={share} />}
                  {m.kind === 'private' && m.answer && !g.deal && <div className="bubble-actions"><button className="metoo" onClick={followUp}>Ask a follow-up privately</button></div>}
                  {m.board === 'tasks' && <div className="bubble-actions"><button className="metoo" onClick={() => openBoard('part-tasks')}>See the to-do list</button></div>}
                </div>
              </div>
            );
          }
          const label = m.kind === 'limit' ? 'shared a limit' : m.kind === 'question' ? (m.private ? 'asked the AI privately' : 'asked the AI') : null;
          // "Me too": the options this message asked for that you have not picked yet (listening tables).
          const more = !mine && !g.deal && m.sup ? m.sup : []; // the server sends only what would add a pick for you
          const optName = (x) => g.task.fields.find((f) => f.id === x.field)?.options.find((o) => o.id === x.option)?.name;
          return (
            <div key={m.id} className={`m-row ${mine ? 'mine' : ''} ${first ? 'first' : ''}`}>
              {!mine && (first && p ? <Avatar p={p} /> : <span className="avatar-gap" />)}
              <div className="m-col">
                <div className={`bubble ${mine ? 'mine' : ''} ${m.kind} ${m.private ? 'private-q' : ''}`} onClick={(e) => { if (!m.private && !g.deal && e.target.tagName !== 'BUTTON') setPicker(picker === m.id ? null : m.id); }}>
                  {(first || label) && !mine && <div className="m-name" style={{ color: p?.color }}>{m.name}{label ? <span className="m-tag"> {label}</span> : null}</div>}
                  {mine && label && <div className="m-name m-tag">You {label}{m.private && <span className="only-you">Only you see this</span>}</div>}
                  {m.text}
                  {more.length > 0 && <div className="bubble-actions"><button className="metoo" onClick={() => send('game:metoo', { msgId: m.id })}>Me too: {more.map(optName).join(', ')}</button></div>}
                </div>
                {picker === m.id && <div className="react-picker" role="group" aria-label="React">{REACTIONS.map((e) => <button key={e} aria-label={`React ${e}`} onClick={() => { send('game:react', { msgId: m.id, emoji: e }); setPicker(null); }}>{e}</button>)}</div>}
                <Reacts m={m} send={send} />
                {m.saved?.length > 0 && <div className="saved" title="What the AI saved from this message">Saved: {m.saved.join(' · ')}</div>}
              </div>
            </div>
          );
        })}
        {typers.length > 0 && <div className="typing" aria-live="off"><span className="typing-dots" aria-hidden="true"><i /><i /><i /></span>{typers.length === 1 && typers[0] === 'The AI' ? 'The AI is working on an answer' : `${typers.join(', ')} ${typers.length === 1 ? 'is' : 'are'} typing`}</div>}
      </div>
      {newBelow > 0 && <button className="new-below" onClick={() => { box.current.scrollTop = box.current.scrollHeight; setNewBelow(0); }}>{newBelow === 1 ? '1 new message' : `${newBelow} new messages`} <span aria-hidden="true">↓</span></button>}
    </div>
  );
}

// "@AI pros and cons": each option with its pros and cons, and a button to pick it.
function Compare({ c, g, send }) {
  const find = (name) => {
    for (const f of g.task.fields) { if (c.field && f.id !== c.field) continue; const o = f.options.find((x) => x.name.toLowerCase() === name.toLowerCase()); if (o) return { f, o }; }
    return null;
  };
  return (
    <div className="compare" role="group" aria-label={c.title}>
      {c.items.map((x) => {
        const hit = find(x.name), opt = hit?.o, fid = hit?.f.id, mine = fid ? g.me.prefs[fid] : null;
        return (
          <div key={x.name} className="cmp-item">
            <div className="row between"><strong>{x.name}</strong>
              {opt && !g.deal && <button className={`btn small ${mine === opt.id ? '' : 'ghost'}`} aria-pressed={mine === opt.id} onClick={() => send('game:pick', { field: fid, option: mine === opt.id ? '' : opt.id })}>{mine === opt.id ? 'Picked' : 'Pick'}</button>}
            </div>
            {x.pros.map((t, i) => <div key={`p${i}`} className="cmp pro"><span aria-hidden="true">+</span><span className="sr-only">Pro: </span>{t}</div>)}
            {x.cons.map((t, i) => <div key={`c${i}`} className="cmp con"><span aria-hidden="true">−</span><span className="sr-only">Con: </span>{t}</div>)}
          </div>
        );
      })}
    </div>
  );
}

// One part of an @AI answer: a list, steps, a table, or pros and cons.
function Block({ b, g, send }) {
  if (b.type === 'compare') return <Compare c={{ title: b.title || 'Pros and cons', items: b.items }} g={g} send={send} />;
  return (
    <div className={`blk blk-${b.type}`} role="group" aria-label={b.title || b.type}>
      {b.title && <div className="blk-title">{b.title}</div>}
      {b.type === 'list' && <ul>{b.items.map((x, i) => <li key={i}>{x}</li>)}</ul>}
      {b.type === 'links' && <ul className="links">{b.items.map((x, i) => <li key={i}><a href={x.url} target="_blank" rel="noreferrer noopener">{x.title}</a></li>)}</ul>}
      {b.type === 'steps' && <ol>{b.items.map((x, i) => <li key={i}>{x}</li>)}</ol>}
      {b.type === 'table' && (
        <div className="blk-scroll"><table>
          <thead><tr>{b.columns.map((c, i) => <th key={i}>{c}</th>)}</tr></thead>
          <tbody>{b.rows.map((r, i) => <tr key={i}>{b.columns.map((_, j) => <td key={j}>{r[j] || ''}</td>)}</tr>)}</tbody>
        </table></div>
      )}
    </div>
  );
}

// The message box. The AI button switches it to asking the AI: in the group (everyone sees the question and the
// answer) or privately (only you see either). Typing "@AI" in a normal message also asks in the group.
function Composer({ g, send, draft, ask, setAsk }) {
  const [text, setText] = useState('');
  const [isLimit, setIsLimit] = useState(false); // the text started as the "Say it myself" draft
  const input = useRef(null);
  const lastTyping = useRef(0);
  const lastKind = useRef('group');                // how this person last asked the AI
  useEffect(() => { if (draft) { setText(draft.text); setIsLimit(true); input.current?.focus(); } }, [draft?.n]);
  useEffect(() => { if (ask !== 'off') { lastKind.current = ask; setIsLimit(false); input.current?.focus(); } }, [ask]);
  const go = () => {
    const t = text.trim(); if (!t) return;
    if (ask !== 'off') send('game:ask', { text: t, private: ask === 'private' });
    else send('game:chat', { text: t, limit: isLimit });
    setText(''); setAsk('off'); setIsLimit(false);
    input.current?.focus(); // keep the keyboard open between messages
  };
  return (
    <form className="composer" onSubmit={(e) => { e.preventDefault(); go(); }}>
      {isLimit && ask === 'off' && <div className="composer-note">Draft of your limit. Change the words if you like, then send. <button type="button" className="linkbtn" onClick={() => { setText(''); setIsLimit(false); }}>Discard</button></div>}
      {ask !== 'off' && (
        <div className="composer-note ask" role="radiogroup" aria-label="Who sees your question to the AI">
          <span>Ask the AI</span>
          <span className="seg">
            <button type="button" role="radio" aria-checked={ask === 'group'} className={ask === 'group' ? 'on' : ''} onMouseDown={(e) => e.preventDefault()} onClick={() => setAsk('group')}>Everyone sees it</button>
            <button type="button" role="radio" aria-checked={ask === 'private'} className={ask === 'private' ? 'on' : ''} onMouseDown={(e) => e.preventDefault()} onClick={() => setAsk('private')}>Only I see it</button>
          </span>
        </div>
      )}
      <div className="composer-row">
        <button type="button" className={`ai-toggle ${ask !== 'off' ? 'on' : ''}`} aria-pressed={ask !== 'off'} aria-label="Ask AI" onMouseDown={(e) => e.preventDefault()} onClick={() => setAsk(ask === 'off' ? lastKind.current : 'off')}>AI</button>
        <input ref={input} type="text" value={text} maxLength={300} aria-label="Message" enterKeyHint="send" autoComplete="off" autoCorrect="on" disabled={!!g.deal}
          placeholder={ask === 'private' ? 'Ask the AI privately' : ask === 'group' ? 'Ask the AI in the group' : 'Message, or @AI to ask'}
          onChange={(e) => {
            setText(e.target.value); if (!e.target.value) setIsLimit(false);
            // nobody sees "typing" while you write a private question
            if (ask !== 'private' && Date.now() - lastTyping.current > 2000) { lastTyping.current = Date.now(); send('game:typing'); }
          }} />
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
        {g.task.fields.map((f) => <div key={f.id} className="row between"><span className="muted small">{f.name}</span><strong className="plan-val">{name(f)}<OwnLine own={g.ways?.[f.id]} /></strong></div>)}
        {g.deal && <CalendarLinks g={g} plan={plan} />}
      </section>
      {g.board?.todos?.length > 0 && <section className="card stack" style={{ gap: 6 }}><span className="label">To-do</span>{g.board.todos.map((t) => <div key={t.id} className="small">{t.done ? '✓ ' : '○ '}{t.text}{t.ownerName ? <span className="muted"> · {t.mine ? 'you' : t.ownerName}</span> : null}</div>)}</section>}
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
  const [f, setF] = useState({ aiHelpful: 0, aiAmount: '', planOk: 0, comfort: 0, inCharge: 0, playAgain: '', comment: '' });
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  if (sent) return <div className="card thanks"><strong>Thank you.</strong> Your answers help our class project.{g.surveyUrl && <> Please also fill in the <a href={g.surveyUrl} target="_blank" rel="noreferrer">short survey</a>.</>}</div>;
  const pick = (k, opts) => <div className="pick even">{opts.map(([v, label]) => <button key={v} className={f[k] === v ? 'on' : ''} aria-pressed={f[k] === v} onClick={() => setF({ ...f, [k]: v })}>{label}</button>)}</div>;
  const scale = (k, q, lo, hi) => (
    <div className="stack" style={{ gap: 6 }} role="group" aria-label={q}><span className="q">{q}</span>
      <div className="scale">{[1, 2, 3, 4, 5].map((n) => <button key={n} className={f[k] === n ? 'on' : ''} aria-pressed={f[k] === n} aria-label={`${q} ${n} of 5`} onClick={() => setF({ ...f, [k]: n })}>{n}</button>)}</div>
      <div className="row between small muted"><span>{lo}</span><span>{hi}</span></div></div>
  );
  const done = f.aiHelpful && f.aiAmount && f.comfort && f.inCharge && f.playAgain && (!g.deal || f.planOk);
  return (
    <section className="card stack">
      <h2 style={{ margin: 0 }}>Six quick taps</h2>
      {scale('aiHelpful', 'How much did the AI help your group?', 'Not at all', 'A lot')}
      <div className="stack" style={{ gap: 6 }}><span className="q">The AI spoke up...</span>
        {pick('aiAmount', [['too_little', 'Too little'], ['about_right', 'About right'], ['too_much', 'Too much']])}</div>
      {g.deal && scale('planOk', 'The plan we made works for me.', 'Disagree', 'Agree')}
      {scale('comfort', 'It was easy to bring up my limit.', 'Disagree', 'Agree')}
      {scale('inCharge', 'The group, not the AI, was in charge of the plan.', 'Disagree', 'Agree')}
      <div className="stack" style={{ gap: 6 }}><span className="q">Would you use this again?</span>
        {pick('playAgain', [['yes', 'Yes'], ['maybe', 'Maybe'], ['no', 'No']])}</div>
      <label className="field small">Anything else? (optional)<textarea value={f.comment} maxLength={1000} onChange={(e) => setF({ ...f, comment: e.target.value })} /></label>
      {error && <div className="error">{error}</div>}
      <button className="btn" disabled={!done} onClick={async () => { try { await api('/api/feedback', { sessionId: g.id, ...f }); setSent(true); } catch (e) { setError(e.message); } }}>Send feedback</button>
      {g.surveyUrl && <a href={g.surveyUrl} target="_blank" rel="noreferrer" className="small">Open the full feedback survey</a>}
    </section>
  );
}
