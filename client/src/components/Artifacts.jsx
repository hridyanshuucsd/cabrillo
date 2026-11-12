import React, { useState } from 'react';

// More pieces of the plan board: opening hours, the day as a timeline, the weather, who brings what, agreements,
// and a ticket that sums up the plan for sharing. Each one is shared by the whole table and updates live.

// Each person keeps the color of their avatar in the chat, always shown with their initial or name, never color alone.
const seatColor = (c) => c || '#7a8790';
const initial = (name) => String(name || '?').trim().charAt(0).toUpperCase();
const clock = (min) => { const h = Math.floor(min / 60) % 24, m = min % 60; return `${((h + 11) % 12) + 1}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h >= 12 ? 'pm' : 'am'}`; };
const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// ---------- is it open? ----------
// One bar per place from 6 am to 2 am. The filled part is when it is open that day; the flag is the planned time.
const H0 = 6 * 60, H1 = 26 * 60;
const pos = (m) => `${Math.max(0, Math.min(100, ((m - H0) / (H1 - H0)) * 100))}%`;
function HoursBar({ range, always, at, open }) {
  return (
    <div className={`hbar ${open === false ? 'closed' : open ? 'open' : ''}`} aria-hidden="true">
      <div className="hbar-track">
        {(always || range) && <div className="hbar-open" style={always ? { left: 0, right: 0 } : { left: pos(range[0]), width: `calc(${pos(range[1])} - ${pos(range[0])})` }} />}
        {[12, 18, 24].map((h) => <span key={h} className="hbar-tick" style={{ left: pos(h * 60) }} />)}
        {at !== null && at !== undefined && <span className="hbar-flag" style={{ left: pos(at < H0 ? at + 1440 : at) }} />}
      </div>
      <div className="hbar-scale"><span>6 am</span><span>noon</span><span>6 pm</span><span>midnight</span></div>
    </div>
  );
}
export function OpeningHours({ g }) {
  const b = g.board || {};
  const places = (b.places || []).filter((p) => b.hours?.[p.id]);
  if (!places.length) return null;
  const wd = b.when ? b.when.weekday : new Date().getDay();
  const at = b.when?.minutes ?? null;
  return (
    <section className="pcard" id="part-hours" data-nav="Hours">
      <div className="row between"><strong>Open at that time?</strong><span className="small muted">{b.when ? b.when.label : `Today, ${DAY[wd]}`}</span></div>
      {places.map((p) => {
        const h = b.hours[p.id];
        const range = h.always ? null : h.week?.[wd] || null;
        const end = range ? range[1] : null;
        const open = h.always ? true : !range ? false : at === null ? null : at >= range[0] && at < end;
        const status = h.loading ? 'Checking' : open === true ? 'Open then' : open === false ? 'Closed then' : range ? `${clock(range[0])} to ${clock(range[1])}` : 'Hours unknown';
        return (
          <div key={p.id} className={`hours-row ${p.id === b.placeId ? 'lead' : ''}`} role="group" aria-label={`${p.name}: ${status}`}>
            <div className="row between"><span className="grow small"><strong>{p.name}</strong>{range && open !== null && <span className="muted"> · {clock(range[0])} to {clock(range[1])}</span>}{h.always && <span className="muted"> · open all day</span>}{!h.always && !range && !h.loading && h.week && <span className="muted"> · closed on {DAY[wd]}</span>}</span>
              <span className={`chip ${open === true ? 'ok' : open === false ? 'warn' : ''}`}>{status}</span></div>
            {!h.loading && (h.week || h.always) && <HoursBar range={range} always={h.always} at={at} open={open} />}
            {!h.loading && <div className="tiny muted">{h.source === 'web' ? 'Hours found on the web' : h.always ? 'Usually open all day.' : h.source === 'typical' ? `Typical hours for a ${String(h.kind || 'place').toLowerCase()}. Check before you go.` : 'No hours found.'}{h.links?.[0] && <> · <a href={h.links[0].url} target="_blank" rel="noreferrer noopener">{h.links[0].title}</a></>}</div>}
          </div>
        );
      })}
    </section>
  );
}

