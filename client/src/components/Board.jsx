import React, { useLayoutEffect, useRef, useState } from 'react';
import { emit } from '../lib.js';
import MapView, { gmapsDirections, gmapsPlace } from './MapView.jsx';
import { MapCard, RideCard, TableCard, BillCard } from './Cards.jsx';
import { OpeningHours, Itinerary, Weather, Bring, Agreements, Ticket } from './Artifacts.jsx';
import { Cost, Cars, Chores, Work, PrivatePick, Listings, Truck, Gifts, Roster, Agenda, Study, Shifts, Invite, Reminders } from './Extras.jsx';

// The plan board: one live view of the whole plan that everyone at the table can use. It sits beside the chat on a
// wide screen and opens as a sheet on a phone. Each part of the plan gets the widget that fits it: an availability
// grid for a time, a map with real places for a place, option cards for anything else. Cards the AI makes (rides,
// bills, maps, menus) and the shared to-do list live here too, so the chat stays a conversation.

const STATUS = { open: 'Open', split: 'Undecided', leaning: 'Leaning', agreed: 'Most agree' };
const money = (x) => `$${Number(x).toFixed(2)}`;

// ---------- picking options (also used in the pick sheet and inside AI questions) ----------
export function Options({ g, send, id, compact }) {
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
            {compact ? (names.length > 0 && <span className="opt-n">{names.length}</span>) : names.length > 0 && <span className="opt-who">{names.map((n, i) => <span key={i} className="nw">{n}{i < names.length - 1 ? ', ' : ''}</span>)}</span>}
            {!compact && no.length > 0 && <span className="opt-warn">Does not work for {no.join(', ')}</span>}
            {!compact && o.custom && o.by && <span className="opt-by">added by {o.by}</span>}
            {mine === o.id && !compact && <span className="opt-check" aria-hidden="true">✓</span>}
          </button>
        );
      })}
    </div>
  );
}

// ---------- add your own option ----------
function AddOption({ g, field, placeholder }) {
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  if (g.deal) return null;
  const add = async () => {
    if (text.trim().length < 2) return;
    const r = await emit('game:add-option', { sessionId: g.id, field, name: text });
    if (r.error) setError(r.error); else { setText(''); setError(''); }
  };
  return (
    <form className="add-row" onSubmit={(e) => { e.preventDefault(); add(); }}>
      <input type="text" value={text} maxLength={50} placeholder={placeholder || 'Add your own option'} aria-label={`Add an option to ${field}`} onChange={(e) => setText(e.target.value)} />
      <button className="btn small" disabled={text.trim().length < 2}>Add</button>
      {error && <span className="small warn-text">{error}</span>}
    </form>
  );
}

