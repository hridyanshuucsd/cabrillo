// Every scenario at every screen size: the chat and the plan board on a small phone, a large phone, a phone on its
// side, a tablet, a small laptop and a large screen. For each size the page is checked for things a person would
// notice: the page moving sideways, anything sticking out of the board, text cut off, text too small to read, and
// buttons too small to tap. Card screenshots for the two phone widths go to test-shots/sizes/<scenario>/.
// Run: npm run build && node tests/sizes.mjs            (SCEN=dinner,outing to run only some scenarios)
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import { startLocalDb } from '../scripts/localdb.js';
import { TASKS } from '../server/tasks.js';

const PORT = 3530, BASE = `http://localhost:${PORT}`, DIR = 'test-shots/sizes';
const ONLY = process.env.SCEN ? process.env.SCEN.split(',') : null;
const SHOTS = process.env.SHOTS !== '0';
if (!ONLY) fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const { pg, url } = await startLocalDb({ dir: '.sizesdb', port: 5448, fresh: true });
const server = spawn(process.execPath, ['server/index.js'], {
  env: { ...process.env, DATABASE_URL: url, PORT: String(PORT), TIME_SCALE: '0.5', JWT_SECRET: 's', ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '', AI_MODEL: '', WEATHER_FAKE: '1', PLACES_FAKE: '1' }, stdio: ['ignore', 'ignore', 'inherit']
});
for (let i = 0; i < 50; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 200)); }
const browser = await chromium.launch();
const results = [];
const check = (name, ok, extra = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${ok ? '' : extra}`); };
const wait = (loc, ms = 8000) => loc.waitFor({ timeout: ms }).then(() => true, () => false);

const SIZES = [
  { name: 'small phone', w: 320, h: 568 }, { name: 'phone', w: 375, h: 667 }, { name: 'large phone', w: 430, h: 932 },
  { name: 'phone on its side', w: 844, h: 390 }, { name: 'tablet', w: 768, h: 1024 }, { name: 'tablet on its side', w: 1024, h: 768 },
  { name: 'laptop', w: 1280, h: 800 }, { name: 'large screen', w: 1920, h: 1080 }
];
// Picks that bring out the most pieces: a carpool (seats), a group gift (pool), matching shirts (sizes), and so on.
const PREFER = { travel: 'carpool', transport: 'carpool', gift: 'group', shirts: 'buy', truck: 'uhaul', notes: 'rotate', clean: 'chart', split: 'role', roles: 'fixed', format: 'person', show: 'jazz', where: null };

// The checks, run inside the page against one root element.
function audit(rootSel) {
  const root = document.querySelector(rootSel);
  const out = [];
  if (!root) return ['missing root'];
  const W = document.documentElement.clientWidth;
  if (document.documentElement.scrollWidth > W + 1) out.push(`the page scrolls sideways (${document.documentElement.scrollWidth} > ${W})`);
  const r0 = root.getBoundingClientRect();
  const desc = (el) => { const id = el.closest('[id]')?.id || ''; const cls = (el.getAttribute('class') || '').split(' ')[0]; const t = (el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40); return `${id ? `#${id} ` : ''}${el.tagName.toLowerCase()}${cls ? `.${cls}` : ''} "${t}"`; };
  const scrolls = (el) => { for (let p = el.parentElement; p && p !== root.parentElement; p = p.parentElement) { if (/(auto|scroll)/.test(getComputedStyle(p).overflowX)) return true; } return false; };
  for (const el of root.querySelectorAll('*')) {
    if (el.closest('.leaflet-container, svg') && !(el instanceof SVGTextElement)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    const st = getComputedStyle(el);
    if (st.visibility === 'hidden' || st.display === 'none' || el.closest('[aria-hidden="true"]') && !(el instanceof SVGTextElement)) continue;
    if ((r.right > r0.right + 3 || r.left < r0.left - 3) && !scrolls(el)) out.push(`sticks out of the board: ${desc(el)} (${Math.round(r.left)} to ${Math.round(r.right)}, board ${Math.round(r0.left)} to ${Math.round(r0.right)})`);
    const leaf = el.children.length === 0 && el.textContent.trim();
    if (leaf && !(el instanceof SVGElement) && el.scrollWidth > el.clientWidth + 1 && st.overflowX !== 'visible' && st.textOverflow !== 'ellipsis' && !scrolls(el)) out.push(`text cut off: ${desc(el)}`);
    if (leaf && !(el instanceof SVGElement) && r.width < 60 && el.textContent.trim().length > 7 && r.height > (parseFloat(st.lineHeight) || parseFloat(st.fontSize) * 1.3) * 2.5) out.push(`text squeezed into a narrow column (${Math.round(r.width)}px): ${desc(el)}`);
    if (leaf) { const fs = el instanceof SVGElement ? r.height / 1.25 : parseFloat(st.fontSize); if (fs < 10.5) out.push(`text too small (${fs.toFixed(1)}px): ${desc(el)}`); }
    const target = el.matches('button, a[href], select, textarea, input:not([type=checkbox]):not([type=radio]), [role=button], [role=radio], label:has(input[type=checkbox])');
    if (target && !el.disabled && (r.height < 32 || r.width < 30)) out.push(`too small to tap (${Math.round(r.width)} by ${Math.round(r.height)}): ${desc(el)}`);
  }
  return [...new Set(out)];
}

const host = await (await browser.newContext({ viewport: { width: 1200, height: 900 } })).newPage();
await host.goto(`${BASE}/login`);
await host.getByRole('tab', { name: 'Create account' }).click();
await host.getByLabel('Display name').fill('Host');
await host.getByLabel('Email').fill('host-s@ucsd.edu');
await host.getByLabel('Password').fill('a-long-password');
await host.locator('input[type=checkbox]').check();
await host.getByRole('button', { name: 'Create account' }).click();
await host.getByRole('button', { name: 'Set up a class session' }).waitFor();

const errors = [];
const allIssues = {};
for (const task of Object.values(TASKS)) {
  if (ONLY && !ONLY.includes(task.id)) continue;
  try {
    await host.goto(`${BASE}/`);
    await host.getByRole('button', { name: 'Set up a class session' }).click();
    await host.getByLabel('Scenario').selectOption(task.id);
    await host.getByLabel('People per table').selectOption('4');
    const auto = host.getByRole('switch'); if (await auto.count()) { if ((await auto.first().getAttribute('aria-checked')) === 'true') await auto.first().click(); }
    await host.getByRole('button', { name: 'Create class session' }).click();
    await host.waitForURL(/\/host\//);
    const code = host.url().split('/host/')[1];
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errors.push(`${task.id}: ${e.message}`));
    await p.goto(`${BASE}/join/${code}`);
    await p.getByLabel('Your first name').fill('Maya');
    await p.getByRole('button', { name: 'Agree and join' }).click();
    await p.waitForURL(/\/play\//);
    const start = host.getByRole('button', { name: /Start this table now with AI players|Start the filling table now/ }).first();
    if (!(await wait(start, 10000))) { await host.reload(); await start.waitFor(); }
    await start.click();
    await p.getByRole('button', { name: 'Next: your private limit' }).click();
    await p.getByRole('button', { name: /^Keep (this|my own) limit$/ }).click();
    await p.getByRole('button', { name: 'I am ready' }).click();
    await p.getByLabel('Message').waitFor();
    // fill the plan from the board sheet
    await p.getByRole('button', { name: 'Plan board' }).click();
    const D = p.getByRole('dialog', { name: 'The plan so far' });
    await D.waitFor();
    for (const f of task.fields) {
      const want = PREFER[f.id] && f.options.some((o) => o.id === PREFER[f.id]) ? PREFER[f.id] : f.options[0].id;
      const name = f.options.find((o) => o.id === want).name;
      const part = D.locator(`#part-${f.id}`);
      const place = part.locator(`button.place-pick[aria-label="${name}"]`);
      if (await place.count()) await place.click();
      else await part.locator('button.opt', { has: p.locator('.opt-name', { hasText: new RegExp(`^${name.replace(/[$()]/g, '\\$&')}$`) }) }).first().click();
      await p.waitForTimeout(150);
    }
    // use a few pieces so they show their filled-in states
    const tryClick = async (loc) => { if (await loc.count()) { await loc.first().click().catch(() => {}); await p.waitForTimeout(150); } };
    await tryClick(D.getByRole('button', { name: 'I can drive' }));
    await tryClick(D.getByRole('button', { name: 'I will do it' }));
    await tryClick(D.getByRole('button', { name: /^Put in \$/ }));
    await tryClick(D.locator('.bring-main'));
    if (await D.getByLabel('Write an agreement').count()) { await D.getByLabel('Write an agreement').fill('We split everything evenly and pay back the same day'); await D.getByLabel('Write an agreement').press('Enter'); }
    if (await D.getByLabel('Add a guest').count()) { await D.getByLabel('Add a guest').fill('Jordan'); await D.getByLabel('Add a guest').press('Enter'); }
    await p.waitForTimeout(800);
    await D.getByRole('button', { name: 'Close' }).first().click();

    const issues = [];
    for (const s of SIZES) {
      await p.setViewportSize({ width: s.w, height: s.h });
      await p.waitForTimeout(350);
      const wide = s.w >= 1000;
      // the chat itself
      const chat = await p.evaluate(audit, '.chat-col');
      const box = await p.getByLabel('Message').boundingBox();
      if (!box || box.y + box.height > s.h + 1) chat.push('the message box is off the screen');
      const msgs = await p.evaluate(() => document.querySelector('.messages')?.getBoundingClientRect().height || 0);
      if (msgs < s.h * 0.3) chat.push(`the messages get too little of the screen (${Math.round(msgs)} of ${s.h} px)`);
      if (!(await p.locator('.actionbar').count())) chat.push('the bar with your limit and Accept is not on the screen');
      issues.push(...chat.map((x) => `${s.name} ${s.w}x${s.h}, chat: ${x}`));
      // the board: beside the chat on a wide screen, a sheet otherwise
      if (!wide) { await p.getByRole('button', { name: 'Plan board' }).click(); await D.waitFor(); await p.waitForTimeout(300); }
      const sel = wide ? '.board-col .pboard' : '[role=dialog] .pboard';
      const board = await p.evaluate(audit, sel);
      issues.push(...board.map((x) => `${s.name} ${s.w}x${s.h}, board: ${x}`));
      if (SHOTS && (s.w === 320 || s.w === 390 || s.w === 375)) {
        const cards = p.locator(`${sel} > section, ${sel} > .card-ai, ${sel} > .pcard, ${sel} > .ticket-wrap`);
        const n = await cards.count();
        fs.mkdirSync(`${DIR}/${task.id}`, { recursive: true });
        for (let i = 0; i < n; i++) { const c = cards.nth(i); await c.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {}); await c.screenshot({ timeout: 5000, path: `${DIR}/${task.id}/${s.w}_${String(i).padStart(2, "0")}.png` }).catch(() => {}); if (0) await c.screenshot({ path: `${DIR}/${task.id}/${s.w}_${String(i).padStart(2, '0')}.png` }).catch(() => {}); }
        await p.screenshot({ path: `${DIR}/${task.id}/${s.w}_sheet_top.png` });
      }
      if (!wide) await D.getByRole('button', { name: 'Close' }).first().click();
      if (SHOTS && (s.w === 844 || s.w === 1280)) await p.screenshot({ path: `${DIR}/${task.id}/${s.w}_screen.png` });
    }
    allIssues[task.id] = issues;
    check(`${task.id}: no layout problems at any size`, issues.length === 0, `\n    ${issues.slice(0, 40).join('\n    ')}${issues.length > 40 ? `\n    ... ${issues.length - 40} more` : ''}`);
    await ctx.close();
  } catch (e) { console.error(task.id, e.message.split('\n')[0]); results.push(false); }
}
fs.writeFileSync(`${DIR}/issues${ONLY ? `-${ONLY.join('-')}` : ''}.json`, JSON.stringify(allIssues, null, 1));
check('no page errors', errors.length === 0, errors.join(' | '));
await browser.close();
server.kill();
await pg.stop();
const failed = results.filter((x) => !x).length;
console.log(failed ? `${failed} size check(s) failed` : `All ${results.length} size checks passed.`);
process.exit(failed ? 1 : 0);
