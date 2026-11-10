import React, { useEffect, useState } from 'react';
import MapView, { along, gmapsDirections, gmapsPlace } from './MapView.jsx';

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
    <div className="card-ai mapcard" role="group" aria-label="Map of the options">
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
    <div className="card-ai ride" role="group" aria-label={`Ride to ${b.place.name}`}>
      <button className="map-tap" onClick={() => setFull(true)} aria-label="Open the ride map full screen">
        <MapView {...mapProps} height={170} />
        <span className="map-hint">{ph ? 'Live demo' : 'Tap to open'}</span>
      </button>
      <div className="card-ai-body">
        {b.auto && <div className="why">The AI added this because the plan says rideshare.</div>}
        <div className="row between" style={{ alignItems: 'flex-start' }}>
          <div><strong className="ride-title">Ride to {b.place.name}</strong><div className="small muted">From {b.origin.name} · {b.miles} mi · about {b.minutes} min</div></div>
          <span className={`chip ${b.status === 'booked' ? 'ok' : b.status === 'declined' ? 'warn' : ''}`}>{b.status === 'pending' ? 'Waiting for everyone' : b.status === 'booked' ? 'Booked (demo)' : 'Not booked'}</span>
        </div>

        {b.status === 'pending' && (
          <>
            <div className="ride-opts" role="radiogroup" aria-label="Car type">
              {b.options.map((o) => (
                <button key={o.id} role="radio" aria-checked={o.id === b.choice} className={`ride-opt ${o.id === b.choice ? 'on' : ''}`} onClick={() => o.id !== b.choice && send('game:booking-option', { bookingId: b.id, option: o.id })}>
                  <CarIcon />
                  <span className="grow"><strong>{o.name}</strong> <span className="small muted">· {o.seats} seats{o.cars > 1 ? ` · ${o.cars} cars` : ''}</span><br /><span className="small muted">{o.note} · {o.pickupMin} min away</span></span>
                  <span className="ride-price"><strong>{money(o.total)}</strong><br /><span className="small muted">{money(o.perPerson)} each</span></span>
                </button>
              ))}
            </div>
            {b.warn && <div className="warnline">{b.warn}</div>}
            <Approve b={b} send={send} what={`${opt.name}, ${money(opt.perPerson)} each`} />
          </>
        )}

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
            <div className="small muted">{opt.name} · {money(b.total)} total · {money(b.perPerson)} each, payment requests sent. Confirmation {b.code}.</div>
          </div>
        )}
        {b.status === 'declined' && <div className="small muted">Someone said the price does not work, so nothing was booked. Ask again for a cheaper option.</div>}
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
    <div className="card-ai table" role="group" aria-label={`Booking: ${b.title}`}>
      <button className="map-tap" onClick={() => setFull(true)} aria-label="Open the map full screen"><MapView points={pts} height={130} /><span className="map-hint">Tap to open</span></button>
      <div className="card-ai-body">
        {b.auto && <div className="why">The AI added this because you picked a place and a time.</div>}
        <div className="row between" style={{ alignItems: 'flex-start' }}>
          <div><strong className="ride-title">{b.restaurant}</strong><div className="small muted">Near {b.place.name} · table for {b.n}</div></div>
          <span className={`chip ${b.status === 'booked' ? 'ok' : b.status === 'declined' ? 'warn' : ''}`}>{b.status === 'pending' ? 'Waiting for everyone' : b.status === 'booked' ? 'Reserved (demo)' : 'Not booked'}</span>
        </div>
        {b.status === 'pending' && (
          <>
            <div className="small muted">Pick a time</div>
            <div className="slots" role="radiogroup" aria-label="Time">{b.slots.map((s) => <button key={s} role="radio" aria-checked={s === b.slot} className={s === b.slot ? 'on' : ''} onClick={() => s !== b.slot && send('game:booking-option', { bookingId: b.id, option: s })}>{s}</button>)}</div>
            <div className="row between"><span className="small">About {money(b.per)} per person</span><strong>{money(b.total)} total</strong></div>
            {b.warn && <div className="warnline">{b.warn}</div>}
            <Approve b={b} send={send} what={`${b.slot}, ${money(b.perPerson)} each`} />
          </>
        )}
        {b.status === 'booked' && <div className="reserved"><strong>Reserved for {b.n} · {b.slot}</strong><span className="small">Confirmation {b.code} · {money(b.perPerson)} each, payment requests sent.</span></div>}
        {b.status === 'declined' && <div className="small muted">Someone said the price does not work, so nothing was booked.</div>}
        <div className="row between">
          <a className="small" href={gmapsPlace(b.place, b.restaurant)} target="_blank" rel="noreferrer">Find it in Google Maps</a>
          <span className="tiny muted">Demo · nothing is charged</span>
        </div>
      </div>
      {full && <FullMap title={b.restaurant} points={pts} onClose={() => setFull(false)} />}
    </div>
  );
}

function Approve({ b, send, what }) {
  return (
    <div className="stack" style={{ gap: 6 }}>
      {b.mine === null
        ? <div className="row" style={{ gap: 8 }}>
            <button className="btn small grow" onClick={() => send('game:booking', { bookingId: b.id, value: true })}>Price looks right</button>
            <button className="btn ghost small grow" onClick={() => send('game:booking', { bookingId: b.id, value: false })}>Not for me</button>
          </div>
        : <div className="small">You approved {what}.</div>}
      <div className="small muted">Approved: {b.approved.length ? b.approved.join(', ') : 'nobody yet'}{b.waiting.length ? ` · Waiting for: ${b.waiting.join(', ')}` : ''}. Changing the car or time asks everyone again.</div>
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
    <div className="card-ai route" role="group" aria-label={title}>
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
  const live = JSON.stringify(m.plan) === JSON.stringify(g.plan) && !g.deal;
  const humans = g.players.filter((p) => !p.isAI);
  const accepted = humans.filter((p) => p.accepted).length;
  return (
    <div className={`card-ai plancard ${live ? '' : 'stale'}`} role="group" aria-label={m.text}>
      <div className="card-ai-body">
        <div className="row between"><strong>{live ? 'The plan is ready' : 'An earlier plan'}</strong>{live && <span className="chip ok">{accepted} of {humans.length} accepted</span>}</div>
        {g.task.fields.map((f) => (
          <div key={f.id} className="plan-line"><span className="small muted">{f.name}</span><strong>{f.options.find((o) => o.id === m.plan[f.id])?.name}</strong></div>
        ))}
        {live
          ? <><button className={`btn block ${g.me.accepted ? 'ghost' : ''}`} onClick={onAccept}>{g.me.accepted ? 'Take back my acceptance' : 'Accept this plan'}</button>
              <div className="tiny muted">If it does not work for you, say so or change a pick. Any change clears every acceptance.</div></>
          : <div className="tiny muted">The plan changed after this.</div>}
      </div>
    </div>
  );
}
