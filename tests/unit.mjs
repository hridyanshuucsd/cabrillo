// Fast checks of the pure logic: how the chat is read, and how model replies are parsed. Run: node tests/unit.mjs
process.env.DATABASE_URL ||= 'postgres://unused@localhost:1/unused'; // game.js needs one to load; these checks never connect
import { applyMessage, statesWish, topicOf, buildPanel, sameMessage } from '../server/listener.js';
import { taskById } from '../server/tasks.js';
import { parseAnswer, jsonObjects, cleanBlocks } from '../server/ai.js';
const results = [];
const check = (name, ok, extra = '') => { results.push(!!ok); if (!ok) console.log(`FAIL  ${name} ${extra}`); };
const t = taskById('outing');
const read = (text, start = {}) => { const prefs = { P1: { ...start } }; const ch = applyMessage(t, prefs, 'P1', text); return { prefs: prefs.P1, kinds: ch.map((c) => `${c.option}:${c.kind}`) }; };

// wishes and what is not a wish
for (const [text, want] of [
  ['Old Town for tacos sounds good', { where: 'oldtown' }],
  ['how about Old Town?', { where: 'oldtown' }],
  ['Old Town?', { where: 'oldtown' }],
  ['should we take an uber?', { travel: 'rideshare' }],
  ['maybe sunday afternoon?', { when: 'sun_pm' }],
  ['what if we do balboa park', { where: 'balboa' }],
  ['if it is cheap i am down for old town', { budget: 'low', where: 'oldtown' }],
  ['if we take an uber and it costs 26 dollars, what does each of us pay?', {}],
  ['is old town far?', {}],
  ['how much is an uber to balboa park?', {}],
  ['how do we get to la jolla cove by bus', {}],
  ['where should we meet guys?', {}],
  ['okay, what time tho?', {}],
  ['I can only take the bus or trolley', { travel: 'transit' }],
]) { const r = read(text); check(`reads "${text}"`, JSON.stringify(r.prefs) === JSON.stringify(want), JSON.stringify(r)); }
// refusals
check('practice on Sunday mornings is a refusal', read('I have practice on Sunday mornings, so not then.', { when: 'sun_pm' }).prefs.when === 'sun_pm');
check('"a hike is out for me" drops a hike pick', !read('I hurt my ankle last week, so a hike is out for me.', { where: 'torrey' }).prefs.where);
check('a question about time is about When', topicOf(t, 'okay, what time tho?') === 'when');
check('a statement is not a question to the group', topicOf(t, 'I love Old Town') === null);
check('statesWish: plain statement', statesWish('sunday works for me'));

// whole words only, and what is said about someone else
for (const [text, want] of [
  ["i'm busy on saturday", {}],                       // "busy" is not "bus"
  ['max $100 for me', {}],                            // "$100" is not "$10"
  ['i can pick you all up', { travel: 'carpool' }],
  ['i have a car', { travel: 'carpool' }],
  ["i don't have a car", {}],
  ['we can get there by buses', { travel: 'transit' }],
  ['what times work for you all?', {}],
]) { const r = read(text); check(`reads "${text}"`, JSON.stringify(r.prefs) === JSON.stringify(want), JSON.stringify(r)); }
const people = [{ pcode: 'A2', names: ['kai'] }, { pcode: 'P2', names: ['maya'] }];
const about = (text) => { const prefs = { P1: {} }; const ch = applyMessage(t, prefs, 'P1', text, people); return { mine: prefs.P1, about: ch.filter((c) => c.kind === 'about_other').map((c) => `${c.about}:${c.option}`) }; };
let r2 = about('let Kai travel by trolley and others can come in my car');
check('"let Kai travel by trolley and others can come in my car"', r2.mine.travel === 'carpool' && r2.about.join() === 'A2:transit', JSON.stringify(r2));
r2 = about("i'll drive and maya can take the bus");
check('"i\'ll drive and maya can take the bus"', r2.mine.travel === 'carpool' && r2.about.join() === 'P2:transit', JSON.stringify(r2));
check('"me and kai will take the trolley" includes the writer', about('me and kai will take the trolley').mine.travel === 'transit');
check('"kai is right, the bus is easiest" is the writer agreeing', about('kai is right, the bus is easiest').mine.travel === 'transit');
check('a request is a question about its part', topicOf(t, 'tell me an exact hour') === 'when' && topicOf(t, 'what times work for you all?') === 'when');
check('sameMessage spots a reworded repeat', sameMessage('sunday afternoon works for me', 'sunday afternoon? saturdays i work') && !sameMessage('2 pm?', 'sunday afternoon works'));
// AI players never settle a part or break a tie between people
const seats = [{ pcode: 'P1' }, { pcode: 'A1', isAI: true }, { pcode: 'A2', isAI: true }];
check('two AI players alone do not settle a part', buildPanel(t, { A1: { when: 'sun_pm' }, A2: { when: 'sun_pm' } }, seats)[1].status === 'leaning');
check('a person plus an AI player do', buildPanel(t, { P1: { when: 'sun_pm' }, A2: { when: 'sun_pm' } }, seats)[1].status === 'agreed');
const two = [{ pcode: 'P1' }, { pcode: 'P2' }, { pcode: 'A1', isAI: true }];
check('an AI player does not break a tie between two people', buildPanel(t, { P1: { where: 'cove' }, P2: { where: 'balboa' }, A1: { where: 'cove' } }, two)[0].status !== 'agreed');
const tr = buildPanel(t, { P1: { travel: 'carpool' }, A1: { travel: 'carpool' }, A2: { travel: 'transit' } }, seats)[2];
check('getting there: the one who differs goes their own way', tr.status === 'agreed' && tr.leader === 'carpool' && tr.own.length === 1 && tr.own[0].pcode === 'A2');

