// A chat between one person and two AI players, replayed against the game logic directly (no browser).
// It follows the conversation that exposed these problems: player codes shown instead of names, AI players that
// repeat themselves and do not answer the question, a split way of getting there that the plan could not record,
// and "Me too" offered where it would switch a pick. Runs three times: scripted lines (no key), a well-behaved
// stand-in model, and a badly behaved one whose lines must never reach the chat.
// Run: node tests/conversation.mjs        (add SHOW=1 to print every chat)
import { startLocalDb } from '../scripts/localdb.js';

const { pg, url } = await startLocalDb({ dir: '.convdb', port: 5442, fresh: true });
process.env.DATABASE_URL = url;
process.env.TIME_SCALE = '0.04';
process.env.AI_SUMMARY = 'off';
process.env.ROUTING = 'off';
process.env.ANTHROPIC_API_KEY = ''; process.env.OPENAI_API_KEY = ''; process.env.AI_MODEL = '';
await import('./helpers/fake-openai.mjs');
const { migrate } = await import('../server/db.js');
const { Table } = await import('../server/game.js');
const { sameMessage } = await import('../server/listener.js');
await migrate();

const results = [];
const check = (name, ok, extra = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${ok ? '' : extra}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (f, ms = 4000) => { const end = Date.now() + ms; while (Date.now() < end) { if (f()) return true; await sleep(25); } return !!f(); };
const io = { to: () => ({ emit: () => {} }), sockets: { adapter: { rooms: { get: () => ({ size: 1 }) } } } };
const CODE = /\b[pa]0\d\b/i;

async function play(label, { key, bad, mode = 'listen' }) {
  process.env.OPENAI_API_KEY = key ? 'test-key' : '';
  process.env.FAKE_MODEL = bad ? 'bad' : '';
  const room = { code: `C${label.length}${Date.now() % 1000}`, kind: 'quick', task: 'outing', autoStart: true };
  const t = new Table({ io, room, humans: [{ key: 'u1', name: 'PQIUS', userId: null, isGuest: true }], mode, taskId: 'outing', number: 1 });
  const [me, ari, kai] = t.players;
  me.limitId = 'no_hike'; ari.limitId = 'sun_am_busy'; kai.limitId = 'no_car'; // Kai gets carsick: bus or trolley only
  await t.start();
  t.ready('u1');
  const ck = (name, ok, extra) => check(`${label}: ${name}`, ok, extra);
  const aiLines = () => t.chat.filter((m) => ['chat', 'limit'].includes(m.kind) && t.byCode(m.from)?.isAI);
  const linesOf = (p) => aiLines().filter((m) => m.from === p.pcode).map((m) => m.text);
  const since = (id) => aiLines().filter((m) => m.id > id);
  // At an answer-only table words do not fill in the plan, so the person also taps what they said.
  const say = async (text, wait = 900, tap) => { const id = t.seq; t.say('u1', text); if (tap && mode === 'ask') t.pick('u1', ...tap); await sleep(wait); return id; };
  const row = (id) => t.panel().find((f) => f.id === id);

  ck('two AI players, named Ari and Kai', ari.short === 'Ari' && kai.short === 'Kai' && ari.name === 'Ari (AI)');
  await until(() => aiLines().length >= 2, 2500);
  const open = aiLines().map((m) => m.text);
  ck('both AI players say something when the chat opens, and not the same thing', open.length >= 2 && !sameMessage(open[0], open[1]) && !sameMessage(open[1], open[0]), JSON.stringify(open));
  ck('AI players do not settle a part by themselves', t.panel().every((f) => f.status !== 'agreed'), JSON.stringify(t.plan));

  let id = await say('what times work for you all?');
  await until(() => since(id).length >= 1);
  ck('"what times work for you all?" gets an answer about when', since(id).length >= 1 && (row('when').options.some((o) => o.who.some((c) => t.byCode(c).isAI)) || since(id).some((m) => /sunday|saturday|morning|afternoon/i.test(m.text))), JSON.stringify(since(id).map((m) => m.text)));

  id = await say('sunday afternoon is good', 900, ['when', 'sun_pm']);
  await until(() => row('when').status === 'agreed');
  ck('a part is settled once the person backs it', row('when').status === 'agreed' && t.plan.when === 'sun_pm');

  id = await say('tell me an exact hour');
  await until(() => since(id).length >= 1);
  ck('"tell me an exact hour" gets a clock time, not the settled option again', since(id).some((m) => /\b\d{1,2}(:\d\d)?\s*(am|pm)?\b/i.test(m.text)) && !since(id).some((m) => /^sunday afternoon works/i.test(m.text)), JSON.stringify(since(id).map((m) => m.text)));

  id = await say('i can pick you all up', 900, ['travel', 'carpool']);
  ck('"i can pick you all up" is read as carpool', t.prefs[me.pcode].travel === 'carpool');
  await until(() => t.prefs[kai.pcode].travel === 'transit' && kai.revealed, 5000);
  ck('Kai says once that it gets carsick and goes its own way', t.prefs[kai.pcode].travel === 'transit' && kai.revealed && linesOf(kai).some((x) => /carsick|bus|trolley/i.test(x)), JSON.stringify(linesOf(kai)));

  id = await say('let Kai travel by trolley and others can come in my car', 1200);
  ck('what is said about Kai is not counted as the writer\'s own pick', t.prefs[me.pcode].travel === 'carpool' && t.prefs[kai.pcode].travel === 'transit');
  await until(() => row('travel').status === 'agreed');
  ck('the plan records the split: Carpool, with Kai by bus or trolley', t.plan.travel === 'carpool' && t.ways.travel?.[kai.pcode] === 'transit', JSON.stringify([t.plan, t.ways]));
  ck('the listening AI does not claim the plan breaks the limit Kai shared', !t.chat.some((m) => m.from === 'AI' && /does not fit/.test(m.text)));
  ck('Kai\'s limit counts as respected with its own way', t.limitOf(kai).violates(t.planFor(kai, t.plan)) === false);

  id = await say('kai? respond?', 1200);
  await until(() => since(id).some((m) => m.from === kai.pcode));
  ck('calling on an AI player by name gets a reply from that player', since(id).some((m) => m.from === kai.pcode), JSON.stringify(since(id).map((m) => `${m.name}: ${m.text}`)));
  id = await say('a01 what do you think?', 1200);
  await until(() => since(id).some((m) => m.from === ari.pcode));
  ck('a player code typed by a person still reaches that AI player', since(id).some((m) => m.from === ari.pcode));

  t.pick('u1', 'where', 'cove'); t.pick('u1', 'budget', 'low');
  await until(() => !!t.plan.where && !!t.plan.budget, 5000);
  await until(() => t.chat.some((m) => m.kind === 'plan'), 3000);
  const card = t.chat.filter((m) => m.kind === 'plan').pop();
  ck('the plan card names who goes their own way', !!card && /Carpool \(Kai: Bus or trolley\)/.test(card.text) && card.ways?.travel?.[0]?.name === 'Kai', card?.text);

  // ----- the whole chat -----
  const texts = t.chat.filter((m) => !m.to && m.from !== me.pcode).map((m) => m.text);
  ck('no player code appears in anything the app or the AI players wrote', !texts.some((x) => CODE.test(x)), texts.filter((x) => CODE.test(x)).join(' | '));
  ck('no emoji or long dash in what AI players wrote', !aiLines().some((m) => /[—–]|\p{Extended_Pictographic}/u.test(m.text)));
  ck('AI player messages are short', aiLines().every((m) => m.text.length <= 150), JSON.stringify(aiLines().filter((m) => m.text.length > 150).map((m) => m.text)));
  for (const p of [ari, kai]) {
    const mine = linesOf(p);
    const dup = mine.find((x, i) => mine.slice(0, i).some((y) => sameMessage(x, y)));
    ck(`${p.short} never repeats itself`, !dup, `"${dup}" in ${JSON.stringify(mine)}`);
  }
  ck('no AI player says the plan is done while a part is open', !t.chat.some((m, i) => t.byCode(m.from)?.isAI && m.kind === 'chat' && /we'?re set|all set|sounds like a plan/i.test(m.text) && !t.chat.slice(0, i).some((x) => x.kind === 'plan')));
  const follow = t.chat.filter((m) => m.kind === 'pick' && m.follow);
  ck('AI players going along shows as one line, not one per player', !t.chat.some((m, i) => m.follow && t.chat[i - 1]?.follow) && follow.every((m) => !/\(AI\) is fine.*\(AI\) is fine/.test(m.text) || Object.keys(m.follow).length > 1), JSON.stringify(follow.map((m) => m.text)));
  const mine = t.viewFor('u1').chat;
  ck('"Me too" is never offered for a part the person already picked or that is settled', !mine.some((m) => (m.sup || []).some((x) => t.prefs[me.pcode][x.field] || row(x.field).status === 'agreed')));
  const run = (() => { let best = 0, n = 0; for (const m of t.chat) { if (m.to || !['chat', 'limit', 'question', 'pick'].includes(m.kind)) continue; const w = t.byCode(m.from); if (w && !w.isAI) n = 0; else if (w && m.kind !== 'pick') best = Math.max(best, ++n); } return best; })();
  ck('AI players never write more than three messages in a row', run <= 3, `${run} in a row`);

  t.accept('u1', true);
  await until(() => t.stage === 'done', 3000);
  ck('the plan locks and respects all three limits', t.outcome?.deal && t.outcome.respected === 3, JSON.stringify(t.outcome));
  ck('the locked plan keeps Kai\'s own way', t.deal?.ways?.travel?.[kai.pcode] === 'transit' && /Carpool \(Kai: Bus or trolley\)/.test(t.chat.filter((m) => m.kind === 'system').pop()?.text || ''));

  if (process.env.SHOW) { console.log(`\n----- ${label}: the chat -----`); for (const m of t.chat) console.log(`${m.to ? '(private) ' : ''}${m.kind.padEnd(8)} ${String(m.name).padEnd(10)} ${m.text}`); console.log(''); }
  return t;
}

// Two people who want different things, and one AI player: the AI player may not settle it for them.
async function twoPeople(label, { key }) {
  process.env.OPENAI_API_KEY = key ? 'test-key' : ''; process.env.FAKE_MODEL = '';
  const room = { code: `D${Date.now() % 100000}`, kind: 'quick', task: 'outing', autoStart: true };
  const t = new Table({ io, room, humans: [{ key: 'u1', name: 'Maya', userId: null, isGuest: true }, { key: 'u2', name: 'Dev', userId: null, isGuest: true }], mode: 'listen', taskId: 'outing', number: 1 });
  const [maya, dev, ari] = t.players;
  maya.limitId = 'budget15'; dev.limitId = 'no_hike'; ari.limitId = 'sun_am_busy';
  await t.start(); t.ready('u1'); t.ready('u2');
  const ck = (name, ok, extra) => check(`${label}: ${name}`, ok, extra);
  const row = (id) => t.panel().find((f) => f.id === id);
  const aiLines = () => t.chat.filter((m) => ['chat', 'limit'].includes(m.kind) && t.byCode(m.from)?.isAI);
  await until(() => aiLines().length >= 1, 2000);
  t.say('u1', 'old town for tacos sounds good'); await sleep(200);
  t.say('u2', 'i would rather do balboa park'); await sleep(1500);
  ck('two people who disagree: the part stays open, whatever the AI player said', row('where').status !== 'agreed' && !t.plan.where, JSON.stringify(row('where')));
  const devAt = t.chat.find((x) => x.from === dev.pcode).id;
  ck('the AI player does not take a side between them', !t.chat.some((m) => m.id > devAt && m.from === ari.pcode && /old town|balboa/i.test(m.text)) && !t.chat.some((m) => m.id > devAt && m.follow));
  t.say('u2', 'ok fine, old town works for me too'); await until(() => row('where').status === 'agreed', 3000);
  ck('once the people agree, the part is settled', t.plan.where === 'oldtown');
  // getting there: each their own way, with no majority among the people
  t.say('u1', 'i will take the trolley'); await sleep(200);
  t.say('u2', 'i am driving'); await until(() => row('travel').status === 'agreed', 4000);
  const tr = row('travel');
  ck('a personal part settles once everyone has said their way, even when they differ', tr.status === 'agreed' && tr.own.length === 1 && !!t.prefs[ari.pcode].travel, JSON.stringify(tr));
  ck('the plan lists who goes their own way', /\((Maya|Dev): (Bus or trolley|Carpool)\)/.test(t.planText(t.plan, t.ways)), t.planText(t.plan, t.ways));
  ck('differing ways to get there are not posted as a disagreement to resolve', !t.chat.some((m) => m.from === 'AI' && m.poll === 'travel' && /What would work for everyone/.test(m.text)));
  ck('no player code in the chat', !t.chat.some((m) => !m.to && CODE.test(m.text)));
  if (process.env.SHOW) { console.log(`\n----- ${label}: the chat -----`); for (const m of t.chat) console.log(`${m.to ? '(private) ' : ''}${m.kind.padEnd(8)} ${String(m.name).padEnd(10)} ${m.text}`); console.log(''); }
  t.hostAdvance();
}

// A person who says almost nothing: AI players keep things moving without taking over the chat.
async function quiet(label) {
  process.env.OPENAI_API_KEY = ''; process.env.FAKE_MODEL = '';
  const room = { code: `Q${Date.now() % 100000}`, kind: 'quick', task: 'outing', autoStart: true };
  const t = new Table({ io, room, humans: [{ key: 'u1', name: 'Sam', userId: null, isGuest: true }], mode: 'ask', taskId: 'outing', number: 1 });
  await t.start(); t.ready('u1');
  const ck = (name, ok, extra) => check(`${label}: ${name}`, ok, extra);
  await sleep(1200);
  t.say('u1', 'hi');
  await sleep(6000); // two and a half minutes of chat time
  const ai = t.chat.filter((m) => ['chat', 'limit'].includes(m.kind) && t.byCode(m.from)?.isAI);
  const after = ai.filter((m) => m.id > t.chat.find((x) => x.text === 'hi').id);
  ck('AI players nudge a quiet chat', after.length >= 1, JSON.stringify(ai.map((m) => m.text)));
  ck('but never more than three messages in a row', after.length <= 3, JSON.stringify(after.map((m) => m.text)));
  ck('and nothing is settled without the person', t.panel().every((f) => f.status !== 'agreed'));
  if (process.env.SHOW) { console.log(`\n----- ${label}: the chat -----`); for (const m of t.chat) console.log(`${m.kind.padEnd(8)} ${String(m.name).padEnd(10)} ${m.text}`); console.log(''); }
  t.hostAdvance();
}

// A person who wants what an AI player's limit rules out, for a part the whole group shares.
async function clash(label) {
  process.env.OPENAI_API_KEY = ''; process.env.FAKE_MODEL = '';
  const room = { code: `K${Date.now() % 100000}`, kind: 'quick', task: 'outing', autoStart: true };
  const t = new Table({ io, room, humans: [{ key: 'u1', name: 'Sam', userId: null, isGuest: true }], mode: 'listen', taskId: 'outing', number: 1 });
  const [sam, ari, kai] = t.players;
  sam.limitId = 'no_hike'; ari.limitId = 'works_sat'; kai.limitId = 'budget15';
  await t.start(); t.ready('u1');
  const ck = (name, ok, extra) => check(`${label}: ${name}`, ok, extra);
  await sleep(900);
  t.say('u1', 'saturday morning works best for me');
  await until(() => ari.revealed, 4000);
  const mine = () => t.chat.filter((m) => m.from === ari.pcode && ['chat', 'limit'].includes(m.kind)).map((m) => m.text);
  ck('the AI player whose limit is in the way says so, once, with another option', ari.revealed && mine().filter((x) => /saturday/i.test(x)).length === 1, JSON.stringify(mine()));
  await until(() => t.plan.when === 'sat_am', 4000);
  await until(() => t.chat.some((m) => m.from === 'AI' && /does not fit what Ari shared/.test(m.text)), 4000);
  ck('the listening AI speaks up for the limit the AI player shared, by first name', t.chat.some((m) => m.from === 'AI' && /does not fit what Ari shared/.test(m.text)), JSON.stringify(t.plan));
  const n = mine().length;
  t.say('u1', 'saturday morning please'); await sleep(1200);
  t.say('u1', 'saturday morning it is'); await sleep(1200);
  ck('the AI player objects at most once more, and does not nag', mine().length <= n + 1, JSON.stringify(mine()));
  ck('the AI player keeps to its limit: it never picks Saturday', !['sat_am', 'sat_pm'].includes(t.prefs[ari.pcode]?.when));
  if (process.env.SHOW) { console.log(`\n----- ${label}: the chat -----`); for (const m of t.chat) console.log(`${m.to ? '(private) ' : ''}${m.kind.padEnd(8)} ${String(m.name).padEnd(10)} ${m.text}`); console.log(''); }
  t.hostAdvance();
}

// The beach house: everyone knows basic facts about themselves, and the AI posts who owes what and takes payments.
async function beach(label, { mode, key }) {
  process.env.OPENAI_API_KEY = key ? 'test-key' : ''; process.env.FAKE_MODEL = '';
  const room = { code: `B${Date.now() % 100000}`, kind: 'quick', task: 'beachhouse', autoStart: true };
  const t = new Table({ io, room, humans: [{ key: 'u1', name: 'Maya', userId: null, isGuest: true }], mode, taskId: 'beachhouse', number: 1 });
  const [maya, ari, kai] = t.players;
  maya.limitId = 'cash_risk'; ari.limitId = 'one_night'; kai.limitId = 'no_venmo';
  await t.start(); t.ready('u1');
  const ck = (name, ok, extra) => check(`${label}: ${name}`, ok, extra);
  const v = t.viewFor('u1');
  ck('the person gets basic facts about themselves and the scenario', v.me.facts.length >= 3 && v.task.info.length >= 1 && v.me.facts.some((f) => /found the house/.test(f.text)), JSON.stringify(v.me.facts));
  await sleep(900);
  const id = t.seq; t.say('u1', 'ari and kai, how many nights did you stay?');
  await until(() => [ari, kai].every((x) => t.chat.some((m) => m.id > id && m.from === x.pcode && /night|friday|saturday/i.test(m.text))), 5000);
  const ans = t.chat.filter((m) => m.id > id && t.byCode(m.from)?.isAI);
  ck('both AI players answer from their facts', ans.some((m) => m.from === ari.pcode && /saturday|one night|1 night/i.test(m.text)) && ans.some((m) => m.from === kai.pcode && /both nights|friday/i.test(m.text)), JSON.stringify(ans.map((m) => `${m.name}: ${m.text}`)));
  ck('a fact that gives a limit away counts as sharing it', ari.limitSharedAt !== null);
  for (const [f, o] of [['split', 'nights'], ['app', 'zelle'], ['payer', 'one'], ['groceries', 'shared']]) t.pick('u1', f, o);
  await until(() => planComplete(), 5000);
  function planComplete() { return ['split', 'app', 'payer', 'groceries'].every((f) => t.plan[f]); }
  if (mode === 'ask') t.say('u1', '@ai who owes what?');
  await until(() => t.bills.length > 0, 5000);
  const b = t.bills[0];
  ck('the AI posts who owes what once the plan is set', !!b && b.rows.length === 2 && b.method === 'zelle', JSON.stringify(b?.rows));
  const ariRow = b?.rows.find((r) => r.pcode === ari.pcode), kaiRow = b?.rows.find((r) => r.pcode === kai.pcode);
  ck('split by nights: one night costs half of two nights', ariRow && kaiRow && Math.abs(kaiRow.amount - 40 - 2 * (ariRow.amount - 40)) < 0.02, JSON.stringify(b?.rows));
  ck('Maya found the house, so the others pay her back', b?.rows.every((r) => r.to === maya.pcode));
  await until(() => b.status === 'settled', 5000);
  ck('AI players pay their share, and the AI says when everyone has paid', b.status === 'settled' && t.chat.some((m) => /Everyone has paid/.test(m.text)));
  const view = t.viewFor('u1').bills[0];
  ck('the bill view names people and marks payments', view.rows.every((r) => r.paid === 'zelle' && r.toMe && r.name && !/^A0/.test(r.name)));
  if (process.env.SHOW) { console.log(`\n----- ${label}: the chat -----`); for (const m of t.chat) console.log(`${m.to ? '(private) ' : ''}${m.kind.padEnd(8)} ${String(m.name).padEnd(10)} ${m.text}`); console.log(''); }
  t.hostAdvance();
}
// A person paying through the AI, and a bill the model writes for a scenario without a built-in bill.
async function payByPerson(label) {
  process.env.OPENAI_API_KEY = ''; process.env.FAKE_MODEL = '';
  const room = { code: `P${Date.now() % 100000}`, kind: 'quick', task: 'beachhouse', autoStart: true };
  const t = new Table({ io, room, humans: [{ key: 'u1', name: 'Maya', userId: null, isGuest: true }, { key: 'u2', name: 'Dev', userId: null, isGuest: true }], mode: 'listen', taskId: 'beachhouse', number: 1 });
  const [maya, dev] = t.players;
  maya.limitId = 'no_venmo'; dev.limitId = 'cash_risk';
  await t.start(); t.ready('u1'); t.ready('u2');
  const ck = (name, ok, extra) => check(`${label}: ${name}`, ok, extra);
  for (const k of ['u1', 'u2']) for (const [f, o] of [['split', 'even'], ['app', 'venmo'], ['payer', 'each'], ['groceries', 'own']]) t.pick(k, f, o);
  await until(() => t.bills.length > 0, 5000);
  const b = t.bills[0];
  ck('paying each the house owner: everyone owes the owner $600 split evenly', b && b.rows.length === 3 && b.rows.every((r) => r.to === 'host' && r.amount === 200), JSON.stringify(b?.rows));
  const mine = b.rows.find((r) => r.pcode === dev.pcode);
  t.payBill('u2', b.id, mine.id, 'zelle');
  ck('a person pays through the AI with the method the plan says, and gets a private receipt', b.paid[mine.id]?.method === 'venmo' && t.chat.some((m) => m.to === 'u2' && /you paid \$200\.00 to the house owner with Venmo/.test(m.text)));
  ck('others do not see that receipt', !t.viewFor('u1').chat.some((m) => /you paid/.test(m.text)));
  t.pick('u1', 'groceries', 'shared'); t.pick('u2', 'groceries', 'shared');
  await sleep(300);
  ck('a change to the plan marks the bill out of date', b.status === 'stale');
  t.hostAdvance();
}

// The plan board: options people add, availability, reactions, tasks, a menu and its bill.
async function boardOps(label) {
  process.env.OPENAI_API_KEY = ''; process.env.FAKE_MODEL = ''; process.env.PLACES_FAKE = '1';
  const room = { code: `G${Date.now() % 100000}`, kind: 'quick', task: 'dinner', autoStart: true };
  const t = new Table({ io, room, humans: [{ key: 'u1', name: 'Maya', userId: null, isGuest: true }, { key: 'u2', name: 'Dev', userId: null, isGuest: true }], mode: 'listen', taskId: 'dinner', number: 1 });
  const [maya, dev] = t.players;
  await t.start(); t.ready('u1'); t.ready('u2');
  const ck = (name, ok, extra) => check(`${label}: ${name}`, ok, extra);
  ck('each table has its own copy of the options', t.task.fields !== (await import('../server/tasks.js')).taskById('dinner').fields);
  const r = t.addOption('u1', 'when', 'Thursday 7 pm');
  ck('a person adds their own time, and it is their pick', r.ok && t.prefs[maya.pcode].when === r.id && t.task.fields.find((f) => f.id === 'when').options.length === 4);
  ck('another table does not see it', (await import('../server/tasks.js')).taskById('dinner').fields.find((f) => f.id === 'when').options.length === 3);
  t.setAvail('u2', 'when', 'fri8', 'yes'); t.setAvail('u2', 'when', r.id, 'yes');
  ck('availability: Dev said yes to two times and gets the one more people can make', t.prefs[dev.pcode].when === r.id, JSON.stringify(t.prefs[dev.pcode]));
  ck('the time part is settled once both pick it', t.panel().find((f) => f.id === 'when').status === 'agreed');
  const places = await t.findPlaces('tacos');
  const p2 = t.addOption('u2', 'where', places[0].name, places[0]);
  ck('a real place found by search becomes an option on the map', p2.ok && t.boardView(maya).places.some((x) => x.id === p2.id && x.address));
  t.say('u1', 'ramen in hillcrest sounds good'); await sleep(50);
  const msg = t.chat.find((m) => m.text === 'ramen in hillcrest sounds good');
  ck('the AI shows what it saved from a message', msg.saved?.[0] === 'Maya → Ramen in Hillcrest', JSON.stringify(msg.saved));
  t.react('u2', msg.id, '👍');
  ck('reactions show who reacted', t.viewFor('u1').chat.find((m) => m.id === msg.id).reacts?.[0]?.who[0] === 'Dev');
  t.todo('u1', 'add', { text: 'Book a table' }); const td = t.todos[0];
  t.todo('u2', 'claim', { id: td.id }); t.todo('u2', 'toggle', { id: td.id });
  ck('a shared task: added, claimed and done by different people', td.owner === dev.pcode && td.done && t.boardView(maya).todos[0].ownerName === 'Dev');
  await t.openMenu('u1', 'hillcrest');
  const menu = t.menus.hillcrest;
  ck('a restaurant gets a menu (a marked sample without a key)', menu.items.length >= 5 && menu.sample);
  t.order('u2', 'hillcrest', 'i0', 1); t.order('u2', 'hillcrest', 'i3', 1); t.order('u1', 'hillcrest', 'i1', 1);
  t.menuBill('u1', 'hillcrest');
  const bill = t.bills.at(-1);
  const devSub = menu.items[0].price + menu.items[3].price;
  ck('splitting the menu: Dev owes Maya his order plus 20%', bill && bill.rows.length === 1 && bill.rows[0].to === maya.pcode && Math.abs(bill.rows[0].amount - devSub * 1.2) < 0.02, JSON.stringify(bill?.rows));
  ck('the board keeps a history of changes', t.boardView(maya).changes >= 6);
  ck('nothing on the board shows a player code', !/"name":"[PA]0\d"/.test(JSON.stringify(t.boardView(maya))));
  t.hostAdvance();
}

async function artifacts(label) {
  process.env.OPENAI_API_KEY = ''; process.env.FAKE_MODEL = ''; process.env.WEATHER_FAKE = '1';
  const ck = (name, ok, extra) => check(`${label}: ${name}`, ok, extra);
  // an outdoor plan: weather, the day, who brings what, agreements
  const room = { code: `W${Date.now() % 100000}`, kind: 'quick', task: 'outing', autoStart: true };
  const t = new Table({ io, room, humans: [{ key: 'u1', name: 'Maya', userId: null, isGuest: true }, { key: 'u2', name: 'Dev', userId: null, isGuest: true }], mode: 'listen', taskId: 'outing', number: 1 });
  const [maya, dev] = t.players;
  await t.start(); t.ready('u1'); t.ready('u2');
  for (const [f, o] of [['where', 'cove'], ['when', 'sun_pm'], ['travel', 'transit']]) { t.pick('u1', f, o); t.pick('u2', f, o); }
  await until(() => t.weather && !t.weather.loading);
  const v = t.boardView(maya);
  ck('the plan has a date: the next Sunday, in the afternoon', v.when?.dayName === 'Sunday' && v.when.minutes === 14 * 60 && v.when.daysAway >= 1 && v.when.daysAway <= 7, JSON.stringify(v.when));
  ck('the weather for the cove that afternoon', v.weather?.temp !== null && v.weather.place === 'La Jolla Cove' && v.weather.hours.some((x) => x.h === 14) && ['clear', 'partly', 'cloud', 'fog', 'rain', 'storm'].includes(v.weather.sky), JSON.stringify(v.weather));
  const it = v.itin;
  ck('the day: meet, bus there, the cove, back', it && it.stops.map((x) => x.kind).join() === 'meet,leg,main,leg,end' && /Bus or trolley to La Jolla Cove/.test(it.stops[1].title) && it.stops[2].label === '2 pm', JSON.stringify(it?.stops));
  t.itinerary('u2', 'shift', { delta: 1 });
  ck('moving the day 15 minutes later moves every stop', t.boardView(maya).itin.stops[2].label === '2:15 pm' && t.itin.edited);
  t.itinerary('u1', 'add', { title: 'Boba after' });
  ck('adding a stop puts it before getting back to campus', t.boardView(maya).itin.stops.at(-2).title === 'Boba after');
  t.pick('u1', 'when', 'sat_am'); t.pick('u2', 'when', 'sat_am');
  ck('an edited day stays as the group made it when the plan changes', t.itin.stops.some((x) => x.title === 'Boba after'));
  t.itinerary('u1', 'reset');
  ck('rebuilding the day follows the new plan', t.boardView(maya).itin.stops[2].label === '10 am' && !t.itin.edited, JSON.stringify(t.boardView(maya).itin.stops[2]));
  ck('who brings what starts with the usual things for an outing', v.bring.length >= 4 && v.bring.every((x) => !x.owner));
  const water = t.bring.find((x) => x.name === 'Water');
  t.bringItem('u2', 'claim', { id: water.id }); t.bringItem('u1', 'add', { name: 'Tide pool shoes', mine: true });
  const bv = t.boardView(maya).bring;
  ck('claiming and adding things: names and seat colors come along', bv.find((x) => x.name === 'Water').owner === 'Dev' && bv.find((x) => x.name === 'Tide pool shoes').mine && bv.find((x) => x.name === 'Water').seat === dev.color);
  t.agreement('u1', 'add', { text: 'We split the bus fare evenly' });
  const g1 = t.agreements[0];
  ck('an agreement starts with the writer stamped', g1.stamps.length === 1 && g1.stamps[0] === maya.pcode);
  t.agreement('u2', 'stamp', { id: g1.id });
  ck('everyone stamps it', t.boardView(dev).agreements[0].stamps.length === 2 && t.boardView(dev).agreements[0].mine);
  ck('the hours card shows the cove as open all day', t.boardView(maya).hours.cove?.always === true);
  ck('nothing on the board shows a player code', !/"(name|owner|byName)":"[PA]0\d"/.test(JSON.stringify(t.boardView(maya))));
  t.hostAdvance();
  // a place that is closed at the planned time
  const room2 = { code: `H${Date.now() % 100000}`, kind: 'quick', task: 'dinner', autoStart: true };
  const d = new Table({ io, room: room2, humans: [{ key: 'v1', name: 'Ana', userId: null, isGuest: true }, { key: 'v2', name: 'Kai', userId: null, isGuest: true }], mode: 'listen', taskId: 'dinner', number: 1 });
  await d.start(); d.ready('v1'); d.ready('v2');
  d.pick('v1', 'where', 'pricecenter'); d.pick('v2', 'where', 'pricecenter');
  d.pick('v1', 'when', 'sat7'); d.pick('v2', 'when', 'sat7');
  await until(() => d.chat.some((m) => /closed on Saturday at 7 pm/.test(m.text)));
  const warn = d.chat.find((m) => /closed on Saturday at 7 pm/.test(m.text));
  ck('the AI says once that the food court is usually closed then', warn && /usually/.test(warn.text) && warn.board === 'hours', warn?.text);
  d.say('v1', 'ok noted'); await sleep(30);
  ck('only once', d.chat.filter((m) => /closed on Saturday/.test(m.text)).length === 1);
  ck('weather stays off for an indoor plan until asked', d.boardView(d.players[0]).weatherOn === false);
  d.wantWeather('v2');
  await until(() => d.weather && !d.weather.loading);
  ck('asking for the weather turns it on', d.boardView(d.players[0]).weather?.temp !== null && d.boardView(d.players[0]).weatherOn);
  d.hostAdvance();
  // an answer-only table never gets the heads-up
  const room3 = { code: `J${Date.now() % 100000}`, kind: 'quick', task: 'dinner', autoStart: true };
  const a = new Table({ io, room: room3, humans: [{ key: 'w1', name: 'Bo', userId: null, isGuest: true }, { key: 'w2', name: 'Li', userId: null, isGuest: true }], mode: 'ask', taskId: 'dinner', number: 1 });
  await a.start(); a.ready('w1'); a.ready('w2');
  for (const k of ['w1', 'w2']) { a.pick(k, 'where', 'pricecenter'); a.pick(k, 'when', 'sat7'); }
  await sleep(200);
  ck('answer-only: no heads-up, but the hours card still shows it closed', !a.chat.some((m) => /closed on/.test(m.text)) && a.boardView(a.players[0]).hours.pricecenter?.week?.[6]?.[1] === 18 * 60);
  a.hostAdvance();
  delete process.env.WEATHER_FAKE;
}

try {
  await boardOps('board');
  await artifacts('artifacts');
  await beach('beach house, listening', { mode: 'listen' });
  await beach('beach house, answer-only', { mode: 'ask' });
  await beach('beach house, model', { mode: 'listen', key: true });
  await payByPerson('paying');
  await twoPeople('two people, scripted', { key: false });
  await twoPeople('two people, model', { key: true });
  await quiet('quiet person');
  await clash('clash with an AI player');
  await play('scripted', { key: false });
  await play('model', { key: true });
  await play('bad model', { key: true, bad: true });
  await play('answer-only table', { key: false, mode: 'ask' });
} catch (e) { console.error(e); results.push(false); }
await sleep(300);
await pg.stop();
const failed = results.filter((x) => !x).length;
console.log(failed ? `${failed} of ${results.length} conversation checks failed` : `All ${results.length} conversation checks passed.`);
process.exit(failed ? 1 : 0);
