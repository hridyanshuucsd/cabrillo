import React, { useEffect, useState } from 'react';
import MapView from './MapView.jsx';
import { planEvent } from './Board.jsx';

// The second set of board pieces: cost, carpool seats, the scenario's own tools (chores, work split, tickets, rooms,
// listings, truck, gift pool, roster, agenda, study, shifts), the invite and reminders. Every piece is shared by
// the table; a few answers are private and say so.

const money = (x) => `$${Number(x).toFixed(Number(x) % 1 ? 2 : 0)}`;
const ini = (n) => String(n || '?').trim().charAt(0).toUpperCase();
const grey = '#7a8790';
const clock = (min) => { const h = Math.floor(min / 60) % 24, m = min % 60; return `${((h + 11) % 12) + 1}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h >= 12 ? 'pm' : 'am'}`; };
const Dot = ({ p, size = 24 }) => <span className="xdot" style={{ width: size, height: size, background: p?.color || grey, fontSize: size * 0.5 }} title={p ? (p.you ? 'You' : p.name) : ''} aria-hidden="true">{ini(p?.name)}</span>;
const Who = ({ p }) => <span className="xwho"><Dot p={p} size={20} />{p.you ? 'You' : p.name}</span>;
const Section = ({ id, title, aside, children, className = '' }) => (
  <section className={`pcard ${className}`} id={id}>
    <div className="row between"><strong>{title}</strong>{aside && <span className="small muted">{aside}</span>}</div>
    {children}
  </section>
);
const AddForm = ({ label, placeholder, onAdd, max = 60 }) => {
  const [t, setT] = useState('');
  return (
    <form className="add-row" onSubmit={(e) => { e.preventDefault(); if (t.trim().length > 1) { onAdd(t.trim()); setT(''); } }}>
      <input type="text" value={t} maxLength={max} placeholder={placeholder} aria-label={label} onChange={(e) => setT(e.target.value)} />
      <button className="btn small" disabled={t.trim().length < 2}>Add</button>
    </form>
  );
};

// ---------- what it costs each person ----------
// A receipt that updates with the plan, and where the total sits against the budget the group picked.
export function Cost({ x }) {
  const c = x.cost;
  if (!c) return null;
  const b = c.budget;
  const over = b && !b.total && b.hi !== null && c.total > b.hi;
  const max = Math.max(c.total * 1.25, b ? (b.hi ?? b.lo * 1.6) * 1.25 : 0, 10);
  const pct = (v) => `${Math.min(100, (v / max) * 100)}%`;
  return (
    <section className="pcard receipt-wrap" id="part-x-cost">
      <div className="receipt" role="group" aria-label={`Cost per person: about ${money(c.total)}${c.monthly ? ' a month' : ''}`}>
        <div className="receipt-head"><strong>What it costs each person</strong><span className="tiny muted">{c.people} people · this game's prices</span></div>
        {c.items.map((it, i) => <div key={i} className={`rline ${it.optional ? 'optional' : ''}`}><span>{it.label}{it.optional ? ' (optional)' : ''}</span><span className="leader" aria-hidden="true" /><span>{money(it.amount)}</span></div>)}
        <div className="rline total"><span>About{c.monthly ? ', a month' : ''}</span><span className="leader" aria-hidden="true" /><span>{money(c.total)}</span></div>
      </div>
      {b && !b.total && (
        <div className="budget-scale" aria-label={`Budget picked: ${b.name}. ${over ? 'The plan is over it.' : 'The plan fits it.'}`}>
          <div className="bs-track">
            <span className="bs-band" style={{ left: pct(b.lo), width: b.hi === null ? `calc(100% - ${pct(b.lo)})` : `calc(${pct(b.hi)} - ${pct(b.lo)})` }} />
            <span className={`bs-mark ${over ? 'over' : ''}`} style={{ left: pct(c.total) }} />
          </div>
          <div className="row between tiny"><span className="muted">Budget {c.agreedBudget ? 'agreed' : 'leading'}: {b.name}</span><span className={`chip ${over ? 'warn' : 'ok'}`}>{over ? `${money(c.total - b.hi)} over` : 'Fits the budget'}</span></div>
        </div>
      )}
    </section>
  );
}