// facts: every fact has at least 4 versions, a limit's version differs from all of them, and nobody at a table shares one
import('../server/facts.js');
const { FACTS } = await import('../server/facts.js');
const { TASKS } = await import('../server/tasks.js');
for (const [id, defs] of Object.entries(FACTS)) {
  check(`facts for ${id} belong to a scenario`, !!TASKS[id]);
  for (const d of defs) {
    const texts = d.values.map((v) => (typeof v === 'string' ? v : v.text));
    check(`${id}.${d.id} has 4 different versions`, new Set(texts).size >= 4, JSON.stringify(texts));
    for (const [lim, v] of Object.entries(d.byLimit || {})) {
      check(`${id}.${d.id}: the version for ${lim} is a real limit and differs from the others`, TASKS[id].limits.some((l) => l.id === lim) && !texts.includes(typeof v === 'string' ? v : v.text));
    }
  }
}
check('every scenario has facts', Object.keys(TASKS).every((id) => FACTS[id]));
{
  const { Table } = await import('../server/game.js');
  const io = { to: () => ({ emit: () => {} }), sockets: { adapter: { rooms: { get: () => ({ size: 1 }) } } } };
  let clash = [];
  for (const id of Object.keys(TASKS)) for (let k = 0; k < 15; k++) {
    const t = new Table({ io, room: { code: 'U', kind: 'class', task: id }, humans: [1, 2, 3, 4].map((i) => ({ key: `u${i}`, name: `P${i}x` })), mode: 'listen', taskId: id, number: 1 });
    for (const d of t.factDefs) { const texts = t.players.map((p) => t.fact(p, d.id).text); if (new Set(texts).size !== texts.length) clash.push(`${id}.${d.id}: ${texts.join(' / ')}`); }
  }
  check('at a table of 4, nobody shares a fact (20 scenarios, 15 deals each)', !clash.length, clash.slice(0, 3).join(' | '));
}

// model replies
const list = { type: 'list', title: 'What to bring', items: ['Water', 'Sunscreen'] };
let a = parseAnswer(JSON.stringify({ text: 'Here is a list.', blocks: [list] }), t);
check('a proper JSON reply', a.text === 'Here is a list.' && a.blocks.length === 1 && a.blocks[0].type === 'list');
a = parseAnswer(`For Balboa Park, here are some useful things to bring. ${JSON.stringify(list)}`, t);
check('a sentence followed by a bare block', a.text === 'For Balboa Park, here are some useful things to bring.' && a.blocks[0]?.items.length === 2, JSON.stringify(a));
a = parseAnswer('```json\n{"text": "Fenced.", "blocks": []}\n```', t);
check('a fenced JSON reply', a.text === 'Fenced.' && !a.blocks.length);
a = parseAnswer('Just a plain sentence with no JSON.', t);
check('a plain text reply', a.text === 'Just a plain sentence with no JSON.' && !a.blocks.length);
a = parseAnswer(`Two blocks follow. ${JSON.stringify(list)} ${JSON.stringify({ type: 'pick', field: 'when' })}`, t);
check('two bare blocks', a.blocks.length === 2 && a.blocks[1].type === 'pick' && !/[{}]/.test(a.text), JSON.stringify(a));
a = parseAnswer('{"text": "Broken', t);
check('broken JSON never shows braces as an answer', !a.blocks.length && typeof a.text === 'string');
a = parseAnswer(JSON.stringify({ text: 'x', blocks: [{ type: 'pick', field: 'nope' }, { type: 'table', columns: ['A'], rows: [['1'], ['2']] }, { type: 'evil', html: '<script>' }] }), t);
check('unknown blocks and unknown plan parts are dropped', a.blocks.length === 1 && a.blocks[0].type === 'table');
check('jsonObjects handles braces inside strings', jsonObjects('{"a": "x } y"} tail {"b": 1}').length === 2);