// ---------- the day ----------
// A vertical route: stops are dots, travel is a dashed stretch with how you get there, the main event is the big dot.
const HowIcon = ({ how }) => (
  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" className="how-ico">
    {how === 'transit' || how === 'train'
      ? <><rect x="5" y="3" width="14" height="14" rx="3" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M5 10h14M8 21l2-4M16 21l-2-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /><circle cx="9" cy="13.5" r="1.2" fill="currentColor" /><circle cx="15" cy="13.5" r="1.2" fill="currentColor" /></>
      : how === 'walk'
        ? <><circle cx="13" cy="4.5" r="2" fill="currentColor" /><path d="M11 21l2-6-3-3 1-4 4 3 3 1M10 12l-3 2" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" /></>
        : <><path d="M4 15l1.6-5A2 2 0 017.5 8.5h9a2 2 0 011.9 1.5L20 15v3h-16z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /><circle cx="7.5" cy="18" r="1.6" fill="currentColor" /><circle cx="16.5" cy="18" r="1.6" fill="currentColor" /></>}
  </svg>
);
export function Itinerary({ g, send }) {
  const it = g.board?.itin;
  const [adding, setAdding] = useState('');
  const [editing, setEditing] = useState(null);
  if (!it) return null;
  const busy = !!g.deal;
  return (
    <section className="pcard" id="part-day" data-nav="The day">
      <div className="row between">
        <span className="grow"><strong>The day</strong><div className="small muted">{it.stops[0].label} to {it.endLabel}{it.edited ? ' · edited by the group' : ' · from the plan'}</div></span>
        {!busy && <span className="seg" role="group" aria-label="Move the whole day">
          <button onClick={() => send('game:day', { action: 'shift', delta: -1 })} aria-label="Start 15 minutes earlier">Earlier</button>
          <button onClick={() => send('game:day', { action: 'shift', delta: 1 })} aria-label="Start 15 minutes later">Later</button>
        </span>}
      </div>
      <ol className="route">
        {it.stops.map((s) => (
          <li key={s.id} className={`stop ${s.kind}`}>
            <span className="stop-time">{s.kind === 'leg' ? '' : s.label}</span>
            <span className="stop-line" aria-hidden="true">{s.kind === 'leg' ? <HowIcon how={s.how} /> : <span className="stop-dot" />}</span>
            <span className="stop-body">
              {editing === s.id
                ? <form className="add-row" onSubmit={(e) => { e.preventDefault(); const t = e.target.elements.t.value; send('game:day', { action: 'rename', id: s.id, title: t }); setEditing(null); }}>
                    <input name="t" type="text" defaultValue={s.title} maxLength={60} aria-label="Stop name" autoFocus />
                    <button className="btn small">Save</button>
                  </form>
                : <><span className={s.kind === 'main' ? 'stop-title main' : 'stop-title'}>{s.title}</span>
                    {s.kind !== 'end' && <span className="tiny muted"> {s.mins} min</span>}</>}
              {!busy && editing !== s.id && s.kind !== 'end' && (
                <span className="stop-tools">
                  <button className="linkbtn tiny" aria-label={`Shorter: ${s.title}`} onClick={() => send('game:day', { action: 'length', id: s.id, delta: -1 })}>−15</button>
                  <button className="linkbtn tiny" aria-label={`Longer: ${s.title}`} onClick={() => send('game:day', { action: 'length', id: s.id, delta: 1 })}>+15</button>
                  <button className="linkbtn tiny" onClick={() => setEditing(s.id)}>Rename</button>
                  {s.kind !== 'meet' && <button className="linkbtn tiny" aria-label={`Remove ${s.title}`} onClick={() => send('game:day', { action: 'remove', id: s.id })}>Remove</button>}
                </span>
              )}
            </span>
          </li>
        ))}
      </ol>
      {!busy && <form className="add-row" onSubmit={(e) => { e.preventDefault(); if (adding.trim().length > 1) { send('game:day', { action: 'add', title: adding }); setAdding(''); } }}>
        <input type="text" value={adding} maxLength={60} placeholder="Add a stop, like boba after" aria-label="Add a stop" onChange={(e) => setAdding(e.target.value)} />
        <button className="btn small" disabled={adding.trim().length < 2}>Add</button>
      </form>}
      {it.edited && !busy && <button className="linkbtn small" style={{ alignSelf: 'flex-start' }} onClick={() => send('game:day', { action: 'reset' })}>Rebuild from the plan</button>}
    </section>
  );
}

// ---------- weather ----------
// The card takes the color of the sky at the planned hour. The strip below shows the chance of rain by hour.
function SkyIcon({ kind, night, size = 64 }) {
  const sun = night
    ? <path d="M40 14a18 18 0 1 0 12 30 15 15 0 0 1-12-30z" fill="#f4f1d0" />
    : <g><circle cx="34" cy="28" r="12" fill="#ffd34d" />{[0, 45, 90, 135, 180, 225, 270, 315].map((a) => <rect key={a} x="33" y="6" width="2.6" height="7" rx="1.3" fill="#ffd34d" transform={`rotate(${a} 34 28)`} />)}</g>;
  const cloud = (fill, y = 0) => <path d={`M18 ${50 + y}h30a10 10 0 0 0 0-20 14 14 0 0 0-26-4 9 9 0 0 0-4 24z`} fill={fill} />;
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden="true" className="sky-ico">
      {(kind === 'clear' || kind === 'partly') && sun}
      {kind === 'partly' && cloud('#ffffff', 4)}
      {kind === 'cloud' && <>{cloud('#e9eef2', -6)}{cloud('#ffffff', 4)}</>}
      {kind === 'fog' && <>{cloud('#eef2f4', -4)}{[44, 50, 56].map((y) => <rect key={y} x="12" y={y} width="40" height="2.6" rx="1.3" fill="#eef2f4" opacity=".9" />)}</>}
      {(kind === 'rain' || kind === 'storm') && <>{cloud(kind === 'storm' ? '#c9d2de' : '#eef3f7', -8)}{[20, 30, 40].map((x) => <path key={x} d={`M${x} 48l-3 8`} stroke="#bfe0ff" strokeWidth="3" strokeLinecap="round" />)}</>}
      {kind === 'storm' && <path d="M34 42l-6 10h6l-3 9 9-13h-6l3-6z" fill="#ffd34d" />}
    </svg>
  );
}
const SKY_WORD = { clear: 'Clear', partly: 'Partly cloudy', cloud: 'Cloudy', fog: 'Foggy', rain: 'Rain likely', storm: 'Storms' };
export function Weather({ g, send }) {
  const b = g.board || {};
  const w = b.weather;
  if (!b.weatherOn) {
    if (!b.placeName) return null;
    return <div className="row"><button className="linkbtn small" onClick={() => send('game:weather', {})}>Show the weather for this plan</button></div>;
  }
  if (!w) return null; // this plan has no place or no day, so there is no forecast to show
  if (w.waiting) return (
    <section className="pcard" id="part-weather" data-nav="Weather"><strong>Weather</strong>
      <div className="small muted">{w?.needs === 'far' ? 'The forecast reaches about two weeks ahead.' : w?.needs === 'day' ? 'Pick a day and the forecast shows up here.' : 'Pick a place and a day and the forecast shows up here.'}</div></section>
  );
  if (w.loading) return <section className="pcard" id="part-weather" data-nav="Weather"><strong>Weather</strong><div className="row" style={{ gap: 8 }}><div className="spinner small" aria-hidden="true" /><span className="small muted">Getting the forecast for {w.place}...</span></div></section>;
  if (w.temp === null) return <section className="pcard" id="part-weather" data-nav="Weather"><strong>Weather</strong><div className="small muted">The forecast is not available right now.</div></section>;
  const night = w.hour >= 18 || w.hour < 6;
  const max = Math.max(...w.hours.map((x) => x.rain), 30);
  return (
    <section className={`sky sky-${w.sky} ${night ? 'night' : ''}`} id="part-weather" data-nav="Weather" aria-label={`Weather for ${w.place}, ${w.dayName} at ${w.hourLabel}: ${w.temp} degrees, ${SKY_WORD[w.sky]}, ${w.rain}% chance of rain`}>
      <div className="sky-top">
        <div className="grow">
          <div className="sky-where">{w.place}</div>
          <div className="sky-when">{w.dayName} at {w.hourLabel}</div>
          <div className="sky-temp">{w.temp}°</div>
          <div className="sky-word">{SKY_WORD[w.sky]} · {w.rain}% rain · high {w.hi}°, low {w.lo}°</div>
        </div>
        <SkyIcon kind={w.sky} night={night} size={84} />
      </div>
      <div className="sky-strip" role="img" aria-label="Chance of rain by hour">
        {w.hours.map((x) => (
          <div key={x.h} className={`sky-col ${x.h === w.hour ? 'now' : ''}`} title={`${x.label}: ${x.temp}°, ${x.rain}% rain`}>
            <span className="sky-t">{x.temp}°</span>
            <span className="sky-bar"><span style={{ height: `${Math.max(4, (x.rain / max) * 100)}%` }} /></span>
            <span className="sky-h">{x.label.replace(':00', '').replace(' ', '')}</span>
          </div>
        ))}
      </div>
      <div className="sky-foot">Bars show the chance of rain. {w.source === 'open-meteo' ? 'Forecast from Open-Meteo.' : w.source === 'test' ? 'Test forecast.' : ''}</div>
    </section>
  );
}

