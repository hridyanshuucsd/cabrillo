// Test helper: answers OpenAI calls locally so the model path can be tested without a key.
// AI player prompts get a JSON line that follows the "Your move" instruction; other prompts get canned answers.
// With FAKE_MODEL=bad the AI player lines are deliberately poor (codes, repeats, "we're set", emojis, long rambles),
// to check that the app never posts them.
const real = globalThis.fetch;
let n = 0;
const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const BAD = [
  'sunday afternoon works for me',
  'sunday afternoon works for me',
  "looks like we're set then",
  'p09 has a point lol',
  'sunday afternoon works for me, also i get carsick so bus or trolley, and maybe old town for tacos since it is cheap and close to the trolley line which is nice',
  'sounds like a plan 🎉 — see you all there',
  'works for me',
  'works for me'
];
const VARY = ['tbh', 'honestly', 'i think', 'ngl', 'for sure'];

function playerLine(user) {
  n++;
  if (process.env.FAKE_MODEL === 'bad') return { text: BAD[n % BAD.length], picks: {}, mentions_limit: false };
  const move = /Your move: (.*)$/s.exec(user)?.[1] || '';
  const limit = /Your private limit: "(.*?)"/.exec(user)?.[1] || '';
  const idOf = (name) => new RegExp(`${esc(name)} \\[(\\w+)\\]`).exec(user)?.[1];
  const partOf = (id) => { for (const l of user.split('\n')) { const m = /^- .*? \[(\w+)\]/.exec(l); if (m && l.includes(`[${id}]`) && m[1] !== id) return m[1]; } return null; };
  const pick = (name) => { const id = idOf(name), part = id && partOf(id); return part ? { [part]: id } : {}; };
  const v = VARY[n % VARY.length];
  let m;
  if (/breaks your limit|about your limit now|limit you (already )?shared/.test(move)) return { text: `heads up, ${limit.charAt(0).toLowerCase()}${limit.slice(1).replace(/\.$/, '')}, so that one is hard for me`, picks: {}, mentions_limit: true };
  if ((m = /float (.+?) for /.exec(move))) return { text: `hey! ${m[1].toLowerCase()} could be fun ${v}?`, picks: pick(m[1]), mentions_limit: false };
  if ((m = /ask the group about (.+?) in your own words/.exec(move))) return { text: `${/Say hi/.test(move) ? 'hey all. ' : 'works for me. '}so what are we thinking for ${m[1]}?`, picks: {}, mentions_limit: false };
  if ((m = /Answer that (.+?) is what you would pick/.exec(move))) return { text: `${m[1].toLowerCase()} is best for me ${v}`, picks: pick(m[1]), mentions_limit: false };
  if ((m = /for example (.+?)\. It is only/.exec(move))) return { text: `${m[1]}? gives us time to eat first ${v}`, picks: {}, mentions_limit: false };
  if ((m = /Suggest (.+?) for it/.exec(move))) return { text: `what about ${m[1].toLowerCase()} ${v}?`, picks: pick(m[1]), mentions_limit: false };
  if ((m = /you will go by (.+?) yourself/.exec(move))) return { text: `${limit.charAt(0).toLowerCase()}${limit.slice(1).replace(/\.$/, '')}, so i'll take the ${m[1].toLowerCase()} and meet you there`, picks: pick(m[1]), mentions_limit: true };
  if (/suggested that you go by/.test(move)) return { text: `works for me ${v}, see you there`, picks: {}, mentions_limit: false };
  if (/Agree in two/.test(move)) return { text: `i'm down ${v}`, picks: {}, mentions_limit: false };
  return { text: `yeah fair ${v}`, picks: {}, mentions_limit: false };
}

globalThis.fetch = async (url, opts) => {
  if (!String(url).startsWith('https://api.openai.com')) return real(url, opts);
  const body = JSON.parse(opts.body);
  // Responses API with web search: one answer with a cited source, as OpenAI returns it.
  if (String(url).endsWith('/v1/responses')) {
    const text = JSON.stringify({ text: 'Two good escape rooms near campus are Escape Room A ([example.com](https://example.com/a)) and Escape Room B.', blocks: [{ type: 'list', title: 'Near UC San Diego', items: ['Escape Room A, about 10 minutes away', 'Escape Room B, in Kearny Mesa'] }] });
    return new Response(JSON.stringify({ output: [{ type: 'web_search_call', id: 'ws1', status: 'completed', action: { type: 'search', query: 'escape rooms near UCSD' } },
      { type: 'message', role: 'assistant', content: [{ type: 'output_text', text, annotations: [{ type: 'url_citation', url: 'https://example.com/a', title: 'Escape Room A', start_index: 0, end_index: 10 }] }] }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  const sys = body.messages[0].content, user = body.messages[1].content;
  // Like some real models, this stand-in refuses one request field, so the app has to find a request style that works.
  if (body.reasoning_effort) return new Response(JSON.stringify({ error: { message: "Unsupported parameter: 'reasoning_effort' is not supported with this model." } }), { status: 400, headers: { 'content-type': 'application/json' } });
  let content;
  if (sys.includes('one AI player')) content = JSON.stringify(playerLine(user));
  else if (sys.includes('keep one line above the chat')) content = 'The group is leaning toward La Jolla Cove and Sunday afternoon; getting there and budget are open.';
  else if (sys.includes('Someone tagged you with @AI')) {
    const q = /Question from \w+(?: \(asked privately\))?: (.*)$/s.exec(user)?.[1] || '';
    if (/pros and cons/i.test(q)) content = JSON.stringify({ text: 'Both are close to campus; it depends on what P01 wants from the day.', blocks: [{ type: 'compare', title: 'Where: pros and cons', items: [
      { name: 'La Jolla Cove', pros: ['Sea lions and tide pools', 'Free'], cons: ['Parking is hard on weekends'] },
      { name: 'Balboa Park', pros: ['Lots of shade and museums', 'Easy by bus'], cons: ['Museums cost extra'] }] }] });
    else if (/privately|between us/i.test(q) || /asked privately/.test(user.slice(-400))) content = `You could just say it plainly. ${JSON.stringify({ type: 'list', title: 'Ways to say it', items: ['Mention it early', 'Offer an option that works'] })}`;
    else
    if (/bring/i.test(q)) content = JSON.stringify({ text: 'I put a few things on the who-brings-what list.', blocks: [{ type: 'bring', items: ['Water', 'A towel', 'Shoes that can get wet'] }] });
    else if (/weather|rain/i.test(q)) content = JSON.stringify({ text: 'The forecast is on the board.', blocks: [{ type: 'weather' }] });
    else if (/split|cost|each/i.test(q)) content = JSON.stringify({ text: 'Split three ways, it comes to 20 dollars each.', blocks: [{ type: 'table', title: 'Split', columns: ['Person', 'Pays'], rows: [['p01', '$20'], ['Ari', '$20'], ['Kai', '$20']] }] });
    else if (/how do|get there|steps/i.test(q)) content = JSON.stringify({ text: 'Take the bus from campus.', blocks: [{ type: 'steps', title: 'By bus', items: ['Walk to the campus stop', 'Ride the bus to La Jolla', 'Walk five minutes to the cove'] }, { type: 'pick', field: 'travel' }] });
    else content = JSON.stringify({ text: 'A sea lion can hold its breath for about 10 minutes.' });
  }
  else content = 'Bring water, sunscreen and a towel; P01 might want shoes for the tide pools.';
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
};