// ---------- board artifacts ----------
{
  const A = await import('../server/artifacts.js');
  check('hour of "Friday at 8 pm"', A.hourOf('Friday at 8 pm') === 20 * 60 && A.hourOf('Sunday afternoon') === 14 * 60 && A.hourOf('Thursday 7:30 pm') === 19 * 60 + 30);
  const w = A.planWhen(['La Jolla Cove', 'Sunday morning']);
  check('plan date: the next Sunday, never today', w.dayName === 'Sunday' && w.daysAway >= 1 && w.daysAway <= 7 && /^\d{4}-\d\d-\d\d$/.test(w.date) && new Date(`${w.date}T12:00:00Z`).getUTCDay() === 0, JSON.stringify(w));
  check('no day named, no date', A.planWhen(['Carpool', 'Under $15']) === null);
  const fc = A.typicalHours('Price Center food court');
  check('typical hours: the food court is closed Saturday at 7 pm', A.openAt(fc, 6, 19 * 60).open === false && A.openAt(fc, 1, 12 * 60).open === true);
  check('typical hours: the beach is always open, a barbecue place is a restaurant', A.typicalHours('La Jolla Cove').always && A.typicalHours('Korean barbecue on Convoy Street').kind === 'Restaurant');
  const ph = A.parseHours({ kind: 'Bar', hours: { sun: 'closed', mon: '16:00-23:00', tue: '4pm-11pm', wed: '16:00-02:00', thu: '', fri: '12:00-01:00', sat: '12:00-01:00' } });
  check('hours from the web: closed days, pm times, past midnight', ph.days[0] === null && ph.days[1][0] === 960 && ph.days[2][0] === 960 && ph.days[3][1] === 26 * 60 && ph.days[4] === null && A.openAt(ph, 5, 24 * 60 + 30).open === true, JSON.stringify(ph.days));
  check('weather codes', A.sky(0) === 'clear' && A.sky(2) === 'partly' && A.sky(45) === 'fog' && A.sky(61) === 'rain' && A.sky(95) === 'storm');
  const blocks = cleanBlocks([{ type: 'bring', items: ['Water', ''] }, { type: 'agree', items: ['We split gas'] }, { type: 'weather' }], t);
  check('model blocks: bring and agree (at most two blocks)', blocks.length === 2 && blocks[0].items.join() === 'Water' && blocks[1].type === 'agree');
}

// ---------- second set ----------
{
  const E = await import('../server/extras.js');
  check('car seats from a fact', E.seatsFromFact('You have a car with room for 4 people.') === 3 && E.seatsFromFact('You have a small car with room for 1 more person.') === 1 && E.seatsFromFact('You do not have a car, but you have a bike.') === 0);
  const d = taskById('dinner');
  check('budget ranges from option names', JSON.stringify(E.budgetRange(d, { budget: 'mid' })) === JSON.stringify({ lo: 15, hi: 30, name: '$15 to $30', total: false }) && E.budgetRange(d, { budget: 'high' }).hi === null && E.budgetRange(taskById('event'), { budget: 'under50' }).total);
  check('every scenario with costs gives a number per person', ['outing', 'dinner', 'trip', 'birthday', 'concert', 'potluck', 'volunteer', 'cleanup', 'gaming', 'study', 'moving', 'sports', 'anniversary', 'roommates', 'housing'].every((id) => {
    const tk = taskById(id); const plan = Object.fromEntries(tk.fields.map((f) => [f.id, f.options[0].id])); const c = E.costFor(tk, plan, 4); return c === null || (Number.isFinite(c.total) && c.items.every((x) => x.label && Number.isFinite(x.amount)));
  }));
  check('room slots stay inside the day', E.roomSlots(taskById('study'), { when: 'mon', length: 'h3' }).every((o) => /Monday/.test(o.name)));
}

const failed = results.filter((x) => !x).length;
console.log(failed ? `${failed} of ${results.length} unit checks failed` : `All ${results.length} unit checks passed.`);
process.exit(failed ? 1 : 0);
