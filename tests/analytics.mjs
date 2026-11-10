// Analytics check: three small tables play a scripted class session with a known outcome, and the analytics computed
// from the saved logs must match it exactly. Then the analytics page is opened as the host on a laptop and on a phone.
//   Table 1 (listening AI): three people, one "Me too", one private question, two limits shared, plan locked, two feedback forms.
//   Table 2 (answer-only AI): three people, one limit passed on without a name, one silent person, the group ends without a plan.
//   Table 3 (listening AI): one person with two AI players; the host ends it.
// Screenshots go to test-shots/analytics/. Run: npm run build && node tests/analytics.mjs
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { io } from 'socket.io-client';
const { chromium, devices } = createRequire(import.meta.url)('playwright');
import { startLocalDb } from '../scripts/localdb.js';

const PORT = 3800, BASE = `http://localhost:${PORT}`, DIR = 'test-shots/analytics';
fs.rmSync(DIR, { recursive: true, force: true }); fs.mkdirSync(DIR, { recursive: true });
const { pg, url } = await startLocalDb({ dir: '.analyticsdb', port: 5441, fresh: true });
const server = spawn(process.execPath, ['server/index.js'], {
  env: { ...process.env, DATABASE_URL: url, PORT: String(PORT), TIME_SCALE: '0.2', JWT_SECRET: 'an', ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '', ROUTING: 'off' }, stdio: ['ignore', 'ignore', 'inherit']
});
for (let i = 0; i < 60; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 200)); }

