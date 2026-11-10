// Phone check: every screen at iPhone SE (375 x 667) and iPhone 14 (390 x 844) sizes, including with the keyboard open.
// Fails if a screen scrolls sideways, a button is too small to tap, or the message box or messages are hidden.
// The keyboard is simulated by shrinking the visible area by 290 px while the message box has focus, as a phone does.
// Screenshots go to test-shots/mobile/. Run: npm run build && node tests/mobile.mjs
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const { chromium, devices } = createRequire(import.meta.url)('playwright');
import { startLocalDb } from '../scripts/localdb.js';

const PORT = 3400, BASE = `http://localhost:${PORT}`, DIR = 'test-shots/mobile';
fs.rmSync(DIR, { recursive: true, force: true }); fs.mkdirSync(DIR, { recursive: true });
const { pg, url } = await startLocalDb({ dir: '.mobiledb', port: 5437, fresh: true });
const server = spawn(process.execPath, ['server/index.js'], {
  env: { ...process.env, DATABASE_URL: url, PORT: String(PORT), TIME_SCALE: '1', JWT_SECRET: 'm', ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '' }, stdio: ['ignore', 'ignore', 'inherit']
});
for (let i = 0; i < 50; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 200)); }

const browser = await chromium.launch();
const results = [];
const check = (name, ok, extra = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${extra}`); };
// iPhone SE (1st gen) is 320 x 568, the smallest phone still in use: the hardest case for the keyboard.
const sizes = { se: devices['iPhone SE'], i14: devices['iPhone 14'] };
async function audit(page, name, { composer = false, share = 0.5 } = {}) {
  await page.waitForTimeout(350);
  const r = await page.evaluate(() => {
    const vh = window.visualViewport ? window.visualViewport.height : window.innerHeight;
    const wide = [...document.querySelectorAll('body *')].filter((e) => { const b = e.getBoundingClientRect(); return b.width && b.right > window.innerWidth + 1 && !e.closest('.planbar-scroll'); }).slice(0, 3).map((e) => `${e.tagName}.${e.className}`);
    const small = [...document.querySelectorAll('button, a.btn, input:not([type=checkbox]):not([type=radio]), select')]
      .filter((e) => { const b = e.getBoundingClientRect(); return b.width && b.height && b.height < 32 && !e.closest('.chip'); }).map((e) => e.textContent.trim() || e.getAttribute('aria-label')).slice(0, 4);
    const box = document.querySelector('.composer');
    const msgs = document.querySelector('.messages');
    const mb = msgs?.getBoundingClientRect();
    return { sideways: document.documentElement.scrollWidth > window.innerWidth + 1, wide, small, vh,
      composerBottom: box ? box.getBoundingClientRect().bottom : null, msgsHeight: mb ? mb.height : null };
  });
  check(`${name}: no sideways scrolling`, !r.sideways, r.wide.join(' '));
  if (r.small.length) check(`${name}: tap targets at least 32 px tall`, false, r.small.join(', '));
  if (composer) {
    check(`${name}: message box is on screen`, r.composerBottom !== null && r.composerBottom <= r.vh + 1, `(bottom ${Math.round(r.composerBottom)} of ${Math.round(r.vh)})`);
    check(`${name}: messages get most of the screen`, r.msgsHeight >= share * r.vh, `(${Math.round(r.msgsHeight)} of ${Math.round(r.vh)} px)`);
  }
  await page.screenshot({ path: `${DIR}/${name}.png` });
}
// Simulates the on-screen keyboard: focus the message box, then shrink the visible area.
async function withKeyboard(page, name, fn) {
  const vp = page.viewportSize();
  await page.getByLabel('Message').focus();
  await page.setViewportSize({ width: vp.width, height: vp.height - 290 });
  await page.waitForTimeout(300);
  await fn?.();
  await audit(page, name, { composer: true });
  const planHidden = !(await page.locator('.board, .actionbar').first().isVisible().catch(() => false));
  check(`${name}: plan and buttons fold away while typing`, planHidden);
  await page.setViewportSize(vp);
  await page.locator('body').click({ position: { x: 5, y: 5 } }).catch(() => {});
}

try {
  // host on a phone
  const host = await (await browser.newContext({ ...sizes.i14 })).newPage();
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
  await host.getByLabel('People per table').selectOption('3');
  await audit(host, 'i14_03_class_setup');
  await host.getByRole('button', { name: 'Create class session' }).click();
  await host.waitForURL(/\/host\//);
  const code = host.url().split('/host/')[1];
  await audit(host, 'i14_04_host_empty');

  // three students, two on an iPhone SE
  const people = [];
  for (const [n, dev] of [['Maya', 'se'], ['Dev', 'i14'], ['Priya', 'se']]) {
    const p = await (await browser.newContext({ ...sizes[dev] })).newPage();
    await p.goto(`${BASE}/join/${code}`);
    if (n === 'Maya') await audit(p, 'se_05_join');
    await p.getByLabel('Your first name').fill(n);
    await p.getByRole('button', { name: 'Agree and join' }).click();
    await p.waitForURL(/\/play\//);
    if (n === 'Maya') {
      await p.getByText('Step 1 of 3').waitFor(); await audit(p, 'se_06_briefing_task');
      await p.getByRole('button', { name: 'Next: your private limit' }).click(); await audit(p, 'se_07_briefing_limit');
      await p.getByRole('button', { name: 'Write my own' }).click(); await audit(p, 'se_08_briefing_write_own');
      await p.getByRole('button', { name: 'Cancel' }).click();
      await p.getByRole('button', { name: 'Keep this limit' }).click(); await audit(p, 'se_09_briefing_how');
      await p.getByRole('button', { name: 'I am ready' }).click(); await audit(p, 'se_10_briefing_waiting');
      await audit(host, 'i14_11_host_filling');
    }
    people.push(p);
  }
  const [a, b, c] = people;
  // reload returns to the same table
  await b.reload(); await b.getByText('Step 1 of 3').waitFor();
  check('reloading the page returns to the same table', true);
  for (const p of [b, c]) {
    await p.getByRole('button', { name: 'Next: your private limit' }).click();
    await p.getByRole('button', { name: 'Keep this limit' }).click();
    await p.getByRole('button', { name: 'I am ready' }).click();
  }
  await a.getByLabel('Message').waitFor({ timeout: 8000 });
  check('the chat opens when the table is full and everyone is ready', true);
  const say = async (p, t) => { await p.getByLabel('Message').fill(t); await p.getByRole('button', { name: 'Send', exact: true }).click(); };
  await say(b, 'Hi all, what is everyone thinking?');
  await say(c, 'I am flexible, maybe something cheap');
  await say(a, 'Sounds good to me, let us pick soon');
  await say(b, 'Should we decide the first thing now?');
  await audit(a, 'se_12_chat', { composer: true });
  await audit(b, 'i14_12_chat', { composer: true });
  await withKeyboard(a, 'se_13_chat_keyboard', async () => {
    await a.getByLabel('Message').fill('typing with the keyboard open');
    await c.getByLabel('Message').fill('x'); await c.getByLabel('Message').fill('xy'); // typing indicator for others
  });
  await say(a, 'typing with the keyboard open');
  check('message sent with the keyboard open reaches others', await c.getByText('typing with the keyboard open').first().waitFor({ timeout: 4000 }).then(() => true, () => false));
  // pick by tapping
  await a.locator('.pchip').first().click();
  await audit(a, 'se_14_pick_sheet');
  await a.getByRole('dialog').locator('.opt').first().click();
  await a.getByRole('dialog').getByRole('button', { name: 'Done' }).click();
  await a.getByRole('button', { name: 'The plan so far, details' }).click(); await audit(a, 'se_15_plan_sheet'); await a.getByRole('button', { name: 'Close' }).click();
  await a.getByRole('button', { name: 'Task' }).click(); await audit(a, 'se_16_task_sheet'); await a.getByRole('button', { name: 'Close' }).click();
  // the three ways to share, and the draft in the message box
  await a.getByRole('button', { name: 'Your private limit' }).click();
  await audit(a, 'se_17_limit_sheet');
  await a.getByRole('dialog').getByRole('button', { name: /^Say it myself/ }).click(); // a private heads-up in the chat can offer the same button
  await a.getByText('Draft of your limit').waitFor();
  await audit(a, 'se_18_limit_draft', { composer: true, share: 0.4 });
  await a.getByRole('button', { name: 'Send', exact: true }).click();
  await b.getByText('shared a limit').first().waitFor();
  // everyone picks the first option of every part, then accepts
  const fields = await a.locator('.pchip').evaluateAll((els) => els.map((el) => el.getAttribute('aria-label').split(':')[0]));
  for (const p of [a, b]) for (const fl of fields) {
    await p.locator(`.pchip[aria-label^="${fl}:"]`).click();
    const btn = p.getByRole('dialog').locator('.opt').first();
    if ((await btn.getAttribute('aria-pressed')) !== 'true') await btn.click();
    await p.getByRole('dialog').getByRole('button', { name: 'Done' }).click();
  }
  await a.getByRole('button', { name: /Accept the plan|Withdraw/ }).waitFor({ timeout: 6000 });
  await audit(a, 'se_19_chat_accept', { composer: true });
  await audit(host, 'i14_20_host_tables');
  for (const p of people) {
    await p.getByRole('button', { name: 'Accept the plan' }).click();
    // a plan that breaks this person's limit asks first
    const sheet = p.getByRole('dialog', { name: 'Accept this plan?' });
    if (await sheet.waitFor({ timeout: 700 }).then(() => true, () => false)) { if (p === a) await audit(p, 'se_21_accept_anyway'); await sheet.getByRole('button', { name: /accept anyway/i }).click(); }
  }
  await a.getByText('What everyone was holding').waitFor({ timeout: 8000 });
  await audit(a, 'se_22_results');
  await a.screenshot({ path: `${DIR}/se_22_results_full.png`, fullPage: true });
  await audit(host, 'i14_23_host_done');
} catch (e) { console.error(e); results.push(false); }
await browser.close(); server.kill(); await pg.stop();
const failed = results.filter((x) => !x).length;
console.log(failed ? `${failed} check(s) failed` : 'All phone checks passed.');
process.exit(failed ? 1 : 0);
