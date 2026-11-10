import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, mmss } from '../lib.js';
import TopBar from '../components/Brand.jsx';

// Analytics for one class session, computed on the server from the database. Everything here uses player codes.
// Charts are plain HTML: stat tiles for headline numbers, meters for shares, one segmented bar per AI mode for what
// happened to private limits (one hue, darker = shared more openly), and bars centered on neutral for the 1 to 5 scales.

const pctText = (x) => (x === null || x === undefined ? 'n/a' : `${x}%`);
const time = (s) => (s === null || s === undefined ? 'n/a' : mmss(s));
const num = (x) => (x === null || x === undefined ? 'n/a' : String(x));
const MODE_KEYS = ['listen', 'ask'];
const WAY_COLORS = { self: '#00574c', ai_named: '#0a7a6e', ai_anon: '#409e91', mentioned: '#68c4b6', never: '#bcc6cd' };
const WAY_INK = { self: '#fff', ai_named: '#fff', ai_anon: '#fff', mentioned: '#10202b', never: '#10202b' };
const SCALE_COLORS = ['#c0282e', '#f6938b', '#dde3e8', '#86b6ef', '#256abf'];
const SCALE_INK = ['#fff', '#10202b', '#10202b', '#10202b', '#fff'];

// A count is printed inside a bar segment only where it fits, which depends on how wide the bars are on this screen.
function useNarrow() {
  const [narrow, setNarrow] = useState(() => window.matchMedia('(max-width: 720px)').matches);
  useEffect(() => { const m = window.matchMedia('(max-width: 720px)'); const f = () => setNarrow(m.matches); m.addEventListener('change', f); return () => m.removeEventListener('change', f); }, []);
  return narrow;
}

// ---------- one tooltip for every mark: shown on hover and on keyboard focus ----------
function useTip() {
  const [tip, setTip] = useState(null);
  const show = (value, label) => (e) => { const r = e.currentTarget.getBoundingClientRect(); setTip({ value, label, x: r.left + r.width / 2, y: r.top }); };
  const hide = () => setTip(null);
  const bind = (value, label) => ({ onMouseEnter: show(value, label), onFocus: show(value, label), onMouseLeave: hide, onBlur: hide, tabIndex: 0 });
  const el = tip && <div className="viz-tip" role="status" style={{ left: Math.min(window.innerWidth - 110, Math.max(110, tip.x)), top: tip.y }}><strong>{tip.value}</strong><span>{tip.label}</span></div>;
  return { bind, el };
}

function Tile({ label, value, sub }) {
  return <div className="tile"><span className="tile-label">{label}</span><span className="tile-value">{value}</span>{sub && <span className="tile-sub">{sub}</span>}</div>;
}

// A share against its own whole: value text, then a thin bar on a lighter track of the same hue.
function Meter({ part, whole, tip }) {
  const p = whole ? Math.round((100 * part) / whole) : null;
  return (
    <div className="meter-cell" {...(p === null ? {} : tip.bind(`${p}%`, `${part} of ${whole}`))}>
      <span className="meter-text"><strong>{p === null ? 'n/a' : `${p}%`}</strong> <span className="muted">{whole ? `${part} of ${whole}` : ''}</span></span>
      {p !== null && <span className="meter-track" aria-hidden="true"><span className="meter-fill" style={{ width: `${p}%` }} /></span>}
    </div>
  );
}

// One whole split into parts, with a 2px gap between parts. A count is printed inside a part only when it fits.
function Segments({ parts, total, tip, label, narrow }) {
  if (!total) return <div className="seg-empty muted small">No data yet</div>;
  const desc = parts.filter((p) => p.n).map((p) => `${p.name}: ${p.n} of ${total}`).join('; ');
  return (
    <div className="segbar" role="img" aria-label={`${label}. ${desc}`}>
      {parts.filter((p) => p.n > 0).map((p) => {
        const share = p.n / total;
        return (
          <span key={p.key} className="segpart" style={{ flexGrow: p.n, background: p.color, color: p.ink }} {...tip.bind(`${p.n} (${Math.round(share * 100)}%)`, p.name)}>
            {share >= (narrow ? 0.1 : 0.04) && <span className="seg-n">{p.n}</span>}
          </span>
        );
      })}
    </div>
  );
}

