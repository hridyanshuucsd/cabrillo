import React, { useEffect, useState } from 'react';
import MapView, { along } from './MapView.jsx';

// Cards the AI posts in the chat: a map of the options, an Uber-style ride, a restaurant table, and movie tickets
// with snacks. Everything happens inside the app: tap a pin to see a place and the way there, answer a ride or a
// table right in the card, pick seats and pre-order popcorn. Every card is a demo: nothing is booked or charged.

function FullMap({ title, onClose, ...map }) {
  useEffect(() => { const k = (e) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet map-sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head"><strong>{title}</strong><button className="btn ghost small" onClick={onClose}>Close</button></div>
        <MapView {...map} interactive height="62dvh" />
      </div>
    </div>
  );
}

const CarIcon = () => <svg viewBox="0 0 32 20" width="40" height="25" aria-hidden="true"><path d="M5 13l2.5-6.5C8 5 9 4.5 10.5 4.5h11c1.5 0 2.5.5 3 2L27 13" fill="none" stroke="currentColor" strokeWidth="2" /><rect x="2.5" y="12" width="27" height="5.5" rx="2.5" fill="currentColor" /><circle cx="9" cy="18" r="2" fill="#fff" stroke="currentColor" strokeWidth="1.5" /><circle cx="23" cy="18" r="2" fill="#fff" stroke="currentColor" strokeWidth="1.5" /></svg>;
const money = (x) => `$${x.toFixed(2)}`;

// ---------- map of the place options ----------
// Tap a pin (or a name under the map) to see that place: how far it is by car and by bus, who wants it, and a button
// to pick it. The way there is drawn on the map. "Bigger map" opens the same map full screen, where it also pans and
// zooms. Nothing opens another app.
const busMin = (min) => Math.round(min * 2.2 + 8);
export function PlaceMap({ g, send, m, height = 150, full = false }) {
  const [sel, setSel] = useState(null);
  const [big, setBig] = useState(false);
  const field = g?.board?.placeField || m.field;
  const row = g?.panel.find((f) => f.id === field);
  const s = m.places.find((p) => p.id === sel);
  const pts = [{ ...m.origin, kind: 'pickup' }, ...m.places.map((p, i) => ({ ...p, kind: 'place', label: i + 1, active: p.id === (sel || m.leader) }))];
  const who = (id) => row?.options.find((o) => o.option === id)?.who || [];
  const mine = g?.me.prefs[field];
  const choose = (id) => setSel(id === sel ? null : id);
  return (
    <div className="placemap">
      <div className="placemap-map">
        <MapView points={pts} line={s ? [[m.origin.lat, m.origin.lng], [s.lat, s.lng]] : null} height={height} interactive={full} onPoint={(p) => choose(p.id)} />
        {!full && <button className="map-big" onClick={() => setBig(true)}>Bigger map</button>}
      </div>
      {s ? (
        <div className="place-pop" aria-live="polite">
          <div className="row between" style={{ alignItems: 'flex-start' }}><strong>{s.name}</strong><button className="linkbtn" onClick={() => setSel(null)} aria-label="Close this place">✕</button></div>
          <div className="small"><strong>{s.minutes} min</strong> by car · <strong>about {busMin(s.minutes)} min</strong> by bus · {s.miles} mi from campus</div>
          {who(s.id).length > 0 && <div className="small muted">Wants it: {who(s.id).join(', ')}</div>}
          {g && !g.deal && field && <button className={`btn small ${mine === s.id ? 'ghost' : ''}`} onClick={() => send('game:pick', { field, option: mine === s.id ? '' : s.id })}>{mine === s.id ? 'Picked · tap to undo' : 'I want this one'}</button>}
        </div>
      ) : (
        <div className="place-chips" role="list">{m.places.map((p, i) => (
          <button key={p.id} role="listitem" className={`place-chip ${p.id === m.leader ? 'lead' : ''}`} onClick={() => choose(p.id)}>
            <span className="mk place inline">{i + 1}</span>{p.name}<span className="muted"> · {p.minutes} min</span>
          </button>
        ))}</div>
      )}
      {big && <FullPlaceMap g={g} send={send} m={m} onClose={() => setBig(false)} />}
    </div>
  );
}
function FullPlaceMap({ onClose, ...props }) {
  useEffect(() => { const k = (e) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet map-sheet" role="dialog" aria-modal="true" aria-label="Map of the options" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head"><strong>Options on the map</strong><button className="btn ghost small" onClick={onClose}>Close</button></div>
        <PlaceMap {...props} height="56dvh" full />
      </div>
    </div>
  );
}
export function MapCard({ m, g, send }) {
  if (!m) return null;
  if (m.kind === 'route') return <RouteCard m={m} />;
  return (
    <div className="card-ai mapcard" id={`map-${m.id}`} role="group" aria-label="Map of the options">
      <div className="card-ai-body">
        {m.auto && <div className="why">The AI added this because you are comparing places.</div>}
        <PlaceMap g={g} send={send} m={m} height={170} />
        <div className="tiny muted">Times are estimates from campus.</div>
      </div>
    </div>
  );
}

// ---------- ride ----------
function useNow(active, offset) {
  const [now, setNow] = useState(Date.now() + offset);
  useEffect(() => { if (!active) return; const t = setInterval(() => setNow(Date.now() + offset), 250); return () => clearInterval(t); }, [active, offset]);
  return active ? now : Date.now() + offset;
}
function ridePhase(b, now) {
  if (b.status !== 'booked' || !b.phases) return null;
  const { matchedAt, pickupAt, dropoffAt } = b.phases;
  if (now < matchedAt) return { step: 'matching' };
  if (now < pickupAt) {
    const t = (now - matchedAt) / (pickupAt - matchedAt);
    const from = b.driverFrom, to = b.origin;
    const bearing = (Math.atan2((to.lng - from.lng) * 0.84, to.lat - from.lat) * 180) / Math.PI;
    return { step: 'arriving', t, car: { lat: from.lat + (to.lat - from.lat) * t, lng: from.lng + (to.lng - from.lng) * t, bearing }, secs: Math.ceil((pickupAt - now) / 1000) };
  }
  if (now < dropoffAt) { const t = (now - pickupAt) / (dropoffAt - pickupAt); return { step: 'trip', t, car: along(b.route, t), left: Math.max(1, Math.round(b.minutes * (1 - t))) }; }
  return { step: 'arrived', car: { lat: b.place.lat, lng: b.place.lng, bearing: 0 } };
}

// The private part of a ride or table card. Whether to book is decided in the group; which ride (or which time) works
// for you is between you and the AI. The group sees how many people have answered and the result, never who said what.
function PrivateAnswer({ b, send }) {
  const ride = b.kind === 'ride';
  const [sel, setSel] = useState(() => new Set(b.mine || []));
  const [editing, setEditing] = useState(b.mine === null);
  useEffect(() => { if (b.mine === null) setEditing(true); }, [b.mine === null]);
  const toggle = (id) => setSel((x) => { const n = new Set(x); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const submit = (ids) => { send('game:booking-answer', { bookingId: b.id, ok: ids }); setEditing(false); };
  const name = (id) => b.options.find((o) => o.id === id)?.name;
  if (!editing) return (
    <div className="private-box">
      <span className="only-you">Only you see this</span>
      <span>{b.mine?.length ? <>You said these work for you: <strong>{b.mine.map(name).join(', ')}</strong>.</> : <>You said <strong>none of these</strong> work for you.</>}</span>
      <button className="linkbtn" style={{ alignSelf: 'flex-start', padding: '2px 0' }} onClick={() => { setSel(new Set(b.mine || [])); setEditing(true); }}>Change my answer</button>
    </div>
  );
  return (
    <div className="private-box">
      <span className="only-you">Only you see this</span>
      <strong>{ride ? 'Which rides work for you?' : 'Which times work for you?'}</strong>
      <span className="small muted">Tap every one you are fine with. The group sees only the result, never who said what.</span>
      {ride ? (
        <div className="ride-opts" role="group" aria-label="Rides that work for you">
          {b.options.map((o) => (
            <button key={o.id} role="checkbox" aria-checked={sel.has(o.id)} className={`ride-opt ${sel.has(o.id) ? 'on' : ''}`} onClick={() => toggle(o.id)}>
              <CarIcon />
              <span className="grow"><strong>{o.name}</strong> <span className="small muted">· {o.seats} seats{o.cars > 1 ? ` · ${o.cars} cars` : ''}</span><br /><span className="small muted">{o.note} · {o.pickupMin} min away</span>
                {o.over?.length > 0 && <><br /><span className="opt-warn">Above the spending limit {o.over.join(', ')} shared</span></>}</span>
              <span className="ride-price"><strong>{money(o.perPerson)} each</strong><br /><span className="small muted">{money(o.total)} total</span></span>
            </button>
          ))}
        </div>
      ) : (
        <>
          <div className="slots" role="group" aria-label="Times that work for you">{b.options.map((o) => <button key={o.id} role="checkbox" aria-checked={sel.has(o.id)} className={sel.has(o.id) ? 'on' : ''} onClick={() => toggle(o.id)}>{o.name}</button>)}</div>
          <span className="small">About {money(b.perPerson)} per person.{b.options[0]?.over?.length > 0 && <span className="opt-warn"> Above the spending limit {b.options[0].over.join(', ')} shared.</span>}</span>
        </>
      )}
      <div className="row wrap-row" style={{ gap: 8 }}>
        <button className="btn small grow" disabled={!sel.size} onClick={() => submit([...sel])}>{sel.size ? 'Send my answer' : 'Tap what works'}</button>
        <button className="btn ghost small" onClick={() => submit([])}>None work for me</button>
      </div>
    </div>
  );
}
const Progress = ({ b }) => <div className="small muted">{b.answered} of {b.of} answered. {b.kind === 'ride' ? 'I book the cheapest ride that works for everyone.' : 'I hold the earliest time that works for everyone.'}</div>;
const statusChip = (b, done) => <span className={`chip ${b.status === 'booked' ? 'ok' : b.status === 'none' ? 'warn' : ''}`}>{b.status === 'asking' ? 'Asking each person' : b.status === 'booked' ? done : 'Not booked'}</span>;

export function RideCard({ b, send, offset, compact }) {
  const [full, setFull] = useState(false);
  const now = useNow(b?.status === 'booked', offset || 0);
  if (!b) return null;
  const ph = ridePhase(b, now);
  const opt = b.options.find((o) => o.id === b.choice);
  const pts = [{ ...b.origin, kind: 'pickup' }, { ...b.place, kind: 'dropoff' }];
  const car = ph?.car || null;
  const mapProps = { points: pts, route: b.route, car };
  return (
    <div className={`card-ai ride ${compact ? 'compact' : ''}`} id={compact ? undefined : `booking-${b.id}`} role="group" aria-label={compact ? `In the chat: ride to ${b.place.name}` : `Ride to ${b.place.name}`}>
      <button className="map-tap" onClick={() => setFull(true)} aria-label="Open the ride map full screen">
        <MapView {...mapProps} height={compact ? 120 : 170} />
        <span className="map-hint">{ph ? 'Live demo' : 'Tap to open'}</span>
      </button>
      <div className="card-ai-body">
        {b.auto && !compact && <div className="why">The AI added this because the plan says rideshare.</div>}
        <div className="row between" style={{ alignItems: 'flex-start' }}>
          <div><strong className="ride-title">Ride to {b.place.name}</strong><div className="small muted">From {b.origin.name} · {b.miles} mi · about {b.minutes} min</div></div>
          {statusChip(b, 'Booked (demo)')}
        </div>

        {b.riderNames && <div className="small muted">This ride is for {b.riderNames.join(', ')}. The others get there another way.</div>}
        {b.status === 'asking' && <>{b.rider !== false && <PrivateAnswer b={b} send={send} />}<Progress b={b} /></>}

        {b.status === 'booked' && ph && (
          <div className="ride-live" aria-live="polite">
            {ph.step === 'matching' && <div className="row" style={{ gap: 10 }}><div className="spinner small" aria-hidden="true" /><strong>Finding your driver...</strong></div>}
            {ph.step !== 'matching' && (
              <>
                <strong className="ride-status">{ph.step === 'arriving' ? `${b.driver.name} is arriving in ${ph.secs < 60 ? `${ph.secs} s` : `${Math.ceil(ph.secs / 60)} min`}` : ph.step === 'trip' ? `On the way · ${ph.left} min to ${b.place.name}` : `You have arrived at ${b.place.name}`}</strong>
                <div className="meter"><div style={{ width: `${Math.round((ph.step === 'arriving' ? ph.t * 0.25 : ph.step === 'trip' ? 0.25 + ph.t * 0.75 : 1) * 100)}%` }} /></div>
                <div className="driver">
                  <span className="avatar" style={{ background: '#10202b' }} aria-hidden="true">{b.driver.name[0]}</span>
                  <span className="grow"><strong>{b.driver.name}</strong> <span className="small muted">★ {b.driver.rating}</span><br /><span className="small muted">{b.driver.color} {b.driver.car}{b.cars > 1 ? ` · 1 of ${b.cars} cars` : ''}</span></span>
                  <span className="plate">{b.driver.plate}</span>
                </div>
              </>
            )}
            <div className="small muted">{opt.name}, the cheapest ride that works for everyone · {money(b.total)} total · {money(b.perPerson)} each. Confirmation {b.code}.</div>
          </div>
        )}
        {b.status === 'none' && <div className="small muted">No ride works for everyone, so nothing was booked. Nobody's answer is shown. Talk it over and ask again, or pick another way to get there.</div>}
        <div className="tiny muted">Demo · nothing is charged</div>
      </div>
      {full && <FullMap title={`Ride to ${b.place.name}`} {...mapProps} onClose={() => setFull(false)} />}
    </div>
  );
}

// ---------- restaurant table ----------
export function TableCard({ b, send, compact }) {
  const [full, setFull] = useState(false);
  if (!b) return null;
  const pts = [{ ...b.place, kind: 'place', label: '', active: true }];
  return (
    <div className={`card-ai table ${compact ? 'compact' : ''}`} id={compact ? undefined : `booking-${b.id}`} role="group" aria-label={compact ? `In the chat: table at ${b.restaurant}` : `Booking: ${b.title}`}>
      <button className="map-tap" onClick={() => setFull(true)} aria-label="Open the map full screen"><MapView points={pts} height={compact ? 100 : 130} /><span className="map-hint">Tap to open</span></button>
      <div className="card-ai-body">
        {b.auto && !compact && <div className="why">The AI added this because you picked a place and a time.</div>}
        <div className="row between" style={{ alignItems: 'flex-start' }}>
          <div><strong className="ride-title">{b.restaurant}</strong><div className="small muted">Near {b.place.name} · table for {b.n}</div></div>
          {statusChip(b, 'Reserved (demo)')}
        </div>
        {b.status === 'asking' && <><PrivateAnswer b={b} send={send} /><Progress b={b} /></>}
        {b.status === 'booked' && <div className="reserved"><strong>Reserved for {b.n} · {b.slot}</strong><span className="small">The earliest time that works for everyone. Confirmation {b.code} · about {money(b.perPerson)} each.</span></div>}
        {b.status === 'none' && <div className="small muted">No time works for everyone, so nothing was reserved. Nobody's answer is shown.</div>}
        <div className="tiny muted">Demo · nothing is charged</div>
      </div>
      {full && <FullMap title={b.restaurant} points={pts} onClose={() => setFull(false)} />}
    </div>
  );
}

// ---------- the way there (bus or car) ----------
export function RouteCard({ m, compact }) {
  const [full, setFull] = useState(false);
  const transit = m.mode === 'transit';
  const pts = [{ ...m.origin, kind: 'pickup' }, { ...m.place, kind: 'dropoff' }];
  const title = `Getting to ${m.place.name}`;
  return (
    <div className={`card-ai route ${compact ? 'compact' : ''}`} id={compact ? undefined : `map-${m.id}`} role="group" aria-label={compact ? `In the chat: ${title.toLowerCase()}` : title}>
      <button className="map-tap" onClick={() => setFull(true)} aria-label="Open the route full screen"><MapView points={pts} route={m.route} height={compact ? 120 : 150} /><span className="map-hint">Tap to open</span></button>
      <div className="card-ai-body">
        {m.auto && !compact && <div className="why">The AI added this because the plan has a place and says {transit ? 'bus or trolley' : 'carpool'}.</div>}
        <div className="row between"><strong>{title}</strong><span className="chip">{transit ? 'Bus or trolley' : 'By car'}</span></div>
        <div className="route-stats">
          <div><span className="big">{m.minutes}</span><span className="small muted"> min{transit ? ', about' : ''}</span></div>
          <div><span className="big">{m.miles}</span><span className="small muted"> mi</span></div>
          <div className="small muted">from {m.origin.name}</div>
        </div>
        <div className="tiny muted">{transit ? 'Bus time is a rough estimate.' : 'Drive time is an estimate.'} Tap the map to see the whole route.</div>
      </div>
      {full && <FullMap title={title} points={pts} route={m.route} onClose={() => setFull(false)} />}
    </div>
  );
}

// ---------- the complete plan, ready to accept ----------
export function PlanCard({ g, m, onAccept }) {
  const live = JSON.stringify(m.plan) === JSON.stringify(g.plan) && JSON.stringify(m.ways || {}) === JSON.stringify(g.ways || {}) && !g.deal;
  const humans = g.players.filter((p) => !p.isAI);
  const accepted = humans.filter((p) => p.accepted).length;
  return (
    <div className={`card-ai plancard ${live ? '' : 'stale'}`} role="group" aria-label={m.text}>
      <div className="card-ai-body">
        <div className="row between"><strong>{live ? 'The plan is ready' : 'An earlier plan'}</strong>{live && <span className="chip ok">{accepted} of {humans.length} accepted</span>}</div>
        {g.task.fields.map((f) => (
          <div key={f.id} className="plan-line"><span className="small muted">{f.name}</span><strong className="plan-val">{f.options.find((o) => o.id === m.plan[f.id])?.name}
            {m.ways?.[f.id]?.length > 0 && <span className="own-line">{m.ways[f.id].map((x) => `${x.name}: ${x.optionName}`).join(' · ')}</span>}</strong></div>
        ))}
        {live
          ? <><button className={`btn block ${g.me.accepted ? 'ghost' : ''}`} onClick={onAccept}>{g.me.accepted ? 'Take back my acceptance' : 'Accept this plan'}</button>
              <div className="tiny muted">If it does not work for you, say so or change a pick. Any change clears every acceptance.</div></>
          : <div className="tiny muted">The plan changed after this.</div>}
      </div>
    </div>
  );
}

// ---------- who owes what ----------
// A table of who pays whom, and a button on your own row to pay through the AI. A demo: no money moves.
const METHOD = { venmo: 'Venmo', zelle: 'Zelle', cash: 'Cash' };
export function BillCard({ b, text, send, deal }) {
  if (!b) return null;
  const total = b.rows.reduce((a, r) => a + r.amount, 0);
  const mine = b.rows.filter((r) => r.mine && !r.paid);
  const getting = b.rows.filter((r) => r.toMe).reduce((a, r) => a + r.amount, 0);
  const paidN = b.rows.filter((r) => r.paid).length;
  const pay = (r, method) => send('game:bill-pay', { billId: b.id, rowId: r.id, method });
  const open = b.status === 'open';
  return (
    <div className={`card-ai bill ${b.status === 'stale' ? 'stale' : ''}`} id={`bill-${b.id}`} role="group" aria-label={b.title}>
      <div className="card-ai-body">
        {text && <div className="why">{text}</div>}
        <div className="row between" style={{ alignItems: 'flex-start' }}>
          <strong className="ride-title">{b.title}</strong>
          <span className={`chip ${b.status === 'settled' ? 'ok' : b.status === 'stale' ? 'warn' : ''}`}>{b.status === 'settled' ? 'All paid (demo)' : b.status === 'stale' ? 'Out of date' : `${paidN} of ${b.rows.length} paid`}</span>
        </div>
        <div className="blk-scroll">
          <table className="bill-table">
            <thead><tr><th>Who</th><th>Pays</th><th>To</th><th className="num">Amount</th></tr></thead>
            <tbody>
              {b.rows.map((r) => (
                <tr key={r.id} className={r.mine ? 'mine' : ''}>
                  <td><strong>{r.mine ? 'You' : r.name}</strong>{r.note && <div className="tiny muted">{r.note}</div>}</td>
                  <td>{r.paid ? <span className="paid">Paid · {METHOD[r.paid]}</span> : <span className="muted">Not yet</span>}</td>
                  <td>{r.toMe ? 'You' : r.toName}</td>
                  <td className="num"><strong>{money(r.amount)}</strong></td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td colSpan={3}>Total</td><td className="num"><strong>{money(total)}</strong></td></tr></tfoot>
          </table>
        </div>
        {b.notes?.map((n, i) => <div key={i} className="small muted">{n}</div>)}
        {getting > 0 && <div className="okline">You get {money(getting)} back.</div>}
        {b.hidden && open && <div className="private-box"><span className="only-you">Only you see this</span><span className="small">{b.hidden}</span></div>}
        {open && !deal && mine.map((r) => (
          <div key={r.id} className="private-box">
            <span className="only-you">Only you see this</span>
            <strong>Ready to pay {money(r.amount)} to {r.toName}?</strong>
            <div className="row wrap-row" style={{ gap: 8 }}>
              {(b.method ? [b.method] : ['venmo', 'zelle']).map((m) => (
                <button key={m} className="btn small grow" onClick={() => pay(r, m)}>{m === 'cash' ? 'I paid in cash' : `Pay with ${METHOD[m]}`}</button>
              ))}
            </div>
            <span className="tiny muted">The AI sends it for you. Demo: no money moves.</span>
          </div>
        ))}
        {b.status === 'stale' && <div className="small muted">The plan changed after this bill. Ask "@AI who owes what" for a new one.</div>}
      </div>
    </div>
  );
}

// ---------- the same cards, inside the chat ----------
// The real cards, a little smaller: you can tap the map, answer a ride or a table, and pick seats and snacks without
// leaving the chat. "Details" brings the card into view on the plan board.
export function InlineCard({ m, g, send, openBoard, target, offset }) {
  const bk = m.kind === 'booking' ? (g.bookings || []).find((x) => x.id === m.bookingId) : null;
  const mp = m.kind === 'map' ? (g.maps || []).find((x) => x.id === m.mapId) : null;
  const bill = m.kind === 'bill' ? (g.bills || []).find((x) => x.id === m.billId) : null;
  const details = (label) => <button className="app-more" onClick={() => openBoard(target)} aria-label={`${label}: details on the board`}>Details on the board</button>;
  if (mp && mp.kind === 'route') return <div className="icard-wrap"><RouteCard m={mp} compact />{details('Route')}</div>;
  if (mp) return <div className="icard-wrap"><div className="card-ai mapcard compact" role="group" aria-label="In the chat: map of the options"><div className="card-ai-body"><PlaceMap g={g} send={send} m={mp} height={140} /></div></div>{details('Map')}</div>;
  if (bk && bk.kind === 'ride') return <div className="icard-wrap"><RideCard b={bk} send={send} offset={offset} compact />{details('Ride')}</div>;
  if (bk) return <div className="icard-wrap"><TableCard b={bk} send={send} compact />{details('Table booking')}</div>;
  if (bill) {
    const total = bill.rows.reduce((a, r) => a + r.amount, 0);
    const mine = bill.rows.filter((r) => r.mine && !r.paid).reduce((a, r) => a + r.amount, 0);
    return (
      <div className="icard" role="group" aria-label={`In the chat: ${bill.title}`}>
        <div className="icard-body">
          <div className="icard-top"><span className="icard-big">{mine ? `You pay ${money(mine)}` : money(total)}</span><span className="icard-sub">{bill.title}</span></div>
          <div className={`icard-status ${bill.status}`}>{bill.status === 'settled' ? 'All paid (demo)' : bill.status === 'stale' ? 'Out of date' : `${bill.rows.filter((r) => r.paid).length} of ${bill.rows.length} paid`}</div>
          <div className="icard-actions">{mine > 0 && bill.status === 'open' && <button className="app-btn main" onClick={() => openBoard(target)}>Pay</button>}{details('Who owes what')}</div>
        </div>
      </div>
    );
  }
  if (m.kind === 'cinema' && g.cinema) return <div className="icard-wrap"><CinemaCard g={g} send={send} compact />{details('Tickets and snacks')}</div>;
  return null;
}

// An idea from the AI: the option, a small map when it is a place, and one tap to pick it or ask for another.
export function IdeaCard({ m, g, send }) {
  const x = m.idea;
  const mine = g.me.prefs[x.field] === x.option;
  return (
    <div className="icard idea" role="group" aria-label={`Idea: ${x.name}`}>
      {x.lat && <MapView points={[{ lat: x.lat, lng: x.lng, kind: 'place', label: '', active: true }]} height={90} />}
      <div className="icard-body">
        <div className="icard-top"><span className="icard-big">{x.name}</span>{x.minutes ? <span className="icard-sub">{x.minutes} min from campus</span> : null}</div>
        {!g.deal && <div className="icard-actions">
          <button className={`app-btn ${mine ? '' : 'main'}`} aria-pressed={mine} onClick={() => send('game:pick', { field: x.field, option: mine ? '' : x.option })}>{mine ? 'Picked' : 'I like it'}</button>
          <button className="app-btn" onClick={() => send('game:idea')}>Another idea</button>
        </div>}
      </div>
    </div>
  );
}

// ---------- movie tickets and snacks ----------
// Everyone taps their own seat on the seat map and pre-orders their own snacks; anyone books it all once the movie,
// theater and showtime are set. Snacks are then waiting at the counter. A demo: nothing is charged.
export function CinemaCard({ g, send, compact }) {
  const c = g.cinema;
  if (!c) return null;
  const locked = !!c.booked || !!g.deal;
  const bySeat = Object.fromEntries(c.seats.map((x) => [x.seat, x]));
  const mySeat = c.seats.find((x) => x.mine)?.seat;
  const ready = c.plan.movie && c.plan.theater && c.plan.when;
  const qty = (id) => c.mine[id] || 0;
  const title = c.plan.movie ? c.plan.movie.replace(/ \(.*\)$/, '') : 'Movie night';
  return (
    <div className={`card-ai cinema ${compact ? 'compact' : ''}`} id={compact ? undefined : 'cinema-card'} role="group" aria-label={compact ? 'In the chat: seats and snacks' : 'Seats and snacks'}>
      <div className="card-ai-body">
        <div className="row between" style={{ alignItems: 'flex-start' }}>
          <div><strong className="ride-title">{title}</strong><div className="small muted">{ready ? `${c.plan.theater} · ${c.plan.when} · $${c.plan.ticket} a ticket` : 'Pick the movie, theater and showtime, then book here.'}</div></div>
          <span className={`chip ${c.booked ? 'ok' : ''}`}>{c.booked ? 'Booked (demo)' : `${c.seats.length} seated`}</span>
        </div>

        <div className="seatmap" role="group" aria-label="Seat map">
          <div className="screen" aria-hidden="true">Screen</div>
          {[...c.rows].map((r) => (
            <div key={r} className="seatrow">
              <span className="rowlab" aria-hidden="true">{r}</span>
              {Array.from({ length: c.cols }, (_, i) => {
                const id = `${r}${i + 1}`, who = bySeat[id], taken = c.taken.includes(id);
                const state = who?.mine ? 'mine' : who ? 'friend' : taken ? 'taken' : 'free';
                return (
                  <button key={id} className={`seat ${state} ${i === c.cols / 2 - 1 ? 'aisle' : ''}`} disabled={locked || taken || (!!who && !who.mine)}
                    aria-label={`Seat ${id}${who ? `, ${who.mine ? 'your seat' : who.name}` : taken ? ', taken' : ', free'}`} aria-pressed={state === 'mine'}
                    onClick={() => send('game:seat', { seat: id })}>{who ? who.name[0] : ''}</button>
                );
              })}
            </div>
          ))}
          <div className="seat-key small muted"><span className="seat mine demo" /> you <span className="seat friend demo" /> your group <span className="seat taken demo" /> taken</div>
        </div>
        <div className="small">{mySeat ? <>Your seat: <strong>{mySeat}</strong>{c.seats.filter((x) => !x.mine).length > 0 && <span className="muted"> · {c.seats.filter((x) => !x.mine).map((x) => `${x.name.replace(/ \(AI\)$/, '')} ${x.seat}`).join(', ')}</span>}</> : locked ? 'No seat for you in this booking.' : 'Tap a free seat. Tap it again to give it up.'}</div>

        <div className="snacks" role="group" aria-label="Your snacks">
          <strong className="small">Your snacks</strong>
          {c.menu.map((it) => (
            <div key={it.id} className="snack-row">
              <span className="grow">{it.name}<span className="muted small"> · ${it.price.toFixed(2)}</span></span>
              {!locked && <button className="qbtn" aria-label={`One less ${it.name}`} disabled={!qty(it.id)} onClick={() => send('game:snack', { item: it.id, delta: -1 })}>−</button>}
              <span className="qty" aria-label={`${qty(it.id)} ${it.name}`}>{qty(it.id)}</span>
              {!locked && <button className="qbtn" aria-label={`Add ${it.name}`} onClick={() => send('game:snack', { item: it.id, delta: 1 })}>+</button>}
            </div>
          ))}
          {c.group.length > 0 && <div className="small muted">The whole group: {c.group.map((x) => `${x.qty} ${x.name.toLowerCase()}`).join(', ')}</div>}
        </div>

        <div className="row between wrap-row" style={{ gap: 8 }}>
          <span className="small">You pay <strong>${(c.booked?.mine ?? c.myTotal).toFixed(2)}</strong>{mySeat && ready ? <span className="muted"> (ticket and snacks)</span> : null}</span>
          {c.overMine && !c.booked && <span className="opt-warn">Only you see this: above your ${c.overMine} limit</span>}
        </div>
        {c.booked
          ? <div className="reserved"><strong>Booked · confirmation {c.booked.code}</strong><span className="small">Booked by {c.booked.by}. Show the code at the counter; your snacks will be ready when you arrive.</span></div>
          : !g.deal && <button className="btn block" disabled={!ready || !c.seats.length} onClick={() => send('game:cinema-book')}>{!ready ? 'Set the movie, theater and time first' : !c.seats.length ? 'Pick seats first' : 'Book the seats and snacks'}</button>}
        <div className="tiny muted">Demo · nothing is charged</div>
      </div>
    </div>
  );
}