const results = [];
const check = (name, ok, extra = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${extra}`); };
const eq = (name, got, want) => check(name, JSON.stringify(got) === JSON.stringify(want), JSON.stringify(got) === JSON.stringify(want) ? `(${JSON.stringify(got)})` : `got ${JSON.stringify(got)}, expected ${JSON.stringify(want)}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cookieOf = (res) => res.headers.get('set-cookie').split(';')[0];
const post = (path, body, cookie) => fetch(`${BASE}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
const get = (path, cookie) => fetch(`${BASE}${path}`, { headers: cookie ? { cookie } : {} });
const emit = (s, ev, p) => new Promise((r) => s.emit(ev, p, (x) => r(x || {})));
const until = async (f, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { if (f()) return true; await sleep(100); } return false; };

let browser;
try {
  // ---------- host ----------
  const hostCookie = cookieOf(await post('/api/signup', { email: 'host@ucsd.edu', name: 'Host', password: 'a-long-password', consent: true }));
  const room = await (await post('/api/rooms', { kind: 'class', task: 'outing', aiMode: 'compare', groupSize: 3 }, hostCookie)).json();
  const host = io(BASE, { transports: ['websocket'], extraHeaders: { cookie: hostCookie } });
  await new Promise((r) => host.on('connect', r));
  await emit(host, 'host:watch', { code: room.code });

  // ---------- seven students: tables of 3, 3 and 1 ----------
  async function student(name) {
    const cookie = cookieOf(await post('/api/guest', { name, consent: true }));
    const s = io(BASE, { transports: ['websocket'], extraHeaders: { cookie } });
    const st = { name, s, cookie, g: null };
    s.on('game:start', ({ sessionId }) => s.emit('game:join', { sessionId }));
    s.on('game:state', (g) => { st.g = g; });
    await new Promise((r) => s.on('connect', r));
    const r = await emit(s, 'room:join', { code: room.code });
    st.sid = r.sessionId; s.emit('game:join', { sessionId: st.sid });
    st.send = (ev, extra) => s.emit(ev, { sessionId: st.sid, ...extra });
    await until(() => st.g);
    return st;
  }
  const people = [];
  for (const n of ['Ana', 'Ben', 'Cai', 'Dee', 'Eli', 'Fay', 'Gus']) { people.push(await student(n)); await sleep(150); }
  const [a1, a2, a3, b1, b2, b3, c1] = people;
  check('seven people fill tables of 3, 3 and 1', a1.sid === a2.sid && a2.sid === a3.sid && b1.sid === b2.sid && b2.sid === b3.sid && c1.sid !== a1.sid && c1.sid !== b1.sid);
  await emit(host, 'host:start-table', { code: room.code, sessionId: c1.sid }); // the single person plays with AI players
  for (const p of people) p.send('game:ready');
  check('all three tables reach the chat', await until(() => people.every((p) => p.g?.stage === 'chat')));
  eq('table 1 listens, table 2 answers only, table 3 listens', [a1.g.mode, b1.g.mode, c1.g.mode], ['listen', 'ask', 'listen']);

  // ---------- table 1: a plan, with a "Me too", a private question and two shared limits ----------
  a1.send('game:chat', { text: 'old town sounds good' });
  await until(() => a2.g.chat.some((m) => m.sup));
  a2.send('game:metoo', { msgId: a2.g.chat.find((m) => m.sup).id });
  a3.send('game:ask', { text: 'what have we decided so far?', private: true });
  a1.send('game:share', { mode: 'named' });
  await sleep(300);
  a2.send('game:chat', { text: a2.g.me.limit.say, limit: true });
  const GOOD = { where: 'oldtown', when: 'sun_pm', travel: 'transit', budget: 'low' }; // respects every limit in this scenario
  await sleep(500);
  // A tap on something a person already asked for in words changes nothing and is not counted, so count the taps that do.
  let taps = 1; // the "Me too"
  const tap = (p, f) => { if (p.g.me.prefs[f] !== GOOD[f]) taps++; p.send('game:pick', { field: f, option: GOOD[f] }); };
  for (const f of ['when', 'travel', 'budget']) { for (const p of [a1, a2, a3]) tap(p, f); await sleep(150); }
  tap(a3, 'where');
  check('table 1 has a complete plan', await until(() => a1.g.complete));
  await sleep(1200); // let the time to plan be more than zero
  for (const p of [a1, a2, a3]) p.send('game:accept', { value: true });
  check('table 1 locks its plan', await until(() => [a1, a2, a3].every((p) => p.g.stage === 'done')));
  const privateSeenByOthers = [a1, a2].some((p) => p.g.chat.some((m) => /what have we decided so far/.test(m.text)));
  check('the private question never reached the other two phones', !privateSeenByOthers && a3.g.chat.some((m) => m.private));
  await post('/api/feedback', { sessionId: a1.sid, aiHelpful: 5, aiAmount: 'about_right', planOk: 4, comfort: 3, inCharge: 5, playAgain: 'yes', comment: 'nice and quick' }, a1.cookie);
  await post('/api/feedback', { sessionId: a2.sid, aiHelpful: 3, aiAmount: 'too_much', planOk: 2, comfort: 4, inCharge: 4, playAgain: 'maybe' }, a2.cookie);

  // ---------- table 2: no plan; the group ends it ----------
  b1.send('game:chat', { text: 'hello there' }); await sleep(150);
  b1.send('game:chat', { text: 'anyone here?' });
  b2.send('game:chat', { text: 'hi' });
  b2.send('game:chat', { text: '@AI what are the options?' });
  b1.send('game:share', { mode: 'anon' });
  await sleep(600);
  for (const p of [b1, b2, b3]) p.send('game:end-vote', { value: true });
  check('table 2 ends without a plan when everyone asks to', await until(() => [b1, b2, b3].every((p) => p.g.stage === 'done')) && !b1.g.deal);
  await post('/api/feedback', { sessionId: b2.sid, aiHelpful: 2, aiAmount: 'too_little', comfort: 2, inCharge: 3, playAgain: 'no' }, b2.cookie);

  // ---------- table 3: the host ends it ----------
  c1.send('game:chat', { text: 'hello everyone' });
  await sleep(400);
  await emit(host, 'host:end-all', { code: room.code });
  check('the host ends table 3', await until(() => c1.g.stage === 'done'));
  await sleep(1500); // let the last log rows reach the database

  // ---------- the numbers ----------
  const res = await get(`/api/analytics/${room.code}`, hostCookie);
  const a = await res.json();
  check('the host can open the analytics', res.ok);
  eq('tables finished', a.all.tables, 3);
  eq('people, without AI players', a.all.people, 7);
  eq('tables with AI players', a.all.tables_with_ai_players, 1);
  eq('plans locked', [a.all.plans_locked, a.all.plans_locked_pct], [1, 33]);
  eq('how tables ended', a.all.ended, { plan: 1, group: 1, host: 1, backstop: 0 });
  check('time to plan is recorded', a.all.time_to_plan_median_s >= 1 && a.all.time_to_plan_median_s < 120, `(${a.all.time_to_plan_median_s} s)`);
  eq('listening tables and people', [a.modes.listen.tables, a.modes.listen.people], [2, 4]);
  eq('answer-only tables and people', [a.modes.ask.tables, a.modes.ask.people], [1, 3]);
  eq('how limits came up at listening tables', a.modes.listen.limit_ways, { self: 1, ai_named: 1, ai_anon: 0, mentioned: 0, never: 2 });
  eq('how limits came up at answer-only tables', a.modes.ask.limit_ways, { self: 0, ai_named: 0, ai_anon: 1, mentioned: 0, never: 2 });
  eq('limits respected by the locked plan', [a.all.limits_respected, a.all.limits_checked, a.all.limits_respected_pct], [3, 3, 100]);
  const truth = a1.g.players.filter((p) => !p.isAI).every((p) => p.limitOk === true);
  check('that matches the results screen people saw', truth);
  eq('messages per person (listening, answer-only)', [a.modes.listen.messages_per_person, a.modes.ask.messages_per_person], [0.8, 1]);
  eq('taps per person at listening tables, and "Me too" taps', [a.modes.listen.taps_per_person, a.modes.listen.me_too], [Math.round((taps / 4) * 10) / 10, 1]);
  eq('silent people (listening, answer-only)', [a.modes.listen.silent_people, a.modes.ask.silent_people], [0, 1]);
  eq('private questions: per listening table, and people who asked', [a.modes.listen.questions_private_per_table, a.modes.listen.people_asked_privately], [0.5, 1]);
  eq('group questions per answer-only table', a.modes.ask.questions_group_per_table, 1);
  eq('private heads-ups', a.all.alerted_people, 0);
  eq('feedback at listening tables', [a.modes.listen.feedback_n, a.modes.listen.scales.ai_helpful, a.modes.listen.scales.plan_ok.mean, a.modes.listen.scales.comfort.mean, a.modes.listen.scales.in_charge.mean],
    [2, { n: 2, mean: 4, counts: [0, 0, 1, 0, 1] }, 3, 3.5, 4.5]);
  eq('"the AI spoke up" and "use again" at listening tables', [a.modes.listen.ai_amount, a.modes.listen.play_again], [{ too_little: 0, about_right: 1, too_much: 1 }, { no: 0, maybe: 1, yes: 1 }]);
  eq('feedback at answer-only tables', [a.modes.ask.feedback_n, a.modes.ask.scales.ai_helpful.mean, a.modes.ask.scales.plan_ok.n, a.modes.ask.ai_amount.too_little, a.modes.ask.play_again.no], [1, 2, 0, 1, 1]);
  eq('feedback response rate', a.all.feedback_rate_pct, 43);
  eq('comments carry a table and a code, not a name', a.comments, [{ table: 1, ai_mode: 'listen', pcode: 'P01', comment: 'nice and quick' }]);
  const t1 = a.tables.find((t) => t.table === 1), t2 = a.tables.find((t) => t.table === 2), t3 = a.tables.find((t) => t.table === 3);
  eq('table rows: outcome and how each ended', [t1.outcome, t1.ended_how, t2.outcome, t2.ended_how, t3.outcome, t3.ended_how], ['plan locked', 'plan', 'no plan', 'group', 'no plan', 'host']);
  eq('table 1: route card shown for the bus plan, no ride', [t1.routes, t1.rides_proposed], [1, 0]);
  eq('table 3: one person and two AI players', [t3.humans, t3.ai_players], [1, 2]);
  eq('leaving out tables with AI players: tables, people, listening tables', [a.people_only.all.tables, a.people_only.all.people, a.people_only.modes.listen.tables, a.people_only.modes.listen.limit_ways.never], [2, 6, 1, 1]);
  const who = a.participants.find((p) => p.table === 1 && p.pcode === 'P03');
  eq('participant row for the person who asked privately', [who.limit_way, who.questions_private, who.taps, who.messages, who.accepted, who.limit_ok, who.feedback], ['never', 1, 4, 0, true, true, false]);
  eq('taps in participants.csv add up to the taps people made', a.participants.filter((p) => p.table === 1).reduce((x, p) => x + p.taps, 0), taps);

  // ---------- files ----------
  const csv = async (f, c = hostCookie) => { const r = await get(`/api/export/${room.code}/${f}`, c); return { ok: r.ok, status: r.status, text: await r.text() }; };
  const tablesCsv = await csv('tables.csv'), partCsv = await csv('participants.csv');
  eq('tables.csv has one row per table', tablesCsv.text.trim().split('\n').length - 1, 3);
  eq('participants.csv has one row per person', partCsv.text.trim().split('\n').length - 1, 7);
  check('no names in either file', !/Ana|Ben|Cai|Dee|Eli|Fay|Gus/.test(tablesCsv.text + partCsv.text));
  const fb = await csv('feedback.csv');
  check('feedback.csv has the new questions', /plan_ok,comfort,in_charge/.test(fb.text.split('\n')[0]));
  const tr = await (await get(`/api/analytics/${room.code}/transcript/${a1.sid}`, hostCookie)).json();
  const kinds = tr.rows.map((r) => r.kind);
  check('the transcript shows the private question, marked private, with codes', tr.rows.some((r) => r.kind === 'private question to the AI' && r.private && r.who === 'P03') && kinds.includes('plan locked') && !/Ana|Ben|Cai/.test(JSON.stringify(tr)));
  check('a student cannot open the analytics or the files', (await get(`/api/analytics/${room.code}`, a1.cookie)).status === 403 && (await csv('tables.csv', a1.cookie)).status === 403 && (await get(`/api/analytics/${room.code}/transcript/${a1.sid}`, a1.cookie)).status === 403);
  const mine = await (await get('/api/my-sessions', hostCookie)).json();
  check('the session is listed under sessions the host ran', mine.length === 1 && mine[0].code === room.code && Number(mine[0].people) === 7);

  // ---------- the page, on a laptop and on a phone ----------
  browser = await chromium.launch();
  const [name, value] = hostCookie.split('=');
  for (const [label, opts] of [['laptop', { viewport: { width: 1280, height: 900 } }], ['phone', { ...devices['iPhone 14'] }]]) {
    const ctx = await browser.newContext(opts);
    await ctx.addCookies([{ name, value, url: BASE }]);
    const page = await ctx.newPage();
    await page.goto(`${BASE}/analytics/${room.code}`);
    check(`${label}: the page opens`, await page.getByRole('heading', { name: 'Session analytics' }).waitFor({ timeout: 8000 }).then(() => true, () => false));
    await page.getByText('Listening AI and answer-only AI, side by side').waitFor({ timeout: 5000 });
    await page.screenshot({ path: `${DIR}/${label}_first.png`, fullPage: true });
    const text = await page.locator('body').innerText();
    check(`${label}: headline numbers are shown`, /Plans locked\s*33%/.test(text) && /1 of 3 tables/.test(text) && /People\s*7/.test(text), '');
    check(`${label}: the limit chart has a table of the same numbers`, (await page.getByRole('img', { name: /Listening AI: how limits came up.*Never came up: 2 of 4/ }).count()) === 1 && /Said it themselves/.test(text));
    await page.getByRole('checkbox', { name: /Leave out tables with AI players/ }).check();
    check(`${label}: tables with AI players can be left out`, /Tables finished\s*2/.test(await page.locator('.tiles').innerText()));
    await page.getByRole('checkbox', { name: /Leave out tables with AI players/ }).uncheck();
    await page.getByRole('button', { name: 'Show the numbers' }).click();
    check(`${label}: feedback numbers can be shown as a table`, (await page.getByRole('cell', { name: '4.00' }).count()) >= 1);
    await page.getByRole('button', { name: 'Read the chat at table 1' }).click();
    check(`${label}: a table's transcript opens`, await page.getByText('private question to the AI').first().waitFor({ timeout: 5000 }).then(() => true, () => false));
    const fit = await page.evaluate(() => ({ sideways: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1, vw: document.documentElement.clientWidth,
      cmp: Math.round(document.querySelector('table.atable').getBoundingClientRect().width), box: Math.round(document.querySelector('table.atable').parentElement.clientWidth) }));
    check(`${label}: the page does not scroll sideways`, !fit.sideways && fit.vw === (label === 'phone' ? 390 : 1280), JSON.stringify(fit));
    check(`${label}: both AI modes fit side by side without scrolling the comparison`, fit.cmp <= fit.box + 1, `(table ${fit.cmp} px in ${fit.box} px)`);
    await page.screenshot({ path: `${DIR}/${label}_full.png`, fullPage: true });
    if (label === 'laptop') {
      await page.locator('.segpart').first().hover();
      check('hovering a bar shows its value', await page.locator('.viz-tip').waitFor({ timeout: 2000 }).then(() => true, () => false));
      await page.locator('.segpart').first().scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${DIR}/laptop_tooltip.png` });
      await page.goto(`${BASE}/history`);
      check('past sessions list the class session with a link to its analytics', await page.getByRole('link', { name: 'Analytics' }).waitFor({ timeout: 5000 }).then(() => true, () => false));
      await page.goto(`${BASE}/host/${room.code}`);
      check('the host console links to the analytics', await page.getByRole('link', { name: 'Open analytics' }).waitFor({ timeout: 5000 }).then(() => true, () => false));
    }
    await ctx.close();
  }
  people.forEach((p) => p.s.close()); host.close();
} catch (e) { console.error(e); results.push(false); }
await browser?.close(); server.kill(); await pg.stop();
const failed = results.filter((x) => !x).length;
console.log(failed ? `${failed} check(s) failed` : `All ${results.length} analytics checks passed.`);
process.exit(failed ? 1 : 0);
