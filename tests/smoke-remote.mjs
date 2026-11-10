import { io } from 'socket.io-client';
// Run: node tests/smoke-remote.mjs https://your-app.onrender.com  (creates one test host account and a short class session)
const BASE = process.argv[2] || 'https://cabrillo.onrender.com';
const ck = (r) => r.headers.get('set-cookie')?.split(';')[0];
const post = (p, b, c) => fetch(BASE + p, { method: 'POST', headers: { 'content-type': 'application/json', ...(c ? { cookie: c } : {}) }, body: JSON.stringify(b) });
const emit = (s, e, p) => new Promise((r) => s.emit(e, p, (x) => r(x || {})));
const out = (n, ok, x = '') => console.log(`${ok ? 'PASS' : 'FAIL'}  ${n} ${x}`);
const t = await fetch(BASE + '/api/tasks'); const tasks = await t.json(); out('scenarios served', tasks.length === 20, `(${tasks.length})`);
let r = await post('/api/signup', { email: `smoke${Date.now()}@cabrillo.test`, name: 'Smoke Host', password: 'smoke-test-password-1', consent: true });
const hc = ck(r); out('host account created (database works)', r.ok && !!hc, `(${r.status})`);
r = await post('/api/rooms', { kind: 'class', task: 'mixed', aiMode: 'compare', groupSize: 4 }, hc); const room = await r.json(); out('class session created', !!room.code, room.code);
const host = io(BASE, { transports: ['websocket'], extraHeaders: { cookie: hc } });
await new Promise((res) => host.on('connect', res)); await emit(host, 'host:watch', { code: room.code });
const tables = new Map(); host.on('host:table', (x) => tables.set(x.id, x));
const kids = [];
for (let i = 1; i <= 4; i++) {
  const c = ck(await post('/api/guest', { name: `Smoke${i}`, consent: true }));
  const s = io(BASE, { transports: ['websocket'], extraHeaders: { cookie: c } });
  const st = { s, state: null };
  s.on('game:start', ({ sessionId }) => s.emit('game:join', { sessionId }));
  s.on('game:state', (g) => { st.state = g; });
  await new Promise((res) => s.on('connect', res));
  const j = await emit(s, 'room:join', { code: room.code }); if (j.error) out('guest join', false, j.error);
  st.seated = !!j.sessionId;
  kids.push(st);
}
out('4 guests were seated the moment they joined', kids.every((k) => k.seated));
await new Promise((res) => setTimeout(res, 3000));
out('the full table started by itself (briefing)', kids.every((k) => k.state?.stage === 'setup'), kids.map((k) => k.state?.stage).join(','));
out('every person has a private limit', kids.every((k) => k.state?.me?.limit?.text));
const tb = [...tables.values()][0]; out('host sees the table', !!tb, tb ? `(Table ${tb.number}, ${tb.task}, ${tb.mode})` : '');
for (const k of kids) k.s.emit('game:ready', { sessionId: k.state.id });
await new Promise((res) => setTimeout(res, 2500));
out('all ready moves the table to Chat', kids.every((k) => k.state?.stage === 'chat'));
out('the chat has no timer', kids.every((k) => !k.state?.stageEndsAt));
kids[0].s.emit('game:chat', { sessionId: kids[0].state.id, text: 'hello from the smoke test' });
await new Promise((res) => setTimeout(res, 1500));
out('chat message reaches the other phones', kids[3].state.chat.some((m) => m.text === 'hello from the smoke test'));
// Tap one option for the first plan part on three phones: the plan above the chat should follow.
const f0 = kids[0].state.task.fields[0];
for (const k of kids.slice(0, 3)) k.s.emit('game:pick', { sessionId: k.state.id, field: f0.id, option: f0.options[0].id });
await new Promise((res) => setTimeout(res, 1500));
out('picks update the shared plan', kids[3].state.plan?.[f0.id] === f0.options[0].id, `(${f0.name}: ${f0.options[0].name})`);
kids[1].s.emit('game:share', { sessionId: kids[1].state.id, mode: 'anon' });
await new Promise((res) => setTimeout(res, 1500));
out('the AI passes on a limit without a name', kids[0].state.chat.some((m) => m.passedOn));
const health = await (await fetch(BASE + '/api/health')).json(); out('AI answers come from', true, health.ai || 'scripted');
const cfg = await (await fetch(BASE + '/api/config')).json(); out('Mapbox maps', true, cfg.mapboxToken ? 'on' : 'off (Esri tiles)');
if (health.ai && health.ai !== 'scripted') {
  kids[2].s.emit('game:chat', { sessionId: kids[2].state.id, text: '@AI in one sentence, what have we decided so far?' });
  await new Promise((res) => setTimeout(res, 9000));
  const ans = [...kids[2].state.chat].reverse().find((m) => m.from === 'AI' && !m.passedOn && m.kind !== 'map' && m.kind !== 'booking');
  out('the model answers an @AI question', !!ans, ans ? `("${ans.text.slice(0, 90)}")` : '');
  out('the "AI hears" line is filled in', !!kids.find((k) => k.state.hearing)?.state.hearing, `("${String(kids.find((k) => k.state.hearing)?.state.hearing || '').slice(0, 110)}")`);
}
const host2 = await fetch(`${BASE}/api/export/${room.code}/logs.csv`, { headers: { cookie: hc } }); const csv = await host2.text();
out('logs export works', host2.ok && csv.split('\n').length > 3, `(${csv.split('\n').length - 1} rows)`);
for (const k of kids) k.s.close(); host.close();
process.exit(0);