// ---------- carpool ----------
// Each car is drawn from above: the driver's seat and the free seats, which you tap to take.
function CarDrawing({ car, onSeat, canRide }) {
  const seats = [car.driver, ...car.riders, ...Array(Math.max(0, car.seats - car.riders.length)).fill(null)];
  const pos = (i) => { const row = i < 2 ? 0 : 1 + Math.floor((i - 2) / 3); const col = i < 2 ? i : (i - 2) % 3; const inRow = i < 2 ? 2 : Math.min(3, seats.length - 2 - (row - 1) * 3); return { x: 70 + row * 46, y: 45 + (col - (inRow - 1) / 2) * 26 }; };
  const len = 70 + Math.max(2, 1 + Math.ceil((seats.length - 2) / 3)) * 46;
  return (
    <svg viewBox={`0 0 ${len + 30} 90`} className="car-svg" role="group" aria-label={`${car.driver.you ? 'Your' : `${car.driver.name}'s`} car, ${car.riders.length} of ${car.seats} seats taken`}>
      <rect x="6" y="6" width={len + 18} height="78" rx="30" className="car-body" />
      <path d={`M40 14 Q30 45 40 76`} className="car-glass" />
      <rect x={len - 4} y="16" width="14" height="58" rx="6" className="car-glass2" />
      {seats.map((p, i) => {
        const { x, y } = pos(i);
        if (p) return <g key={i}><circle cx={x} cy={y} r="11.5" fill={p.color || grey} /><text x={x} y={y + 4.5} className="car-ini">{ini(p.name)}</text>{i === 0 && <circle cx={x - 22} cy={y} r="6.5" className="car-wheel" />}</g>;
        return canRide
          ? <g key={i} className="car-free" role="button" tabIndex={0} aria-label="Take this seat" onClick={onSeat} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onSeat()}><circle cx={x} cy={y} r="11.5" /><text x={x} y={y + 4.5}>+</text></g>
          : <circle key={i} cx={x} cy={y} r="11.5" className="car-empty" />;
      })}
    </svg>
  );
}
export function Cars({ x, act, deal }) {
  const c = x.cars;
  const [seats, setSeats] = useState(c?.mySeats || 3);
  if (!c) return null;
  const driving = c.list.find((k) => k.mine);
  const riding = c.list.find((k) => k.inIt);
  return (
    <Section id="part-x-cars" title="Carpool seats" aside={`${c.list.reduce((a, k) => a + k.seats - k.riders.length, 0)} free seats in ${c.list.length} car${c.list.length === 1 ? '' : 's'}`}>
      {c.list.length === 0 && <div className="small muted">Nobody has offered to drive yet.</div>}
      {c.list.map((k) => (
        <div key={k.id} className="car-row">
          <CarDrawing car={k} canRide={!deal && !driving && !k.inIt && k.riders.length < k.seats} onSeat={() => act('car', 'ride', { id: k.id })} />
          <div className="row between wrap-row">
            <span className="small"><strong>{k.driver.you ? 'You drive' : `${k.driver.name} drives`}</strong> · {k.riders.length} of {k.seats} seat{k.seats === 1 ? '' : 's'} taken{k.riders.length ? `: ${k.riders.map((r) => (r.you ? 'you' : r.name)).join(', ')}` : ''}</span>
            {!deal && k.mine && <span className="row" style={{ gap: 4 }}><span className="seg"><button onClick={() => act('car', 'seats', { id: k.id, delta: -1 })} aria-label="One seat fewer">−</button><button onClick={() => act('car', 'seats', { id: k.id, delta: 1 })} aria-label="One more seat">+</button></span><button className="linkbtn small" onClick={() => act('car', 'stop', { id: k.id })}>Stop driving</button></span>}
            {!deal && k.inIt && <button className="linkbtn small" onClick={() => act('car', 'leave', { id: k.id })}>Leave this car</button>}
            {!deal && !k.mine && !k.inIt && !driving && k.riders.length < k.seats && <button className="btn small ghost" onClick={() => act('car', 'ride', { id: k.id })}>Ride with {k.driver.name}</button>}
          </div>
        </div>
      ))}
      {c.without.length > 0 && <div className="small">Not in a car yet: {c.without.map((p) => (p.you ? 'you' : p.name)).join(', ')}</div>}
      {!deal && !driving && !riding && <div className="row" style={{ gap: 8 }}>
        <span className="seg"><button onClick={() => setSeats(Math.max(1, seats - 1))} aria-label="Fewer seats">−</button><button disabled aria-live="polite">{seats} seats</button><button onClick={() => setSeats(Math.min(6, seats + 1))} aria-label="More seats">+</button></span>
        <button className="btn small" onClick={() => act('car', 'drive', { seats })}>I can drive</button>
      </div>}
    </Section>
  );
}

// ---------- chore chart ----------
export function Chores({ x, act, deal }) {
  const [sel, setSel] = useState(null);
  if (x.cleanNote && !x.chores) return <Section id="part-x-chores" title="Chores"><div className="small muted">{x.cleanNote}</div></Section>;
  const c = x.chores;
  if (!c) return null;
  const tap = (w, i) => {
    if (deal) return;
    if (sel && sel.w === w && sel.i !== i) { act('chore', 'swap', { week: w, a: sel.i, b: i }); setSel(null); }
    else if (c.weeks[w][i].you) setSel(sel?.w === w && sel.i === i ? null : { w, i });
  };
  return (
    <Section id="part-x-chores" title="Chore chart" aside="Rotates every week">
      <div className="chore-grid" role="table" aria-label="Chore chart">
        <div role="row" className="chore-row head"><span role="columnheader" />{c.weeks.map((_, w) => <span role="columnheader" key={w} className={w === 0 ? 'now' : ''}>{w === 0 ? 'This week' : `Week ${w + 1}`}</span>)}</div>
        {c.chores.map((name, i) => (
          <div role="row" className="chore-row" key={name}>
            <span role="rowheader" className="chore-name">{name}</span>
            {c.weeks.map((wk, w) => {
              const p = wk[i];
              const picked = sel && sel.w === w && sel.i === i;
              const target = sel && sel.w === w && sel.i !== i;
              return <button role="cell" key={w} className={`chore-cell ${picked ? 'picked' : ''} ${target ? 'target' : ''} ${w === 0 ? 'now' : ''}`} style={{ '--seat': p.color || grey }} onClick={() => tap(w, i)}
                aria-label={`${name}, ${w === 0 ? 'this week' : `week ${w + 1}`}: ${p.you ? 'you' : p.name}${target ? '. Tap to trade' : ''}`}><Dot p={p} size={22} /><span className="chore-who">{p.you ? 'You' : p.name}</span></button>;
            })}
          </div>
        ))}
      </div>
      <div className="tiny muted">{sel ? 'Now tap the chore you want to trade for, in the same week.' : 'To trade, tap one of your chores, then the one you want that week.'}</div>
    </Section>
  );
}

