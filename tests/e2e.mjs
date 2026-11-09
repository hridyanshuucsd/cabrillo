// End-to-end test: a host and six students play a class session in separate browsers.
// The class session compares AI modes, so one table gets the listening AI and the other the answer-only AI.
// Run: npm run build && npm run test:e2e   (screenshots go to test-shots/)
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright'); // install with: npm i -D playwright && npx playwright install chromium
import { startLocalDb } from '../scripts/localdb.js';

const PORT = 3200, BASE = `http://localhost:${PORT}`;
const SHOTS = 'test-shots'; fs.mkdirSync(SHOTS, { recursive: true });
const { pg, url } = await startLocalDb({ dir: '.testdb', port: 5435, fresh: true });
const server = spawn(process.execPath, ['server/index.js'], {
  env: { ...process.env, DATABASE_URL: url, PORT: String(PORT), TIME_SCALE: '0.25', FILL_AFTER_SECONDS: '3', GATHER_SECONDS: '2', JWT_SECRET: 'test', ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '' },
  stdio: ['ignore', 'pipe', 'pipe']
});
server.stdout.on('data', (d) => process.env.VERBOSE && process.stdout.write(d));
server.stderr.on('data', (d) => process.stderr.write(d));
for (let i = 0; i < 50; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 200)); }

