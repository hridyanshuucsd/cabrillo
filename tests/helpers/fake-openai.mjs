// Test helper: answers OpenAI calls locally so the model path can be tested without a key.
// AI player prompts get JSON that depends on the newest message; other prompts get a plain sentence.
const real = globalThis.fetch;
let n = 0;
globalThis.fetch = async (url, opts) => {
  if (!String(url).startsWith('https://api.openai.com')) return real(url, opts);
  const body = JSON.parse(opts.body);
  const sys = body.messages[0].content, user = body.messages[1].content;
  let content;
  if (sys.includes('You are playing one member')) {
    n++;
    const ask = /Reply to .*"(.*)"/.exec(user)?.[1] || '';
    if (/limit now/.test(user)) content = { text: 'heads up, i have practice sunday mornings so those are out for me', picks: {}, mentions_limit: true };
    else if (/time|when/i.test(ask)) content = { text: `sunday afternoon is best for me ngl (${n})`, picks: { when: 'sun_pm' }, mentions_limit: false };
    else if (/where|meet/i.test(ask)) content = { text: `la jolla cove? tide pools are fun (${n})`, picks: { where: 'cove' }, mentions_limit: false };
    else content = { text: `yeah that works for me (${n})`, picks: {}, mentions_limit: false };
    content = JSON.stringify(content);
  } else if (sys.includes('asked you to compare')) {
    content = JSON.stringify({ text: 'Both are close to campus; it depends on what P01 wants from the day.', items: [
      { name: 'La Jolla Cove', pros: ['Sea lions and tide pools', 'Free'], cons: ['Parking is hard on weekends'] },
      { name: 'Balboa Park', pros: ['Lots of shade and museums', 'Easy by bus'], cons: ['Museums cost extra'] }] });
  } else if (sys.includes('keep one line above the chat')) content = 'The group is leaning toward La Jolla Cove and Sunday afternoon; getting there and budget are open.';
  else content = 'Bring water, sunscreen and a towel; P01 might want shoes for the tide pools.';
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
};