// ---------- shared claim lists (work split, study topics) ----------
const STATUS = { todo: 'To do', doing: 'In progress', done: 'Done' };
function ClaimRows({ items, list, act, deal, status, cap }) {
  return items.map((it) => (
    <div key={it.id} className={`claim-row ${it.status}`}>
      <span className="grow"><span className="claim-title">{it.title}</span>
        <span className="claim-takers">{it.takers.length ? it.takers.map((p, i) => <Who key={i} p={p} />) : <span className="tiny muted">Nobody yet</span>}</span></span>
      {status && <button className={`status-pill ${it.status}`} disabled={deal} onClick={() => act('list', 'status', { list, id: it.id })} aria-label={`${it.title}: ${STATUS[it.status]}. Tap to change`}>{STATUS[it.status]}</button>}
      {!deal && (it.mine || it.takers.length < (it.cap || cap)) && <button className={`btn small ${it.mine ? 'ghost' : ''}`} onClick={() => act('list', 'take', { list, id: it.id })}>{it.mine ? 'Let go' : 'I will do it'}</button>}
    </div>
  ));
}
function DayLine({ marks, total }) {
  return (
    <div className="dayline" aria-hidden="true">
      <span className="dl-track" />
      {marks.map((m, i) => <span key={i} className={`dl-mark ${m.kind || ''} ${i === 0 ? 'first' : i === marks.length - 1 ? 'last' : ''}`} style={{ left: `${(m.at / total) * 100}%` }}><span className="dl-label">{m.label}</span><span className="dl-sub">{m.sub}</span></span>)}
    </div>
  );
}
export function Work({ x, act, deal }) {
  const w = x.work;
  if (!w) return null;
  const done = w.items.filter((i) => i.status === 'done').length;
  let line = null;
  if (w.hack && w.milestones) line = <DayLine total={24} marks={w.milestones.map((m) => ({ at: m.hr, label: m.label, sub: m.at, kind: m.hr === 22 ? 'due' : '' }))} />;
  else if (w.dates?.final) line = <DayLine total={w.dates.final.days} marks={[{ at: 0, label: 'Today', sub: '', kind: 'today' }, ...(w.dates.draft ? [{ at: w.dates.draft.days, label: w.dates.draft.label, sub: `in ${w.dates.draft.days} day${w.dates.draft.days === 1 ? '' : 's'}` }] : []), { at: w.dates.final.days, label: w.dates.final.label, sub: `in ${w.dates.final.days} days`, kind: 'due' }]} />;
  return (
    <Section id="part-x-work" title={w.hack ? 'Who builds what' : 'Who does what'} aside={`${done} of ${w.items.length} done`}>
      {line}
      <ClaimRows items={w.items} list="work" act={act} deal={deal} status cap={w.cap} />
      {!deal && <AddForm label="Add a piece of work" placeholder="Add a piece of work" onAdd={(t) => act('list', 'add', { list: 'work', title: t })} />}
    </Section>
  );
}

// ---------- tickets and rooms: everyone answers privately ----------
export function PrivatePick({ p, act, deal, kind }) {
  const [mine, setMine] = useState(null);
  useEffect(() => { setMine(p?.mine ?? null); }, [JSON.stringify(p?.mine)]);
  if (!p) return null;
  const sel = new Set(mine || []);
  const tickets = kind === 'tickets';
  const booked = p.status === 'booked';
  const toggle = (id) => { const s = new Set(sel); if (s.has(id)) s.delete(id); else s.add(id); setMine([...s]); act('private', 'answer', { name: p.name, ids: [...s] }); };
  return (
    <Section id={`part-x-${kind}`} title={tickets ? `Tickets: ${p.title}` : `Book the room: ${p.title}`} aside={booked ? 'Booked (demo)' : `${p.answered} of ${p.of} answered`}>
      {!booked && <div className="tiny muted">{p.common ? (p.common.length ? `These work for everyone. Nobody's answer is shown.` : 'Nothing works for everyone. Nobody\'s answer is shown; talk it over or change yours.') : 'Tap what works for you. Your answer is private; the group only sees what works for everyone.'}</div>}
      <div className={tickets ? 'tix' : 'slots'}>
        {p.options.map((o) => {
          const all = p.common?.includes(o.id);
          const out = p.common && !all;
          const chosen = booked && p.choice === o.id;
          if (booked && !chosen) return null;
          return (
            <div key={o.id} className={`${tickets ? 'tix-stub' : 'slot'} ${sel.has(o.id) ? 'on' : ''} ${all ? 'all' : ''} ${out ? 'out' : ''} ${chosen ? 'chosen' : ''}`}>
              <span className="grow"><span className="tix-name">{o.name}</span>{tickets && <span className="tix-price">{money(o.price)}</span>}{o.ga && <span className="tiny muted">General admission</span>}</span>
              {!booked && !deal && <label className="tix-check"><input type="checkbox" checked={sel.has(o.id)} onChange={() => toggle(o.id)} aria-label={`${o.name} works for me`} /> Works for me</label>}
              {!booked && !deal && all && <button className="btn small" onClick={() => act('private', 'book', { name: p.name, id: o.id })}>{tickets ? `Buy ${p.of}` : 'Book it'}</button>}
              {chosen && <span className="tix-code">{p.code}<span className="tiny"> · by {p.by}</span></span>}
            </div>
          );
        })}
      </div>
      {booked && <div className="row between"><span className="tiny muted">Demo: nothing was charged.{tickets ? ' The bill is on the board.' : ''}</span>{!deal && <button className="linkbtn small" onClick={() => act('private', 'reopen', { name: p.name })}>Change it</button>}</div>}
    </Section>
  );
}