// A 1 to 5 scale as a bar centered on the neutral answer: disagreement grows to the left, agreement to the right.
function Diverging({ counts, tip, labels, narrow }) {
  const n = counts.reduce((a, b) => a + b, 0);
  if (!n) return <div className="seg-empty muted small">No answers yet</div>;
  const left = (counts[0] + counts[1] + counts[2] / 2) / n; // share that sits left of the center line
  return (
    <div className="div-wrap" role="img" aria-label={counts.map((c, i) => `${i + 1}: ${c}`).join(', ')}>
      <span className="div-axis" aria-hidden="true" />
      <div className="div-bar" style={{ marginLeft: `${(1 - left) * 50}%`, width: '50%' }}>
        {counts.map((c, i) => c > 0 && (
          <span key={i} className="segpart" style={{ flexGrow: c, background: SCALE_COLORS[i], color: SCALE_INK[i] }} {...tip.bind(`${c} of ${n}`, `answered ${i + 1}${i === 0 ? ` (${labels[0]})` : i === 4 ? ` (${labels[1]})` : ''}`)}>
            {c / n >= (narrow ? 0.18 : 0.08) && <span className="seg-n">{c}</span>}
          </span>
        ))}
      </div>
    </div>
  );
}

function Legend({ items }) {
  return <div className="viz-legend">{items.map((x) => <span key={x.name} className="viz-key"><i style={{ background: x.color }} aria-hidden="true" />{x.name}</span>)}</div>;
}

function Transcript({ code, id }) {
  const [t, setT] = useState(null); const [error, setError] = useState('');
  useEffect(() => { api(`/api/analytics/${code}/transcript/${id}`).then(setT).catch((e) => setError(e.message)); }, [code, id]);
  if (error) return <div className="error">{error}</div>;
  if (!t) return <div className="muted small">Loading the transcript...</div>;
  return (
    <div className="transcript">
      {t.rows.map((r, i) => (
        <div key={i} className={`tr-row ${r.private ? 'private' : ''} ${r.who === 'system' ? 'sys' : ''} ${/^AI/.test(r.kind) || r.who === 'AI' ? 'ai' : ''}`}>
          <span className="tr-t">{r.t < 0 ? `-${mmss(-r.t)}` : mmss(r.t)}</span>
          <span className="tr-who">{r.who}</span>
          <span className="tr-text"><span className="tr-kind">{r.kind}{r.private ? (r.to ? `, only ${r.to} saw this` : ', private') : ''}</span>{r.text ? ` ${r.text}` : ''}</span>
        </div>
      ))}
    </div>
  );
}