// ---------- who brings what ----------
// Claimed things carry the person's color and initial; unclaimed ones wait with a dashed edge.
export function Bring({ g, send }) {
  const list = g.board?.bring || [];
  const [text, setText] = useState('');
  if (!list.length && !g.board) return null;
  const cats = [...new Set(list.map((x) => x.cat))];
  const covered = list.filter((x) => x.owner).length;
  return (
    <section className="pcard" id="part-bring" data-nav="Bring">
      <div className="row between"><strong>Who brings what</strong><span className="small muted">{covered} of {list.length} covered</span></div>
      {list.length > 0 && <div className="cover" aria-hidden="true">{list.map((x) => <span key={x.id} style={x.owner ? { background: seatColor(x.seat) } : undefined} />)}</div>}
      {cats.map((c) => (
        <div key={c} className="bring-cat">
          <div className="small muted">{c}</div>
          <div className="bring-items">
            {list.filter((x) => x.cat === c).map((x) => (
              <span key={x.id} className={`bring ${x.owner ? 'taken' : ''} ${x.mine ? 'mine' : ''}`} style={x.owner ? { '--seat': seatColor(x.seat) } : undefined}>
                <button className="bring-main" disabled={!!g.deal} aria-pressed={x.mine} onClick={() => send('game:bring', { action: 'claim', id: x.id })}
                  aria-label={x.owner ? `${x.name}: ${x.mine ? 'you bring it. Tap to let go' : `${x.owner} brings it. Tap to take it`}` : `${x.name}: nobody yet. Tap to bring it`}>
                  {x.owner ? <span className="who-dot" aria-hidden="true">{initial(x.owner)}</span> : <span className="who-dot empty" aria-hidden="true">+</span>}
                  <span className="bring-name">{x.name}</span>
                  <span className="bring-who">{x.owner ? (x.mine ? 'You' : x.owner) : 'Nobody yet'}</span>
                </button>
                {!x.owner && !g.deal && <button className="bring-x" aria-label={`Remove ${x.name}`} onClick={() => send('game:bring', { action: 'remove', id: x.id })}>×</button>}
              </span>
            ))}
          </div>
        </div>
      ))}
      {!g.deal && <form className="add-row" onSubmit={(e) => { e.preventDefault(); if (text.trim().length > 1) { send('game:bring', { action: 'add', name: text, mine: true }); setText(''); } }}>
        <input type="text" value={text} maxLength={60} placeholder="I will bring..." aria-label="Add something you will bring" onChange={(e) => setText(e.target.value)} />
        <button className="btn small" disabled={text.trim().length < 2}>Add</button>
      </form>}
    </section>
  );
}

