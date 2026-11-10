// Test helper: answers OpenAI calls locally so the model path can be tested without a key.
// AI player prompts get JSON that depends on the newest message; other prompts get a plain sentence.
const real = globalThis.fetch;
let n = 0;
globalThis.fetch = async (url, opts) => {
  if (!String(url).startsWith('https://api.openai.com')) return real(url, opts);
  const body = JSON.parse(opts.body);
  const sys = body.messages[0].content, user = body.messages[1].content;
  // Like some real models, this stand-in refuses one request field, so the app has to find a request style that works.
  if (body.reasoning_effort) return new Response(JSON.stringify({ error: { message: "Unsupported parameter: 'reasoning_effort' is not supported with this model." } }), { status: 400, headers: { 'content-type': 'application/json' } });
  let content;
  if (sys.includes('You are playing one member')) {
    n++;
    const ask = /Reply to .*"(.*)"/.exec(user)?.[1] || '';
    if (/limit now/.test(user)) content = { text: 'heads up, i have practice sunday mornings so those are out for me', picks: {}, mentions_limit: true };
    else if (/time|when/i.test(ask)) content = { text: `sunday afternoon is best for me ngl (${n})`, picks: { when: 'sun_pm' }, mentions_limit: false };
    else if (/where|meet/i.test(ask)) content = { text: `la jolla cove? tide pools are fun (${n})`, picks: { where: 'cove' }, mentions_limit: false };
    else content = { text: `yeah that works for me (${n})`, picks: {}, mentions_limit: false };
    content = JSON.stringify(content);
  } else if (sys.includes('keep one line above the chat')) content = 'The group is leaning toward La Jolla Cove and Sunday afternoon; getting there and budget are open.';
  else if (sys.includes('Someone tagged you with @AI')) {
    const q = /Question from \w+(?: \(asked privately\))?: (.*)$/s.exec(user)?.[1] || '';
    if (/pros and cons/i.test(q)) content = JSON.stringify({ text: 'Both are close to campus; it depends on what P01 wants from the day.', blocks: [{ type: 'compare', title: 'Where: pros and cons', items: [
      { name: 'La Jolla Cove', pros: ['Sea lions and tide pools', 'Free'], cons: ['Parking is hard on weekends'] },
      { name: 'Balboa Park', pros: ['Lots of shade and museums', 'Easy by bus'], cons: ['Museums cost extra'] }] }] });
    else if (/privately|between us/i.test(q) || /asked privately/.test(user.slice(-400))) content = `You could just say it plainly. ${JSON.stringify({ type: 'list', title: 'Ways to say it', items: ['Mention it early', 'Offer an option that works'] })}`;
    else
    if (/bring/i.test(q)) content = JSON.stringify({ text: 'Here is a short packing list for the cove.', blocks: [{ type: 'list', title: 'What to bring', items: ['Water', 'Sunscreen', 'A towel', 'Shoes that can get wet'] }] });
    else if (/split|cost|each/i.test(q)) content = JSON.stringify({ text: 'Split three ways, it comes to 20 dollars each.', blocks: [{ type: 'table', title: 'Split', columns: ['Person', 'Pays'], rows: [['P01', '$20'], ['A01', '$20'], ['A02', '$20']] }] });
    else if (/how do|get there|steps/i.test(q)) content = JSON.stringify({ text: 'Take the bus from campus.', blocks: [{ type: 'steps', title: 'By bus', items: ['Walk to the campus stop', 'Ride the bus to La Jolla', 'Walk five minutes to the cove'] }, { type: 'pick', field: 'travel' }] });
    else content = JSON.stringify({ text: 'A sea lion can hold its breath for about 10 minutes.' });
  }
  else content = 'Bring water, sunscreen and a towel; P01 might want shoes for the tide pools.';
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
};