// ---------- availability grid (a time part) ----------
const NEXT = { undefined: 'yes', yes: 'maybe', maybe: 'no', no: undefined };
const MARK = { yes: 'Yes', maybe: 'Maybe', no: 'No' };
export function AvailGrid({ g, send, id }) {
  const field = g.task.fields.find((f) => f.id === id);
  const a = g.board?.avail?.[id];
  if (!field || !a) return null;
  const best = Math.max(0, ...Object.values(a.score || {}));
  // Day names are shortened in the column heads so four times fit across a phone; the full name is in the label.
  const short = (n) => n.replace(/\b(Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day\b/g, (_, d) => ({ Tues: 'Tue', Wednes: 'Wed', Thurs: 'Thu', Satur: 'Sat' }[d] || d))
    .replace(/\bmorning\b/, 'morn.').replace(/\bafternoon\b/, 'aft.').replace(/\bevening\b/, 'eve.');
  return (
    <div className="grid-wrap">
      <div className="avail" role="table" aria-label={`${field.name}: who can make which option`} style={{ gridTemplateColumns: `minmax(58px, 1fr) repeat(${field.options.length}, minmax(52px, 1fr))` }}>
        <div role="columnheader" className="avail-corner tiny muted">Tap your row</div>
        {field.options.map((o) => <div key={o.id} role="columnheader" aria-label={o.name} className={`avail-head ${best > 0 && a.score?.[o.id] === best ? 'best' : ''}`}><span aria-hidden="true">{short(o.name)}</span>{best > 0 && a.score?.[o.id] === best && <span className="best-tag">Most can</span>}</div>)}
        {a.rows.map((r) => (
          <React.Fragment key={r.pcode}>
            <div role="rowheader" className={`avail-name ${r.you ? 'you' : ''}`}>{r.you ? 'You' : r.name}</div>
            {field.options.map((o) => {
              const v = r.marks[o.id];
              return r.you && !g.deal
                ? <button key={o.id} role="cell" className={`cell ${v || 'blank'} mine`} aria-label={`${o.name}: ${v ? MARK[v] : 'not marked'}. Tap to change.`} onClick={() => send('game:avail', { field: id, option: o.id, value: NEXT[v] || '' })}>{v ? MARK[v] : '+'}</button>
                : <div key={o.id} role="cell" className={`cell ${v || 'blank'}`}>{v ? MARK[v] : ''}</div>;
            })}
          </React.Fragment>
        ))}
      </div>
      <div className="tiny muted">Tap a box: yes, then maybe, then no. Mark every time you could do; your pick becomes the one most people can make.</div>
    </div>
  );
}

// ---------- a place part: map, places, real search ----------
function AddPlace({ g, field }) {
  const [q, setQ] = useState('');
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);
  if (g.deal) return null;
  const search = async () => {
    if (q.trim().length < 2) return;
    setBusy(true);
    const r = await emit('game:places', { sessionId: g.id, query: q });
    setBusy(false); setRes(r.results || []);
  };
  const add = async (x) => { await emit('game:add-option', { sessionId: g.id, field, name: x.name, geo: x }); setRes(null); setQ(''); };
  return (
    <div className="stack" style={{ gap: 6 }}>
      <form className="add-row" onSubmit={(e) => { e.preventDefault(); search(); }}>
        <input type="text" value={q} maxLength={80} placeholder="Search a real place in San Diego" aria-label="Search a real place" onChange={(e) => setQ(e.target.value)} />
        <button className="btn small" disabled={q.trim().length < 2 || busy}>{busy ? 'Searching' : 'Search'}</button>
      </form>
      {res && (res.length ? res.map((x, i) => (
        <div key={i} className="search-row">
          <span className="grow"><strong>{x.name}</strong><br /><span className="small muted">{x.address}</span></span>
          <button className="btn small ghost" onClick={() => add(x)}>Add</button>
        </div>
      )) : <div className="small muted">No places found. Try another name.</div>)}
    </div>
  );
}
function PlaceWidget({ g, send, id, onMenu }) {
  const b = g.board;
  const row = g.panel.find((f) => f.id === id);
  const mine = g.me.prefs[id];
  const places = b.places || [];
  const pts = [{ ...b.origin, kind: 'pickup' }, ...places.map((p, i) => ({ ...p, kind: 'place', label: i + 1, active: p.id === row?.leader }))];
  return (
    <div className="stack" style={{ gap: 8 }}>
      {places.length > 0 && <MapView points={pts} height={190} interactive />}
      {places.map((p, i) => {
        const who = row?.options.find((o) => o.option === p.id)?.who || [];
        const no = row?.blocked?.[p.id] || [];
        return (
          <div key={p.id} className={`place-row ${p.id === row?.leader ? 'lead' : ''}`}>
            <span className="mk place inline">{i + 1}</span>
            <span className="grow"><strong>{p.name}</strong>
              <br /><span className="small muted">{p.address ? `${p.address} · ` : ''}{p.minutes} min drive{who.length ? ` · ${who.join(', ')}` : ''}</span>
              {no.length > 0 && <><br /><span className="opt-warn">Does not work for {no.join(', ')}</span></>}
              <span className="place-actions">
                <a className="small" href={gmapsDirections(b.origin, p)} target="_blank" rel="noreferrer">Directions</a>
                <a className="small" href={gmapsPlace(p, p.address ? p.name : p.restaurant)} target="_blank" rel="noreferrer">Google Maps</a>
                {p.food && <button className="linkbtn small" onClick={() => onMenu(p.id)}>Menu</button>}
              </span>
            </span>
            {!g.deal && <button className={`opt place-pick ${mine === p.id ? 'mine' : ''}`} aria-pressed={mine === p.id} aria-label={p.name} onClick={() => send('game:pick', { field: id, option: mine === p.id ? '' : p.id })}>{mine === p.id ? 'Picked' : 'Pick'}</button>}
          </div>
        );
      })}
      {/* options that are not a place on the map, such as "Online on Zoom" */}
      {g.task.fields.find((f) => f.id === id)?.options.filter((o) => !places.some((x) => x.id === o.id)).map((o) => {
        const who = row?.options.find((x) => x.option === o.id)?.who || [];
        const no = row?.blocked?.[o.id] || [];
        return (
          <div key={o.id} className={`place-row ${o.id === row?.leader ? 'lead' : ''}`}>
            <span className="mk place inline off" aria-hidden="true">·</span>
            <span className="grow"><strong>{o.name}</strong><br /><span className="small muted">Not on the map{who.length ? ` · ${who.join(', ')}` : ''}</span>
              {no.length > 0 && <><br /><span className="opt-warn">Does not work for {no.join(', ')}</span></>}</span>
            {!g.deal && <button className={`opt place-pick ${mine === o.id ? 'mine' : ''}`} aria-pressed={mine === o.id} aria-label={o.name} onClick={() => send('game:pick', { field: id, option: mine === o.id ? '' : o.id })}>{mine === o.id ? 'Picked' : 'Pick'}</button>}
          </div>
        );
      })}
      <AddPlace g={g} field={id} />
    </div>
  );
}

