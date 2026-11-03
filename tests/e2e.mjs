// End-to-end test: a host and four students play a full class session in separate browsers.
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
  env: { ...process.env, DATABASE_URL: url, PORT: String(PORT), TIME_SCALE: '0.25', FILL_AFTER_SECONDS: '3', GATHER_SECONDS: '2', JWT_SECRET: 'test' },
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

try {
  // ---------- host creates an account and a class session ----------
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
  await host.getByRole('button', { name: 'Create class session' }).click();
  await host.waitForURL(/\/host\//);
  const code = host.url().split('/host/')[1];
  check('host creates class session', /^[A-Z0-9]{5}$/.test(code), code);

  // ---------- four students join as guests ----------
  const names = ['Maya', 'Dev', 'Priya', 'Jordan'];
  const students = [];
  for (const n of names) {
    const ctx = await phone(); const p = await ctx.newPage();
    await p.goto(`${BASE}/join/${code}`);
    await p.getByLabel('Display name').fill(n);
    await p.locator('input[type=checkbox]').check();
    await p.getByRole('button', { name: 'Continue as guest' }).click();
    await p.getByText('Waiting room').waitFor();
    students.push(p);
  }
  await shot(students[0], '01_waiting_room');
  await host.getByText('4 people').waitFor({ timeout: 5000 });
  check('host sees 4 waiting', true);
  await shot(host, '02_host_waiting');
  await host.getByRole('button', { name: /Start tables/ }).click();
  for (const p of students) await p.waitForURL(/\/play\//, { timeout: 5000 });
  check('all students seated at a table', true);

  // ---------- brief ----------
  await students[0].getByText('Your private fact').first().waitFor();
  await shot(students[0], '03_brief');
  const roles = [];
  for (const p of students) roles.push(await p.locator('.role-card div[style*="font-size: 24"]').innerText());
  check('four different roles dealt', new Set(roles).size === 4, roles.join(', '));
  for (const p of students) await p.getByRole('button', { name: 'I am ready' }).click();
  await students[0].getByRole('heading', { name: 'Explore the north lot' }).waitFor({ timeout: 5000 });
  check('everyone ready skips to Explore', true);

  // ---------- explore: layers, sharing, asking the AI ----------
  const m = students[0];
  await m.getByRole('button', { name: 'Parking use' }).click();
  await m.getByRole('button', { name: 'Share with the table' }).click();
  await m.getByLabel('Message').fill('How many stalls are used in the morning?');
  await m.getByRole('button', { name: 'Ask the AI instead' }).click();
  await m.getByText(/4 in 10 stalls/).first().waitFor({ timeout: 8000 });
  check('AI answers a question from map data', true);
  await students[2].getByRole('button', { name: 'Share with the table' }).click();
  await students[1].getByText('shared a fact').first().waitFor();
  check('shared facts reach other players', true);
  await shot(m, '04_explore');

  // host moves the table on to Negotiate
  await host.getByRole('button', { name: 'Next stage' }).click();
  await m.getByRole('heading', { name: 'Shared plan' }).waitFor({ timeout: 5000 });
  await m.getByText(/Rule check/).first().waitFor({ timeout: 5000 });
  check('AI warns that the starting plan breaks the 40% rule', true);

  // ---------- negotiate: reach 30 / 20 / 20 / 30 and accept ----------
  const clickUse = async (page, verb, use) => { await page.getByRole('button', { name: `${verb} ${use}` }).click(); await page.waitForTimeout(150); };
  await students[1].getByRole('button', { name: 'Accept this plan' }).click();
  await clickUse(m, 'Lower', 'Parking');
  await clickUse(m, 'Raise', 'Study space');
  check('an edit clears earlier accepts', await students[1].getByRole('button', { name: 'Accept this plan' }).isVisible());
  await clickUse(students[1], 'Lower', 'Parking');
  await clickUse(students[1], 'Raise', 'Club hub');
  await m.getByText('Total 100%').waitFor();
  await shot(m, '05_negotiate');
  for (const p of students) await p.getByRole('button', { name: 'Accept this plan' }).click();
  await m.getByRole('heading', { name: 'Deal reached' }).waitFor({ timeout: 8000 });
  check('deal locks when every human accepts a valid plan', true);

  // ---------- reveal and feedback ----------
  await m.getByText('What everyone was holding', { exact: true }).waitFor();
  const revealText = await m.locator('body').innerText();
  check('reveal shows shared and never-shared facts', revealText.includes('Never shared') && /Shared \d\d:\d\d/.test(revealText));
  await m.getByRole('button', { name: '4', exact: true }).click();
  await m.getByRole('button', { name: 'Yes', exact: true }).click();
  await m.getByRole('button', { name: 'Send feedback' }).click();
  await m.getByText('Thank you for the feedback').waitFor();
  check('in-app feedback saves', true);
  await shot(m, '06_reveal');
  await shot(host, '07_host_tables');

  // ---------- data export ----------
  const csv = await (await host.request.get(`${BASE}/api/export/${code}/logs.csv`)).text();
  const types = new Set(csv.split('\n').slice(1).map((l) => l.split(',')[4]));
  const need = ['session_started', 'stage_started', 'ready_clicked', 'layer_viewed', 'fact_shared', 'question_asked', 'ai_answer', 'rule_warning', 'proposal_edit', 'vote', 'deal_locked', 'cards_revealed', 'feedback_submitted'];
  const missing = need.filter((t) => !types.has(t));
  check('log export contains every event type', missing.length === 0, missing.length ? `missing: ${missing}` : `${csv.split('\n').length - 1} rows`);
  check('log export has no player names', !/Maya|Priya|Jordan|Dev\b/.test(csv));
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
  await solo.getByText('Your private fact').first().waitFor();
  const brief = await solo.locator('body').innerText();
  check('Play now fills empty seats with labeled AI players', (brief.match(/AI, no vote/g) || []).length >= 2);
  await shot(solo, '08_quick_with_ai');

  // account history
  await host.goto(`${BASE}/history`);
  check('history page loads for accounts', await host.getByText('My past sessions').isVisible());
} catch (e) {
  console.error('TEST ERROR', e);
  results.push({ name: 'exception', ok: false });
} finally {
  await browser.close(); server.kill(); await pg.stop();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
