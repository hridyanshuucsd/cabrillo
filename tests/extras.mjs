// The second set of board pieces in a browser, one scenario at a time: one person on a laptop with AI players.
// Each scenario picks a few parts of the plan, uses its own piece, and takes a screenshot of it.
// Screenshots go to test-shots/extras/. Run: npm run build && node tests/extras.mjs
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const { chromium, devices } = createRequire(import.meta.url)('playwright');
import { startLocalDb } from '../scripts/localdb.js';

const PORT = 3520, BASE = `http://localhost:${PORT}`, DIR = 'test-shots/extras';
fs.rmSync(DIR, { recursive: true, force: true }); fs.mkdirSync(DIR, { recursive: true });
const { pg, url } = await startLocalDb({ dir: '.extrasdb', port: 5447, fresh: true });
const server = spawn(process.execPath, ['server/index.js'], {
  env: { ...process.env, DATABASE_URL: url, PORT: String(PORT), TIME_SCALE: '0.5', JWT_SECRET: 'x', ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '', AI_MODEL: '', WEATHER_FAKE: '1', PLACES_FAKE: '1' }, stdio: ['ignore', 'ignore', 'inherit']
});
for (let i = 0; i < 50; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 200)); }
const browser = await chromium.launch();
const results = [];
const check = (name, ok, extra = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${extra}`); };
const wait = (loc, ms = 8000) => loc.waitFor({ timeout: ms }).then(() => true, () => false);
const errors = [];

const host = await (await browser.newContext({ viewport: { width: 1200, height: 900 } })).newPage();
await host.goto(`${BASE}/login`);
await host.getByRole('tab', { name: 'Create account' }).click();
await host.getByLabel('Display name').fill('Host');
await host.getByLabel('Email').fill('host-x@ucsd.edu');
await host.getByLabel('Password').fill('a-long-password');
await host.locator('input[type=checkbox]').check();
await host.getByRole('button', { name: 'Create account' }).click();
await host.getByRole('button', { name: 'Set up a class session' }).waitFor();

// One table: a new class session for the scenario, one person joins and the host fills the rest with AI players.
async function table(task, { phone = false } = {}) {
  await host.goto(`${BASE}/`);
  await host.getByRole('button', { name: 'Set up a class session' }).click();
  await host.getByLabel('Scenario').selectOption(task);
  await host.getByLabel('People per table').selectOption('3');
  const auto = host.getByRole('switch'); if (await auto.count()) { if ((await auto.first().getAttribute('aria-checked')) === 'true') await auto.first().click(); }
  await host.getByRole('button', { name: 'Create class session' }).click();
  await host.waitForURL(/\/host\//);
  const code = host.url().split('/host/')[1];
  const p = await (await browser.newContext(phone ? devices['iPhone 14'] : { viewport: { width: 1360, height: 960 }, deviceScaleFactor: 2 })).newPage();
  p.on('pageerror', (e) => errors.push(`${task}: ${e.message}`));
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
  const B = p.locator('.pboard');
  // pick an option of one part of the plan on the board
  const pick = async (field, name) => {
    const part = B.locator(`#part-${field}`);
    const place = part.locator(`button.place-pick[aria-label="${name}"]`);
    if (await place.count()) { if ((await place.getAttribute('aria-pressed')) !== 'true') await place.click(); }
    else { const o = part.locator('button.opt', { has: p.locator('.opt-name', { hasText: new RegExp(`^${name.replace(/[$()]/g, '\\$&')}$`) }) }).first(); if ((await o.getAttribute('aria-pressed')) !== 'true') await o.click(); }
    await p.waitForTimeout(250);
  };
  const shot = async (sel, name) => { const el = B.locator(sel); await el.scrollIntoViewIfNeeded(); await p.waitForTimeout(200); await el.screenshot({ path: `${DIR}/${name}.png` }); };
  return { p, B, pick, shot, close: () => p.context().close() };
}

