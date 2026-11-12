// The board artifacts in a browser: the weather card, opening hours, the day as a timeline, who brings what,
// agreements with stamps, and the plan as a ticket. One person on a laptop (board beside the chat) and two on
// phones (board as a sheet). Screenshots go to test-shots/artifacts/. Run: npm run build && node tests/artifacts.mjs
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const { chromium, devices } = createRequire(import.meta.url)('playwright');
import { startLocalDb } from '../scripts/localdb.js';

const PORT = 3510, BASE = `http://localhost:${PORT}`, DIR = 'test-shots/artifacts';
fs.rmSync(DIR, { recursive: true, force: true }); fs.mkdirSync(DIR, { recursive: true });
const { pg, url } = await startLocalDb({ dir: '.artdb', port: 5446, fresh: true });
const server = spawn(process.execPath, ['server/index.js'], {
  env: { ...process.env, DATABASE_URL: url, PORT: String(PORT), TIME_SCALE: '0.4', JWT_SECRET: 'c', ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '', WEATHER_FAKE: '1', PLACES_FAKE: '1' }, stdio: ['ignore', 'ignore', 'inherit']
});
for (let i = 0; i < 50; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 200)); }
const browser = await chromium.launch();
const results = [];
const check = (name, ok, extra = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${extra}`); };
const wait = (loc, ms = 8000) => loc.waitFor({ timeout: ms }).then(() => true, () => false);

try {
  const host = await (await browser.newContext({ viewport: { width: 1200, height: 900 } })).newPage();
  await host.goto(`${BASE}/login`);
  await host.getByRole('tab', { name: 'Create account' }).click();
  await host.getByLabel('Display name').fill('Host');
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

  const ps = [];
  for (const [n, ctx] of [['Maya', { viewport: { width: 1360, height: 900 }, deviceScaleFactor: 2 }], ['Dev', devices['iPhone 14']], ['Priya', devices['iPhone 14']]]) {
    const p = await (await browser.newContext(ctx)).newPage();
    await p.goto(`${BASE}/join/${code}`);
    await p.getByLabel('Your first name').fill(n);
    await p.getByRole('button', { name: 'Agree and join' }).click();
    await p.waitForURL(/\/play\//);
    ps.push(p);
  }
  const [a, b, c] = ps;
  for (const p of ps) {
    await p.getByRole('button', { name: 'Next: your private limit' }).click();
    await p.getByRole('button', { name: /^Keep (this|my own) limit$/ }).click();
    await p.getByRole('button', { name: 'I am ready' }).click();
  }
  await a.getByLabel('Message').waitFor();
  const say = async (p, t) => { await p.getByLabel('Message').fill(t); await p.getByRole('button', { name: 'Send', exact: true }).click(); await p.waitForTimeout(300); };
  const board = async (p) => { if (!(await p.getByRole('dialog', { name: 'The plan so far' }).count())) { await p.getByRole('button', { name: 'Plan board' }).click(); await p.getByRole('dialog', { name: 'The plan so far' }).waitFor(); } return p.getByRole('dialog', { name: 'The plan so far' }); };
  const shut = async (p) => { const d = p.getByRole('dialog', { name: 'The plan so far' }); if (await d.count()) await d.getByRole('button', { name: 'Close' }).first().click(); };

  // three people, three different ways of saying the same plan (they are all people; there are no AI players here)
  await say(a, 'la jolla cove on sunday afternoon? we could take the bus');
  await say(b, 'cove works for me, sunday afternoon is good, bus or trolley is fine');
  await say(c, 'same, la jolla cove sunday afternoon by bus');
  const A = a.locator('.pboard');
  check('laptop: the weather card shows the cove on Sunday afternoon', await wait(A.locator('#part-weather .sky-temp')) && /La Jolla Cove/.test(await A.locator('#part-weather').innerText()) && /Sunday at 2 pm/.test(await A.locator('#part-weather').innerText()));
  check('laptop: the rain strip has one column per hour, the planned hour marked', (await A.locator('.sky-col').count()) >= 6 && (await A.locator('.sky-col.now').count()) === 1);
  check('laptop: the day starts at Price Center and takes the bus', await wait(A.locator('#part-day .stop.main')) && /Bus or trolley to La Jolla Cove/.test(await A.locator('#part-day').innerText()));
  check('laptop: the cove is open all day', /Open then/.test(await A.locator('#part-hours').innerText()));
  check('laptop: the plan ticket shows Sunday', await wait(A.locator('.ticket-day', { hasText: 'Sun' })));

  // On a phone with the board closed, a change someone else makes shows for a moment above the message box.
  await A.getByRole('button', { name: /^Snacks: nobody yet/ }).click();
  const toast = c.locator('.board-toast');
  check('phone: Priya sees "Maya will bring snacks" without opening the board', await wait(toast) && /Maya will bring snacks/.test(await toast.innerText()));
  await toast.click();
  const Cs = c.getByRole('dialog', { name: 'The plan so far' });
  check('phone: tapping it opens the board', await wait(Cs));
  await Cs.locator('.board-nav').getByRole('button', { name: 'Bring', exact: true }).click();
  await c.waitForTimeout(1500);
  const room = await Cs.locator('.sheet-body').evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop);
  const top = await Cs.locator('#part-bring').evaluate((el) => el.getBoundingClientRect().top);
  const navBottom = await Cs.locator('.board-nav').evaluate((el) => el.getBoundingClientRect().bottom);
  check('phone: the jump row takes her to who brings what, not hidden under the row', top >= navBottom - 2 && (top < navBottom + 80 || room < 2), `${top} ${navBottom} ${room}`);
  await c.screenshot({ path: `${DIR}/phone_jump_row.png` });
  await shut(c);

  // Who brings what: Dev claims water on a phone, Maya sees his name on it.
  let B = await board(b);
  await B.getByRole('button', { name: /^Water: nobody yet/ }).click();
  check('phone: Dev claims the water', await wait(B.getByRole('button', { name: /^Water: you bring it/ })));
  check('laptop: Maya sees Dev on the water', await wait(A.getByRole('button', { name: /^Water: Dev brings it/ })));
  await A.getByLabel('Add something you will bring').fill('Tide pool shoes');
  await A.getByLabel('Add something you will bring').press('Enter');
  check('laptop: Maya adds her own thing and it is hers', await wait(A.getByRole('button', { name: /^Tide pool shoes: you bring it/ })));

  // Agreements: Maya writes one, both phones stamp it, it gets sealed.
  await A.getByLabel('Write an agreement').fill('We split the bus fare evenly');
  await A.getByLabel('Write an agreement').press('Enter');
  B = await board(b);
  await B.locator('#part-agreements').scrollIntoViewIfNeeded();
  await B.getByRole('button', { name: 'I agree' }).click();
  const C = await board(c);
  await C.locator('#part-agreements').scrollIntoViewIfNeeded();
  await C.getByRole('button', { name: 'I agree' }).click();
  check('everyone stamped the agreement', await wait(A.locator('.pact.sealed')) && (await A.locator('.pact .stamp:not(.empty)').count()) === 3);

  // The day: Priya moves it 15 minutes later on her phone.
  await C.locator('#part-day').scrollIntoViewIfNeeded();
  await C.getByRole('button', { name: 'Start 15 minutes later' }).click();
  check('phone: moving the day shows on the laptop', await wait(A.locator('#part-day .stop.main .stop-time', { hasText: '2:15 pm' })));
  check('nothing on the board shows a player code', !/\b[PA]0\d\b/.test(await A.innerText()));

  await A.locator('.ticket-wrap').scrollIntoViewIfNeeded();
  await a.screenshot({ path: `${DIR}/laptop_board_top.png` });
  await A.locator('#part-weather').scrollIntoViewIfNeeded();
  await a.screenshot({ path: `${DIR}/laptop_weather_hours.png` });
  await A.locator('#part-bring').scrollIntoViewIfNeeded();
  await a.screenshot({ path: `${DIR}/laptop_bring_agree.png` });
  await C.locator('#part-weather').scrollIntoViewIfNeeded(); await c.screenshot({ path: `${DIR}/phone_weather.png` });
  await C.locator('#part-day').scrollIntoViewIfNeeded(); await c.screenshot({ path: `${DIR}/phone_day.png` });
  await C.locator('#part-bring').scrollIntoViewIfNeeded(); await c.screenshot({ path: `${DIR}/phone_bring.png` });
  await C.locator('#part-agreements').scrollIntoViewIfNeeded(); await c.screenshot({ path: `${DIR}/phone_agreements.png` });
  await C.locator('.ticket-wrap').scrollIntoViewIfNeeded(); await c.screenshot({ path: `${DIR}/phone_ticket.png` });
  // the saved ticket image draws without errors
  const png = await a.evaluate(() => new Promise((res) => { const orig = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { HTMLAnchorElement.prototype.click = orig; res(this.href.slice(0, 22)); }; [...document.querySelectorAll('button')].find((x) => x.textContent === 'Save as image').click(); }));
  check('saving the ticket makes a PNG', png === 'data:image/png;base64,');
  const errs = [];
  for (const p of ps) p.on('pageerror', (e) => errs.push(e.message));
  await shut(b); await shut(c);
  check('no page errors', errs.length === 0, errs.join(' | '));
} catch (e) { console.error(e); results.push(false); }
await browser.close();
server.kill();
await pg.stop();
const failed = results.filter((x) => !x).length;
console.log(failed ? `${failed} artifact check(s) failed` : 'All artifact checks passed.');
process.exit(failed ? 1 : 0);
