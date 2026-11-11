// One person at a table with two AI players, on a phone: the AI players reply to questions, the AI answers a question
// to the group with an options card, a shared limit marks the options it rules out, and the plan card and the route card
// appear. Runs twice: scripted lines (no key), then the model path against a local stand-in for OpenAI.
// Screenshots go to test-shots/aiplayers/. Run: npm run build && node tests/aiplayers.mjs
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const { chromium, devices } = createRequire(import.meta.url)('playwright');
import { startLocalDb } from '../scripts/localdb.js';

const DIR = 'test-shots/aiplayers';
fs.rmSync(DIR, { recursive: true, force: true }); fs.mkdirSync(DIR, { recursive: true });
const { pg, url } = await startLocalDb({ dir: '.aidb', port: 5440, fresh: true });
const results = [];
const check = (name, ok, extra = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${extra}`); };
const wait = (loc, ms = 12000) => loc.waitFor({ timeout: ms }).then(() => true, () => false);
const browser = await chromium.launch();

async function run(label, port, env, extraArgs = []) {
  const BASE = `http://localhost:${port}`;
  const server = spawn(process.execPath, [...extraArgs, 'server/index.js'], {
    env: { ...process.env, DATABASE_URL: url, PORT: String(port), TIME_SCALE: '0.5', JWT_SECRET: 'a', ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '', AI_MODEL: '', ...env }, stdio: ['ignore', 'ignore', 'inherit']
  });
  for (let i = 0; i < 50; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 200)); }
  try {
    const host = await (await browser.newContext({ viewport: { width: 1200, height: 900 } })).newPage();
    await host.goto(`${BASE}/login`);
    await host.getByRole('tab', { name: 'Create account' }).click();
    await host.getByLabel('Display name').fill('Host');
    await host.getByLabel('Email').fill(`host-${label}@ucsd.edu`);
    await host.getByLabel('Password').fill('a-long-password');
    await host.locator('input[type=checkbox]').check();
    await host.getByRole('button', { name: 'Create account' }).click();
    await host.getByRole('button', { name: 'Set up a class session' }).click();
    await host.getByLabel('Scenario').selectOption('outing');
    await host.getByLabel('People per table').selectOption('3');
    const auto = host.getByRole('switch'); if (await auto.count()) { if ((await auto.first().getAttribute('aria-checked')) === 'true') await auto.first().click(); }
    await host.getByRole('button', { name: 'Create class session' }).click();
    await host.waitForURL(/\/host\//);
    const code = host.url().split('/host/')[1];

    const a = await (await browser.newContext({ ...devices['iPhone 14'] })).newPage();
    await a.goto(`${BASE}/join/${code}`);
    await a.getByLabel('Your first name').fill('Maya');
    await a.getByRole('button', { name: 'Agree and join' }).click();
    await a.waitForURL(/\/play\//);
    await host.getByRole('button', { name: /Start this table now with AI players|Start the filling table now/ }).first().click();
    await a.getByRole('button', { name: 'Next: your private limit' }).click();
    await a.getByRole('button', { name: /^Keep (this|my own) limit$/ }).click();
    await a.getByRole('button', { name: 'I am ready' }).click();
    await a.getByLabel('Message').waitFor();
    const say = async (t) => { await a.getByLabel('Message').fill(t); await a.getByRole('button', { name: 'Send', exact: true }).click(); };
    const aiLines = () => a.locator('.bubble:not(.mine):not(.ai)').count();

    const before = await aiLines();
    await say('where should we meet guys?');
    check(`${label}: a question about where gets an options card from the AI`, await wait(a.getByText(/(Options for where|Picks for where)/).first()));
    await a.waitForTimeout(9000);
    check(`${label}: AI players reply to the question`, (await aiLines()) > before, `(${(await aiLines()) - before} new AI player messages)`);
    await a.screenshot({ path: `${DIR}/${label}_01_where.png` });

    const b2 = await aiLines();
    await say('okay, what time tho?');
    check(`${label}: a question about time gets an options card`, await wait(a.getByText(/(where when stands|when stands|picked when yet|for when)/i).first()));
    await a.waitForTimeout(9000);
    check(`${label}: AI players reply to the time question`, (await aiLines()) > b2);
    const texts = await a.locator('.bubble:not(.mine):not(.ai)').allInnerTexts();
    console.log('   AI player lines:', texts.map((t) => t.replace(/\n/g, ' | ')).join('  //  '));
    check(`${label}: no template lines like "I would like X for when"`, !texts.some((t) => /I would like .* for \w+\./.test(t)));
    await a.screenshot({ path: `${DIR}/${label}_02_when.png` });

    // @ai (any case) gives a pros and cons card with a Pick button per option
    await say('@ai pros and cons of la jolla cove vs balboa park?');
    const cmp = a.getByRole('group', { name: 'Where: pros and cons' }).last();
    check(`${label}: "@ai pros and cons" gives a pros and cons card`, await wait(cmp, 25000));
    check(`${label}: the card covers both options, each with pros and cons`, (await cmp.locator('.cmp-item').count()) === 2 && (await cmp.locator('.cmp.pro').count()) >= 2 && (await cmp.locator('.cmp.con').count()) >= 2);
    await cmp.scrollIntoViewIfNeeded(); await a.screenshot({ path: `${DIR}/${label}_025_compare.png` });
    const answers = async () => a.locator('.bubble.ai').count();
    const ask = async (q) => { const n = await answers(); await say(q); for (let i = 0; i < 50 && (await answers()) <= n; i++) await a.waitForTimeout(400); return (await answers()) > n; };
    check(`${label}: "@AI what should we bring" gets an answer`, await ask('@AI what should we bring to the beach?'));
    check(`${label}: "@ai how long can a sea lion hold its breath" (off topic) gets an answer`, await ask('@ai how long can a sea lion hold its breath'));
    check(`${label}: "@AI how do we get there by bus" gets an answer`, await ask('@AI how do we get there by bus, step by step?'));
    check(`${label}: "@AI split $60 three ways" gets an answer`, await ask('@AI if it costs $60 total how do we split it each?'));
    if (label === 'model') {
      check('model: a question about real places is answered with web search, with its sources as links', await ask('@ai what escape rooms are near us?') && await wait(a.getByRole('link', { name: 'Escape Room A' }).first(), 5000) && !(await a.locator('.bubble.ai').last().innerText()).includes('example.com'));
      await a.screenshot({ path: `${DIR}/model_027_search.png` });
      check('model: the packing answer shows a list', (await a.locator('.blk-list li').count()) >= 3);
      check('model: the bus answer shows steps and the options to tap', (await a.locator('.blk-steps li').count()) >= 3 && (await a.locator('.bubble.ai .opts').count()) >= 1);
      check('model: the split answer shows a table with names, not codes', (await a.locator('.blk-table td').allInnerTexts()).includes('Maya'));
      await a.locator('.blk-table').last().scrollIntoViewIfNeeded(); await a.screenshot({ path: `${DIR}/model_026_answers.png` });
    }

    // share my limit through the AI: options it rules out are marked in the options card
    await a.getByRole('button', { name: 'Your private limit' }).click();
    await a.getByRole('dialog').getByRole('button', { name: /^AI passes it on, with my name/ }).click();
    await a.waitForTimeout(800);
    let marked = false;
    for (const fl of ['Where', 'When', 'Getting there', 'Budget per person']) {
      await a.locator(`.pchip[aria-label^="${fl}:"]`).click();
      if (await wait(a.getByRole('dialog').getByText(/Does not work for Maya/).first(), 1200)) { marked = true; await a.getByRole('dialog').screenshot({ path: `${DIR}/${label}_03_blocked.png` }); }
      await a.getByRole('dialog').getByRole('button', { name: 'Done' }).click();
      if (marked) break;
    }
    check(`${label}: a shared limit marks the options it rules out`, marked);

    // pick everything; AI players follow; the plan card and the route card appear
    for (const [fl, op] of [['Where', 'La Jolla Cove'], ['When', 'Sunday afternoon'], ['Getting there', 'Bus or trolley'], ['Budget per person', 'Under $15']]) {
      await a.locator(`.pchip[aria-label^="${fl}:"]`).click();
      const btn = a.getByRole('dialog').getByRole('button', { name: new RegExp(`^${op.replace(/[$]/g, '\\$')}`) }).first();
      if ((await btn.getAttribute('aria-pressed')) !== 'true') await btn.click();
      await a.getByRole('dialog').getByRole('button', { name: 'Done' }).click();
    }
    check(`${label}: the plan card appears with an Accept button`, await wait(a.getByRole('button', { name: 'Accept this plan' }), 20000));
    check(`${label}: the AI adds a route card for the bus`, await wait(a.getByRole('button', { name: /^Route .*On the board/ }), 8000));
    await a.getByRole('button', { name: /^Route .*On the board/ }).first().click();
    check(`${label}: the route card is on the board`, await wait(a.getByRole('dialog').getByRole('group', { name: 'Getting to La Jolla Cove' }), 4000));
    await a.waitForTimeout(800);
    await a.screenshot({ path: `${DIR}/${label}_04_route.png` });
    await a.getByRole('dialog').getByRole('button', { name: 'Close' }).first().click();
    await a.getByRole('button', { name: 'Accept this plan' }).last().scrollIntoViewIfNeeded();
    await a.screenshot({ path: `${DIR}/${label}_05_plan_card.png` });
    await a.getByRole('button', { name: 'Accept this plan' }).last().click();
    const sheet = a.getByRole('dialog', { name: 'Accept this plan?' });
    if (await wait(sheet, 800)) await sheet.getByRole('button', { name: /accept anyway/i }).click();
    check(`${label}: accepting from the card locks the plan`, await wait(a.getByText('What everyone was holding'), 10000));
    const sideways = await a.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    check(`${label}: no sideways scrolling`, !sideways);
  } catch (e) { console.error(e); results.push(false); }
  server.kill();
}

await run('scripted', 3700, {});
await run('model', 3701, { OPENAI_API_KEY: 'test-key' }, ['--import', './tests/helpers/fake-openai.mjs']);
await browser.close(); await pg.stop();
const failed = results.filter((x) => !x).length;
console.log(failed ? `${failed} check(s) failed` : 'All AI player checks passed.');
process.exit(failed ? 1 : 0);
