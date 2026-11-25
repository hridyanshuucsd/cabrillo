import React, { useEffect, useState } from 'react';
import MapView, { along, gmapsDirections, gmapsPlace, uberLink, lyftLink, openTableLink, resyLink } from './MapView.jsx';

// Cards the AI posts in the chat: a map of the options, an Uber-style ride, and a restaurant table.
// Every card is a demo: nothing is booked or charged, and each card says so.

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
export function MapCard({ m }) {
  const [full, setFull] = useState(false);
  if (!m) return null;
  if (m.kind === 'route') return <RouteCard m={m} />;
  const pts = [{ ...m.origin, kind: 'pickup' }, ...m.places.map((p, i) => ({ ...p, kind: 'place', label: i + 1, active: p.id === m.leader }))];
  return (
    <div className="card-ai mapcard" id={`map-${m.id}`} role="group" aria-label="Map of the options">
      <button className="map-tap" onClick={() => setFull(true)} aria-label="Open the map full screen"><MapView points={pts} height={150} /><span className="map-hint">Tap to open</span></button>
      <div className="card-ai-body">
        {m.auto && <div className="why">The AI added this because you are comparing places.</div>}
        <div className="row between"><strong>Options on the map</strong><span className="small muted">from campus</span></div>
        {m.places.map((p, i) => (
          <div key={p.id} className={`place-row ${p.id === m.leader ? 'lead' : ''}`}>
            <span className="mk place inline">{i + 1}</span>
            <span className="grow"><strong>{p.name}</strong>{p.id === m.leader && <span className="chip ok" style={{ marginLeft: 6 }}>In the plan</span>}<br /><span className="small muted">{p.minutes} min drive · {p.miles} mi</span></span>
            <a className="btn ghost small" href={gmapsDirections(m.origin, p)} target="_blank" rel="noreferrer">Directions</a>
          </div>
        ))}
        <div className="tiny muted">Drive times are estimates. Directions open Google Maps.</div>
      </div>
      {full && <FullMap title="Options on the map" points={pts} onClose={() => setFull(false)} />}
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

export function RideCard({ b, send, offset }) {
  const [full, setFull] = useState(false);
  const now = useNow(b?.status === 'booked', offset || 0);
  if (!b) return null;
  const ph = ridePhase(b, now);
  const opt = b.options.find((o) => o.id === b.choice);
  const pts = [{ ...b.origin, kind: 'pickup' }, { ...b.place, kind: 'dropoff' }];
  const car = ph?.car || null;
  const mapProps = { points: pts, route: b.route, car };
  return (
    <div className="card-ai ride" id={`booking-${b.id}`} role="group" aria-label={`Ride to ${b.place.name}`}>
      <button className="map-tap" onClick={() => setFull(true)} aria-label="Open the ride map full screen">
        <MapView {...mapProps} height={170} />
        <span className="map-hint">{ph ? 'Live demo' : 'Tap to open'}</span>
      </button>
      <div className="card-ai-body">
        {b.auto && <div className="why">The AI added this because the plan says rideshare.</div>}
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
        <div className="row between">
          <a className="small" href={gmapsDirections(b.origin, b.place)} target="_blank" rel="noreferrer">Open the route in Google Maps</a>
          <span className="tiny muted">Demo · nothing is charged</span>
        </div>
      </div>
      {full && <FullMap title={`Ride to ${b.place.name}`} {...mapProps} onClose={() => setFull(false)} />}
    </div>
  );
}

// ---------- restaurant table ----------
export function TableCard({ b, send }) {
  const [full, setFull] = useState(false);
  if (!b) return null;
  const pts = [{ ...b.place, kind: 'place', label: '', active: true }];
  return (
    <div className="card-ai table" id={`booking-${b.id}`} role="group" aria-label={`Booking: ${b.title}`}>
      <button className="map-tap" onClick={() => setFull(true)} aria-label="Open the map full screen"><MapView points={pts} height={130} /><span className="map-hint">Tap to open</span></button>
      <div className="card-ai-body">
        {b.auto && <div className="why">The AI added this because you picked a place and a time.</div>}
        <div className="row between" style={{ alignItems: 'flex-start' }}>
          <div><strong className="ride-title">{b.restaurant}</strong><div className="small muted">Near {b.place.name} · table for {b.n}</div></div>
          {statusChip(b, 'Reserved (demo)')}
        </div>
        {b.status === 'asking' && <><PrivateAnswer b={b} send={send} /><Progress b={b} /></>}
        {b.status === 'booked' && <div className="reserved"><strong>Reserved for {b.n} · {b.slot}</strong><span className="small">The earliest time that works for everyone. Confirmation {b.code} · about {money(b.perPerson)} each.</span></div>}
        {b.status === 'none' && <div className="small muted">No time works for everyone, so nothing was reserved. Nobody's answer is shown.</div>}
        <div className="row between">
          <a className="small" href={gmapsPlace(b.place, b.restaurant)} target="_blank" rel="noreferrer">Find it in Google Maps</a>
          <span className="tiny muted">Demo · nothing is charged</span>
        </div>
      </div>
      {full && <FullMap title={b.restaurant} points={pts} onClose={() => setFull(false)} />}
    </div>
  );
}

// ---------- the way there (bus or car) ----------
function RouteCard({ m }) {
  const [full, setFull] = useState(false);
  const transit = m.mode === 'transit';
  const pts = [{ ...m.origin, kind: 'pickup' }, { ...m.place, kind: 'dropoff' }];
  const title = `Getting to ${m.place.name}`;
  return (
    <div className="card-ai route" id={`map-${m.id}`} role="group" aria-label={title}>
      <button className="map-tap" onClick={() => setFull(true)} aria-label="Open the route full screen"><MapView points={pts} route={m.route} height={150} /><span className="map-hint">Tap to open</span></button>
      <div className="card-ai-body">
        {m.auto && <div className="why">The AI added this because the plan has a place and says {transit ? 'bus or trolley' : 'carpool'}.</div>}
        <div className="row between"><strong>{title}</strong><span className="chip">{transit ? 'Bus or trolley' : 'By car'}</span></div>
        <div className="route-stats">
          <div><span className="big">{m.minutes}</span><span className="small muted"> min{transit ? ', about' : ''}</span></div>
          <div><span className="big">{m.miles}</span><span className="small muted"> mi</span></div>
          <div className="small muted">from {m.origin.name}</div>
        </div>
        <a className="btn ghost block" href={gmapsDirections(m.origin, m.place, transit ? 'transit' : 'driving')} target="_blank" rel="noreferrer">{transit ? 'Bus and trolley times in Google Maps' : 'Directions in Google Maps'}</a>
        <div className="tiny muted">{transit ? 'Bus times are a rough estimate; Google Maps has the live schedule.' : 'Drive time is an estimate.'}</div>
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

// ---------- the same cards, small, inside the chat ----------
// A picture and a few words instead of a paragraph: a map with times, a ride with its price, a table with its time,
// who owes what. Each one hands off to the real app (Google Maps, Uber, Lyft, OpenTable, Resy) and opens the full card
// on the board for the details. Only the person's own private answer is asked for here, with one tap to the board.
const Go = ({ href, children }) => <a className="app-btn" href={href} target="_blank" rel="noreferrer noopener">{children}</a>;
export function InlineCard({ m, g, openBoard, target }) {
  const bk = m.kind === 'booking' ? (g.bookings || []).find((x) => x.id === m.bookingId) : null;
  const mp = m.kind === 'map' ? (g.maps || []).find((x) => x.id === m.mapId) : null;
  const bill = m.kind === 'bill' ? (g.bills || []).find((x) => x.id === m.billId) : null;
  const details = (label) => <button className="app-more" onClick={() => openBoard(target)} aria-label={`${label}: details on the board`}>Details</button>;
  if (mp && mp.kind === 'route') {
    const transit = mp.mode === 'transit';
    return (
      <div className="icard" role="group" aria-label={`Summary: route to ${mp.place.name}`}>
        <MapView points={[{ ...mp.origin, kind: 'pickup' }, { ...mp.place, kind: 'dropoff' }]} route={mp.route} height={104} />
        <div className="icard-body">
          <div className="icard-top"><span className="icard-big">{mp.minutes} min</span><span className="icard-sub">{transit ? 'by bus or trolley' : 'by car'} to {mp.place.name}</span></div>
          <div className="icard-actions"><Go href={gmapsDirections(mp.origin, mp.place, transit ? 'transit' : 'driving')}>Google Maps</Go>{details('Route')}</div>
        </div>
      </div>
    );
  }
  if (mp) {
    const pts = [{ ...mp.origin, kind: 'pickup' }, ...mp.places.map((p, i) => ({ ...p, kind: 'place', label: i + 1, active: p.id === mp.leader }))];
    return (
      <div className="icard" role="group" aria-label="Summary: map of the options">
        <MapView points={pts} height={110} />
        <div className="icard-body">
          <div className="icard-places">{mp.places.map((p, i) => <span key={p.id} className={`icard-place ${p.id === mp.leader ? 'lead' : ''}`}><span className="mk place inline">{i + 1}</span>{p.name.replace(/ hike$/, '')}<span className="muted"> {p.minutes} min</span></span>)}</div>
          <div className="icard-actions"><Go href={gmapsPlace(mp.places[0] || mp.origin)}>Google Maps</Go>{details('Map')}</div>
        </div>
      </div>
    );
  }
  if (bk && bk.kind === 'ride') {
    const opt = bk.options.find((o) => o.id === bk.choice);
    const ask = bk.status === 'asking' && bk.rider !== false && bk.mine === null;
    return (
      <div className="icard" role="group" aria-label={`Summary: ride to ${bk.place.name}`}>
        <MapView points={[{ ...bk.origin, kind: 'pickup' }, { ...bk.place, kind: 'dropoff' }]} route={bk.route} height={104} />
        <div className="icard-body">
          <div className="icard-top"><span className="icard-big">{bk.status === 'booked' ? money(bk.perPerson) : `from ${money(Math.min(...bk.options.map((o) => o.perPerson)))}`}</span><span className="icard-sub">each · ride to {bk.place.name} · {bk.minutes} min</span></div>
          <div className={`icard-status ${bk.status}`}>{bk.status === 'asking' ? `${bk.answered} of ${bk.of} answered` : bk.status === 'booked' ? `Booked (demo): ${opt?.name}` : 'Not booked'}</div>
          <div className="icard-actions">
            {ask && <button className="app-btn main" onClick={() => openBoard(target)}>Answer privately</button>}
            <Go href={uberLink(bk.origin, bk.place)}>Uber</Go><Go href={lyftLink(bk.origin, bk.place)}>Lyft</Go>{details('Ride')}
          </div>
        </div>
      </div>
    );
  }
  if (bk) {
    const ask = bk.status === 'asking' && bk.mine === null;
    return (
      <div className="icard" role="group" aria-label={`Summary: table at ${bk.restaurant}`}>
        <div className="icard-body">
          <div className="icard-top"><span className="icard-big">{bk.status === 'booked' ? bk.slot : `Table for ${bk.n}`}</span><span className="icard-sub">{bk.restaurant}{bk.whenName ? ` · ${bk.whenName}` : ''}</span></div>
          <div className={`icard-status ${bk.status}`}>{bk.status === 'asking' ? `${bk.answered} of ${bk.of} answered · about ${money(bk.perPerson)} each` : bk.status === 'booked' ? `Reserved (demo) for ${bk.n}` : 'Not reserved'}</div>
          <div className="icard-actions">
            {ask && <button className="app-btn main" onClick={() => openBoard(target)}>Pick times privately</button>}
            <Go href={openTableLink(bk.restaurant, bk.n)}>OpenTable</Go><Go href={resyLink(bk.restaurant)}>Resy</Go><Go href={gmapsPlace(bk.place, bk.restaurant)}>Maps</Go>{details('Table booking')}
          </div>
        </div>
      </div>
    );
  }
  if (bill) {
    const total = bill.rows.reduce((a, r) => a + r.amount, 0);
    const mine = bill.rows.filter((r) => r.mine && !r.paid).reduce((a, r) => a + r.amount, 0);
    return (
      <div className="icard" role="group" aria-label={`Summary: ${bill.title}`}>
        <div className="icard-body">
          <div className="icard-top"><span className="icard-big">{mine ? `You pay ${money(mine)}` : money(total)}</span><span className="icard-sub">{bill.title}</span></div>
          <div className={`icard-status ${bill.status}`}>{bill.status === 'settled' ? 'All paid (demo)' : bill.status === 'stale' ? 'Out of date' : `${bill.rows.filter((r) => r.paid).length} of ${bill.rows.length} paid`}</div>
          <div className="icard-actions">{mine > 0 && bill.status === 'open' && <button className="app-btn main" onClick={() => openBoard(target)}>Pay</button>}{details('Who owes what')}</div>
        </div>
      </div>
    );
  }
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
          {x.lat && <Go href={gmapsPlace({ lat: x.lat, lng: x.lng }, x.restaurant || x.name)}>Google Maps</Go>}
        </div>}
      </div>
    </div>
  );
}