// ---------- agreements ----------
// Each promise collects a stamp from everyone who agrees. When the whole group has stamped it, it gets a seal.
export function Agreements({ g, send }) {
  const list = g.board?.agreements || [];
  const people = g.board?.people || 0;
  const [text, setText] = useState('');
  return (
    <section className="pcard" id="part-agreements" data-nav={g.task.id === 'roommates' ? 'Rules' : 'Agreements'}>
      <div className="row between"><strong>{g.task.id === 'roommates' ? 'House rules' : 'Agreements'}</strong>{list.length > 0 && <span className="small muted">{list.filter((x) => x.stamps.length >= people).length} of {list.length} signed by all</span>}</div>
      {list.length === 0 && <div className="small muted">{g.task.id === 'roommates' ? 'Each part of the plan the group agrees on becomes a house rule here for everyone to sign. You can add your own rules too.' : 'Write down what the group promised each other, like "we split gas evenly" or "whoever books gets paid back tonight". Everyone stamps it.'}</div>}
      {list.map((x) => {
        const all = x.stamps.length >= people && people > 0;
        return (
          <div key={x.id} className={`pact ${all ? 'sealed' : ''}`}>
            <div className="pact-text">{x.text}</div>
            <div className="row between wrap-row" style={{ gap: 8 }}>
              <span className="stamps" aria-label={`${x.stamps.length} of ${people} agreed: ${x.stamps.map((s) => s.you ? 'you' : s.name).join(', ') || 'nobody yet'}`}>
                {x.stamps.map((s, i) => <span key={i} className="stamp" style={{ '--seat': seatColor(s.seat), '--tilt': `${((i * 37) % 17) - 8}deg` }} title={s.you ? 'You' : s.name}>{initial(s.name)}</span>)}
                {Array.from({ length: Math.max(0, people - x.stamps.length) }, (_, i) => <span key={`e${i}`} className="stamp empty" aria-hidden="true" />)}
              </span>
              {!g.deal && <span className="row" style={{ gap: 4 }}>
                <button className={`btn small ${x.mine ? 'ghost' : ''}`} aria-pressed={x.mine} onClick={() => send('game:agree', { action: 'stamp', id: x.id })}>{x.mine ? 'Agreed' : 'I agree'}</button>
                <button className="linkbtn small" aria-label={`Remove: ${x.text}`} onClick={() => send('game:agree', { action: 'remove', id: x.id })}>×</button>
              </span>}
            </div>
            <div className="tiny muted">{x.fromPlan ? 'From the plan: everyone signs' : x.byAI ? 'Written down by the AI from the chat' : `Written by ${x.byName}`}{all ? ' · everyone agreed' : ''}</div>
          </div>
        );
      })}
      {!g.deal && <form className="add-row" onSubmit={(e) => { e.preventDefault(); if (text.trim().length > 2) { send('game:agree', { action: 'add', text }); setText(''); } }}>
        <input type="text" value={text} maxLength={120} placeholder="We agree that..." aria-label="Write an agreement" onChange={(e) => setText(e.target.value)} />
        <button className="btn small" disabled={text.trim().length < 3}>Add</button>
      </form>}
    </section>
  );
}

