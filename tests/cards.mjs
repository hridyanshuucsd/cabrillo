// Map, ride and table cards on phones: the AI adds a map when two places are compared and prices a ride when the plan
// says rideshare; each person answers privately which rides work, the group watches the ride play out on the map, and asks for a table. Screenshots go to test-shots/cards/. Run: npm run build && node tests/cards.mjs
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const { chromium, devices } = createRequire(import.meta.url)('playwright');
import { startLocalDb } from '../scripts/localdb.js';

const PORT = 3500, BASE = `http://localhost:${PORT}`, DIR = 'test-shots/cards';
fs.rmSync(DIR, { recursive: true, force: true }); fs.mkdirSync(DIR, { recursive: true });
const { pg, url } = await startLocalDb({ dir: '.cardsdb', port: 5438, fresh: true });
const server = spawn(process.execPath, ['server/index.js'], {
  env: { ...process.env, DATABASE_URL: url, PORT: String(PORT), TIME_SCALE: '0.4', JWT_SECRET: 'c', ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '' }, stdio: ['ignore', 'ignore', 'inherit']
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
  for (const n of ['Maya', 'Dev', 'Priya']) {
    const p = await (await browser.newContext({ ...devices['iPhone 14'] })).newPage();
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
  const say = async (p, t) => { await p.getByLabel('Message').fill(t); await p.getByRole('button', { name: 'Send', exact: true }).click(); await p.waitForTimeout(250); };

  // The AI adds a map by itself as soon as two places are being compared.
  await say(a, 'Old Town for tacos sounds good');
  await say(b, 'I was thinking Balboa Park, honestly');
  check('the AI adds a map when two places are compared, without being asked', await wait(a.getByRole('group', { name: 'Map of the options' })));
  check('the map says why the AI added it', await wait(a.getByText('The AI added this because you are comparing places.').first(), 3000));
  await say(b, 'ok fine, Old Town works for me too');
  await a.waitForTimeout(1500); // tiles
  await a.getByRole('group', { name: 'Map of the options' }).scrollIntoViewIfNeeded();
  await a.screenshot({ path: `${DIR}/01_map_card.png` });
  check('the map card lists drive times and Google Maps directions', (await a.getByRole('link', { name: 'Directions' }).count()) >= 4);
  await a.getByRole('button', { name: 'Open the map full screen' }).first().click();
  await a.waitForTimeout(1200);
  await a.screenshot({ path: `${DIR}/02_map_full.png` });
  await a.getByRole('button', { name: 'Close' }).click();

  // The AI prices a ride by itself once the plan says rideshare.
  await say(a, 'let us take a rideshare there');
  await say(c, 'rideshare is fine with me');
  check('the AI prices a ride when the plan says rideshare, without being asked', await wait(a.getByRole('group', { name: 'Ride to Old Town' })));
  check('the AI says why it added the ride', await wait(a.getByText('The AI added this because the plan says rideshare.').first(), 3000));
  await a.waitForTimeout(1500);
  await a.getByRole('group', { name: 'Ride to Old Town' }).scrollIntoViewIfNeeded();
  await a.screenshot({ path: `${DIR}/03_ride_options.png` });
  const ride = (p) => p.getByRole('group', { name: 'Ride to Old Town' });
  check('three car types with prices, answered privately', (await ride(a).getByRole('checkbox').count()) === 3 && (await ride(a).getByText('Only you see this').count()) === 1);
  // each person says privately which rides work; one person changes their mind before the result
  await ride(a).getByRole('checkbox', { name: /^XL/ }).click();
  await ride(a).getByRole('button', { name: 'Send my answer' }).click();
  await ride(b).getByText('1 of 3 answered').waitFor({ timeout: 4000 });
  check('others see only how many people answered', !(await ride(b).getByText(/You said/).count()) && !/Maya (said|picked|chose|answered|is fine with)[^.]*XL/.test(await b.locator('body').innerText()));
  await ride(a).getByRole('button', { name: 'Change my answer' }).click();
  await ride(a).getByRole('checkbox', { name: /^XL/ }).click();
  await ride(a).getByRole('checkbox', { name: /^Standard/ }).click();
  await ride(a).getByRole('checkbox', { name: /^Green/ }).click();
  await ride(a).getByRole('button', { name: 'Send my answer' }).click();
  check('a person can change their private answer before the result', await wait(ride(a).getByText(/You said these work for you: Standard, Green/), 4000));
  await a.screenshot({ path: `${DIR}/03b_ride_private_answer.png` });
  await ride(b).getByRole('checkbox', { name: /^Standard/ }).click(); await ride(b).getByRole('checkbox', { name: /^XL/ }).click();
  await ride(b).getByRole('button', { name: 'Send my answer' }).click();
  for (const o of [/^Standard/, /^XL/, /^Green/]) await ride(c).getByRole('checkbox', { name: o }).click();
  await ride(c).getByRole('button', { name: 'Send my answer' }).click();
  check('the AI books the cheapest ride that works for everyone', await wait(a.getByText(/Standard is the cheapest ride that works for everyone/).first()) && await wait(a.getByText('Booked (demo)').first()));
  check('a driver is found', await wait(a.getByText(/is arriving in/), 6000));
  await a.waitForTimeout(800);
  await a.getByRole('group', { name: 'Ride to Old Town' }).scrollIntoViewIfNeeded();
  await a.screenshot({ path: `${DIR}/04_ride_driver_arriving.png` });
  check('the car drives the route', await wait(a.getByText(/On the way ·/), 10000));
  await a.waitForTimeout(2500);
  await a.getByRole('group', { name: 'Ride to Old Town' }).scrollIntoViewIfNeeded();
  await a.screenshot({ path: `${DIR}/05_ride_on_trip.png` });
  check('the ride arrives', await wait(a.getByText('You have arrived at Old Town'), 16000));

  await say(c, 'can we also reserve a table for lunch');
  check('asking for a table posts a table card', await wait(a.getByRole('group', { name: /Booking: Table for 3/ })));
  const tbl = (p) => p.getByRole('group', { name: /Booking: Table for 3/ });
  await a.waitForTimeout(1200);
  await tbl(a).scrollIntoViewIfNeeded();
  await a.screenshot({ path: `${DIR}/06_table_card.png` });
  // a: the first two times; b: the last two; c: all three. The earliest time that works for everyone is the second.
  const times = await tbl(a).getByRole('checkbox').allInnerTexts();
  for (const [p, idx] of [[a, [0, 1]], [b, [1, 2]], [c, [0, 1, 2]]]) { for (const i of idx) await tbl(p).getByRole('checkbox').nth(i).click(); await tbl(p).getByRole('button', { name: 'Send my answer' }).click(); }
  check('the table is reserved at the earliest time that works for everyone', await wait(a.getByText(`Reserved for 3 · ${times[1]}`)), times[1]);
  await a.getByRole('group', { name: /Booking: Table for 3/ }).scrollIntoViewIfNeeded();
  await a.screenshot({ path: `${DIR}/07_table_reserved.png` });
  const sideways = await a.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  check('no sideways scrolling with the cards', !sideways);
  const logs = await (await fetch(`${BASE}/api/export/${code}/logs.csv`, { headers: { cookie: (await host.context().cookies()).map((x) => `${x.name}=${x.value}`).join('; ') } })).text();
  check('the map, private answers and bookings are logged', ['map_shown', 'booking_proposed', 'booking_answer', 'booking_done'].every((e) => logs.includes(e)));
} catch (e) { console.error(e); results.push(false); }
await browser.close(); server.kill(); await pg.stop();
const failed = results.filter((x) => !x).length;
console.log(failed ? `${failed} check(s) failed` : 'All card checks passed.');
process.exit(failed ? 1 : 0);