// ---------- apartment listings ----------
export function Listings({ x, act, deal }) {
  const L = x.listings;
  const [all, setAll] = useState(false);
  if (!L) return null;
  const shown = L.items.filter((l) => all || !L.area || l.area === L.area);
  const liked = L.items.filter((l) => l.hearts.length);
  const pts = [{ ...L.origin, kind: 'pickup' }, ...shown.map((l, i) => ({ ...l, kind: 'place', label: i + 1, active: l.mine }))];
  const AREA = { utc: 'UTC', pb: 'Pacific Beach', clairemont: 'Clairemont' };
  return (
    <Section id="part-x-listings" title="Apartments" aside={`Sample listings · ${L.rooms === 'shared' ? 'shared rooms' : 'singles'}`}>
      <MapView points={pts} height={170} interactive />
      {L.area && <button className="linkbtn small" style={{ alignSelf: 'flex-start' }} onClick={() => setAll(!all)}>{all ? `Only ${AREA[L.area]}` : 'Show every area'}</button>}
      {shown.map((l, i) => {
        const over = L.maxRent && l.each > L.maxRent;
        return (
          <div key={l.id} className={`listing ${l.mine ? 'liked' : ''}`}>
            <span className="mk place inline">{i + 1}</span>
            <span className="grow"><strong>{l.name}</strong> <span className="small muted">· {AREA[l.area]}</span>
              <span className="listing-rent">{money(l.each)}<span className="small muted"> each a month</span></span>
              <span className="small muted">{l.beds} bed, {l.baths} bath · {l.bus}, {l.min} min to campus · {l.perks.join(', ')}{L.lease && !l.lease.includes(L.lease) ? ` · no ${L.lease === 'june' ? 'June' : 'September'} lease` : ''}</span>
              {over && <span className="opt-warn">Over the rent you picked</span>}
            </span>
            <button className={`heart ${l.mine ? 'on' : ''}`} disabled={deal} aria-pressed={l.mine} aria-label={`Like ${l.name}`} onClick={() => act('heart', 'toggle', { id: l.id })}>{l.mine ? '♥' : '♡'}<span>{l.hearts.length || ''}</span></button>
          </div>
        );
      })}
      {liked.length > 1 && <div className="blk blk-scroll"><div className="blk-title">Compare the ones you like</div><table><thead><tr><th>Listing</th><th>Each</th><th>Campus</th><th>Liked by</th></tr></thead>
        <tbody>{liked.map((l) => <tr key={l.id}><td>{l.name}</td><td>{money(l.each)}</td><td>{l.min} min</td><td>{l.hearts.map((h) => (h.you ? 'you' : h.name)).join(', ')}</td></tr>)}</tbody></table></div>}
      <div className="tiny muted">Sample listings for the game, not real apartments for rent.</div>
    </Section>
  );
}

// ---------- moving truck ----------
const TruckArt = ({ len }) => {
  const w = 40 + len * 5;
  return (
    <svg viewBox={`0 0 ${w + 46} 62`} className="truck-svg" aria-hidden="true">
      <rect x="4" y="8" width={w} height="38" rx="4" className="truck-box" />
      <path d={`M${w + 6} 18 h22 l12 14 v14 h-34 z`} className="truck-cab" />
      <rect x={w + 12} y="22" width="13" height="9" rx="2" className="truck-win" />
      {[18, w - 12, w + 28].map((cx) => <circle key={cx} cx={cx} cy="50" r="7" className="truck-wheel" />)}
    </svg>
  );
};
export function Truck({ x, act, deal }) {
  const t = x.truck;
  if (!t) return null;
  const pick = t.pick === 'movers' ? t.movers : t.trucks.find((k) => k.id === t.pick);
  return (
    <Section id="part-x-truck" title="Moving truck" aside={`Split ${t.people} ways · sample prices`}>
      {t.plan === 'cars' && <div className="small muted">The plan says your own cars, so this is only for comparison.</div>}
      <div className="trucks" role="radiogroup" aria-label="Truck size">
        {t.trucks.map((k) => (
          <button key={k.id} role="radio" aria-checked={t.pick === k.id} disabled={deal} className={`truck ${t.pick === k.id ? 'on' : ''}`} onClick={() => act('truck', 'pick', { id: k.id })}>
            <TruckArt len={k.len} /><strong>{k.name}</strong><span className="tiny muted">{k.fits}</span><span className="truck-each">{money(k.each)}<span className="tiny"> each</span></span>
          </button>
        ))}
        <button role="radio" aria-checked={t.pick === 'movers'} disabled={deal} className={`truck movers ${t.pick === 'movers' ? 'on' : ''}`} onClick={() => act('truck', 'pick', { id: 'movers' })}>
          <span className="movers-art" aria-hidden="true">3 movers</span><strong>Hire movers</strong><span className="tiny muted">3 hours, they lift</span><span className="truck-each">{money(t.movers.each)}<span className="tiny"> each</span></span>
        </button>
      </div>
      <div className="row between wrap-row">
        <span className="small">Miles driven: <strong>{t.miles}</strong> at {money(t.perMile)} a mile, plus $15 for gas</span>
        {!deal && <span className="seg"><button onClick={() => act('truck', 'miles', { delta: -1 })} aria-label="5 fewer miles">−5</button><button onClick={() => act('truck', 'miles', { delta: 1 })} aria-label="5 more miles">+5</button></span>}
      </div>
      {pick && <div className="okline">{t.pick === 'movers' ? 'Movers' : pick.name}: {money(pick.total)} in all, {money(pick.each)} each.{t.start ? ` Start at ${t.start}.` : ''}</div>}
    </Section>
  );
}

