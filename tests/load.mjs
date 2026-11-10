// Load test: a host and a full class of simulated students play one class session at the same time.
// Students arrive one by one over about 15 seconds and are seated the moment they join; full tables start by themselves.
// Checks table sizes, a different scenario per table, both AI modes, people who leave while a table fills,
// a late arrival, that every table finishes, and that the data exports work.
// Run: node tests/load.mjs [students]   (default 75; uses TIME_SCALE 0.1, so a 10 minute session takes about 1 minute)
import { spawn } from 'node:child_process';
import { io } from 'socket.io-client';
import { startLocalDb } from '../scripts/localdb.js';

const N = Number(process.argv[2] || 75);
const PORT = 3300, BASE = `http://localhost:${PORT}`;
const { pg, url } = await startLocalDb({ dir: '.loaddb', port: 5436, fresh: true });
const server = spawn(process.execPath, ['server/index.js'], {
  env: { ...process.env, DATABASE_URL: url, PORT: String(PORT), TIME_SCALE: '0.1', JWT_SECRET: 'load', ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '' },
  stdio: ['ignore', 'pipe', 'pipe']
});
let serverErrors = '';
server.stderr.on('data', (d) => { serverErrors += d; process.stderr.write(d); });
for (let i = 0; i < 80; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 200)); }

