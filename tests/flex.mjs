// The changes from the Nov 25 feedback, checked against the game logic directly (no browser):
// a person starts the chat, parts of the plan show up as people bring them up, flexible wishes ("Friday or
// Saturday", "I'm flexible", "$30 if needed"), private nudges with one-tap answers for quiet people, ideas when the
// group is stuck, and the three AI styles. Run: node tests/flex.mjs
import { startLocalDb } from '../scripts/localdb.js';

const { pg, url } = await startLocalDb({ dir: '.flexdb', port: 5446, fresh: true });
process.env.DATABASE_URL = url;
process.env.TIME_SCALE = '0.02';
process.env.AI_SUMMARY = 'off';
process.env.ROUTING = 'off';
process.env.ANTHROPIC_API_KEY = ''; process.env.OPENAI_API_KEY = ''; process.env.AI_MODEL = '';
const { migrate } = await import('../server/db.js');
const { Table } = await import('../server/game.js');
const { readFlex } = await import('../server/flex.js');
const { taskById } = await import('../server/tasks.js');
await migrate();

const results = [];
const check = (name, ok, extra = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${ok ? '' : extra}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (f, ms = 4000) => { const end = Date.now() + ms; while (Date.now() < end) { if (f()) return true; await sleep(25); } return !!f(); };
const io = { to: () => ({ emit: () => {} }), sockets: { adapter: { rooms: { get: () => ({ size: 1 }) } } } };

// ---------- reading flexible wishes ----------
const dinner = taskById('dinner');
const r1 = readFlex(dinner, 'friday at 8 or saturday both work for me');
check('"Friday at 8 or Saturday" names two times as fine', JSON.stringify(r1.multi) === JSON.stringify({ when: ['fri8', 'sat7'] }), JSON.stringify(r1));
const r2 = readFlex(dinner, 'I could do $25 if needed');
check('"$25 if needed" is fine if needed, not a first choice', r2.stretch.length === 1 && r2.stretch[0].option === 'mid', JSON.stringify(r2));
const r3 = readFlex(dinner, "I'm flexible on the budget");
check('"I\'m flexible on the budget" is flexible on the budget', r3.flex.join() === 'budget', JSON.stringify(r3));
const r4 = readFlex(dinner, 'honestly whatever works for you guys');
check('"whatever works" without a part is flexible on the part being discussed', r4.flex.join() === '*', JSON.stringify(r4));
const r5 = readFlex(dinner, 'I am not flexible on the budget');
check('"not flexible" is firm, not flexible', r5.rigid.join() === 'budget' && !r5.flex.length, JSON.stringify(r5));
check('a plain wish is not flexible', JSON.stringify(readFlex(dinner, 'ramen in hillcrest sounds good')) === JSON.stringify({ multi: {}, stretch: [], flex: [], rigid: [] }));

// ---------- a table of three people ----------
async function table(opts = {}) {
  const room = { code: `F${Math.floor(Math.random() * 1e6)}`, kind: 'quick', task: 'dinner', autoStart: true, ...(opts.room || {}) };
  const humans = [{ key: 'u1', name: 'Maya' }, { key: 'u2', name: 'Dev' }, { key: 'u3', name: 'Jo' }].slice(0, opts.n || 3).map((h) => ({ ...h, userId: null, isGuest: true }));
  const t = new Table({ io, room, humans, mode: opts.mode || 'listen', taskId: 'dinner', number: 1 });
  t.connected = () => true;
  await t.start();
  for (const h of humans) t.ready(h.key);
  await until(() => t.stage === 'chat');
  return t;
}

{
  const t = await table();
  const [maya, dev, jo] = t.players;
  check('the chat opens with a person, not the AI', !!t.starter && !t.chat.some((m) => m.from === 'AI'));
  const st = t.byCode(t.starter);
  check('only the starter sees the prompt to start', t.chatFor(st, st.key).some((m) => m.kind === 'starter') && t.players.filter((p) => p !== st).every((p) => !t.chatFor(p, p.key).some((m) => m.kind === 'starter')));
  check('three people get the Light AI', t.style === 'light');
  check('no part of the plan has come up yet', t.panelView().every((f) => !f.seen));
  t.say('u1', 'how about ramen in hillcrest friday at 8?');
  const seen = t.panelView().filter((f) => f.seen).map((f) => f.id);
  check('the parts someone brings up show on the board', seen.includes('where') && seen.includes('when') && !seen.includes('budget'), JSON.stringify(seen));

  t.say('u2', 'friday at 8 or saturday both work for me');
  const devMsg = t.chat.filter((m) => m.from === dev.pcode).at(-1);
  check('the AI notes both times as one line', devMsg.saved?.[0] === 'Dev → Friday at 8 pm or Saturday at 7 pm', JSON.stringify(devMsg.saved));
  check('both times are marked as fine for Dev', t.avail[dev.pcode].when.fri8 === 'yes' && t.avail[dev.pcode].when.sat7 === 'yes');

  t.say('u3', 'I could do $15 to $30 if needed');
  const joMsg = t.chat.filter((m) => m.from === jo.pcode).at(-1);
  check('"if needed" is noted as fine if needed', joMsg.saved?.some((x) => x === 'Jo: $15 to $30 if needed'), JSON.stringify(joMsg.saved));
  check('"if needed" does not become Jo\'s pick', !t.prefs[jo.pcode]?.budget);

  t.say('u1', 'under 15 for me');
  t.say('u2', 'under $15 works');
  t.say('u3', "I'm flexible on where");
  const where = t.panelView().find((f) => f.id === 'where');
  check('a flexible person goes along with what the others lead with', where.options.find((o) => o.option === 'hillcrest')?.who.includes('Jo'), JSON.stringify(where.options));
  check('the board lists who is flexible', where.flexible.includes('Jo'), JSON.stringify(where.flexible));
  const when = t.panelView().find((f) => f.id === 'when');
  check('the board shows the time that works for everyone who said something', when.fits.includes('fri8') && !when.fits.includes('fri6'), JSON.stringify(when.fits));
  t.setFlex('u2', 'where', true);
  check('a tap marks a part as flexible', t.flex[dev.pcode].where === true);
  t.setFlex('u2', 'where', false);
  check('and a second tap takes it back', !t.flex[dev.pcode].where);

  // Ideas
  const before = t.chat.length;
  t.idea('u1');
  const idea = t.chat.slice(before).find((m) => m.idea);
  check('the idea button posts one short idea', !!idea && idea.text.length < 60 && idea.idea.field === 'where', JSON.stringify(idea));
  t.lastIdeaAt = 0; t.idea('u1');
  const idea2 = t.chat.filter((m) => m.idea).at(-1);
  check('"Another idea" gives a different one', idea2 && idea2.idea.option !== idea.idea.option);

  // Style
  t.setStyle('u2', 'quiet');
  check('any person can set the AI style for the table', t.style === 'quiet' && t.cap() === 0 && t.chat.at(-1).text === 'Dev set the AI to Quiet.');
  t.setStyle('u2', 'loud');
  check('an unknown style is ignored', t.style === 'quiet');
  t.endReason = 'host'; t.enter('done');
}

{
  // The quiet person: two people talk, the third says nothing. The AI nudges the third privately, once, with taps.
  const t = await table();
  const [maya, dev, jo] = t.players;
  const talk = ['ramen in hillcrest?', 'hmm or pizza in little italy', 'little italy is far for me', 'ok hillcrest then', 'friday at 8?', 'friday at 8 works', 'cool', 'bus or trolley for me'];
  for (const [i, text] of talk.entries()) { t.say(i % 2 ? 'u2' : 'u1', text); await sleep(30); }
  t.stageStartedAt -= 120000 * 0.02; t.listen();
  const nudge = t.chat.find((m) => m.to === 'u3' && m.quick);
  check('a person who has not weighed in gets a private nudge', !!nudge, JSON.stringify(t.chat.filter((m) => m.from === 'AI').map((m) => m.text)));
  check('the nudge is short and comes with one-tap answers', nudge && nudge.text.length < 50 && nudge.quick.length === 4 && nudge.quick.some((q) => q.kind === 'flex'));
  check('nobody else sees it', !t.chatFor(maya, 'u1').some((m) => m.id === nudge?.id) && !t.chatFor(dev, 'u2').some((m) => m.id === nudge?.id));
  check('the people who talked are not nudged', !t.chat.some((m) => (m.to === 'u1' || m.to === 'u2') && m.quick));
  const n = t.chat.filter((m) => m.quick).length; t.listen();
  check('the nudge is not repeated right away', t.chat.filter((m) => m.quick).length === n);
  const i = nudge.quick.findIndex((q) => q.kind === 'flex');
  t.quick('u3', nudge.id, i);
  check('"I am flexible" in the nudge is posted for the person and noted', t.chat.some((m) => m.from === jo.pcode && /flexible/.test(m.text)) && Object.values(t.flex[jo.pcode] || {}).some(Boolean));
  t.quick('u3', nudge.id, 0);
  check('a nudge answers once', t.chat.filter((m) => m.from === jo.pcode).length === 1);
  t.endReason = 'host'; t.enter('done');
}

{
  // Active: four people. The AI offers one idea when nobody has come up with anything to do.
  const t = await table({ n: 3, room: { aiStyle: 'active' } });
  check('a room can set the AI style', t.style === 'active' && t.cap() === 3);
  t.say('u1', 'hey all');
  t.stageStartedAt -= 60000 * 0.02; t.lastChatAt = Date.now() - 20000 * 0.02; t.lastAiSayAt = 0;
  t.listen();
  const idea = t.chat.find((m) => m.idea);
  check('the active AI offers an idea when the chat stalls with no idea', !!idea && /^Stuck\? One idea: /.test(idea.text), JSON.stringify(t.chat.map((m) => m.text)));
  check('that counts as one of its questions', t.interjections === 1);
  t.endReason = 'host'; t.enter('done');
}

{
  // Quiet style: nothing unprompted in the group chat, but a direct ask still gets a card.
  const t = await table({ room: { aiStyle: 'quiet' } });
  t.say('u1', 'ramen in hillcrest or pizza in little italy?');
  t.say('u2', 'pizza in little italy');
  t.say('u3', 'ramen in hillcrest');
  t.stageStartedAt -= 300000 * 0.02; t.lastAiSayAt = 0; t.lastInterjectAt = 0; t.listen();
  check('the quiet AI posts nothing on its own (a reply to a question is fine)', !t.chat.some((m) => m.from === 'AI' && !m.to && !m.answer && m.card !== 'pick') && t.interjections === 0, JSON.stringify(t.chat.filter((m) => m.from === 'AI').map((m) => `${m.kind}:${m.text}`)));
  t.endReason = 'host'; t.enter('done');
}

{
  // A limit on a part nobody has talked about is not "broken" yet, so no early private alert.
  const t = await table();
  const [maya] = t.players;
  maya.limitId = 'budget15';
  t.say('u2', 'how about ramen in hillcrest?');
  check('a budget limit is not broken while nobody has talked about the budget', t.viewFor('u1').me.limit.now !== 'breaks' && !t.chat.some((m) => m.to === 'u1' && /breaks your private limit/.test(m.text)));
  t.say('u2', '$15 to $30 sounds right'); t.say('u3', '$20 is good');
  check('it is broken once the group heads to a bigger budget', t.viewFor('u1').me.limit.now === 'breaks' && t.chat.some((m) => m.to === 'u1' && /breaks your private limit/.test(m.text)));
  t.endReason = 'host'; t.enter('done');
}

await sleep(200);
const failed = results.filter((x) => !x).length;
console.log(failed ? `${failed} of ${results.length} checks failed` : `All ${results.length} checks passed.`);
await pg.stop();
process.exit(failed ? 1 : 0);