// ---------- gift pool ----------
function Ring({ target, pledges }) {
  const R = 46, C = 2 * Math.PI * R;
  let at = 0;
  return (
    <svg viewBox="0 0 120 120" className="ring" aria-hidden="true">
      <circle cx="60" cy="60" r={R} className="ring-track" />
      {pledges.map((p, i) => { const frac = Math.min(1, p.amount / target); const seg = <circle key={i} cx="60" cy="60" r={R} fill="none" stroke={p.color || grey} strokeWidth="14" strokeDasharray={`${Math.max(0, frac * C - 2)} ${C}`} strokeDashoffset={-at * C} transform="rotate(-90 60 60)" opacity={p.paid ? 1 : 0.45} />; at += frac; return seg; })}
    </svg>
  );
}
export function Gifts({ x, act, deal, people }) {
  const g = x.gifts;
  const [amt, setAmt] = useState('');
  if (!g) return null;
  const pct = Math.min(100, Math.round((g.raised / g.target) * 100));
  return (
    <Section id="part-x-gifts" title="Gift pool" aside={`For ${g.lead}`}>
      <div className="pool">
        <div className="pool-ring"><Ring target={g.target} pledges={g.pledges} /><div className="pool-center"><strong>{money(g.raised)}</strong><span className="tiny muted">of {money(g.target)}</span></div></div>
        <div className="grow stack" style={{ gap: 6 }}>
          {g.pledges.length === 0 && <div className="small muted">Nobody has put in yet. An even share is {money(g.even)}.</div>}
          {g.pledges.map((p, i) => <div key={i} className="small"><Who p={p} /> {money(p.amount)} · {p.paid ? `paid with ${p.method === 'zelle' ? 'Zelle' : 'Venmo'}` : 'not paid yet'}</div>)}
          <div className="tiny muted">{pct}% pledged · solid means paid (demo, no money moves)</div>
        </div>
      </div>
      {!deal && !g.mine?.paid && <div className="row wrap-row" style={{ gap: 6 }}>
        <button className="btn small" onClick={() => act('gift', 'pledge', { amount: g.even })}>Put in {money(g.even)}</button>
        <form className="row" style={{ gap: 6 }} onSubmit={(e) => { e.preventDefault(); if (+amt >= 0) { act('gift', 'pledge', { amount: +amt }); setAmt(''); } }}>
          <input type="number" min="0" step="1" value={amt} placeholder="Other $" aria-label="Another amount" className="amt" onChange={(e) => setAmt(e.target.value)} />
          <button className="btn small ghost" disabled={!amt}>Put in</button>
        </form>
      </div>}
      {!deal && g.mine && !g.mine.paid && <div className="row" style={{ gap: 6 }}><span className="small grow">Pay your {money(g.mine.amount)} through the AI:</span><button className="btn small ghost" onClick={() => act('gift', 'pay', { method: 'venmo' })}>Venmo</button><button className="btn small ghost" onClick={() => act('gift', 'pay', { method: 'zelle' })}>Zelle</button></div>}
      <div className="label" style={{ marginTop: 4 }}>Gift ideas</div>
      {g.items.map((it) => (
        <div key={it.id} className={`gift-row ${it.lead ? 'lead' : ''}`}>
          <span className="grow"><strong>{it.name}</strong> <span className="small muted">{money(it.price)}{it.lead ? ' · the pool is for this one' : ''}</span></span>
          <button className={`heart ${it.mine ? 'on' : ''}`} disabled={deal} aria-pressed={it.mine} aria-label={`Like ${it.name}`} onClick={() => act('gift', 'heart', { id: it.id })}>{it.mine ? '♥' : '♡'}<span>{it.hearts.length || ''}</span></button>
        </div>
      ))}
      {!deal && <GiftAdd act={act} />}
    </Section>
  );
}
function GiftAdd({ act }) {
  const [n, setN] = useState(''), [p, setP] = useState('');
  return (
    <form className="add-row" onSubmit={(e) => { e.preventDefault(); if (n.trim().length > 1 && +p > 0) { act('gift', 'add', { name: n, price: +p }); setN(''); setP(''); } }}>
      <input type="text" value={n} maxLength={50} placeholder="Suggest a gift" aria-label="Suggest a gift" onChange={(e) => setN(e.target.value)} />
      <input type="number" min="1" value={p} placeholder="$" aria-label="Price in dollars" className="amt" onChange={(e) => setP(e.target.value)} />
      <button className="btn small" disabled={n.trim().length < 2 || !(+p > 0)}>Add</button>
    </form>
  );
}

// ---------- team roster ----------
function Field({ surface }) {
  const line = 'field-line';
  return (
    <g>
      <rect x="1" y="1" width="98" height="58" rx="2" className={`field-ground ${surface}`} />
      {surface === 'court' && <><path d="M30 1 v22 h40 v-22" className={line} /><circle cx="50" cy="23" r="9" className={line} /><path d="M6 1 v12 a44 44 0 0 0 88 0 v-12" className={line} /><circle cx="50" cy="6" r="2" className={line} /></>}
      {surface === 'net' && <><path d="M1 3 h98" className="field-net" /><path d="M1 24 h98" className={line} /></>}
      {surface === 'pitch' && <><path d="M50 1 v58" className={line} /><circle cx="50" cy="30" r="9" className={line} /><rect x="1" y="17" width="14" height="26" className={line} /><rect x="85" y="17" width="14" height="26" className={line} /></>}
      {surface === 'endzone' && <><path d="M18 1 v58 M82 1 v58" className={line} /><rect x="1" y="1" width="17" height="58" className="field-zone" /><rect x="82" y="1" width="17" height="58" className="field-zone" /></>}
    </g>
  );
}
export function Roster({ x, act, deal }) {
  const r = x.roster;
  if (!r) return null;
  if (!r.sport) return <Section id="part-x-roster" title="Team roster"><div className="small muted">Pick a sport and the positions show up here.</div></Section>;
  return (
    <Section id="part-x-roster" title={`${r.sportName} roster`} aside={r.captain ? `Captain: ${r.captain.you ? 'you' : r.captain.name}` : 'No captain yet'}>
      <svg viewBox="0 0 100 60" className="field" role="group" aria-label={`${r.sportName} positions`}>
        <Field surface={r.surface} />
        {r.spots.map((s) => (
          <g key={s.id} className={`spot ${s.who ? 'taken' : ''} ${s.who?.you ? 'mine' : ''}`} role="button" tabIndex={deal ? -1 : 0} aria-label={`${s.label}: ${s.who ? (s.who.you ? 'you' : s.who.name) : 'open. Tap to play here'}`}
            onClick={() => !deal && (!s.who || s.who.you) && act('roster', 'spot', { id: s.id })} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && !deal && (!s.who || s.who.you) && act('roster', 'spot', { id: s.id })}>
            <circle cx={s.x} cy={s.y} r="5.2" fill={s.who ? s.who.color || grey : 'rgba(255,255,255,.85)'} />
            <text x={s.x} y={s.y + 1.9} className="spot-ini">{s.who ? ini(s.who.name) : '+'}</text>
            <text x={s.x} y={s.y + 10.5} className="spot-label">{s.label}</text>
          </g>
        ))}
      </svg>
      <div className="tiny muted">Tap an open spot to play there. Spots nobody takes go to friends you bring along.</div>
      <div className="roster-people">
        {r.players.map((p) => (
          <div key={p.pcode} className="roster-person">
            <Who p={p} />
            <button className={`star ${r.myVote === p.pcode ? 'on' : ''}`} disabled={deal} aria-pressed={r.myVote === p.pcode} aria-label={`Vote ${p.you ? 'yourself' : p.name} for captain`} onClick={() => act('roster', 'captain', { pcode: p.pcode })}>{r.myVote === p.pcode ? '★' : '☆'} {p.votes || ''}</button>
            {r.sizes && <span className="tiny muted">{p.size ? `Shirt ${p.size}` : 'No size yet'}</span>}
          </div>
        ))}
      </div>
      {r.sizes && !deal && <div className="row wrap-row" style={{ gap: 6 }}><span className="small">Your shirt:</span><span className="seg">{r.sizes.map((s) => <button key={s} aria-pressed={r.mySize === s} className={r.mySize === s ? 'on' : ''} onClick={() => act('roster', 'size', { size: s })}>{s}</button>)}</span></div>}
      {r.games && <div className="games">{r.games.map((g) => <div key={g.week} className="game"><span className="tiny muted">Week {g.week}</span><strong>vs {g.vs}</strong><span className="tiny">{g.when}</span></div>)}</div>}
    </Section>
  );
}

