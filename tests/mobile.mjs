// Phone check: every screen at iPhone SE (375 x 667) and iPhone 14 (390 x 844) sizes.
// Fails if any screen scrolls sideways, or if the message box is off screen on the chat screens.
// Screenshots go to test-shots/mobile/. Run: npm run build && node tests/mobile.mjs
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const { chromium, devices } = createRequire(import.meta.url)('playwright');
import { startLocalDb } from '../scripts/localdb.js';

const PORT = 3400, BASE = `http://localhost:${PORT}`, DIR = 'test-shots/mobile';
fs.mkdirSync(DIR, { recursive: true });
const { pg, url } = await startLocalDb({ dir: '.mobiledb', port: 5437, fresh: true });
const server = spawn(process.execPath, ['server/index.js'], {
  env: { ...process.env, DATABASE_URL: url, PORT: String(PORT), TIME_SCALE: '1', JWT_SECRET: 'm', ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '' }, stdio: ['ignore', 'ignore', 'inherit']
});
for (let i = 0; i < 50; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 200)); }

const browser = await chromium.launch();
const results = [];
const check = (name, ok, extra = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${extra}`); };
const sizes = { se: devices['iPhone SE'], i14: devices['iPhone 14'] };
async function audit(page, name, { composer = false } = {}) {
  await page.waitForTimeout(300);
  const r = await page.evaluate(() => {
    const doc = document.documentElement;
    const wide = [...document.querySelectorAll('body *')].filter((e) => { const b = e.getBoundingClientRect(); return b.width && b.right > window.innerWidth + 1; }).slice(0, 3).map((e) => `${e.tagName}.${e.className}`);
    const box = document.querySelector('.composer');
    const small = [...document.querySelectorAll('button, a.btn, input, select')].filter((e) => { const b = e.getBoundingClientRect(); return b.width && b.height && b.height < 30 && !e.closest('.chip') && e.type !== 'checkbox' && e.type !== 'radio'; }).map((e) => e.textContent.trim() || e.getAttribute('aria-label')).slice(0, 4);
    return { sideways: doc.scrollWidth > window.innerWidth + 1, wide, composerBottom: box ? box.getBoundingClientRect().bottom : null, h: window.innerHeight, small };
  });
  check(`${name}: no sideways scrolling`, !r.sideways, r.wide.join(' '));
  if (r.small.length) check(`${name}: tap targets at least 30 px tall`, false, r.small.join(', '));
  if (composer) check(`${name}: message box is on screen`, r.composerBottom !== null && r.composerBottom <= r.h, `(bottom ${Math.round(r.composerBottom)} of ${r.h})`);
  await page.screenshot({ path: `${DIR}/${name}.png` });
}

try {
  // host on a phone
  const hostCtx = await browser.newContext({ ...sizes.i14 });
  const host = await hostCtx.newPage();
  await host.goto(`${BASE}/login`);
  await audit(host, 'i14_01_login');
  await host.getByRole('tab', { name: 'Create account' }).click();
  await host.getByLabel('Display name').fill('Host');
  await host.getByLabel('Email').fill('host@ucsd.edu');
  await host.getByLabel('Password').fill('a-long-password');
  await host.locator('input[type=checkbox]').check();
  await host.getByRole('button', { name: 'Create account' }).click();
  await host.getByRole('button', { name: 'Set up a class session' }).waitFor();
  await audit(host, 'i14_02_home');
  await host.getByRole('button', { name: 'Set up a class session' }).click();
  await audit(host, 'i14_03_class_setup');
  await host.getByRole('button', { name: 'Create class session' }).click();
  await host.waitForURL(/\/host\//);
  const code = host.url().split('/host/')[1];

  // three students, two on an iPhone SE
  const people = [];
  for (const [n, dev] of [['Maya', 'se'], ['Dev', 'i14'], ['Priya', 'se']]) {
    const ctx = await browser.newContext({ ...sizes[dev] }); const p = await ctx.newPage();
    await p.goto(`${BASE}/join/${code}`);
    if (n === 'Maya') await audit(p, 'se_04_join');
    await p.getByLabel('Display name').fill(n);
    await p.locator('input[type=checkbox]').check();
    await p.getByRole('button', { name: 'Continue as guest' }).click();
    await p.getByText('Waiting room').waitFor();
    people.push({ p, dev, n });
  }
  await audit(people[0].p, 'se_05_waiting');
  await host.getByText('3 people').waitFor();
  await audit(host, 'i14_06_host_waiting');
  await host.getByRole('button', { name: /Start tables/ }).click();
  for (const { p } of people) await p.getByRole('button', { name: 'I am ready' }).waitFor();
  await audit(people[0].p, 'se_07_setup');
  await people[0].p.screenshot({ path: `${DIR}/se_07_setup_full.png`, fullPage: true });
  for (const { p } of people) await p.getByRole('button', { name: 'I am ready' }).click();
  const [a, b, c] = people.map((x) => x.p);
  await a.getByLabel('Message').waitFor();
  const say = async (p, t) => { await p.getByLabel('Message').fill(t); await p.getByRole('button', { name: 'Send', exact: true }).click(); };
  // the scenario is random, so talk about whatever the first options are
  const tiles = await a.locator('.plan-tile .tile-name').allInnerTexts();
  await say(b, 'Hi all, what is everyone thinking?');
  await say(c, 'I am flexible, maybe something cheap');
  await say(a, 'Sounds good to me, let us pick soon');
  await audit(a, 'se_08_chat', { composer: true });
  await audit(b, 'i14_08_chat', { composer: true });
  check('chat screen shows the Plan so far tiles', tiles.length >= 3, `(${tiles.join(', ')})`);
  await a.getByLabel('Message').focus();
  await audit(a, 'se_09_chat_typing', { composer: true });
  await a.getByRole('button', { name: 'Details' }).click();
  await audit(a, 'se_10_plan_details');
  await a.getByRole('button', { name: 'Close' }).click();
  await a.locator('.limit-bar').click();
  await audit(a, 'se_11_limit_sheet');
  await a.getByRole('button', { name: 'Post my limit to the group' }).click();
  await b.getByText('shared a limit').first().waitFor();
  await say(b, 'can you book a table for us');
  await c.locator('.msg.booking').first().waitFor({ timeout: 5000 }).catch(() => {});
  await audit(c, 'se_12_chat_booking', { composer: true });
  await audit(host, 'i14_13_host_tables');
  await host.locator('.table-head').first().click();
  await audit(host, 'i14_14_host_table_open');
  for (const p of [a, b, c]) await p.getByRole('button', { name: 'Ready to confirm' }).click();
  await a.getByRole('heading', { name: 'Final plan' }).waitFor();
  await audit(a, 'se_15_confirm');
  await b.getByRole('tab', { name: /Chat/ }).click();
  await say(b, 'all good with me');
  await b.getByRole('tab', { name: 'Final plan' }).click();
  await a.locator('.tabs .dot').waitFor({ timeout: 5000 }).catch(() => {});
  check('confirm screen shows unread messages on the Chat tab', /\d/.test(await a.getByRole('tab', { name: /Chat/ }).innerText()));
  await a.getByRole('tab', { name: /Chat/ }).click();
  await audit(a, 'se_16_confirm_chat', { composer: true });
  await a.getByRole('tab', { name: 'Final plan' }).click();
  // fill any missing choices, then everyone accepts
  for (const grp of await a.locator('.pick[role=group]').all()) if (!(await grp.locator('[aria-pressed=true]').count())) await grp.locator('button').first().click();
  for (const p of [a, b, c]) await p.getByRole('button', { name: 'Accept this plan' }).click();
  await a.getByText('What everyone was holding').waitFor({ timeout: 8000 });
  await audit(a, 'se_17_wrap');
  await a.screenshot({ path: `${DIR}/se_17_wrap_full.png`, fullPage: true });
} catch (e) { console.error(e); results.push(false); }
await browser.close(); server.kill(); await pg.stop();
const failed = results.filter((x) => !x).length;
console.log(failed ? `${failed} check(s) failed` : 'All phone checks passed.');
process.exit(failed ? 1 : 0);