// ---------- one part of the plan ----------
export function PartWidget({ g, send, id, onMenu }) {
  const f = g.task.fields.find((x) => x.id === id);
  const row = g.panel.find((x) => x.id === id);
  if (!f) return null;
  return (
    <div className="stack" style={{ gap: 8 }}>
      {f.kind === 'time' && <AvailGrid g={g} send={send} id={id} />}
      {f.kind === 'place' ? <PlaceWidget g={g} send={send} id={id} onMenu={onMenu || (() => {})} /> : <Options g={g} send={send} id={id} />}
      {row?.own?.length > 0 && <div className="small muted">Going their own way: {row.own.map((x) => `${x.name} (${x.optionName})`).join(', ')}</div>}
      {f.kind !== 'place' && <AddOption g={g} field={id} placeholder={f.kind === 'time' ? 'Add a time' : 'Add another option'} />}
    </div>
  );
}

// ---------- a restaurant menu ----------
function MenuCard({ g, send, id, m }) {
  const total = (items) => items.reduce((a, x) => a + x.price * x.qty, 0);
  const mineTotal = Object.entries(m.mine || {}).reduce((a, [i, q]) => a + (m.items.find((x) => x.id === i)?.price || 0) * q, 0);
  return (
    <div className="card-ai menu" id={`menu-${id}`} data-nav="Menu" role="group" aria-label={`Menu: ${m.place.name}`}>
      <div className="card-ai-body">
        <div className="row between"><strong className="ride-title">{m.place.name}</strong><span className="chip">{m.loading ? 'Finding the menu' : m.sample ? 'Sample menu' : 'Menu from the web'}</span></div>
        {m.loading && <div className="row" style={{ gap: 8 }}><div className="spinner small" aria-hidden="true" /><span className="small muted">Looking it up...</span></div>}
        {m.items.map((it) => {
          const q = m.mine?.[it.id] || 0;
          return (
            <div key={it.id} className="menu-row">
              <span className="grow"><strong>{it.name}</strong>{it.note && <span className="small muted"> · {it.note}</span>}<br /><span className="small muted">{money(it.price)}</span></span>
              {!g.deal && <span className="qty">
                <button className="qbtn" aria-label={`One less ${it.name}`} disabled={!q} onClick={() => send('game:order', { placeId: id, itemId: it.id, delta: -1 })}>−</button>
                <span aria-live="polite">{q}</span>
                <button className="qbtn" aria-label={`Order ${it.name}`} onClick={() => send('game:order', { placeId: id, itemId: it.id, delta: 1 })}>+</button>
              </span>}
            </div>
          );
        })}
        {m.orders?.length > 0 && <div className="orders">{m.orders.map((o, i) => <div key={i} className="small"><strong>{o.you ? 'You' : o.name}:</strong> {o.items.map((x) => `${x.qty > 1 ? `${x.qty}× ` : ''}${x.name}`).join(', ')} <span className="muted">· {money(total(o.items))}</span></div>)}</div>}
        {mineTotal > 0 && <div className="okline">Your order: {money(mineTotal)} (about {money(mineTotal * 1.2)} with tax and tip)</div>}
        {!g.deal && m.orders?.length > 0 && <button className="btn small ghost" onClick={() => send('game:menu-bill', { placeId: id })}>I will pay; split the bill</button>}
        {m.sample && <div className="tiny muted">A sample menu for this kind of place; prices are estimates.</div>}
        {m.links?.length > 0 && <div className="tiny">{m.links.slice(0, 2).map((l, i) => <a key={i} href={l.url} target="_blank" rel="noreferrer noopener" style={{ marginRight: 8 }}>{l.title}</a>)}</div>}
      </div>
    </div>
  );
}