try {
  // dinner: cost and carpool seats
  let t = await table('dinner');
  await t.pick('where', 'Korean barbecue on Convoy Street'); await t.pick('budget', '$15 to $30'); await t.pick('travel', 'Carpool');
  check('dinner: the receipt shows dinner on Convoy and a total', await wait(t.B.locator('#part-x-cost .rline.total')) && /Dinner/.test(await t.B.locator('#part-x-cost').innerText()));
  check('dinner: the carpool card appears', await wait(t.B.locator('#part-x-cars')));
  if (await t.B.getByRole('button', { name: 'I can drive' }).count()) await t.B.getByRole('button', { name: 'I can drive' }).click();
  check('dinner: Maya drives, drawn as a car', await wait(t.B.locator('#part-x-cars').getByText('You drive')) && (await t.B.locator('#part-x-cars .car-svg').count()) >= 1);
  await t.shot('#part-x-cost', 'dinner_cost'); await t.shot('#part-x-cars', 'dinner_cars'); await t.close();

  // roommates: chore chart with a trade, and house rules
  t = await table('roommates');
  await t.B.locator('#part-x-chores').waitFor();
  const mine = t.B.locator('#part-x-chores .chore-cell.now', { hasText: 'You' }).first();
  await mine.click();
  const other = t.B.locator('#part-x-chores .chore-cell.now.target').first();
  await other.click();
  check('roommates: Maya trades a chore this week', await wait(t.p.locator('.pboard .history, .pboard').getByText(/./).first()) && (await t.B.locator('#part-x-chores .chore-cell.now', { hasText: 'You' }).count()) >= 1);
  await t.shot('#part-x-chores', 'roommates_chores'); await t.shot('#part-agreements', 'roommates_rules'); await t.close();

  // group project: who does what, with the timeline
  t = await table('project');
  await t.pick('split', 'By role (research, writing, editing, slides)'); await t.pick('draft', 'Wednesday');
  await t.B.locator('#part-x-work .claim-row', { hasText: 'Writing' }).getByRole('button', { name: 'I will do it' }).click();
  await t.B.locator('#part-x-work .claim-row', { hasText: 'Writing' }).locator('.status-pill').click();
  check('project: Maya writes, in progress, with draft and final on a timeline', await wait(t.B.locator('#part-x-work .status-pill.doing')) && (await t.B.locator('#part-x-work .dl-mark').count()) === 3);
  await t.shot('#part-x-work', 'project_work'); await t.close();

  // concert: tickets answered privately, then bought
  t = await table('concert');
  await t.pick('show', 'Jazz at the Rady Shell');
  await t.B.locator('#part-x-tickets').waitFor();
  await t.B.getByLabel('Lawn works for me').check();
  check('concert: once everyone answers, lawn works for all and can be bought', await wait(t.B.getByRole('button', { name: /^Buy \d$/ }).first()));
  await t.shot('#part-x-tickets', 'concert_tickets_answered');
  await t.B.getByRole('button', { name: /^Buy \d$/ }).first().click();
  check('concert: bought (demo), with a code', await wait(t.B.locator('#part-x-tickets .tix-stub.chosen')));
  await t.shot('#part-x-tickets', 'concert_tickets_bought'); await t.close();

  // study: room, timer, flashcards
  t = await table('study');
  await t.pick('where', 'Geisel Library study room'); await t.pick('when', 'Monday night'); await t.pick('length', '2 hours');
  await t.B.locator('#part-x-room').waitFor();
  const slot = t.B.locator('#part-x-room .slot').nth(1);
  await slot.getByRole('checkbox').check();
  await t.p.waitForTimeout(300);
  const book = t.B.locator('#part-x-room').getByRole('button', { name: 'Book it' });
  if (await book.count()) await book.first().click();
  check('study: the room is booked for a time that works for all', await wait(t.B.locator('#part-x-room .slot.chosen')));
  await t.B.locator('#part-x-study').getByRole('button', { name: 'Focus 25' }).click();
  await t.B.getByLabel('Flashcard question').fill('What does a determinant of zero tell you?');
  await t.B.getByLabel('Flashcard answer').fill('The matrix is not invertible');
  await t.B.locator('#part-x-study').getByRole('button', { name: 'Add card' }).click();
  check('study: a shared timer runs and the flashcard is there', await wait(t.B.locator('#part-x-study .flash-text', { hasText: 'determinant' })) && /2[45]:\d\d/.test(await t.B.locator('.timer-left').innerText()));
  await t.shot('#part-x-room', 'study_room'); await t.shot('#part-x-study', 'study_plan'); await t.close();

  // housing: listings on a map
  t = await table('housing');
  await t.pick('area', 'Clairemont'); await t.pick('rooms', 'Everyone has a single');
  await t.B.getByRole('button', { name: 'Like Balboa Ave apartments' }).click();
  check('housing: Maya likes a listing', await wait(t.B.locator('#part-x-listings .listing.liked')));
  await t.shot('#part-x-listings', 'housing_listings'); await t.close();

  // moving: the truck
  t = await table('moving');
  await t.pick('truck', 'Rent a U-Haul');
  await t.B.getByRole('radio', { name: /15 ft truck/ }).click();
  check('moving: the 15 ft truck is picked, with a price each', await wait(t.B.locator('#part-x-truck .truck.on')) && /15 ft truck: \$/.test(await t.B.locator('#part-x-truck .okline').innerText()));
  await t.shot('#part-x-truck', 'moving_truck'); await t.close();

  // anniversary: gift pool
  t = await table('anniversary');
  await t.pick('gift', 'Flowers');
  await t.B.locator('#part-x-gifts').getByRole('button', { name: /^Put in \$/ }).click();
  await t.B.locator('#part-x-gifts').getByRole('button', { name: 'Venmo' }).click();
  check('anniversary: Maya puts in her share and pays with Venmo (demo)', await wait(t.B.locator('#part-x-gifts').getByText(/paid with Venmo/)));
  await t.shot('#part-x-gifts', 'anniversary_gifts'); await t.close();

  // sports: roster on the court
  t = await table('sports');
  await t.pick('sport', 'Volleyball'); await t.pick('shirts', 'Buy matching shirts ($20)'); await t.pick('day', 'Thursday');
  await t.B.getByRole('button', { name: 'Setter: open. Tap to play here' }).click();
  // shirt sizes show while matching shirts lead; AI players may lean another way
  const sizes = t.B.locator('#part-x-roster .seg');
  const hasSizes = await wait(sizes, 3000);
  if (hasSizes) await sizes.getByRole('button', { name: 'M', exact: true }).click();
  check('sports: Maya plays setter (and wears M when shirts are bought)', await wait(t.B.getByRole('button', { name: 'Setter: you' })) && (!hasSizes || await wait(t.B.locator('#part-x-roster').getByText('Shirt M'))));
  await t.shot('#part-x-roster', 'sports_roster'); await t.close();

  // meeting: agenda and the weekly invite
  t = await table('meeting');
  await t.pick('day', 'Wednesday'); await t.pick('time', 'Noon'); await t.pick('notes', 'Rotate each week');
  await t.B.getByRole('button', { name: 'Longer: Problems to fix' }).click();
  check('meeting: the agenda runs over 30 minutes and says so', await wait(t.B.locator('#part-x-agenda .warn-line')) && (await t.B.getByRole('link', { name: 'Weekly invite in Google Calendar' }).getAttribute('href')).includes('RRULE'));
  await t.shot('#part-x-agenda', 'meeting_agenda'); await t.close();

  // volunteer: shifts
  t = await table('volunteer');
  await t.pick('where', 'San Diego Food Bank'); await t.pick('when', 'Saturday morning');
  await t.B.locator('#part-x-shifts .gantt-bar').first().click();
  await t.B.getByLabel('Closed-toe shoes').click();
  check('volunteer: Maya signs up for a shift and checks off shoes', await wait(t.B.locator('#part-x-shifts .gantt-bar.mine')) && await wait(t.B.getByText('1 of 1 done').first()));
  await t.shot('#part-x-shifts', 'volunteer_shifts'); await t.close();

  // birthday: invite and reminders, on a phone
  t = await table('birthday', { phone: true });
  await t.p.getByRole('button', { name: 'Plan board' }).click();
  const D = t.p.getByRole('dialog', { name: 'The plan so far' });
  const bpick = async (f, name) => { await D.locator(`#part-${f} button.opt`, { has: t.p.locator('.opt-name', { hasText: new RegExp(`^${name}$`) }) }).first().click(); await t.p.waitForTimeout(250); };
  await bpick('what', 'Karaoke'); await bpick('when', 'Friday night');
  await D.getByLabel('Add a guest').fill('Jordan'); await D.getByLabel('Add a guest').press('Enter');
  await D.getByRole('group', { name: "Jordan's answer" }).getByRole('button', { name: 'Going' }).click();
  check('birthday (phone): the invite is drafted, secret from Sam, and Jordan is going', await wait(D.getByText(/1 going/)) && /surprise karaoke/.test(await D.locator('.invite-text').innerText()));
  await D.getByLabel('Reminder text').fill('Pick up the cake'); await D.getByLabel('For whom').selectOption('me'); await D.getByLabel('Reminder text').press('Enter');
  check('birthday (phone): a private reminder joins the two for everyone', await wait(D.getByText('Pick up the cake')) && (await D.locator('.rem').count()) === 3);
  await D.locator('#part-x-invite').scrollIntoViewIfNeeded(); await t.p.screenshot({ path: `${DIR}/birthday_phone_invite.png` });
  await D.locator('#part-x-reminders').scrollIntoViewIfNeeded(); await t.p.screenshot({ path: `${DIR}/birthday_phone_reminders.png` });
  await D.locator('#part-x-gifts').scrollIntoViewIfNeeded(); await t.p.screenshot({ path: `${DIR}/birthday_phone_gifts.png` });
  await t.close();
  check('no page errors', errors.length === 0, errors.join(' | '));
} catch (e) { console.error(e); results.push(false); }
await browser.close();
server.kill();
await pg.stop();
const failed = results.filter((x) => !x).length;
console.log(failed ? `${failed} check(s) failed` : `All ${results.length} second-set checks passed.`);
process.exit(failed ? 1 : 0);