// ---------- the plan as a ticket ----------
// A ticket stub with the plan on it, to send to the group chat you already use or to save as a picture.
function ticketData(g) {
  const b = g.board || {};
  const rows = g.panel.map((f) => ({ label: f.name, value: f.status === 'agreed' ? f.leaderName : 'Still open', open: f.status !== 'agreed' }));
  const d = b.when ? new Date(`${b.when.date}T12:00:00`) : null;
  return {
    title: g.task.short, rows,
    day: b.when ? b.when.dayName.slice(0, 3) : 'Day', date: d ? d.toLocaleDateString([], { month: 'short', day: 'numeric' }) : 'to be set',
    time: b.when?.minutes !== null && b.when?.minutes !== undefined ? clock(b.when.minutes) : b.itin ? b.itin.stops[0].label : '',
    meet: b.itin ? `Meet ${b.itin.stops[0].label} at Price Center` : '',
    complete: !!g.complete
  };
}
const shareText = (t) => [`${t.title}${t.complete ? '' : ' (draft)'}`, ...t.rows.map((r) => `${r.label}: ${r.value}`), t.meet].filter(Boolean).join('\n');
function drawTicket(t) {
  const W = 1000, H = 520, c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d');
  const stub = 720;
  x.fillStyle = '#f1f4f6'; x.fillRect(0, 0, W, H);
  // body and stub with notches cut where they meet
  x.fillStyle = '#ffffff';
  x.beginPath(); x.roundRect(30, 30, W - 60, H - 60, 28); x.fill();
  x.globalCompositeOperation = 'destination-out';
  x.beginPath(); x.arc(stub, 30, 26, 0, Math.PI * 2); x.arc(stub, H - 30, 26, 0, Math.PI * 2); x.fill();
  x.globalCompositeOperation = 'source-over';
  x.fillStyle = '#008a70'; x.beginPath(); x.roundRect(stub, 30, W - 30 - stub, H - 60, [0, 28, 28, 0]); x.fill();
  x.globalCompositeOperation = 'destination-out';
  x.beginPath(); x.arc(stub, 30, 26, 0, Math.PI * 2); x.arc(stub, H - 30, 26, 0, Math.PI * 2); x.fill();
  x.globalCompositeOperation = 'source-over';
  x.strokeStyle = '#bcc6cd'; x.setLineDash([10, 10]); x.lineWidth = 3; x.beginPath(); x.moveTo(stub, 70); x.lineTo(stub, H - 70); x.stroke(); x.setLineDash([]);
  x.fillStyle = '#10202b'; x.font = '800 54px Manrope, system-ui, sans-serif'; x.fillText(t.title, 80, 120);
  let y = 190;
  for (const r of t.rows.slice(0, 5)) {
    x.font = '700 22px Manrope, system-ui, sans-serif'; x.fillStyle = '#51616c'; x.fillText(r.label, 80, y);
    x.font = '800 30px Manrope, system-ui, sans-serif'; x.fillStyle = r.open ? '#a3301f' : '#10202b'; x.fillText(r.value.slice(0, 32), 260, y);
    y += 56;
  }
  x.fillStyle = '#ffffff'; x.textAlign = 'center';
  x.font = '800 64px Manrope, system-ui, sans-serif'; x.fillText(t.day, stub + (W - 30 - stub) / 2, 190);
  x.font = '700 30px Manrope, system-ui, sans-serif'; x.fillText(t.date, stub + (W - 30 - stub) / 2, 240);
  x.font = '800 40px Manrope, system-ui, sans-serif'; x.fillText(t.time, stub + (W - 30 - stub) / 2, 320);
  x.font = '700 20px Manrope, system-ui, sans-serif'; x.fillText('Planned on Cabrillo', stub + (W - 30 - stub) / 2, H - 80);
  return c;
}
export function Ticket({ g }) {
  const [done, setDone] = useState('');
  const t = ticketData(g);
  if (!g.panel.some((f) => f.status === 'agreed')) return null;
  const text = shareText(t);
  const flash = (s) => { setDone(s); setTimeout(() => setDone(''), 2200); };
  const share = async () => { try { if (navigator.share) { await navigator.share({ title: t.title, text }); return; } } catch { return; } copy(); };
  const copy = async () => { try { await navigator.clipboard.writeText(text); flash('Copied the plan'); } catch { flash('Could not copy here'); } };
  const save = () => { const c = drawTicket(t); const a = document.createElement('a'); a.download = 'plan.png'; a.href = c.toDataURL('image/png'); a.click(); flash('Saved plan.png'); };
  return (
    <section className="ticket-wrap" id="part-ticket" data-nav="Share">
      <div className={`ticket ${t.complete ? '' : 'draft'}`} role="group" aria-label={`The plan as a ticket: ${text.replace(/\n/g, '. ')}`}>
        <div className="ticket-main">
          <div className="ticket-title">{t.title}{!t.complete && <span className="ticket-draft">Draft</span>}</div>
          <dl className="ticket-rows">{t.rows.map((r) => <React.Fragment key={r.label}><dt>{r.label}</dt><dd className={r.open ? 'open' : ''}>{r.value}</dd></React.Fragment>)}</dl>
        </div>
        <div className="ticket-stub">
          <span className="ticket-day">{t.day}</span>
          <span className="ticket-date">{t.date}</span>
          {t.time && <span className="ticket-time">{t.time}</span>}
        </div>
      </div>
      <div className="row wrap-row" style={{ gap: 8 }}>
        <button className="btn small" onClick={share}>Share the plan</button>
        <button className="btn small ghost" onClick={copy}>Copy as text</button>
        <a className="btn small ghost" href={`sms:?&body=${encodeURIComponent(text)}`}>Text it</a>
        <button className="btn small ghost" onClick={save}>Save as image</button>
        {done && <span className="small muted" role="status">{done}</span>}
      </div>
    </section>
  );
}