// ---------- meeting agenda ----------
const ical = (d) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}T${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}00`;
export function Agenda({ g, x, act, deal }) {
  const a = x.agenda;
  if (!a) return null;
  const used = a.items.reduce((s, i) => s + i.mins, 0);
  const plan = Object.fromEntries(g.panel.filter((f) => f.leader).map((f) => [f.id, f.leader]));
  const e = planEvent(g, plan);
  const end = new Date(e.start.getTime() + 30 * 60000);
  const details = `Agenda:\n${a.items.map((i) => `${i.title} (${i.mins} min)`).join('\n')}`;
  const google = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent('Weekly team meeting')}&dates=${ical(e.start)}/${ical(end)}&details=${encodeURIComponent(details)}&recur=${encodeURIComponent('RRULE:FREQ=WEEKLY;COUNT=10')}&ctz=America/Los_Angeles`;
  const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Cabrillo//EN', 'BEGIN:VEVENT', `UID:${g.id}-weekly@cabrillo`, `DTSTART:${ical(e.start)}`, `DTEND:${ical(end)}`, 'RRULE:FREQ=WEEKLY;COUNT=10', 'SUMMARY:Weekly team meeting', `DESCRIPTION:${details.replace(/\n/g, '\\n')}`, 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  return (
    <Section id="part-x-agenda" title="Meeting agenda" aside={`${used} of ${a.budget} minutes`}>
      <div className={`mins-bar ${used > a.budget ? 'over' : ''}`} aria-hidden="true">
        {a.items.map((i, k) => <span key={i.id} style={{ flexGrow: i.mins, opacity: 1 - k * 0.15 }} title={`${i.title}: ${i.mins} min`} />)}
        {used < a.budget && <span className="free" style={{ flexGrow: a.budget - used }} />}
      </div>
      {used > a.budget && <div className="warn-line">{used - a.budget} minutes over a 30 minute meeting</div>}
      {a.items.map((it) => (
        <div key={it.id} className="claim-row">
          <span className="grow"><span className="claim-title">{it.title}</span><span className="claim-takers">{it.takers.length ? it.takers.map((p, i) => <Who key={i} p={p} />) : <span className="tiny muted">Nobody leads it yet</span>}</span></span>
          {!deal && <span className="seg"><button onClick={() => act('list', 'mins', { list: 'agenda', id: it.id, delta: -1 })} aria-label={`Shorter: ${it.title}`}>−</button><button disabled>{it.mins} min</button><button onClick={() => act('list', 'mins', { list: 'agenda', id: it.id, delta: 1 })} aria-label={`Longer: ${it.title}`}>+</button></span>}
          {!deal && (it.mine || !it.takers.length) && <button className={`btn small ${it.mine ? 'ghost' : ''}`} onClick={() => act('list', 'take', { list: 'agenda', id: it.id })}>{it.mine ? 'Let go' : 'I will lead it'}</button>}
        </div>
      ))}
      {!deal && <AddForm label="Add an agenda item" placeholder="Add an agenda item" onAdd={(t) => act('list', 'add', { list: 'agenda', title: t })} />}
      {a.rotation && <div className="small">Notes, week by week: {a.rotation.map((p, i) => <span key={i} className="rot"><Dot p={p} size={18} /> {p.you ? 'you' : p.name}</span>)}</div>}
      {a.day && a.time && <div className="row wrap-row" style={{ gap: 8 }}>
        <a className="btn small ghost" href={google} target="_blank" rel="noreferrer noopener">Weekly invite in Google Calendar</a>
        <a className="btn small ghost" href={`data:text/calendar;charset=utf-8,${encodeURIComponent(ics)}`} download="team-meeting.ics">Weekly .ics</a>
        <span className="tiny muted">Every {a.day}, {a.time}, for 10 weeks{a.format === 'video' ? ', on a video call' : ''}</span>
      </div>}
    </Section>
  );
}