// ---------- shared to-do list ----------
function Todos({ g, send }) {
  const [text, setText] = useState('');
  const todos = g.board?.todos || [];
  return (
    <div className="stack" style={{ gap: 6 }}>
      {todos.length === 0 && <div className="small muted">Nothing yet. Add what still has to happen, like "book the room" or "send the invite".</div>}
      {todos.map((t) => (
        <div key={t.id} className={`todo ${t.done ? 'done' : ''}`}>
          <button className="todo-check" role="checkbox" aria-checked={t.done} aria-label={t.text} onClick={() => send('game:todo', { action: 'toggle', id: t.id })}>{t.done ? '✓' : ''}</button>
          <span className="grow">{t.text}<br /><span className="tiny muted">{t.ownerName ? `${t.mine ? 'You' : t.ownerName} will do it` : 'Nobody yet'} · added by {t.byName}</span></span>
          <button className="linkbtn small" onClick={() => send('game:todo', { action: 'claim', id: t.id })}>{t.mine ? 'Let go' : t.ownerName ? 'Take over' : 'I will do it'}</button>
          <button className="linkbtn small" aria-label={`Remove ${t.text}`} onClick={() => send('game:todo', { action: 'remove', id: t.id })}>×</button>
        </div>
      ))}
      <form className="add-row" onSubmit={(e) => { e.preventDefault(); if (text.trim().length > 1) { send('game:todo', { action: 'add', text }); setText(''); } }}>
        <input type="text" value={text} maxLength={120} placeholder="Add a task" aria-label="Add a task" onChange={(e) => setText(e.target.value)} />
        <button className="btn small" disabled={text.trim().length < 2}>Add</button>
      </form>
    </div>
  );
}

// ---------- calendar ----------
// A date and time for the plan: the next weekday the plan names, at the hour it names (or a sensible hour for
// "morning", "afternoon", "evening").
export function planEvent(g, plan) {
  const names = g.task.fields.map((f) => f.options.find((o) => o.id === plan[f.id])?.name || '').filter(Boolean);
  const text = names.join(' ').toLowerCase();
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const wd = days.findIndex((d) => text.includes(d));
  const m = text.match(/(\d{1,2})(?::(\d\d))?\s*(am|pm)/);
  let hour = m ? (+m[1] % 12) + (m[3] === 'pm' ? 12 : 0) : /morning|breakfast/.test(text) ? 10 : /lunch|noon/.test(text) ? 12 : /afternoon/.test(text) ? 14 : 19;
  const d = new Date(); d.setHours(hour, m ? +(m[2] || 0) : 0, 0, 0);
  const add = wd >= 0 ? ((wd - d.getDay() + 7) % 7 || 7) : 1;
  d.setDate(d.getDate() + add);
  const end = new Date(d.getTime() + 2 * 3600 * 1000);
  const place = g.task.fields.find((f) => f.kind === 'place');
  const where = place ? (g.board?.places || []).find((p) => p.id === plan[place.id]) : null;
  return { title: `${g.task.short}: ${names.slice(0, 2).join(', ')}`, start: d, end, details: g.task.fields.map((f) => `${f.name}: ${f.options.find((o) => o.id === plan[f.id])?.name || 'open'}`).join('\n'),
    location: where ? `${where.name}${where.address ? `, ${where.address}` : ', San Diego'}` : 'San Diego' };
}
const stamp = (d) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}T${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}00`;
export function CalendarLinks({ g, plan }) {
  const e = planEvent(g, plan);
  const google = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(e.title)}&dates=${stamp(e.start)}/${stamp(e.end)}&details=${encodeURIComponent(e.details)}&location=${encodeURIComponent(e.location)}&ctz=America/Los_Angeles`;
  const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Cabrillo//EN', 'BEGIN:VEVENT', `UID:${g.id}@cabrillo`, `DTSTART:${stamp(e.start)}`, `DTEND:${stamp(e.end)}`,
    `SUMMARY:${e.title}`, `LOCATION:${e.location}`, `DESCRIPTION:${e.details.replace(/\n/g, '\\n')}`, 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  return (
    <div className="row wrap-row" style={{ gap: 8 }}>
      <a className="btn small ghost" href={google} target="_blank" rel="noreferrer noopener">Add to Google Calendar</a>
      <a className="btn small ghost" href={`data:text/calendar;charset=utf-8,${encodeURIComponent(ics)}`} download="plan.ics">Download .ics</a>
      <span className="tiny muted">{e.start.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })}, {e.start.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
    </div>
  );
}