const browser = await chromium.launch();
const results = [];
const check = (name, ok, extra = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${extra}`); };
const phone = () => browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const shot = (page, name) => page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
const say = async (page, text) => { await page.getByLabel('Message').fill(text); await page.getByRole('button', { name: 'Send', exact: true }).click(); };
const body = (page) => page.locator('body').innerText();

try {
  // ---------- host creates an account and a class session that compares AI modes ----------
  const hostCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const host = await hostCtx.newPage();
  await host.goto(`${BASE}/login`);
  await shot(host, '00_login_desktop');
  await host.getByRole('tab', { name: 'Create account' }).click();
  await host.getByLabel('Display name').fill('Hridyanshu');
  await host.getByLabel('Email').fill('host@ucsd.edu');
  await host.getByLabel('Password').fill('a-long-password');
  await host.locator('input[type=checkbox]').check();
  await host.getByRole('button', { name: 'Create account' }).click();
  await host.getByRole('button', { name: 'Set up a class session' }).click();
  await host.getByLabel('Scenario').selectOption('outing');
  await host.getByLabel('People per table').selectOption('3');
  await host.getByRole('button', { name: 'Create class session' }).click();
  await host.waitForURL(/\/host\//);
  const code = host.url().split('/host/')[1];
  check('host creates class session', /^[A-Z0-9]{5}$/.test(code), code);

  // ---------- six students join as guests; each is seated the moment they join ----------
  const names = ['Maya', 'Dev', 'Priya', 'Jordan', 'Lena', 'Omar'];
  const students = [];
  for (const n of names) {
    const ctx = await phone(); const p = await ctx.newPage();
    await p.goto(`${BASE}/join/${code}`);
    await p.getByLabel('Your first name').fill(n);
    await p.getByRole('button', { name: 'Agree and join' }).click();
    await p.waitForURL(/\/play\//, { timeout: 5000 });
    students.push(p);
    if (n === 'Maya') { await p.getByText('1 of 3 people are here').waitFor(); await shot(p, '01a_table_filling'); }
  }
  check('six students seated as they join, without the host pressing Start', true);

  // ---------- set up: sort students by table mode ----------
  for (const p of students) await p.getByText('Your private limit').first().waitFor();
  const listen = [], ask = [];
  for (const p of students) ((await body(p)).includes('Reads the chat, keeps the Plan so far') ? listen : ask).push(p);
  check('compare mode makes one listening table and one answer-only table', listen.length === 3 && ask.length === 3, `${listen.length}/${ask.length}`);
  await shot(listen[0], '01_setup');
  const limits = [];
  for (const p of listen) limits.push(await p.locator('.limit-body').first().innerText());
  check('each person at a table gets a different private limit', new Set(limits).size === 3);
  for (const p of students) await p.getByRole('button', { name: 'I am ready' }).click();
  await listen[0].getByLabel('Plan so far', { exact: true }).waitFor({ timeout: 5000 });
  check('everyone ready moves both tables to Chat', true);

  // ---------- answer-only table: the AI speaks only when asked ----------
  const [d] = ask;
  check('answer-only table has no Plan so far panel', !(await d.getByLabel('Plan so far', { exact: true }).count()));
  await say(d, '@AI how do we get to Old Town?');
  await d.getByText(/easy by trolley or bus/).first().waitFor({ timeout: 8000 });
  check('@AI question gets an answer at the answer-only table', true);
  await say(d, '@AI can you book an uber for us?');
  await d.getByRole('group', { name: /^Ride to / }).first().waitFor({ timeout: 6000 });
  check('answer-only AI books only when asked with @AI', true);
  await ask[1].getByRole('button', { name: 'Not for me' }).click();
  await d.getByText(/Not booked/).first().waitFor({ timeout: 5000 });
  check('one person can stop a booking', true);

  // ---------- listening table ----------
  const [a, b, c] = listen;
  await say(a, 'How about Old Town on Sunday afternoon?');
  await say(b, 'Old Town sounds good to me, and the trolley is easy');
  const panel = a.getByLabel('Plan so far', { exact: true });
  await panel.getByText('Most agree').first().waitFor({ timeout: 5000 });
  check('Plan so far picks up what the chat agreed', (await panel.innerText()).includes('Old Town'));
  await a.getByText(/Before anything is settled|What would make one of these work/).first().waitFor({ timeout: 25000 });
  check('listening AI interjects with a question', true);
  await shot(a, '02_chat_listening');
  await c.getByText('Only you see this').waitFor({ timeout: 25000 });
  const aSees = (await body(a)).includes('You have not said much yet');
  check('quiet member gets a private nudge that others do not see', !aSees);
  await b.getByRole('button', { name: 'Plan so far details and AI controls' }).click();
  await b.getByRole('button', { name: 'Pause AI' }).click();
  await a.getByText(/paused the AI/).first().waitFor();
  check('anyone can pause the AI', true);
  await b.getByRole('button', { name: 'Resume AI' }).click();
  await b.getByRole('button', { name: 'Close' }).click();
  await c.getByRole('button', { name: 'Your private limit' }).click();
  await c.getByRole('button', { name: 'Post my limit to the group' }).click();
  await a.getByText('shared a private limit').first().waitFor();
  check('a shared limit reaches the others', true);
  await say(a, '@AI what have we decided so far?');
  await a.getByText(/Plan so far: Where: Old Town/).first().waitFor({ timeout: 8000 });
  check('@AI can recap the plan', true);
  await shot(c, '03_chat_quiet_member');

  // ---------- booking demo: the AI prepares a table, everyone approves the price, then it books ----------
  await say(a, 'Can someone reserve a table for lunch after?');
  await b.getByRole('group', { name: /^Booking: Table for/ }).first().waitFor({ timeout: 6000 });
  check('a booking request becomes a card everyone sees', (await c.getByRole('group', { name: /^Booking: Table for/ }).count()) > 0);
  await a.getByRole('button', { name: 'Price looks right' }).click();
  await b.getByRole('button', { name: 'Price looks right' }).click();
  await shot(c, '09_booking_pending');
  await c.getByRole('button', { name: 'Price looks right' }).click();
  await a.getByText(/Confirmation DEMO-/).first().waitFor({ timeout: 5000 });
  check('the booking completes only after everyone approves the price', true);
  await shot(a, '10_booking_done');
  for (const p of listen) await p.getByRole('button', { name: 'Ready to confirm' }).click();
  await a.getByRole('heading', { name: 'Final plan' }).waitFor({ timeout: 5000 });
  check('Ready to confirm moves the table on early', true);
  check('the draft plan starts from the chat', (await a.getByRole('button', { name: 'Old Town' }).getAttribute('aria-pressed')) === 'true');

  // ---------- confirm ----------
  await a.getByRole('button', { name: 'Sunday afternoon' }).click();
  await a.getByRole('button', { name: 'Bus or trolley' }).click();
  await a.getByRole('button', { name: '$15 to $30' }).click();
  await a.getByText('Complete', { exact: true }).waitFor();
  await b.getByRole('button', { name: 'Accept this plan' }).click();
  await b.getByRole('button', { name: 'Withdraw my acceptance' }).waitFor();
  await a.getByRole('button', { name: 'Under $15' }).click();
  await b.getByRole('button', { name: 'Accept this plan' }).waitFor({ timeout: 3000 });
  check('a change clears earlier accepts', true);
  await shot(a, '04_confirm');
  for (const p of listen) await p.getByRole('button', { name: 'Accept this plan' }).click();
  await a.getByRole('heading', { name: 'Your group made a plan' }).waitFor({ timeout: 8000 });
  check('plan locks when everyone accepts a complete plan', true);

  // ---------- wrap up ----------
  await a.getByText('What everyone was holding').waitFor();
  const wrapText = await body(a);
  check('wrap up shows whose limits came up and whether the plan respects them', /private limits came up/.test(wrapText) && /The plan works with this limit/.test(wrapText));
  await a.getByRole('button', { name: '4', exact: true }).click();
  await a.getByRole('button', { name: 'About right' }).click();
  await a.getByRole('button', { name: 'Yes', exact: true }).click();
  await a.getByRole('button', { name: 'Send feedback' }).click();
  await a.getByText('Your answers help our class project').waitFor();
  check('in-app feedback saves', true);
  await shot(a, '05_wrap');

  // the answer-only table never spoke up on its own
  const dText = await body(d);
  check('answer-only AI made no unprompted interjections', !/Before anything is settled|What would make one of these work|Nobody has talked about/.test(dText) && !(await d.getByText('Only you see this').count()));
  await shot(d, '06_chat_answer_only');
  await shot(host, '07_host_tables');

  // ---------- data export ----------
  const csv = await (await host.request.get(`${BASE}/api/export/${code}/logs.csv`)).text();
  const types = new Set(csv.split('\n').slice(1).map((l) => l.split(',')[4]));
  const need = ['booking_proposed', 'booking_vote', 'booking_done', 'booking_declined', 'session_started', 'stage_started', 'ready_clicked', 'chat_message', 'panel_update', 'ai_nudge_private', 'ai_paused_by_player', 'question_asked', 'ai_answer', 'limit_shared', 'ready_to_confirm', 'plan_edit', 'vote', 'deal_locked', 'session_outcome', 'feedback_submitted'];
  const missing = need.filter((t) => !types.has(t));
  check('log export contains every event type', missing.length === 0, missing.length ? `missing: ${missing}` : `${csv.split('\n').length - 1} rows`);
  check('log export has an interjection', types.has('limits_check') || types.has('conflict'));
  check('log export has no player names', !/Maya|Priya|Jordan|Lena|Omar|\bDev\b/.test(csv));
  const sessions = await (await host.request.get(`${BASE}/api/export/${code}/sessions.csv`)).text();
  check('sessions export records both AI modes', /,listen,/.test(sessions) && /,ask,/.test(sessions));
  const denied = await students[0].request.get(`${BASE}/api/export/${code}/logs.csv`);
  check('students cannot export data', denied.status() === 403);

  // ---------- play now with AI players filling seats ----------
  const solo = await (await phone()).newPage();
  await solo.goto(`${BASE}/login`);
  await solo.getByRole('tab', { name: 'Play as guest' }).click();
  await solo.getByLabel('Display name').fill('Sam');
  await solo.locator('input[type=checkbox]').check();
  await solo.getByRole('button', { name: 'Continue as guest' }).click();
  await solo.getByRole('button', { name: 'Find a table' }).click();
  await solo.waitForURL(/\/play\//, { timeout: 10000 });
  await solo.getByText('Your private limit').first().waitFor();
  check('Play now fills empty seats with labeled AI players', ((await body(solo)).match(/AI player/g) || []).length >= 2);
  await solo.getByRole('button', { name: 'I am ready' }).click();
  await solo.getByText(/I would like/).first().waitFor({ timeout: 15000 });
  check('AI players take part in the chat', true);
  await shot(solo, '08_quick_with_ai');

  await host.goto(`${BASE}/history`);
  check('history page loads for accounts', await host.getByText('My past sessions').waitFor({ timeout: 5000 }).then(() => true, () => false));
} catch (e) {
  console.error('TEST ERROR', e);
  results.push({ name: 'exception', ok: false });
} finally {
  await browser.close(); server.kill(); await pg.stop();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