// ---------- study session: topics, a shared timer, flashcards ----------
function Timer({ t, act, deal }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { if (!t) return undefined; const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id); }, [t?.endsAt]);
  const left = t ? Math.min(t.mins * 60000, Math.max(0, t.endsAt - now)) : 0;
  const frac = t ? left / (t.mins * 60000) : 1;
  const R = 34, C = 2 * Math.PI * R;
  return (
    <div className="timer">
      <svg viewBox="0 0 80 80" className={`timer-ring ${t?.mode || ''}`} aria-hidden="true"><circle cx="40" cy="40" r={R} className="tr-track" /><circle cx="40" cy="40" r={R} className="tr-fill" strokeDasharray={`${frac * C} ${C}`} transform="rotate(-90 40 40)" /></svg>
      <div className="grow">
        <div className="timer-left" role="timer" aria-live="off">{t ? `${Math.floor(left / 60000)}:${String(Math.floor(left / 1000) % 60).padStart(2, '0')}` : '25:00'}</div>
        <div className="tiny muted">{t ? (left ? `${t.mode === 'break' ? 'Break' : 'Focus'}, started by ${t.by}. Everyone sees the same clock.` : `${t.mode === 'break' ? 'Break' : 'Focus block'} is over.`) : 'A shared timer for the whole group.'}</div>
      </div>
      {!deal && <span className="stack" style={{ gap: 4 }}>
        <button className="btn small" onClick={() => act('timer', 'start', { mode: 'focus' })}>Focus 25</button>
        <button className="btn small ghost" onClick={() => act('timer', t && left ? 'stop' : 'start', { mode: 'break' })}>{t && left ? 'Stop' : 'Break 5'}</button>
      </span>}
    </div>
  );
}
function Flashcards({ deck, act, deal }) {
  const [i, setI] = useState(0), [flip, setFlip] = useState(false);
  const [q, setQ] = useState(''), [a, setA] = useState('');
  const c = deck[Math.min(i, deck.length - 1)];
  return (
    <div className="stack" style={{ gap: 8 }}>
      {c ? <>
        <button className={`flash ${flip ? 'back' : ''}`} onClick={() => setFlip(!flip)} aria-label={flip ? `Answer: ${c.a}. Tap to see the question` : `Question: ${c.q}. Tap to see the answer`}>
          <span className="tiny muted">{flip ? 'Answer' : `Card ${Math.min(i, deck.length - 1) + 1} of ${deck.length} · by ${c.by}`}</span>
          <span className="flash-text">{flip ? c.a : c.q}</span>
          <span className="tiny muted">{c.yes} got it · {c.no} not yet</span>
        </button>
        <div className="row between">
          <button className="linkbtn small" disabled={i === 0} onClick={() => { setI(i - 1); setFlip(false); }}>Previous</button>
          {!deal && <span className="row" style={{ gap: 4 }}><button className={`btn small ${c.mine === 'yes' ? '' : 'ghost'}`} onClick={() => act('card', 'know', { id: c.id, v: c.mine === 'yes' ? '' : 'yes' })}>Got it</button><button className={`btn small ${c.mine === 'no' ? '' : 'ghost'}`} onClick={() => act('card', 'know', { id: c.id, v: c.mine === 'no' ? '' : 'no' })}>Not yet</button></span>}
          <button className="linkbtn small" disabled={i >= deck.length - 1} onClick={() => { setI(i + 1); setFlip(false); }}>Next</button>
        </div>
      </> : <div className="small muted">No flashcards yet. Write one, or ask "@AI quiz us on" a topic and the AI adds cards here.</div>}
      {!deal && <form className="stack" style={{ gap: 6 }} onSubmit={(e) => { e.preventDefault(); if (q.trim().length > 2 && a.trim()) { act('card', 'add', { q, a }); setQ(''); setA(''); setI(deck.length); setFlip(false); } }}>
        <div className="add-row"><input type="text" value={q} maxLength={160} placeholder="Question" aria-label="Flashcard question" onChange={(e) => setQ(e.target.value)} /></div>
        <div className="add-row"><input type="text" value={a} maxLength={160} placeholder="Answer" aria-label="Flashcard answer" onChange={(e) => setA(e.target.value)} /><button className="btn small" disabled={q.trim().length < 3 || !a.trim()}>Add card</button></div>
      </form>}
    </div>
  );
}
export function Study({ x, act, deal }) {
  const s = x.study;
  if (!s) return null;
  return (
    <Section id="part-x-study" title="Study plan" aside={`${s.items.filter((i) => i.takers.length).length} of ${s.items.length} topics taken`}>
      <Timer t={s.timer} act={act} deal={deal} />
      <ClaimRows items={s.items} list="study" act={act} deal={deal} cap={1} />
      <div className="label" style={{ marginTop: 4 }}>Flashcards</div>
      <Flashcards deck={s.deck} act={act} deal={deal} />
    </Section>
  );
}

// ---------- volunteer shifts ----------
export function Shifts({ x, act, deal }) {
  const s = x.shifts;
  if (!s) return null;
  const span = s.to - s.from;
  const hours = Array.from({ length: span / 60 + 1 }, (_, i) => s.from + i * 60);
  return (
    <Section id="part-x-shifts" title={`Shifts at ${s.place}`} aside="Two people per shift">
      <div className="gantt">
        <div className="gantt-scale" aria-hidden="true">{hours.map((h) => <span key={h} style={{ left: `${((h - s.from) / span) * 100}%` }}>{clock(h)}</span>)}</div>
        {s.items.map((it) => (
          <div key={it.id} className="gantt-row">
            <button className={`gantt-bar ${it.mine ? 'mine' : ''} ${it.takers.length >= it.cap ? 'full' : ''}`} style={{ left: `${((it.start - s.from) / span) * 100}%`, width: `${(it.len / span) * 100}%` }}
              disabled={deal || (!it.mine && it.takers.length >= it.cap)} onClick={() => act('list', 'take', { list: 'shifts', id: it.id })}
              aria-label={`${it.title}, ${clock(it.start)} to ${clock(it.start + it.len)}: ${it.takers.length} of ${it.cap}. ${it.mine ? 'Tap to leave' : 'Tap to sign up'}`}>
              <span className="gantt-title">{it.title}</span>
              <span className="gantt-who">{it.takers.map((p, i) => <Dot key={i} p={p} size={20} />)}{Array.from({ length: it.cap - it.takers.length }, (_, i) => <span key={`e${i}`} className="xdot empty" aria-hidden="true" />)}</span>
            </button>
          </div>
        ))}
      </div>
      <div className="tiny muted">Tap a shift to sign up. One shift each.</div>
      <div className="label" style={{ marginTop: 4 }}>Before you go</div>
      {s.check.map((c) => (
        <label key={c.text} className="check-row"><input type="checkbox" checked={c.mine} disabled={deal} onChange={() => act('check', 'toggle', { item: c.text })} /><span className="grow">{c.text}</span><span className="tiny muted">{c.done} of {s.people} done</span></label>
      ))}
    </Section>
  );
}

