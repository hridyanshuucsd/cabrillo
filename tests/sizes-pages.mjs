// Every other page at every screen size: sign in, home, join, the briefing, the end-of-table survey and results,
// the host console, the analytics page, history and about. The same checks as tests/sizes.mjs: nothing moving
// sideways, nothing sticking out, no text cut off or squeezed, no text too small, no button too small to tap.
// Screenshots of each page at each size go to test-shots/sizes-pages/. Run: npm run build && node tests/sizes-pages.mjs
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import { startLocalDb } from '../scripts/localdb.js';

const PORT = 3540, BASE = `http://localhost:${PORT}`, DIR = 'test-shots/sizes-pages';
fs.rmSync(DIR, { recursive: true, force: true }); fs.mkdirSync(DIR, { recursive: true });
const { pg, url } = await startLocalDb({ dir: '.pagesdb', port: 5449, fresh: true });
const server = spawn(process.execPath, ['server/index.js'], {
  env: { ...process.env, DATABASE_URL: url, PORT: String(PORT), TIME_SCALE: '0.3', JWT_SECRET: 'p', ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '', AI_MODEL: '' }, stdio: ['ignore', 'ignore', 'inherit']
});
for (let i = 0; i < 50; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 200)); }
const browser = await chromium.launch();
const results = [];
const check = (name, ok, extra = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${ok ? '' : extra}`); };
const wait = (loc, ms = 8000) => loc.waitFor({ timeout: ms }).then(() => true, () => false);
const SIZES = [[320, 568], [375, 667], [430, 932], [844, 390], [768, 1024], [1024, 768], [1280, 800], [1920, 1080]];

function audit() {
  const out = [];
  const W = document.documentElement.clientWidth;
  if (document.documentElement.scrollWidth > W + 1) out.push(`the page scrolls sideways (${document.documentElement.scrollWidth} > ${W})`);
  const desc = (el) => { const cls = (el.getAttribute('class') || '').split(' ')[0]; const t = (el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40); return `${el.tagName.toLowerCase()}${cls ? `.${cls}` : ''} "${t}"`; };
  const scrolls = (el) => { for (let p = el.parentElement; p; p = p.parentElement) if (/(auto|scroll)/.test(getComputedStyle(p).overflowX)) return true; return false; };
  for (const el of document.querySelectorAll('#root *')) {
    if (el.closest('.leaflet-container, svg') && !(el instanceof SVGTextElement)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    const st = getComputedStyle(el);
    if (st.visibility === 'hidden' || el.closest('[aria-hidden="true"]') && !(el instanceof SVGTextElement)) continue;
    if ((r.right > W + 2 || r.left < -2) && !scrolls(el)) out.push(`off the screen: ${desc(el)} (${Math.round(r.left)} to ${Math.round(r.right)})`);
    const leaf = el.children.length === 0 && el.textContent.trim();
    if (leaf && !(el instanceof SVGElement) && el.scrollWidth > el.clientWidth + 1 && st.overflowX !== 'visible' && st.textOverflow !== 'ellipsis' && !scrolls(el)) out.push(`text cut off: ${desc(el)}`);
    if (leaf && !(el instanceof SVGElement) && r.width < 60 && el.textContent.trim().length > 7 && r.height > (parseFloat(st.lineHeight) || parseFloat(st.fontSize) * 1.3) * 2.5) out.push(`text squeezed (${Math.round(r.width)}px): ${desc(el)}`);
    if (leaf) { const fs = el instanceof SVGElement ? r.height / 1.25 : parseFloat(st.fontSize); if (fs < 10.5) out.push(`text too small (${fs.toFixed(1)}px): ${desc(el)}`); }
    const target = el.matches('button, a[href], select, textarea, input:not([type=checkbox]):not([type=radio]), [role=button], [role=radio], [role=tab], [role=switch], label:has(input[type=checkbox])');
    if (target && !el.disabled && (r.height < 32 || r.width < 30) && !el.closest('p, li, .small, .tiny')) out.push(`too small to tap (${Math.round(r.width)} by ${Math.round(r.height)}): ${desc(el)}`);
  }
  return [...new Set(out)];
}
async function sweep(page, label) {
  const issues = [];
  const keep = page.viewportSize();
  for (const [w, h] of SIZES) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(250);
    issues.push(...(await page.evaluate(audit)).map((x) => `${w}x${h}: ${x}`));
    await page.screenshot({ path: `${DIR}/${label}_${w}x${h}.png` });
  }
  await page.setViewportSize(keep);
  check(`${label}: fits every screen size`, issues.length === 0, `\n    ${issues.slice(0, 30).join('\n    ')}${issues.length > 30 ? `\n    ... ${issues.length - 30} more` : ''}`);
}

try {
  const host = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  await host.goto(`${BASE}/login`);
  await sweep(host, 'login');
  await host.getByRole('tab', { name: 'Create account' }).click();
  await host.getByLabel('Display name').fill('Host');
  await host.getByLabel('Email').fill('host-p@ucsd.edu');
  await host.getByLabel('Password').fill('a-long-password');
  await host.locator('input[type=checkbox]').check();
  await host.getByRole('button', { name: 'Create account' }).click();
  await host.getByRole('button', { name: 'Set up a class session' }).waitFor();
  await sweep(host, 'home');
  await host.getByRole('button', { name: 'Set up a class session' }).click();
  await sweep(host, 'class_setup');
  await host.getByLabel('Scenario').selectOption('dinner');
  await host.getByLabel('People per table').selectOption('3');
  const auto = host.getByRole('switch'); if (await auto.count()) { if ((await auto.first().getAttribute('aria-checked')) === 'true') await auto.first().click(); }
  await host.getByRole('button', { name: 'Create class session' }).click();
  await host.waitForURL(/\/host\//);
  const code = host.url().split('/host/')[1];
  await sweep(host, 'host_console_empty');

  const p = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })).newPage();
  await p.goto(`${BASE}/join/${code}`);
  await sweep(p, 'join');
  await p.getByLabel('Your first name').fill('Maya');
  await p.getByRole('button', { name: 'Agree and join' }).click();
  await p.waitForURL(/\/play\//);
  await sweep(p, 'waiting_for_table');
  const start = host.getByRole('button', { name: /Start this table now with AI players|Start the filling table now/ }).first();
  if (!(await wait(start, 10000))) { await host.reload(); await start.waitFor(); }
  await start.click();
  await p.getByRole('button', { name: 'Next: your private limit' }).waitFor();
  await sweep(p, 'briefing_1');
  await p.getByRole('button', { name: 'Next: your private limit' }).click();
  await sweep(p, 'briefing_2');
  await p.getByRole('button', { name: /^Keep (this|my own) limit$/ }).click();
  await sweep(p, 'briefing_3');
  await p.getByRole('button', { name: 'I am ready' }).click();
  await p.getByLabel('Message').waitFor();
  await p.getByLabel('Message').fill('korean bbq on convoy friday at 8 by carpool?');
  await p.getByRole('button', { name: 'Send', exact: true }).click();
  await p.waitForTimeout(4000);
  await sweep(host, 'host_console_live');
  // the sheets on top of the chat
  await p.getByRole('button', { name: 'Task' }).click();
  await sweep(p, 'task_sheet');
  await p.getByRole('button', { name: 'End without a plan' }).click();
  const close = p.getByRole('button', { name: 'Close' }); if (await close.count()) await close.first().click().catch(() => {});
  // the end of the table: the survey, then the results
  await wait(p.getByText(/How much did the AI help/i).first(), 20000);
  await sweep(p, 'survey');
  for (const b of await p.getByRole('button', { name: / 4 of 5$/ }).all()) await b.click().catch(() => {});
  const send = p.getByRole('button', { name: /Send|See the results|Finish/ }).first(); if (await send.count()) await send.click().catch(() => {});
  await p.waitForTimeout(1500);
  await sweep(p, 'results');
  await host.goto(`${BASE}/analytics/${code}`);
  await host.waitForTimeout(1500);
  await sweep(host, 'analytics');
  await host.goto(`${BASE}/history`); await host.waitForTimeout(800);
  await sweep(host, 'history');
  await host.goto(`${BASE}/about`); await host.waitForTimeout(500);
  await sweep(host, 'about');
} catch (e) { console.error(e); results.push(false); }
await browser.close();
server.kill();
await pg.stop();
const failed = results.filter((x) => !x).length;
console.log(failed ? `${failed} page check(s) failed` : `All ${results.length} page checks passed.`);
process.exit(failed ? 1 : 0);