// ---------- the whole board ----------
// A row of short links at the top of the board, one for each card on it, so a long board is quick to move around
// in on a small screen. It stays at the top while the board scrolls.
function BoardNav({ root }) {
  const [items, setItems] = useState([]);
  const key = useRef('');
  useLayoutEffect(() => {
    const list = [...(root.current?.querySelectorAll('[data-nav]') || [])].map((e) => ({ id: e.id, label: e.dataset.nav }));
    const k = JSON.stringify(list);
    if (k !== key.current) { key.current = k; setItems(list); }
  });
  if (items.length < 3) return null;
  return (
    <nav className="board-nav" aria-label="Jump to a part of the board">
      {items.map((x) => <button key={x.id} onClick={() => document.getElementById(x.id)?.scrollIntoView({ block: 'start', behavior: 'smooth' })}>{x.label}</button>)}
    </nav>
  );
}

export default function PlanBoard({ g, send, onAccept, onClose }) {
  const [showHistory, setShowHistory] = useState(false);
  const rootRef = useRef(null);
  const listen = g.mode === 'listen';
  const paused = !!g.pausedBy;
  const b = g.board || {};
  const x = b.x || {};
  const act = (kind, action, a) => send('game:x', { kind, action, ...a });
  const openMenu = async (placeId) => { await emit('game:menu', { sessionId: g.id, placeId }); setTimeout(() => document.getElementById(`menu-${placeId}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 150); };
  // Cards the AI made, newest first: rides, tables, bills, maps and routes.
  const cards = [...g.chat].reverse().filter((m) => ['booking', 'bill'].includes(m.kind) || (m.kind === 'map' && (g.maps || []).find((x) => x.id === m.mapId)?.kind === 'route'));
  const blocks = [...g.chat].reverse().filter((m) => m.from === 'AI' && (m.blocks?.length || m.compare));
  const set = g.panel.filter((f) => f.status === 'agreed').length;
  const humans = g.players.filter((p) => !p.isAI);
  return (
    <div className="pboard" ref={rootRef}>
      <div className="pboard-head">
        <div className="grow"><strong>Plan board</strong><div className="small muted">{set} of {g.panel.length} parts set · everyone can edit</div></div>
        <button className="linkbtn small" aria-expanded={showHistory} onClick={() => setShowHistory(!showHistory)}>{b.changes || 0} changes</button>
        {onClose && <button className="btn ghost small" onClick={onClose}>Close</button>}
      </div>
      {showHistory && <div className="history">{(b.history || []).slice().reverse().map((h, i) => <div key={i} className="small"><span className="muted">{Math.floor(h.t / 60000)}:{String(Math.floor(h.t / 1000) % 60).padStart(2, '0')}</span> {h.text}</div>)}{!b.history?.length && <div className="small muted">No changes yet.</div>}</div>}
      {listen && (
        <div className="row between pboard-ai">
          <span className="small grow">{paused ? `Paused by ${g.pausedBy}. Taps still count.` : g.hearing || 'The AI updates this board from your chat. It never votes.'}</span>
          <button className={`btn small ${paused ? '' : 'ghost'}`} onClick={() => send('game:pause-ai', { paused: !paused })}>{paused ? 'Resume AI' : 'Pause AI'}</button>
        </div>
      )}
      {g.complete && !g.deal && (
        <section className="pcard ready">
          <div className="row between"><strong>The plan is ready</strong><span className="chip ok">{humans.filter((p) => p.accepted).length} of {humans.length} accepted</span></div>
          <button className={`btn block ${g.me.accepted ? 'ghost' : ''}`} onClick={onAccept}>{g.me.accepted ? 'Take back my acceptance' : 'Accept this plan'}</button>
          <CalendarLinks g={g} plan={g.plan} />
        </section>
      )}
      <BoardNav root={rootRef} />
      <Ticket g={g} />
      {g.panel.map((f, i) => (
        <section key={f.id} className={`pcard ${f.status}`} id={`part-${f.id}`} data-nav={i === 0 ? 'Plan' : undefined}>
          <div className="row between"><strong>{f.name}</strong><span className={`chip ${f.status === 'agreed' ? 'ok' : f.status === 'split' ? 'warn' : ''}`}>{f.status === 'agreed' ? f.leaderName : STATUS[f.status]}</span></div>
          <PartWidget g={g} send={send} id={f.id} onMenu={openMenu} />
        </section>
      ))}
      <Weather g={g} send={send} />
      <OpeningHours g={g} />
      <Itinerary g={g} send={send} />
      <Cost x={x} />
      <Cars x={x} act={act} deal={!!g.deal} />
      <Chores x={x} act={act} deal={!!g.deal} />
      <Work x={x} act={act} deal={!!g.deal} />
      <Agenda g={g} x={x} act={act} deal={!!g.deal} />
      <Study x={x} act={act} deal={!!g.deal} />
      <Shifts x={x} act={act} deal={!!g.deal} />
      <Roster x={x} act={act} deal={!!g.deal} />
      <Listings x={x} act={act} deal={!!g.deal} />
      <Truck x={x} act={act} deal={!!g.deal} />
      <PrivatePick p={x.tickets} act={act} deal={!!g.deal} kind="tickets" />
      <PrivatePick p={x.room} act={act} deal={!!g.deal} kind="room" />
      <Gifts x={x} act={act} deal={!!g.deal} />
      <Bring g={g} send={send} />
      <Agreements g={g} send={send} />
      <Invite x={x} act={act} deal={!!g.deal} />
      <Reminders g={g} x={x} act={act} />
      {Object.entries(b.menus || {}).map(([id, m]) => <MenuCard key={id} g={g} send={send} id={id} m={m} />)}
      {cards.length > 0 && <div className="label" id="part-cards" data-nav="Cards" style={{ marginTop: 6 }}>Cards</div>}
      {cards.map((m) => {
        if (m.kind === 'booking') { const bk = (g.bookings || []).find((x) => x.id === m.bookingId); return bk?.kind === 'ride' ? <RideCard key={m.id} b={bk} send={send} offset={g.clockOffset} /> : <TableCard key={m.id} b={bk} send={send} />; }
        if (m.kind === 'bill') return <BillCard key={m.id} b={(g.bills || []).find((x) => x.id === m.billId)} text={m.text} send={send} deal={!!g.deal} />;
        return <MapCard key={m.id} m={(g.maps || []).find((x) => x.id === m.mapId)} />;
      })}
      {blocks.length > 0 && <div className="label" id="part-fromai" data-nav="From the AI" style={{ marginTop: 6 }}>From the AI</div>}
      {blocks.slice(0, 6).map((m) => <div key={m.id} className="pcard"><div className="small muted">{m.text}</div>{m.blocks?.map((bl, k) => <MiniBlock key={k} b={bl} />)}</div>)}
      <section className="pcard" id="part-tasks" data-nav="To-do">
        <strong>To-do</strong>
        <Todos g={g} send={send} />
      </section>
    </div>
  );
}

// A compact copy of an answer block on the board.
function MiniBlock({ b }) {
  if (b.type === 'compare') return <div className="blk">{b.title && <div className="blk-title">{b.title}</div>}{b.items.map((x) => <div key={x.name} className="small"><strong>{x.name}</strong>: + {x.pros.join('; ')}{x.cons.length ? ` · − ${x.cons.join('; ')}` : ''}</div>)}</div>;
  if (b.type === 'table') return <div className="blk blk-scroll"><table><thead><tr>{b.columns.map((c, i) => <th key={i}>{c}</th>)}</tr></thead><tbody>{b.rows.map((r, i) => <tr key={i}>{b.columns.map((_, j) => <td key={j}>{r[j] || ''}</td>)}</tr>)}</tbody></table></div>;
  if (b.type === 'links') return <div className="blk"><div className="blk-title">Sources</div>{b.items.map((x, i) => <div key={i}><a href={x.url} target="_blank" rel="noreferrer noopener">{x.title}</a></div>)}</div>;
  if (b.items) return <div className="blk">{b.title && <div className="blk-title">{b.title}</div>}<ul>{b.items.map((x, i) => <li key={i}>{x}</li>)}</ul></div>;
  return null;
}
