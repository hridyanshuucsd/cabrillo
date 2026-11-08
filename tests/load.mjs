// Load test: a host and a full class of simulated students play one class session at the same time.
// Checks that tables form at the right size, every table gets a different scenario, both AI modes are used,
// late arrivals are seated, every table finishes, and the data exports work.
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
    const st = { i, s, cookie, sessionId: null, last: null, sent: 0, states: 0, done: false, feedback: false };
    s.on('game:start', ({ sessionId }) => { st.sessionId = sessionId; s.emit('game:join', { sessionId }); });
    s.on('game:state', (g) => {
      st.last = g; st.states++;
      const send = (ev, extra) => s.emit(ev, { sessionId: g.id, ...extra });
      if (g.stage === 'setup' && !g.me.ready && !st.readyTimer) st.readyTimer = setTimeout(() => send('game:ready'), 2500 + Math.random() * 1500);
      if (g.stage === 'chat' && !st.chatting) {
        st.chatting = true;
        const loop = async () => {
          for (let k = 0; k < 5 && st.last?.stage === 'chat'; k++) {
            await sleep(1500 + Math.random() * 3500);
            if (st.last?.stage !== 'chat') break;
            const f = g.task.fields[Math.floor(Math.random() * g.task.fields.length)];
            const opt = f.options[Math.floor(Math.random() * f.options.length)];
            send('game:chat', { text: `${TALK[k % TALK.length]} ${opt.name.toLowerCase()}` }); st.sent++;
            if (k === 1 && Math.random() < 0.5) send('game:share');
            if (k === 2 && i % 7 === 0) send('game:chat', { text: '@AI what have we decided so far?' });
            if (k === 3 && i % 11 === 0 && g.task.fields.some((x) => x.id === 'where')) send('game:chat', { text: 'can you book an uber for us' });
          }
          if (st.last?.stage === 'chat') send('game:confirm-ready');
        };
        loop();
      }
      if (g.stage === 'confirm' && !g.deal) {
        const missing = g.task.fields.filter((f) => !g.plan[f.id]);
        const first = g.players.filter((p) => !p.isAI)[0]?.isYou;
        if (missing.length && first) send('game:set', { field: missing[0].id, option: missing[0].options[0].id });
        else if (!missing.length && !g.me.accepted) send('game:accept', { value: true });
        // Approve any pending booking so it does not hang.
        for (const b of g.bookings) if (b.status === 'pending' && b.mine === null) send('game:booking', { bookingId: b.id, value: true });
      }
      if (g.stage === 'chat') for (const b of g.bookings) if (b.status === 'pending' && b.mine === null) send('game:booking', { bookingId: b.id, value: Math.random() < 0.8 });
      if ((g.stage === 'wrap' || g.stage === 'done') && !st.feedback) {
        st.feedback = true;
        post('/api/feedback', { sessionId: g.id, aiHelpful: 1 + Math.floor(Math.random() * 5), aiAmount: 'about_right', playAgain: 'yes' }, cookie);
      }
      if (g.stage === 'done') st.done = true;
    });
    await new Promise((r) => s.on('connect', r));
    const r = await emit(s, 'room:join', { code: room.code });
    if (r.error) throw new Error(r.error);
    return st;
  })();
}

const t0 = Date.now();
const students = await Promise.all(Array.from({ length: N }, (_, i) => student(i + 1)));
await sleep(500);
check(`${N} students joined the waiting room`, roomState?.waiting.length === N, `(${roomState?.waiting.length})`);

// event loop lag on the server is not visible here, so measure response time of the health route during play
const lag = [];
const probe = setInterval(async () => { const a = Date.now(); try { await fetch(`${BASE}/api/health`); lag.push(Date.now() - a); } catch {} }, 500);

const startRes = await emit(host, 'room:start', { code: room.code });
check('host starts tables', startRes.ok === true);
await sleep(800);
const first = [...hostTables.values()];
const sizes = first.map((t) => t.players.filter((p) => !p.isAI).length);
check('every table has 3 to 5 people', sizes.every((n) => n >= 3 && n <= 5), `(sizes ${sizes.sort().join(',')})`);
check('every student was seated once', sizes.reduce((a, b) => a + b, 0) === N);
const tasks = first.map((t) => t.task);
check('every table has a different scenario', new Set(tasks).size === tasks.length, `(${tasks.length} tables, ${new Set(tasks).size} scenarios)`);
const modes = first.map((t) => t.mode);
check('both AI modes are used about equally', Math.abs(modes.filter((m) => m === 'listen').length - modes.filter((m) => m === 'ask').length) <= 1, `(${modes.filter((m) => m === 'listen').length} listening, ${modes.filter((m) => m === 'ask').length} answer-only)`);

// ---------- two late arrivals during Set up join existing tables; one much later gets its own table ----------
const late = await Promise.all([student(N + 1), student(N + 2)]);
await sleep(300);
const lateRes = await emit(host, 'room:start', { code: room.code });
await sleep(800);
check('two late arrivals join tables still in Set up', lateRes.seated === true && late.every((s) => s.sessionId && first.some((t) => t.id === s.sessionId)), JSON.stringify(lateRes));
await sleep(6000);
const latest = await student(N + 3);
await sleep(300);
await emit(host, 'room:start', { code: room.code });
await sleep(800);
const extra = [...hostTables.values()].find((t) => !first.some((f) => f.id === t.id));
check('a later arrival gets a new table with AI players filling seats', !!extra && extra.players.length === 3 && extra.players.filter((p) => p.isAI).length === 2, extra ? `(table ${extra.number}, ${extra.task})` : '');
students.push(...late, latest);

// ---------- wait for every table to finish ----------
for (let k = 0; k < 240 && !students.every((s) => s.done); k++) await sleep(500);
clearInterval(probe);
const doneCount = students.filter((s) => s.done).length;
check('every student reached the end', doneCount === students.length, `(${doneCount} of ${students.length})`);
const all = [...hostTables.values()];
const deals = all.filter((t) => t.deal).length;
check('tables locked plans', deals >= Math.ceil(all.length * 0.8), `(${deals} of ${all.length})`);
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
const sessionsCsv = await (await fetch(`${BASE}/api/export/${room.code}/sessions.csv`, { headers: { cookie: hostCookie } })).text();
const playersCsv = await (await fetch(`${BASE}/api/export/${room.code}/players.csv`, { headers: { cookie: hostCookie } })).text();
check('players.csv has no names', !/Student\d/.test(playersCsv) && !/Student\d/.test(sessionsCsv));
console.log(`\n${all.length} tables, ${students.length} students, ${Math.round((Date.now() - t0) / 1000)} s. Messages sent: ${students.reduce((a, s) => a + s.sent, 0)}. States received: ${students.reduce((a, s) => a + s.states, 0)}.`);

students.forEach((s) => s.s.close()); host.close();
server.kill(); await pg.stop();
const failed = results.filter((x) => !x).length;
console.log(failed ? `${failed} check(s) failed` : 'All load checks passed.');
process.exit(failed ? 1 : 0);
