// Talks to a deployed copy with one simulated person at a table with two AI players, and prints what the AI and the AI
// players actually say (this is the only way to see the real model's wording, since the key lives on the server).
// Run: node tests/live-ai.mjs https://your-app.onrender.com   (creates one test host account and one class session)
import { io } from 'socket.io-client';
const BASE = process.argv[2] || 'https://cabrillo.onrender.com';
const ck = (r) => r.headers.get('set-cookie')?.split(';')[0];
const post = (p, b, c) => fetch(BASE + p, { method: 'POST', headers: { 'content-type': 'application/json', ...(c ? { cookie: c } : {}) }, body: JSON.stringify(b) });
const emit = (s, e, p) => new Promise((r) => s.emit(e, p, (x) => r(x || {})));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
console.log('health:', await (await fetch(BASE + '/api/health')).text());
let r = await post('/api/signup', { email: `live${Date.now()}@cabrillo.test`, name: 'Live Check', password: 'live-check-password-1', consent: true });
const hc = ck(r);
r = await post('/api/rooms', { kind: 'class', task: process.argv[3] || 'outing', aiMode: 'listen', groupSize: 3 }, hc);
const room = await r.json(); console.log('class session', room.code);
const host = io(BASE, { transports: ['websocket'], extraHeaders: { cookie: hc } });
await new Promise((res) => host.on('connect', res)); await emit(host, 'host:watch', { code: room.code });
await emit(host, 'host:auto-start', { code: room.code, value: false });
const c = ck(await post('/api/guest', { name: 'Maya', consent: true }));
const s = io(BASE, { transports: ['websocket'], extraHeaders: { cookie: c } });
let g = null; const seen = new Set();
const show = () => { for (const m of g?.chat || []) { if (seen.has(m.id)) continue; seen.add(m.id);
  const extra = [m.poll && `[options: ${m.poll}]`, m.blocks?.length && `[blocks: ${JSON.stringify(m.blocks)}]`, m.compare && `[compare: ${JSON.stringify(m.compare.items)}]`, m.kind === 'map' && '[map card]', m.kind === 'booking' && '[booking card]', m.kind === 'plan' && '[plan card]', m.to && '(only Maya sees this)'].filter(Boolean).join(' ');
  console.log(`  ${String(Math.round(m.t / 1000)).padStart(4)}s  ${m.name}${m.kind === 'limit' ? ' (shared a limit)' : m.kind === 'question' ? ' (asked the AI)' : ''}: ${m.text} ${extra}`); } };
s.on('game:start', ({ sessionId }) => s.emit('game:join', { sessionId }));
s.on('game:state', (x) => { g = x; show(); });
await new Promise((res) => s.on('connect', res));
const j = await emit(s, 'room:join', { code: room.code }); s.emit('game:join', { sessionId: j.sessionId });
await wait(1500);
await emit(host, 'host:start-table', { code: room.code, sessionId: j.sessionId });
await wait(1500);
console.log('my limit:', g.me.limit.text);
s.emit('game:ready', { sessionId: g.id });
await wait(2500);
const say = async (t, ms = 14000) => { s.emit('game:chat', { sessionId: g.id, text: t }); await wait(ms); if (g.hearing) console.log('   AI HEARS:', g.hearing); };
const ask = async (t, priv, ms = 16000) => { s.emit('game:ask', { sessionId: g.id, text: t, private: priv }); await wait(ms); };
await wait(16000);
await say('where should we meet guys?');
await say('okay, what time tho?');
// "Me too" on an AI player's message, if one offers it
const mt = g.chat.find((m) => m.sup && m.from !== g.me.pcode);
if (mt) { s.emit('game:metoo', { sessionId: g.id, msgId: mt.id }); console.log(`   (tapped "Me too" on: ${mt.text})`); await wait(3000); }
await say('im down for whatever honestly, just not too expensive');
await ask('pros and cons of the top two places?', false, 20000);
await ask('what should we bring?', false);
console.log('   picks before the what-if question:', JSON.stringify(g.me.prefs));
await ask('if we take an uber and it costs 26 dollars, what does each of us pay?', false);
console.log('   picks after the what-if question: ', JSON.stringify(g.me.prefs), '(must be the same)');
await ask('how do i tell the group about my limit without making it awkward?', true, 18000);
await ask('ok and what if they still want to drive?', true, 18000);
// a group decision (rideshare), then the private answers about which ride
if (g.task.fields.some((f) => f.id === 'travel') && !/carsick/.test(g.me.limit.text)) {
  for (const [f, o] of Object.entries({ travel: 'rideshare' })) s.emit('game:pick', { sessionId: g.id, field: f, option: o });
  await wait(12000);
  const b = g.bookings.find((x) => x.status === 'asking');
  if (b) { console.log('   ride options:', b.options.map((o) => `${o.name} $${o.perPerson} each`).join(', ')); s.emit('game:booking-answer', { sessionId: g.id, bookingId: b.id, ok: b.options.slice(0, 2).map((o) => o.id) }); await wait(5000); console.log('   ride status:', g.bookings[0].status, g.bookings[0].choice || ''); }
}
await say('ok lets lock this in', 12000);
console.log('plan:', JSON.stringify(g.plan), 'panel:', g.panel.map((f) => `${f.name}=${f.leaderName || '-'}(${f.status})`).join(', '));
const csv = await (await fetch(`${BASE}/api/export/${room.code}/logs.csv`, { headers: { cookie: hc } })).text();
const src = {}; for (const m of csv.matchAll(/""source"":""([^"]+)""/g)) src[m[1]] = (src[m[1]] || 0) + 1;
console.log('answers came from:', JSON.stringify(src));
await emit(host, 'host:announce', { code: room.code, text: 'About 2 minutes left. Try to settle on a plan.' });
await wait(1500);
await emit(host, 'host:end-all', { code: room.code });
await wait(3000);
const an = await (await fetch(`${BASE}/api/analytics/${room.code}`, { headers: { cookie: hc } })).json();
console.log('analytics:', JSON.stringify({ tables: an.all.tables, people: an.all.people, plans_locked: an.all.plans_locked, ended: an.all.ended, limit_ways: an.all.limit_ways, questions_private_per_table: an.all.questions_private_per_table, model_sources: an.model_sources }));
console.log(`analytics page: ${BASE}/analytics/${room.code} (sign in as the test host to open it)`);

s.close(); host.close(); process.exit(0);