// ---------- invite with RSVPs ----------
export function Invite({ x, act, deal }) {
  const v = x.invite;
  const [edit, setEdit] = useState(false);
  const [done, setDone] = useState('');
  if (!v) return null;
  const copy = async () => { try { await navigator.clipboard.writeText(v.text); setDone('Copied'); } catch { setDone('Could not copy here'); } setTimeout(() => setDone(''), 2000); };
  return (
    <Section id="part-x-invite" title="Invite" aside={`${v.going} going · ${v.maybe} maybe · ${v.no} no`}>
      <div className="invite-card">
        {v.hideFrom && <span className="secret">Keep it secret from {v.hideFrom}</span>}
        {edit
          ? <form className="stack" style={{ gap: 6 }} onSubmit={(e) => { e.preventDefault(); act('invite', 'text', { text: e.target.elements.t.value }); setEdit(false); }}><textarea name="t" defaultValue={v.text} rows={4} maxLength={400} aria-label="Invite text" /><button className="btn small">Save</button></form>
          : <p className="invite-text">{v.text}</p>}
      </div>
      {!deal && !edit && <div className="row wrap-row" style={{ gap: 6 }}>
        <button className="btn small" onClick={copy}>Copy the invite</button>
        <a className="btn small ghost" href={`sms:?&body=${encodeURIComponent(v.text)}`}>Text it</a>
        <button className="linkbtn small" onClick={() => setEdit(true)}>Edit</button>
        {v.edited && <button className="linkbtn small" onClick={() => act('invite', 'reset', {})}>Use the plan again</button>}
        {done && <span className="small muted" role="status">{done}</span>}
      </div>}
      <div className="label" style={{ marginTop: 4 }}>Guests</div>
      {v.guests.length === 0 && <div className="small muted">Add the people you invite, and mark their answers as they come in.</div>}
      {v.guests.map((gst) => (
        <div key={gst.id} className="row between guest">
          <span className="grow small"><strong>{gst.name}</strong></span>
          <span className="seg rsvp" role="group" aria-label={`${gst.name}'s answer`}>{['going', 'maybe', 'no'].map((r) => <button key={r} disabled={deal} aria-pressed={gst.rsvp === r} className={gst.rsvp === r ? `on ${r}` : ''} onClick={() => act('invite', 'rsvp', { id: gst.id, rsvp: r })}>{r === 'going' ? 'Going' : r === 'maybe' ? 'Maybe' : 'No'}</button>)}</span>
          {!deal && <button className="linkbtn small" aria-label={`Remove ${gst.name}`} onClick={() => act('invite', 'remove', { id: gst.id })}>×</button>}
        </div>
      ))}
      {!deal && <AddForm label="Add a guest" placeholder="Guest's name" max={40} onAdd={(t) => act('invite', 'guest', { name: t })} />}
      <div className="tiny muted">A demo: nothing is sent. Copy or text the invite yourself.</div>
    </Section>
  );
}

// ---------- reminders ----------
const BEFORE = [[24 * 60, 'The day before'], [3 * 60, 'Three hours before'], [60, 'An hour before'], [15, '15 minutes before']];
const beforeText = (m) => (BEFORE.find(([v]) => v === m)?.[1] || (m >= 1440 ? `${Math.round(m / 1440)} days before` : m >= 60 ? `${Math.round(m / 60)} hours before` : `${m} minutes before`));
export function Reminders({ g, x, act }) {
  const [text, setText] = useState(''), [before, setBefore] = useState(60), [who, setWho] = useState('all');
  const list = x.reminders || [];
  const plan = Object.fromEntries(g.panel.filter((f) => f.leader).map((f) => [f.id, f.leader]));
  const e = planEvent(g, plan);
  const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Cabrillo//EN', 'BEGIN:VEVENT', `UID:${g.id}-rem@cabrillo`, `DTSTART:${ical(e.start)}`, `DTEND:${ical(e.end)}`, `SUMMARY:${e.title}`, `LOCATION:${e.location}`,
    ...list.flatMap((r) => ['BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${r.text}`, `TRIGGER:-PT${r.before}M`, 'END:VALARM']), 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  return (
    <Section id="part-x-reminders" title="Reminders" aside={e.start.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}>
      {list.map((r) => (
        <div key={r.id} className="rem">
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" className="bell"><path d="M12 3a5 5 0 0 0-5 5v3.5L5 15h14l-2-3.5V8a5 5 0 0 0-5-5zM10 18a2 2 0 0 0 4 0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /></svg>
          <span className="grow small"><strong>{r.text}</strong><br /><span className="muted">{beforeText(r.before)} · {r.mine ? 'only you' : 'everyone'}</span></span>
          <button className="linkbtn small" aria-label={`Remove reminder: ${r.text}`} onClick={() => act('reminder', 'remove', { id: r.id })}>×</button>
        </div>
      ))}
      <form className="stack" style={{ gap: 6 }} onSubmit={(ev) => { ev.preventDefault(); if (text.trim().length > 1) { act('reminder', 'add', { text, before, who }); setText(''); } }}>
        <div className="add-row"><input type="text" value={text} maxLength={80} placeholder="Remind us to..." aria-label="Reminder text" onChange={(ev) => setText(ev.target.value)} /><button className="btn small" disabled={text.trim().length < 2}>Add</button></div>
        <div className="row wrap-row" style={{ gap: 6 }}>
          <select value={before} onChange={(ev) => setBefore(+ev.target.value)} aria-label="When" className="small-select">{BEFORE.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          <select value={who} onChange={(ev) => setWho(ev.target.value)} aria-label="For whom" className="small-select"><option value="all">For everyone</option><option value="me">Only for me</option></select>
        </div>
      </form>
      <a className="btn small ghost" href={`data:text/calendar;charset=utf-8,${encodeURIComponent(ics)}`} download="plan-with-reminders.ics">Add the plan and these reminders to my calendar</a>
      <div className="tiny muted">Your calendar app sends the reminders.</div>
    </Section>
  );
}