const results = [];
const check = (name, ok, extra = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${extra}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cookieOf = (res) => res.headers.get('set-cookie').split(';')[0];
const post = async (path, body, cookie) => fetch(`${BASE}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
const connect = (cookie) => io(BASE, { transports: ['websocket'], extraHeaders: { cookie }, reconnection: true });
const emit = (s, ev, p) => new Promise((r) => s.emit(ev, p, (x) => r(x || {})));

// ---------- host ----------
const hostCookie = cookieOf(await post('/api/signup', { email: 'host@ucsd.edu', name: 'Host', password: 'a-long-password', consent: true }));
const room = await (await post('/api/rooms', { kind: 'class', task: 'mixed', aiMode: 'compare', groupSize: 4 }, hostCookie)).json();
const host = connect(hostCookie);
const hostTables = new Map();
host.on('host:table', (t) => hostTables.set(t.id, t));
let roomState = null;
host.on('room:state', (s) => { roomState = s; });
await emit(host, 'host:watch', { code: room.code });

// ---------- students ----------
const TALK = ['I would like', 'What about', 'I vote for', 'Maybe', 'I am fine with'];
function student(i) {
  return (async () => {
    const cookie = cookieOf(await post('/api/guest', { name: `Student${String(i).padStart(2, '0')}`, consent: true }));
    const s = connect(cookie);
    const st = { i, s, cookie, sessionId: null, last: null, sent: 0, states: 0, done: false, feedback: false, picked: {} };
    s.on('game:start', ({ sessionId }) => { st.sessionId = sessionId; s.emit('game:join', { sessionId }); });
    s.on('game:state', (g) => {
      st.last = g; st.states++;
      const send = (ev, extra) => s.emit(ev, { sessionId: g.id, ...extra });
      // briefing: some people swap their limit or write their own, then everyone taps Ready
      if (['setup', 'forming'].includes(g.stage) && !g.me.ready && !st.readyTimer) {
        if (i % 6 === 1) send('game:limit', { action: 'swap' });
        if (i % 9 === 2) send('game:limit', { action: 'own', text: 'I need to be home by nine in the evening' });
        st.readyTimer = setTimeout(() => send('game:ready'), 2500 + Math.random() * 1500);
      }
      // student 5 closes the page as soon as the chat starts; their table must still be able to finish
      if (i === 5 && g.stage === 'chat' && !st.dropped) { st.dropped = true; st.done = true; s.close(); return; }
      if (g.stage === 'chat' && !st.chatting) {
        st.chatting = true;
        (async () => {
          for (let k = 0; k < 4 && st.last?.stage === 'chat'; k++) {
            await sleep(1500 + Math.random() * 3500);
            if (st.last?.stage !== 'chat') break;
            const f = g.task.fields[Math.floor(Math.random() * g.task.fields.length)];
            const opt = f.options[Math.floor(Math.random() * f.options.length)];
            send('game:chat', { text: `${TALK[k % TALK.length]} ${opt.name.toLowerCase()}` }); st.sent++;
            if (k === 1 && i % 3 === 0) send('game:share', { mode: i % 2 ? 'named' : 'anon' });
            if (k === 1 && i % 3 === 1) send('game:chat', { text: 'Here is my limit in my own words', limit: true });
            if (k === 2 && i % 7 === 0) send('game:chat', { text: '@AI what have we decided so far?' });
            if (k === 2 && i % 5 === 0) send('game:ask', { text: 'what have we decided so far?', private: true });
            const mt = g.chat.find((m) => m.sup && m.from !== g.me.pcode); if (k === 1 && i % 4 === 0 && mt) send('game:metoo', { msgId: mt.id });
            if (k === 3 && i % 11 === 0 && g.task.fields.some((x) => x.id === 'where')) send('game:chat', { text: 'can you book an uber for us' });
          }
          st.converge = true; // after talking, go along with whatever has the most support
        })();
      }
      if (g.stage === 'chat' && !g.deal) {
        for (const b of g.bookings) if (b.status === 'asking' && b.mine === null) send('game:booking-answer', { bookingId: b.id, ok: b.options.filter(() => Math.random() < 0.8).map((o) => o.id) });
        if (st.converge) {
          for (const f of g.panel) {
            if (f.status === 'agreed') continue;
            const target = f.options[0]?.option || g.task.fields.find((x) => x.id === f.id).options[0].id;
            if (g.me.prefs[f.id] !== target && st.picked[f.id] !== target) { st.picked[f.id] = target; send('game:pick', { field: f.id, option: target }); setTimeout(() => { st.picked[f.id] = null; }, 1500); }
          }
          if (g.complete && !g.me.accepted) send('game:accept', { value: true, fits: true });
        }
      }
      if (g.stage === 'done' && !st.feedback) {
        st.feedback = true;
        post('/api/feedback', { sessionId: g.id, aiHelpful: 1 + Math.floor(Math.random() * 5), aiAmount: 'about_right', planOk: 1 + Math.floor(Math.random() * 5), comfort: 1 + Math.floor(Math.random() * 5), inCharge: 1 + Math.floor(Math.random() * 5), playAgain: 'yes' }, cookie);
      }
      if (g.stage === 'done') st.done = true;
    });
    await new Promise((r) => s.on('connect', r));
    const r = await emit(s, 'room:join', { code: room.code });
    if (r.error) throw new Error(r.error);
    st.seatedOnJoin = !!r.sessionId;
    return st;
  })();
}

const t0 = Date.now();
const lag = [];
const probe = setInterval(async () => { const a = Date.now(); try { await fetch(`${BASE}/api/health`); lag.push(Date.now() - a); } catch {} }, 500);

// one person joins and closes the page before their table fills: their seat must be freed
const leaver = await student(0);
await sleep(200);
const leaverTable = leaver.sessionId;
leaver.s.close();
await sleep(3000);

// the class arrives over about 15 seconds
const students = await Promise.all(Array.from({ length: N }, (_, i) => sleep(Math.random() * 15000).then(() => student(i + 1))));
check(`all ${N} students were seated the moment they joined`, students.every((s) => s.seatedOnJoin && s.sessionId), `(${students.filter((s) => s.seatedOnJoin).length})`);
await sleep(1500);
const lt = hostTables.get(leaverTable);
check('a person who closes the page while their table fills gives up the seat', !lt || !lt.players.some((p) => p.name === 'Student00'));

// the host starts whatever is still filling
const startRes = await emit(host, 'host:start-all', { code: room.code });
check('host starts the remaining tables', startRes.ok === true, JSON.stringify(startRes));
await sleep(1000);
const ids = new Set(roomState.tables.map((t) => t.id));
const first = [...hostTables.values()].filter((t) => ids.has(t.id));
const sizes = first.map((t) => t.players.filter((p) => !p.isAI).length);
check('every table has 3 to 5 people', sizes.every((n) => n >= 3 && n <= 5), `(sizes ${sizes.sort().join(',')})`);
check('most tables have the chosen size of 4', sizes.filter((n) => n === 4).length >= sizes.length - 3);
check('every student was seated once', sizes.reduce((a, b) => a + b, 0) === N);
const tasks = first.map((t) => t.task);
check('every table has a different scenario', new Set(tasks).size === tasks.length, `(${tasks.length} tables, ${new Set(tasks).size} scenarios)`);
const modes = first.map((t) => t.mode);
check('both AI modes are used about equally', Math.abs(modes.filter((m) => m === 'listen').length - modes.filter((m) => m === 'ask').length) <= 1, `(${modes.filter((m) => m === 'listen').length} listening, ${modes.filter((m) => m === 'ask').length} answer-only)`);
check('no table is left filling', first.every((t) => t.stage !== 'forming'));

// a late arrival after every table started gets a new table
await sleep(4000);
const latest = await student(N + 1);
await sleep(500);
const lateTable = hostTables.get(latest.sessionId);
check('a late arrival is seated at once', !!latest.sessionId && !first.some((t) => t.id === latest.sessionId && t.players.every((p) => !p.isAI)));
// Nobody waits more than about 3 minutes: with nobody else arriving, the table starts by itself with AI players
// (90 seconds after the person sat down; 9 seconds at this test's speed). The host does not have to notice.
const waitedFrom = Date.now();
for (let k = 0; k < 40 && hostTables.get(latest.sessionId)?.stage === 'forming'; k++) await sleep(500);
const extra = hostTables.get(latest.sessionId);
check('a late arrival who is alone starts with AI players without the host doing anything', !!extra && extra.stage !== 'forming' && extra.players.filter((p) => p.isAI).length >= 1, extra ? `(table ${extra.number}, ${extra.players.length} seats, after ${Math.round((Date.now() - waitedFrom) / 100) / 10} s at test speed)` : '');
students.push(latest);

// ---------- wait for every table to finish ----------
for (let k = 0; k < 240 && !students.every((s) => s.done); k++) await sleep(500);
clearInterval(probe);
const doneCount = students.filter((s) => s.done).length;
check('every student reached the end', doneCount === students.length, `(${doneCount} of ${students.length})`);
const all = [...hostTables.values()].filter((t) => roomState.tables.some((x) => x.id === t.id));
const deals = all.filter((t) => t.deal).length;
check('every table locked a plan, including the one where someone closed the page', deals === all.length, `(${deals} of ${all.length})`);
const p95 = lag.sort((a, b) => a - b)[Math.floor(lag.length * 0.95)] || 0;
check('server stayed responsive during play', p95 < 250, `(health check p95 ${p95} ms, max ${lag[lag.length - 1]} ms)`);
check('no server errors', !/unhandled|uncaught|failed/i.test(serverErrors), serverErrors ? serverErrors.slice(0, 200) : '');

// ---------- exports ----------
await sleep(1500);
for (const f of ['sessions.csv', 'players.csv', 'logs.csv', 'feedback.csv']) {
  const r = await fetch(`${BASE}/api/export/${room.code}/${f}`, { headers: { cookie: hostCookie } });
  const rows = (await r.text()).trim().split('\n').length - 1;
  const want = f === 'sessions.csv' ? all.length : f === 'players.csv' ? all.reduce((a, t) => a + t.players.length, 0) : 1;
  check(`export ${f}`, r.ok && rows >= want, `(${rows} rows)`);
}
const logsCsv = await (await fetch(`${BASE}/api/export/${room.code}/logs.csv`, { headers: { cookie: hostCookie } })).text();
const want = ['limit_changed', 'limit_shared', 'pick', 'plan_update', 'plan_complete', 'vote', 'deal_locked', 'session_outcome', 'player_outcome', 'limit_alert_private', 'question_asked'];
check('the new flow is in the research logs', want.every((e) => logsCsv.includes(e)), want.filter((e) => !logsCsv.includes(e)).join(', '));
const sessionsCsv = await (await fetch(`${BASE}/api/export/${room.code}/sessions.csv`, { headers: { cookie: hostCookie } })).text();
const playersCsv = await (await fetch(`${BASE}/api/export/${room.code}/players.csv`, { headers: { cookie: hostCookie } })).text();
check('players.csv has no names', !/Student\d/.test(playersCsv) && !/Student\d/.test(sessionsCsv));

// ---------- analytics, computed from the saved logs ----------
const an = await (await fetch(`${BASE}/api/analytics/${room.code}`, { headers: { cookie: hostCookie } })).json();
check('analytics count every finished table and every person', an.all.tables === all.length && an.all.people === students.length, `(${an.all.tables} tables, ${an.all.people} people)`);
check('analytics agree with the host console on plans locked', an.all.plans_locked === deals, `(${an.all.plans_locked})`);
check('analytics split the tables by AI mode', an.modes.listen.tables + an.modes.ask.tables === all.length && Math.abs(an.modes.listen.tables - an.modes.ask.tables) <= 1, `(${an.modes.listen.tables} listening, ${an.modes.ask.tables} answer-only)`);
check('every person has exactly one limit outcome', Object.values(an.all.limit_ways).reduce((x, y) => x + y, 0) === an.all.people, JSON.stringify(an.all.limit_ways));
check('analytics count the feedback forms', an.all.feedback_n >= students.length - 2, `(${an.all.feedback_n})`);
check('time to plan is recorded for every locked table', an.tables.filter((t) => t.outcome === 'plan locked').every((t) => t.time_to_plan_s > 0));
const tcsv = await (await fetch(`${BASE}/api/export/${room.code}/tables.csv`, { headers: { cookie: hostCookie } })).text();
const pcsv = await (await fetch(`${BASE}/api/export/${room.code}/participants.csv`, { headers: { cookie: hostCookie } })).text();
check('tables.csv and participants.csv have one row per table and per person', tcsv.trim().split('\n').length - 1 === all.length && pcsv.trim().split('\n').length - 1 === students.length && !/Student\d/.test(tcsv + pcsv));
if (process.env.SHOTS) { // a picture of the analytics page for a full class: SHOTS=1 node tests/load.mjs
  const { createRequire } = await import('node:module');
  const { chromium, devices } = createRequire(import.meta.url)('playwright');
  const fs = await import('node:fs'); fs.mkdirSync('test-shots/analytics', { recursive: true });
  const browser = await chromium.launch();
  const [name, value] = hostCookie.split('=');
  for (const [label, opts] of [['laptop', { viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 }], ['phone', { ...devices['iPhone 14'] }]]) {
    const ctx = await browser.newContext(opts); await ctx.addCookies([{ name, value, url: BASE }]);
    const page = await ctx.newPage(); await page.goto(`${BASE}/analytics/${room.code}`);
    await page.getByText('Every table').waitFor({ timeout: 10000 });
    await page.screenshot({ path: `test-shots/analytics/class_${label}.png`, fullPage: true });
    await ctx.close();
  }
  await browser.close();
}
console.log(`\n${all.length} tables, ${students.length} students, ${Math.round((Date.now() - t0) / 1000)} s. Messages sent: ${students.reduce((a, s) => a + s.sent, 0)}. States received: ${students.reduce((a, s) => a + s.states, 0)}.`);

students.forEach((s) => s.s.close()); host.close();
server.kill(); await pg.stop();
const failed = results.filter((x) => !x).length;
console.log(failed ? `${failed} check(s) failed` : 'All load checks passed.');
process.exit(failed ? 1 : 0);
