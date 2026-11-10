// End-to-end test of the whole flow: briefing (task, private limit, how it works), a chat with no timer where the
// plan fills in from the chat and from taps, the three ways to share a limit, accepting the plan, and results.
// A host and six students play a class session in separate browsers.
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

  // ---------- six students join; each is seated the moment they join ----------
  const names = ['Maya', 'Dev', 'Priya', 'Jordan', 'Lena', 'Omar'];
  const students = [];
  for (const n of names) {
    const p = await (await phone()).newPage();
    await p.goto(`${BASE}/join/${code}`);
    await p.getByLabel('Your first name').fill(n);
    await p.getByRole('button', { name: 'Agree and join' }).click();
    await p.waitForURL(/\/play\//, { timeout: 5000 });
    students.push(p);
  }
  check('six students seated as they join, without the host pressing Start', true);
  const [a, b, c, d, e, f] = students;

  // ---------- briefing: task, private limit (keep, swap, or write your own), how the chat works ----------
  await a.getByText('Step 1 of 3').waitFor();
  check('briefing step 1 explains the task and what to decide', /Agree on one outing/.test(await body(a)) && /La Jolla Cove · Balboa Park/.test(await body(a)));
  await shot(a, '01_briefing_task');
  await a.getByRole('button', { name: 'Next: your private limit' }).click();
  const dealt = await a.locator('.limit-body').innerText();
  await a.getByRole('button', { name: 'Give me a different one' }).click();
  await a.waitForFunction((t) => document.querySelector('.limit-body')?.innerText !== t, dealt);
  const swapped = await a.locator('.limit-body').innerText();
  check('a person can swap the limit they were given', swapped !== dealt, `"${dealt}" -> "${swapped}"`);
  await a.getByRole('button', { name: 'Write my own' }).click();
  await a.getByLabel('Write your own limit').fill('I need to be home by 9 pm');
  await a.getByRole('button', { name: 'Use this limit' }).click();
  await a.getByText('I need to be home by 9 pm').first().waitFor();
  check('a person can write their own limit', true);
  await shot(a, '02_briefing_limit_own');
  await a.getByRole('button', { name: 'Go back to the one I was given' }).click();
  await a.waitForFunction((t) => document.querySelector('.limit-body')?.innerText === t, swapped);
  await a.getByRole('button', { name: 'Keep this limit' }).click();
  check('briefing step 3 explains the three ways to share and that there is no timer', /say it yourself/i.test(await body(a)) && /No timer/.test(await body(a)));
  await shot(a, '03_briefing_how');
  await a.getByRole('button', { name: 'I am ready' }).click();
  await a.getByRole('heading', { name: 'You are ready' }).waitFor();
  await shot(a, '04_briefing_waiting');
  const brief = async (p) => {
    await p.getByRole('button', { name: 'Next: your private limit' }).click();
    const text = await p.locator('.limit-body').innerText();
    await p.getByRole('button', { name: 'Keep this limit' }).click();
    await p.getByRole('button', { name: 'I am ready' }).click();
    return text;
  };
  const limits = { Maya: swapped };
  for (const [n, p] of [['Dev', b], ['Priya', c], ['Jordan', d], ['Lena', e], ['Omar', f]]) limits[n] = await brief(p);
  for (const p of students) await p.getByLabel('Message').waitFor({ timeout: 8000 });
  check('the chat opens as soon as everyone at the table is ready', true);
  check('private limits differ within a table', new Set([limits.Maya, limits.Dev, limits.Priya]).size === 3);

  // which table has which AI
  const isListen = async (p) => (await p.locator('.hearing').count()) > 0;
  const listenFirst = await isListen(a);
  const [L, A] = listenFirst ? [[a, b, c], [d, e, f]] : [[d, e, f], [a, b, c]];
  const Ln = listenFirst ? ['Maya', 'Dev', 'Priya'] : ['Jordan', 'Lena', 'Omar'];
  check('one table has the listening AI and the other the answer-only AI', (await isListen(L[0])) && !(await isListen(A[0])));
  check('the chat has no timer', !(await L[0].locator('.timer-pill, [role=timer]').count()) && /There is no timer/.test(await body(L[0])));

  // ---------- listening table ----------
  const [x, y, z] = L; const [xn, yn, zn] = Ln;
  // An option that breaks x's private limit, so the private heads-up can be tested with whatever limit was dealt.
  const BREAK = [[/Saturday until 5/, 'saturday morning', 'Saturday morning'], [/at most \$15/, '$20', '$15 to $30'], [/carsick/, 'carpool', 'Carpool'], [/ankle/, 'hike', 'Torrey Pines hike'], [/Sunday morning/, 'sunday morning', 'Sunday morning']];
  const [, word, bad] = BREAK.find(([re]) => re.test(limits[xn]));
  await say(y, `how about ${word}?`);
  await x.getByText(/breaks your private limit/).first().waitFor({ timeout: 5000 });
  check('a private heads-up appears when the plan heads somewhere that breaks your limit', (await x.getByText('Only you see this').count()) > 0);
  check('nobody else sees that heads-up', !(await y.getByText(/breaks your private limit/).count()));
  check('the plan above the chat updates from the chat', new RegExp(bad.replace(/[$]/g, '\\$')).test(await x.locator('.planbar').innerText()));
  check('the "AI hears" line reflects the chat', new RegExp(yn).test(await x.locator('.hearing').innerText()), await x.locator('.hearing').innerText());
  await shot(x, '05_chat_private_headsup');
  // way 1 of 3: the AI passes it on without a name (straight from the heads-up)
  await x.locator('.bubble.private').getByRole('button', { name: /without my name/ }).click();
  await y.getByText(/Someone at this table asked me to pass this on without their name/).waitFor({ timeout: 5000 });
  check('the AI can pass a limit on without a name', !(await body(y)).includes(`${xn} asked me`));
  // the plan now takes the option that breaks the shared limit: the AI speaks up. z agrees with one tap on "Me too".
  await z.getByRole('button', { name: `Me too: ${bad}` }).click();
  await x.getByText(`${zn} agreed with ${yn}: ${bad}.`).waitFor({ timeout: 5000 });
  check('"Me too" under a message picks what that message asked for', !(await z.getByRole('button', { name: `Me too: ${bad}` }).count()));
  await y.getByText(/does not fit a limit that someone shared without their name/).waitFor({ timeout: 5000 });
  check('the AI speaks up when the plan stops fitting a shared limit', true);
  // a private question to the AI: only the person who asked sees the question and the answer
  await x.getByRole('button', { name: 'Ask AI' }).click();
  await x.getByRole('radio', { name: 'Only I see it' }).click();
  await x.getByLabel('Message').fill('what have we decided so far, just between us?');
  await x.getByRole('button', { name: 'Send', exact: true }).click();
  await x.locator('.bubble.private', { hasText: 'Plan so far' }).waitFor({ timeout: 8000 });
  await x.waitForTimeout(400);
  check('a private question and its answer are seen only by the person who asked', (await x.getByText('asked the AI privately').count()) === 1 && !(await body(y)).includes('just between us') && !(await body(y)).includes('Plan so far:'));
  await shot(x, '05b_private_question');
  // a what-if question to the AI is not a vote
  const before = await x.locator('.planbar').innerText();
  await say(x, '@AI if we took an uber, what would each of us pay?');
  await x.waitForTimeout(900);
  check('a what-if question to the AI does not change anyone\'s picks', (await x.locator('.planbar').innerText()) === before);
  // way 2 of 3: say it myself, from a draft in the message box
  await y.getByRole('button', { name: 'Your private limit' }).click();
  await shot(y, '06_limit_sheet');
  await y.getByRole('button', { name: /^Say it myself/ }).click();
  await y.getByText('Draft of your limit').waitFor({ timeout: 3000 });
  const draft = await y.getByLabel('Message').inputValue();
  check('"Say it myself" puts an editable draft in the message box', draft.length > 10 && (await y.getByText('Draft of your limit').count()) > 0, `"${draft}"`);
  await y.getByRole('button', { name: 'Send', exact: true }).click();
  await x.getByText('shared a limit').first().waitFor({ timeout: 5000 });
  // way 3 of 3: the AI passes it on with a name
  await z.getByRole('button', { name: 'Your private limit' }).click();
  await z.getByRole('button', { name: /with my name/ }).click();
  await x.getByText(`${zn} asked me to pass this on`).waitFor({ timeout: 5000 });
  check('all three ways to share a limit work', true);

  // tapping counts like saying
  const tap = async (p, field, option) => {
    await p.locator(`.pchip[aria-label^="${field}:"]`).click();
    const btn = p.getByRole('dialog').getByRole('button', { name: new RegExp(`^${option.replace(/[$]/g, '\\$')}`) });
    if ((await btn.getAttribute('aria-pressed')) !== 'true') await btn.click();
    await p.getByRole('dialog').getByRole('button', { name: 'Done' }).click();
  };
  const GOOD = [['Where', 'Old Town'], ['When', 'Sunday afternoon'], ['Getting there', 'Bus or trolley'], ['Budget per person', 'Under $15']];
  await tap(x, 'Where', 'Old Town');
  await y.getByText(`${xn} picked Old Town for where.`).waitFor({ timeout: 5000 });
  check('a tap shows in the chat for everyone', true);
  await shot(x, '07_chat_board');
  await x.locator('.pchip[aria-label^="When:"]').click();
  await shot(x, '08_pick_sheet');
  await x.getByRole('dialog').getByRole('button', { name: 'Done' }).click();
  for (const [fl, op] of GOOD) { await tap(x, fl, op); await tap(y, fl, op); }
  await x.getByRole('group', { name: /Every part of the plan has a choice: Old Town, Sunday afternoon, Bus or trolley( \([^)]*\))?, Under \$15/ }).first().waitFor({ timeout: 5000 });
  check('the plan is what most of the table wants, and a plan card appears when it is complete', (await x.getByRole('button', { name: 'Accept this plan' }).count()) >= 1);

  // pause, ask, book
  await y.getByRole('button', { name: 'The plan so far, details' }).click();
  await y.getByRole('button', { name: 'Pause AI' }).click();
  await x.getByText(/paused the AI/).first().waitFor();
  await y.getByRole('button', { name: 'Resume AI' }).click();
  await y.getByRole('button', { name: 'Close' }).click();
  check('anyone can pause and resume the AI', true);
  await say(x, '@AI how do we get to Old Town?');
  await x.getByText(/easy by trolley or bus/).first().waitFor({ timeout: 8000 });
  check('the AI answers a direct question', true);

  // accept: a change to the plan clears earlier accepts
  await x.getByRole('button', { name: 'Accept the plan' }).click();
  await x.getByRole('button', { name: 'Withdraw my acceptance' }).waitFor();
  await tap(y, 'Budget per person', '$15 to $30');
  // Depending on what the third person said in the chat, the plan is now incomplete or complete with a new budget; either way the accept is gone.
  await x.getByRole('button', { name: /^(Plan progress|Accept the plan)/ }).waitFor({ timeout: 5000 });
  check('a change to the plan clears earlier accepts', true);
  await tap(y, 'Budget per person', 'Under $15');
  await tap(z, 'Budget per person', 'Under $15');
  await x.getByRole('button', { name: 'Accept the plan' }).waitFor({ timeout: 5000 });
  await shot(x, '09_chat_accept');
  for (const p of L) await p.getByRole('button', { name: 'Accept the plan' }).click();
  await x.getByRole('heading', { name: 'Your group made a plan' }).waitFor({ timeout: 8000 });
  check('the plan locks when everyone accepts, and results open', true);
  const res = await body(x);
  check('results show whose limits came up and whether the plan respects them', /private limits came up/.test(res) && /The plan works with this limit/.test(res) && /Shared without a name/.test(res));
  for (const q of ['How much did the AI help your group?', 'The plan we made works for me.', 'It was easy to bring up my limit.', 'The group, not the AI, was in charge of the plan.']) await x.getByRole('button', { name: `${q} 4 of 5` }).click();
  await x.getByRole('button', { name: 'About right' }).click();
  await x.getByRole('button', { name: 'Yes', exact: true }).click();
  await x.getByRole('button', { name: 'Send feedback' }).click();
  await x.getByText('Your answers help our class project').waitFor();
  check('in-app feedback saves', true);
  await shot(x, '10_results');

  // ---------- answer-only table ----------
  const [u, v, w] = A;
  await say(u, 'Old Town sounds fun');
  await u.waitForTimeout(600);
  check('answer-only table: the chat does not fill in the plan', /Tap to pick/.test(await u.locator('.pchip[aria-label^="Where:"]').innerText()));
  await tap(u, 'Where', 'Old Town'); await tap(v, 'Where', 'Old Town');
  await w.locator('.pchip.agreed[aria-label^="Where:"]').waitFor({ timeout: 5000 });
  check('answer-only table: taps fill in the plan', true);
  await say(u, '@AI how do we get to Old Town?');
  await u.getByText(/easy by trolley or bus/).first().waitFor({ timeout: 8000 });
  const uText = await body(u);
  check('answer-only AI made no unprompted moves', !/Quick check before|Tap to pick\.|Heads up/.test(uText) && !(await u.getByText('Only you see this').count()) && !(await u.getByRole('button', { name: /^Me too/ }).count()));
  await say(u, '@AI can you book an uber for us?');
  await u.getByRole('group', { name: /^Ride to / }).first().waitFor({ timeout: 6000 });
  check('answer-only AI answers and books only when asked', true);
  // each person tells the AI privately which rides work; here one person says none do
  const rideOf = (p) => p.getByRole('group', { name: /^Ride to / }).first();
  await rideOf(u).getByRole('checkbox', { name: /^Standard/ }).click();
  await rideOf(u).getByRole('button', { name: 'Send my answer' }).click();
  await rideOf(v).getByRole('button', { name: 'None work for me' }).click();
  await rideOf(u).getByText('2 of 3 answered').waitFor({ timeout: 5000 });
  check('ride answers are private: others see only how many answered', !(await rideOf(u).getByText(/none of these/i).count()) && (await rideOf(v).getByText(/none of these/i).count()) === 1);
  await rideOf(w).getByRole('checkbox', { name: /^XL/ }).click();
  await rideOf(w).getByRole('button', { name: 'Send my answer' }).click();
  await u.getByText(/Not booked: no ride works for everyone/).first().waitFor({ timeout: 5000 });
  const An = listenFirst ? ['Jordan', 'Lena', 'Omar'] : ['Maya', 'Dev', 'Priya'];
  const notBooked = await u.getByText(/Not booked: no ride works for everyone/).first().innerText();
  check('with no ride that works for everyone, nothing is booked and nobody is named', !An.some((n) => notBooked.includes(n)), notBooked);
  await shot(u, '11_chat_answer_only');
  // no timer, so a table that cannot agree ends only when every person asks to
  for (const p of A) { await p.getByRole('button', { name: 'Task' }).click(); await p.getByRole('button', { name: 'End without a plan' }).click(); if (p !== w) await p.getByRole('button', { name: 'Close' }).click(); }
  await u.getByRole('heading', { name: 'No plan this time' }).waitFor({ timeout: 8000 });
  check('a table can end without a plan once everyone asks to', true);
  await shot(host, '12_host_tables');

  // ---------- data export ----------
  const csv = await (await host.request.get(`${BASE}/api/export/${code}/logs.csv`)).text();
  const types = new Set(csv.split('\n').slice(1).map((l) => l.split(',')[4]));
  const need = ['session_started', 'stage_started', 'limit_changed', 'ready_clicked', 'chat_message', 'panel_update', 'chat_parsed', 'pick', 'plan_update', 'plan_complete', 'limit_alert_private', 'limit_shared', 'shared_limit_conflict', 'ai_paused_by_player', 'question_asked', 'ai_answer', 'booking_proposed', 'booking_answer', 'booking_none', 'me_too', 'player_outcome', 'vote', 'accepts_reset', 'deal_locked', 'end_vote', 'ended_by_group', 'session_outcome', 'feedback_submitted'];
  const missing = need.filter((t) => !types.has(t));
  check('log export contains every event type', missing.length === 0, missing.length ? `missing: ${missing}` : `${csv.split('\n').length - 1} rows`);
  check('log export has no player names', !/Maya|Priya|Jordan|Lena|Omar|\bDev\b/.test(csv));
  const sessions = await (await host.request.get(`${BASE}/api/export/${code}/sessions.csv`)).text();
  check('sessions export records both AI modes', /,listen,/.test(sessions) && /,ask,/.test(sessions));
  const denied = await students[0].request.get(`${BASE}/api/export/${code}/logs.csv`);
  check('students cannot export data', denied.status() === 403);

  // ---------- play now, alone, with AI players filling seats ----------
  const solo = await (await phone()).newPage();
  await solo.goto(`${BASE}/login`);
  await solo.getByRole('tab', { name: 'Play as guest' }).click();
  await solo.getByLabel('Display name').fill('Sam');
  await solo.locator('input[type=checkbox]').check();
  await solo.getByRole('button', { name: 'Continue as guest' }).click();
  await solo.getByRole('button', { name: 'Find a table' }).click();
  await solo.waitForURL(/\/play\//, { timeout: 10000 });
  await brief(solo);
  await solo.getByLabel('Message').waitFor({ timeout: 8000 });
  check('Play now fills empty seats with labeled AI players', /3 at the table/.test(await body(solo)));
  const soloFields = await solo.locator('.pchip').evaluateAll((els) => els.map((el) => el.getAttribute('aria-label').split(':')[0]));
  for (const fl of soloFields) {
    await solo.locator(`.pchip[aria-label^="${fl}:"]`).click();
    await solo.getByRole('dialog').locator('.opt').first().click();
    await solo.getByRole('dialog').getByRole('button', { name: 'Done' }).click();
  }
  const soloDone = await solo.getByRole('button', { name: 'Accept the plan' }).waitFor({ timeout: 40000 }).then(() => true, () => false);
  check('AI players go along with the person, so a solo table can reach a full plan', soloDone, soloDone ? '' : await solo.locator('.planbar').innerText());
  await shot(solo, '13_quick_with_ai');

  await host.goto(`${BASE}/history`);
  check('the history page lists the class session the host ran, with its analytics', await host.getByText('Class sessions I hosted').waitFor({ timeout: 5000 }).then(() => true, () => false) && (await host.getByRole('link', { name: 'Analytics' }).count()) >= 1);
} catch (e) {
  console.error('TEST ERROR', e);
  results.push({ name: 'exception', ok: false });
} finally {
  await browser.close(); server.kill(); await pg.stop();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