export default function Analytics() {
  const code = String(useParams().code || '').toUpperCase();
  const [a, setA] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [numbers, setNumbers] = useState(false);
  const [open, setOpen] = useState(null);
  const [peopleOnly, setPeopleOnly] = useState(false); // leave out tables where AI players filled empty seats
  const tip = useTip();
  const narrow = useNarrow();
  const load = () => { setBusy(true); api(`/api/analytics/${code}`).then((x) => { setA(x); setError(''); }).catch((e) => setError(e.message)).finally(() => setBusy(false)); };
  useEffect(load, [code]);
  const jsonUrl = useMemo(() => (a ? URL.createObjectURL(new Blob([JSON.stringify(a, null, 2)], { type: 'application/json' })) : null), [a]);
  const top = useRef(null);

  if (error && !a) return <div className="wrap stack"><TopBar back /><div className="error" role="alert">{error}</div><Link className="btn" to="/">Back home</Link></div>;
  if (!a) return <div className="wrap center-screen"><div className="spinner" aria-hidden="true" /><p className="muted">Working out the numbers...</p></div>;

  const view = peopleOnly ? a.people_only : a;
  const modes = MODE_KEYS.filter((m) => a.modes[m].tables_started > 0);
  const all = view.all;
  const col = (m) => view.modes[m];
  const withAi = a.all.tables_with_ai_players;
  const exp = (f) => `/api/export/${code}/${f}`;
  const ways = a.limit_ways.map(([key, name]) => ({ key, name, color: WAY_COLORS[key], ink: WAY_INK[key] }));
  const wayParts = (agg) => ways.map((w) => ({ ...w, n: agg.limit_ways[w.key] }));
  const row = (label, f, help) => <tr><th scope="row">{label}{help && <span className="th-help">{help}</span>}</th>{modes.map((m) => <td key={m}>{f(col(m))}</td>)}</tr>;
  const group = (title) => <tr className="group"><th colSpan={modes.length + 1} scope="colgroup">{title}</th></tr>;
  const when = a.first_started_at ? new Date(a.first_started_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : null;

  return (
    <div className="wide stack analytics" ref={top}>
      <div className="no-print"><TopBar back /></div>
      <header className="an-head">
        <div>
          <div className="label">Class session {code}{when ? ` · ${when}` : ''}</div>
          <h1 style={{ margin: '2px 0 4px' }}>Session analytics</h1>
          <p className="muted small" style={{ margin: 0 }}>Computed from the saved logs, so it stays available after the session. People appear as codes such as P01; AI players are left out of every per-person number.</p>
        </div>
        <div className="row wrap-row no-print" style={{ gap: 8 }}>
          <button className="btn small ghost" onClick={load} disabled={busy}>{busy ? 'Refreshing...' : 'Refresh'}</button>
          <button className="btn small ghost" onClick={() => window.print()}>Print or save as PDF</button>
          <Link className="btn small ghost" to={`/host/${code}`}>Host console</Link>
        </div>
      </header>
      {error && <div className="error" role="alert">{error}</div>}

      {withAi > 0 && a.all.tables > withAi && (
        <label className="switch no-print">
          <input type="checkbox" checked={peopleOnly} onChange={(e) => setPeopleOnly(e.target.checked)} />
          <span><strong>Leave out tables with AI players</strong><br /><span className="small muted">{withAi} of {a.all.tables} finished tables had labeled AI players in empty seats. Turn this on to compare only tables where every seat was a person. The list of tables below always shows all of them.</span></span>
        </label>
      )}
      {!a.all.tables ? (
        <div className="card stack">
          <strong>No table has finished yet.</strong>
          <span className="muted">{a.all.tables_started ? `${a.all.tables_started} ${a.all.tables_started === 1 ? 'table has' : 'tables have'} started. Numbers appear here as tables finish; press Refresh.` : 'Numbers appear here once tables start and finish. Press Refresh after the session.'}</span>
        </div>
      ) : (
        <>
          <section className="tiles" aria-label="At a glance">
            <Tile label="Tables finished" value={all.tables} sub={all.tables_unfinished ? `${all.tables_unfinished} still running or cut off` : `${all.tables_with_ai_players} had AI players in empty seats`} />
            <Tile label="People" value={all.people} sub={`about ${num(all.people_per_table)} per table`} />
            <Tile label="Plans locked" value={pctText(all.plans_locked_pct)} sub={`${all.plans_locked} of ${all.tables} tables`} />
            <Tile label="Median time to a plan" value={time(all.time_to_plan_median_s)} sub={all.plans_locked ? `fastest ${time(all.time_to_plan_min_s)}, slowest ${time(all.time_to_plan_max_s)}` : 'no plan locked yet'} />
            <Tile label="Private limits that came up" value={pctText(all.limits_came_up_pct)} sub={`${all.limits_came_up} of ${all.limits} people`} />
            <Tile label="Limits the locked plans respect" value={pctText(all.limits_respected_pct)} sub={all.limits_checked ? `${all.limits_respected} of ${all.limits_checked} people at tables with a plan` : 'no plan locked yet'} />
          </section>

          <section className="card stack" aria-labelledby="cmp-h">
            <div className="row between wrap-row"><h2 id="cmp-h" style={{ margin: 0 }}>{modes.length > 1 ? 'Listening AI and answer-only AI, side by side' : 'The numbers'}</h2></div>
            <p className="small muted" style={{ margin: 0 }}>{modes.length > 1 ? `Tables were split evenly between the two as they were created (balanced, not random). With this few tables, read differences as descriptive, not as proof.${a.room.task === 'mixed' ? ' Each table also had its own scenario, so a difference between the columns can come from the scenarios as well as from the AI.' : ''} The CSV files below are ready for a statistics tool.` : 'Every table in this session used the same AI mode.'}</p>
            <div className="table-scroll">
              <table className="atable">
                <thead><tr><th scope="col"><span className="sr-only">Measure</span></th>{modes.map((m) => <th key={m} scope="col">{a.mode_names[m]}</th>)}</tr></thead>
                <tbody>
                  {group('Reaching a plan')}
                  {row('Tables finished', (c) => <><strong>{c.tables}</strong> <span className="muted">· {c.people} people{c.tables_with_ai_players ? ` · ${c.tables_with_ai_players} with AI players` : ''}</span></>)}
                  {row('Plans locked', (c) => <Meter part={c.plans_locked} whole={c.tables} tip={tip} />, 'everyone accepted the same complete plan')}
                  {row('Median time to a plan', (c) => <><strong>{time(c.time_to_plan_median_s)}</strong>{c.plans_locked > 1 && <span className="muted"> · {time(c.time_to_plan_min_s)} to {time(c.time_to_plan_max_s)}</span>}</>, 'from chat open to plan locked')}
                  {row('Tables without a plan', (c) => <><strong>{c.tables - c.plans_locked}</strong>{c.tables - c.plans_locked > 0 && <span className="muted"> · {[c.ended.group && `${c.ended.group} ended by the group`, c.ended.host && `${c.ended.host} ended by the host`, c.ended.backstop && `${c.ended.backstop} timed out`].filter(Boolean).join(', ')}</span>}</>)}
                  {group('Private limits')}
                  {row('Came up at all', (c) => <Meter part={c.limits_came_up} whole={c.limits} tip={tip} />, 'shared on purpose, or in their own words')}
                  {row('Shared on purpose', (c) => <Meter part={c.limits_shared} whole={c.limits} tip={tip} />, 'said it from the draft, or through the AI')}
                  {row('Median time until shared', (c) => <strong>{time(c.share_median_s)}</strong>, 'after the chat opened')}
                  {row('Respected by the locked plan', (c) => <Meter part={c.limits_respected} whole={c.limits_checked} tip={tip} />, 'people at tables that locked a plan')}
                  {row('Plans that respect every limit', (c) => <Meter part={c.tables_all_respected} whole={c.plans_locked} tip={tip} />)}
                  {row('Private heads-up, then shared', (c) => (c.alerted_people ? <Meter part={c.alerts_followed_by_share} whole={c.alerted_people} tip={tip} /> : <span className="muted">none sent</span>), 'listening tables only')}
                  {group('Taking part')}
                  {row('Messages per person', (c) => <strong>{num(c.messages_per_person)}</strong>)}
                  {row('Taps per person', (c) => <><strong>{num(c.taps_per_person)}</strong>{c.me_too > 0 && <span className="muted"> · {c.me_too} were "Me too"</span>}</>)}
                  {row('Top talker share', (c) => <strong>{c.top_talker_share === null ? 'n/a' : `${Math.round(c.top_talker_share * 100)}%`}</strong>, 'share of a table\'s messages from its most active person')}
                  {row('People who never spoke or tapped', (c) => <strong>{c.silent_people}</strong>)}
                  {group('Using the AI')}
                  {row('Questions to the AI in the group', (c) => <><strong>{num(c.questions_group_per_table)}</strong> <span className="muted">per table</span></>)}
                  {row('Private questions to the AI', (c) => <><strong>{num(c.questions_private_per_table)}</strong> <span className="muted">per table · {c.people_asked_privately} {c.people_asked_privately === 1 ? 'person' : 'people'} asked</span></>)}
                  {row('Questions the AI asked on its own', (c) => <><strong>{num(c.ai_questions_own_per_table)}</strong> <span className="muted">per table (cap 2)</span></>)}
                  {row('Option cards after a question to the group', (c) => <><strong>{num(c.option_cards_per_table)}</strong> <span className="muted">per table</span></>)}
                  {row('Maps and routes shown', (c) => <strong>{c.maps + c.routes}</strong>)}
                  {row('Rides and tables', (c) => <><strong>{c.rides_booked + c.tables_booked}</strong> <span className="muted">booked of {c.rides_proposed + c.tables_proposed} asked{c.bookings_no_common ? ` · ${c.bookings_no_common} with no option for everyone` : ''}</span></>, 'answered privately; demo only')}
                  {row('Times a plan change cleared acceptances', (c) => <><strong>{num(c.accepts_reset_per_table)}</strong> <span className="muted">per table</span></>)}
                </tbody>
              </table>
            </div>
          </section>

          <section className="card stack" aria-labelledby="lim-h">
            <h2 id="lim-h" style={{ margin: 0 }}>What happened to each person's private limit</h2>
            <p className="small muted" style={{ margin: 0 }}>One bar per kind of table. Darker means shared more openly; gray means the limit never came up.</p>
            <Legend items={ways} />
            <div className="bars">
              {modes.map((m) => (
                <div key={m} className="bar-row">
                  <span className="bar-label"><strong>{a.mode_names[m]}</strong><span className="muted small"> {col(m).limits} people</span></span>
                  <Segments parts={wayParts(col(m))} total={col(m).limits} tip={tip} narrow={narrow} label={`${a.mode_names[m]}: how limits came up`} />
                </div>
              ))}
            </div>
            <div className="table-scroll">
              <table className="atable small-table">
                <thead><tr><th scope="col">How it came up</th>{modes.map((m) => <th key={m} scope="col">{a.mode_names[m]}</th>)}</tr></thead>
                <tbody>{ways.map((w) => <tr key={w.key}><th scope="row"><i className="sw" style={{ background: w.color }} aria-hidden="true" />{w.name}</th>{modes.map((m) => <td key={m}><strong>{col(m).limit_ways[w.key]}</strong> <span className="muted">{pctText(col(m).limits ? Math.round((100 * col(m).limit_ways[w.key]) / col(m).limits) : null)}</span></td>)}</tr>)}</tbody>
              </table>
            </div>
          </section>

          <section className="card stack" aria-labelledby="fb-h">
            <div className="row between wrap-row">
              <h2 id="fb-h" style={{ margin: 0 }}>Feedback after the session</h2>
              <button className="btn small ghost no-print" aria-pressed={numbers} onClick={() => setNumbers(!numbers)}>{numbers ? 'Hide the numbers' : 'Show the numbers'}</button>
            </div>
            <p className="small muted" style={{ margin: 0 }}>{all.feedback_n} of {all.people} people answered ({pctText(all.feedback_rate_pct)}). Each bar is centered on the middle answer: disagreement grows to the left, agreement to the right.</p>
            {all.feedback_n === 0 ? <div className="muted">No feedback yet.</div> : (
              <>
                <Legend items={[1, 2, 3, 4, 5].map((n, i) => ({ name: n === 1 ? '1, lowest' : n === 5 ? '5, highest' : String(n), color: SCALE_COLORS[i] }))} />
                {a.scales.map(([key, q, lo, hi]) => (
                  <div key={key} className="fb-q">
                    <div className="fb-title"><strong>{q}</strong><span className="muted small"> 1 = {lo}, 5 = {hi}</span></div>
                    {modes.map((m) => {
                      const s = col(m).scales[key];
                      return (
                        <div key={m} className="bar-row">
                          <span className="bar-label">{a.mode_names[m]}<span className="muted small"> {s.n ? `mean ${s.mean.toFixed(1)} · ${s.n} ${s.n === 1 ? 'answer' : 'answers'}` : 'no answers'}</span></span>
                          <Diverging counts={s.counts} tip={tip} narrow={narrow} labels={[lo, hi]} />
                        </div>
                      );
                    })}
                  </div>
                ))}
                {[['ai_amount', 'The AI spoke up...', [['too_little', 'Too little', '#dde3e8', '#10202b'], ['about_right', 'About right', '#0a7a6e', '#fff'], ['too_much', 'Too much', '#7d8b95', '#fff']]],
                  ['play_again', 'Would you use this again?', [['no', 'No', '#7d8b95', '#fff'], ['maybe', 'Maybe', '#dde3e8', '#10202b'], ['yes', 'Yes', '#0a7a6e', '#fff']]]].map(([key, q, opts]) => (
                  <div key={key} className="fb-q">
                    <div className="fb-title"><strong>{q}</strong></div>
                    <Legend items={opts.map(([, name, color]) => ({ name, color }))} />
                    {modes.map((m) => {
                      const d = col(m)[key]; const total = Object.values(d).reduce((x, y) => x + y, 0);
                      return (
                        <div key={m} className="bar-row">
                          <span className="bar-label">{a.mode_names[m]}<span className="muted small"> {total} {total === 1 ? 'answer' : 'answers'}</span></span>
                          <Segments parts={opts.map(([k, name, color, ink]) => ({ key: k, name, color, ink, n: d[k] }))} total={total} tip={tip} narrow={narrow} label={`${a.mode_names[m]}: ${q}`} />
                        </div>
                      );
                    })}
                  </div>
                ))}
                {numbers && (
                  <div className="table-scroll">
                    <table className="atable small-table">
                      <thead><tr><th scope="col">Question</th><th scope="col">AI</th>{[1, 2, 3, 4, 5].map((n) => <th key={n} scope="col">{n}</th>)}<th scope="col">Answers</th><th scope="col">Mean</th></tr></thead>
                      <tbody>
                        {a.scales.flatMap(([key, q]) => modes.map((m) => { const s = col(m).scales[key]; return <tr key={key + m}><th scope="row">{q}</th><td>{a.mode_names[m]}</td>{s.counts.map((c, i) => <td key={i}>{c}</td>)}<td>{s.n}</td><td>{s.mean === null ? 'n/a' : s.mean.toFixed(2)}</td></tr>; }))}
                        {modes.map((m) => <tr key={`am${m}`}><th scope="row">The AI spoke up...</th><td>{a.mode_names[m]}</td><td colSpan={7}>too little {col(m).ai_amount.too_little} · about right {col(m).ai_amount.about_right} · too much {col(m).ai_amount.too_much}</td></tr>)}
                        {modes.map((m) => <tr key={`pa${m}`}><th scope="row">Would you use this again?</th><td>{a.mode_names[m]}</td><td colSpan={7}>no {col(m).play_again.no} · maybe {col(m).play_again.maybe} · yes {col(m).play_again.yes}</td></tr>)}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
            {a.comments.length > 0 && (
              <div className="stack" style={{ gap: 6 }}>
                <span className="label">Comments ({a.comments.length})</span>
                {a.comments.map((c, i) => <div key={i} className="comment"><span className="muted small">Table {c.table} · {a.mode_names[c.ai_mode]} · {c.pcode}</span><span>{c.comment}</span></div>)}
              </div>
            )}
          </section>

          <section className="card stack" aria-labelledby="tb-h">
            <h2 id="tb-h" style={{ margin: 0 }}>Every table</h2>
            <p className="small muted" style={{ margin: 0 }}>Open a table to read what was said, with codes in place of names. Private items are marked.</p>
            <div className="table-scroll">
              <table className="atable tables">
                <thead><tr><th scope="col">Table</th><th scope="col">AI</th><th scope="col">People</th><th scope="col">Outcome</th><th scope="col">Time to plan</th><th scope="col">Limits came up</th><th scope="col">Limits respected</th><th scope="col">Messages</th><th scope="col">Questions to AI</th><th scope="col">AI cards</th><th scope="col"><span className="sr-only">Transcript</span></th></tr></thead>
                <tbody>
                  {a.tables.map((t) => (
                    <tr key={t.session_id} className={`${open === t.session_id ? 'is-open' : ''} ${peopleOnly && t.ai_players ? 'left-out' : ''}`}>
                      <th scope="row">Table {t.table} <span className="muted" style={{ fontWeight: 500 }}>· {t.task_name}</span></th>
                      <td data-label="AI">{t.ai_mode === 'listen' ? 'Listening' : 'Answer-only'}</td>
                      <td data-label="People">{t.humans}{t.ai_players ? <span className="muted"> + {t.ai_players} AI</span> : ''}</td>
                      <td data-label="Outcome"><span className={`chip ${t.outcome === 'plan locked' ? 'ok' : t.outcome === 'unfinished' ? 'warn' : ''}`}>{t.outcome === 'no plan' ? `no plan (${t.ended_how === 'group' ? 'group ended it' : t.ended_how === 'host' ? 'host ended it' : 'timed out'})` : t.outcome}</span></td>
                      <td data-label="Time to plan">{time(t.time_to_plan_s)}</td>
                      <td data-label="Limits came up">{t.limits_came_up} of {t.limits}</td>
                      <td data-label="Limits respected">{t.limits_respected === null ? 'n/a' : `${t.limits_respected} of ${t.limits}`}</td>
                      <td data-label="Messages">{t.messages}</td>
                      <td data-label="Questions to AI">{t.questions_group}{t.questions_private ? <span className="muted"> + {t.questions_private} private</span> : ''}</td>
                      <td data-label="AI cards">{t.option_cards + t.maps + t.routes + t.rides_proposed + t.tables_proposed}</td>
                      <td className="cell-btn"><button className="btn small ghost no-print" aria-expanded={open === t.session_id} onClick={() => setOpen(open === t.session_id ? null : t.session_id)}>{open === t.session_id ? 'Close' : 'Read'}<span className="sr-only"> the chat at table {t.table}</span></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {open && (() => { const t = a.tables.find((x) => x.session_id === open); return t && (
              <div className="transcript-box" aria-label={`What was said at table ${t.table}`}>
                <div className="row between"><strong>Table {t.table} · {t.task_name} · {a.mode_names[t.ai_mode]}</strong><button className="btn small ghost no-print" onClick={() => setOpen(null)}>Close</button></div>
                <Transcript code={code} id={open} />
              </div>
            ); })()}
          </section>
        </>
      )}

      <section className="card stack no-print" aria-labelledby="dl-h">
        <h2 id="dl-h" style={{ margin: 0 }}>Download the data</h2>
        <div className="downloads">
          {[['tables.csv', 'One row per table, with every number on this page'], ['participants.csv', 'One row per person: their limit, how it came up, messages, taps, feedback'],
            ['logs.csv', 'Every event with a timestamp (messages, taps, AI actions)'], ['feedback.csv', 'The six taps and comments'], ['sessions.csv', 'One row per table as saved at the end'], ['players.csv', 'Seats and limit ids']].map(([f, d]) => (
            <a key={f} className="dl" href={exp(f)}><strong>{f}</strong><span className="small muted">{d}</span></a>
          ))}
          {jsonUrl && <a className="dl" href={jsonUrl} download={`${code}-analytics.json`}><strong>analytics.json</strong><span className="small muted">This page as data</span></a>}
        </div>
        <p className="small muted" style={{ margin: 0 }}>Codes only: no names and no emails in any file.</p>
      </section>

      <section className="card stack" aria-labelledby="def-h">
        <h2 id="def-h" style={{ margin: 0 }}>How each number is computed</h2>
        <dl className="defs">{a.definitions.map(([k, v]) => <React.Fragment key={k}><dt>{k}</dt><dd>{v}</dd></React.Fragment>)}</dl>
        {Object.keys(a.model_sources).length > 0 && <p className="small muted" style={{ margin: 0 }}>Where AI text came from in this session: {Object.entries(a.model_sources).map(([k, v]) => `${k.replace('openai:', 'OpenAI ').replace('anthropic:', 'Anthropic ')} (${v})`).join(', ')}.</p>}
      </section>
      {tip.el}
    </div>
  );
}
