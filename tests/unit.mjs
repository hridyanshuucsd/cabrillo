// Fast checks of the pure logic: how the chat is read, and how model replies are parsed. Run: node tests/unit.mjs
import { applyMessage, statesWish, topicOf } from '../server/listener.js';
import { taskById } from '../server/tasks.js';
import { parseAnswer, jsonObjects } from '../server/ai.js';
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

const failed = results.filter((x) => !x).length;
console.log(failed ? `${failed} of ${results.length} unit checks failed` : `All ${results.length} unit checks passed.`);
process.exit(failed ? 1 : 0);
