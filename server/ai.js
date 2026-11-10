// Answers to questions people ask the AI directly (with @AI or the "Ask the AI" button).
// Uses Anthropic or OpenAI when a key is set, and scripted answers otherwise or if the model fails.

function context(ctx) {
  const t = ctx.task;
  const fields = t.fields.map((f) => `- ${f.name}: ${f.options.map((x) => x.name).join(', ')}`).join('\n');
  const info = t.info.map((i) => `- ${i.text}`).join('\n');
  return `Task for the group: ${t.prompt}
Plan fields and options:
${fields}
Game information:
${info}
Plan so far (from the chat):
${ctx.summary}
Recent chat (people appear as codes such as P01; AI players as A01; newest last):
${ctx.recent}`;
}

const SYSTEM = `You are the AI in Cabrillo, a clearly labeled AI that listens to a small student group chat while they make one plan.
You help the group decide; you never decide for them, never take a side, and you cannot vote.
You cannot see anyone's private limits unless they were shared in the chat. Never guess them.
Refer to people by their codes exactly as written (for example P01).
Prices, times, schedules and everyone's limits in this game are invented: for those, use only the information below. You may use common knowledge about real places and general planning tips. If you do not know, say so.
Answer in at most 3 short sentences, plain language, no emojis, no em dashes, no contractions. If asked which option is best, lay out the trade-off and leave the choice to the group.
Sound like a friendly, relaxed classmate who happens to be organized: warm and natural, not formal or robotic, and never a stiff list.`;

const OPENAI_MODELS = ['gpt-6.1-terra', 'gpt-5.6-terra', 'gpt-5.4-mini', 'gpt-4o-mini'];
let workingModel = null;

// One call to whichever provider has a key. Returns { text, source } or null when no key is set.
async function chat(system, user, maxTokens, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    if (process.env.ANTHROPIC_API_KEY) {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST', signal: controller.signal,
        headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({ model: process.env.AI_MODEL || 'claude-haiku-5-5', max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] })
      });
      if (!r.ok) throw new Error(`Anthropic ${r.status}: ${(await r.text()).slice(0, 200)}`);
      const d = await r.json();
      return { text: d.content?.map((c) => c.text || '').join('').trim(), source: 'anthropic' };
    }
    if (process.env.OPENAI_API_KEY) {
      // Newest "Terra" model first (the balanced tier: natural chat at a fraction of the flagship price). If OpenAI does not
      // accept a model name for this key, the next one is tried and the one that works is remembered. AI_MODEL pins one.
      const chain = process.env.AI_MODEL ? [process.env.AI_MODEL] : OPENAI_MODELS;
      const start = Math.max(0, chain.indexOf(workingModel));
      let lastErr = '';
      for (const model of chain.slice(start)) {
        const call = (limitKey, budget) => fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST', signal: controller.signal,
          headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'content-type': 'application/json' },
          body: JSON.stringify({ model, [limitKey]: budget, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] })
        });
        // Older models take max_tokens; newer ones only take max_completion_tokens (which also covers any hidden reasoning, so it gets more room).
        let r = await call('max_tokens', maxTokens);
        if (r.status === 400) r = await call('max_completion_tokens', maxTokens * 6);
        if (r.ok) {
          const d = await r.json();
          const text = d.choices?.[0]?.message?.content?.trim();
          if (!text) { lastErr = `${model}: empty answer`; continue; }
          workingModel = model;
          return { text, source: `openai:${model}` };
        }
        lastErr = `${model}: ${r.status} ${(await r.text()).slice(0, 160)}`;
        if (![400, 403, 404].includes(r.status)) break; // rate limit or outage: do not cycle through models
      }
      throw new Error(`OpenAI ${lastErr}`);
    }
    return null;
  } finally { clearTimeout(timer); }
}

const callLLM = (question, ctx) => chat(`${SYSTEM}\n\n${context(ctx)}`, question, 200);

const HEARING = `You are the AI in Cabrillo. You listen to a small group chat while the group makes one plan, and you keep one line above the chat that says what you are hearing.
Write ONE sentence of at most 24 words: what the group seems to want so far and what is still open or in conflict.
Include ideas people raised even if they are not on the option list. Do not give advice, do not take a side, do not invent anything.
Refer to people by their codes exactly as written (for example P01). Plain language, no emojis, no em dashes, no contractions.`;

// The live "what I am hearing" line. Returns null without a key or on any failure; the caller then uses its rule-based line.
export async function summarize(ctx) {
  try {
    const t = ctx.task;
    const r = await chat(HEARING, `Task: ${t.prompt}\nParts of the plan and their options:\n${t.fields.map((f) => `- ${f.name}: ${f.options.map((x) => x.name).join(', ')}`).join('\n')}\nTally so far: ${ctx.summary}\nRecent chat (newest last):\n${ctx.recent}`, 80);
    const text = r?.text?.replace(/\s+/g, ' ').replace(/^["']|["']$/g, '').trim();
    return text && text.length <= 260 ? { text, source: r.source } : null;
  } catch (e) { console.error('AI summary failed:', e.message); return null; }
}

function scripted(question, ctx) {
  const s = question.toLowerCase();
  if (/(so far|summary|summar|decided|where are we|recap|plan)/.test(s)) return `Plan so far: ${ctx.summary}`;
  if (/(private|limit|secret|card|what do (they|others) need)/.test(s)) return 'Private limits stay private. Each person decides whether to say theirs or to ask me to pass it on.';
  if (/(time|how long|left|minute|timer)/.test(s)) return 'There is no timer. The chat ends when everyone accepts a complete plan.';
  for (const i of ctx.task.info) if (i.kw.some((k) => s.includes(k))) return i.text;
  if (/(vote|decide|choose for us|pick for us|what should we)/.test(s)) return 'I do not vote or choose for the group. I can list the options people have raised and what is still open.';
  if (/(option|choices)/.test(s)) return ctx.task.fields.map((f) => `${f.name}: ${f.options.map((x) => x.name).join(', ')}`).join('. ') + '.';
  return 'I can recap the plan so far, list what is still open, and share game information about travel, cost, and timing.';
}

export async function answerQuestion(question, ctx) {
  try {
    const r = await callLLM(question, ctx);
    if (r?.text) return r;
  } catch (e) { console.error('AI call failed, using scripted answer:', e.message); }
  return { text: scripted(question, ctx), source: 'scripted' };
}

export const aiMode = () => (process.env.ANTHROPIC_API_KEY ? 'anthropic' : process.env.OPENAI_API_KEY ? 'openai' : 'scripted');

// ---------- AI players ----------
// An AI player is a labeled seat filler that chats like a relaxed classmate. The model only writes the words and says
// which options the player now wants; the app checks every pick against the player's limit before it counts.
const PLAYER = `You are playing one member of a small college group chat. The others can see you are an AI player, so never claim to be human, but talk like a relaxed college student texting friends.
Write ONE short message (at most 18 words). Casual: lowercase is fine, contractions are fine, "tbh", "ngl", "lol" are fine sometimes. No emojis, no em dashes, no hashtags. Vary your wording; never repeat a message you already sent.
Reply to the newest message when there is one: answer a question if you can, react to an idea, or ask a short follow-up. Sound like a person, not a form ("sunday afternoon works, mornings i have practice" is good; "I would like Sunday afternoon for when" is bad).
People are written as codes like P01 or A02. Do not invent names; you may refer to someone by their code.
Stay consistent with what you want and with your limit. Only bring up your limit if it matters right now or someone asked about limits.
Answer with JSON only: {"text": "...", "picks": {"<part id>": "<option id>"}, "mentions_limit": true or false}. "picks" lists only options your message says you want; use the ids given.`;

export async function playerLine(ctx) {
  try {
    const t = ctx.task;
    const parts = t.fields.map((f) => `- ${f.id} (${f.name}): ${f.options.map((o) => `${o.id} = ${o.name}`).join('; ')}`).join('\n');
    const user = `Task: ${t.prompt}
Parts of the plan, with option ids:
${parts}
You are ${ctx.me}. What you would like: ${ctx.wants || 'nothing in particular, you are easygoing'}.
Your private limit: "${ctx.limit}". ${ctx.shared ? 'You already told the group about it.' : 'You have not told the group yet.'}
${ctx.goingAlong ? `You are fine going along with: ${ctx.goingAlong}.` : ''}
Plan so far: ${ctx.summary}
Recent chat (newest last):
${ctx.recent || '(nobody has said anything yet)'}
${ctx.instruction}`;
    const r = await chat(PLAYER, user, 120);
    if (!r?.text) return null;
    const m = r.text.match(/\{[\s\S]*\}/);
    const j = JSON.parse(m ? m[0] : r.text);
    const text = String(j.text || '').replace(/\s+/g, ' ').replace(/—|–/g, ', ').trim();
    if (!text || text.length > 200) return null;
    return { text, picks: j.picks && typeof j.picks === 'object' ? j.picks : {}, mentionsLimit: !!j.mentions_limit, source: r.source };
  } catch (e) { console.error('AI player line failed:', e.message); return null; }
}

// ---------- pros and cons ----------
// "@AI pros and cons of the cove vs balboa?" gets a card: each option with a few pros and cons. The app passes the
// facts it has (who wants each option, shared limits it breaks, drive time, game information); the model adds common
// knowledge about real places. Never a verdict.
const COMPARE_RE = /\b(pros?|cons?|compare|comparison|vs\.?|versus|difference|differences|better|best|which one|trade-?offs?|upsides?|downsides?|good and bad|worth it)\b/i;
export const wantsCompare = (q) => COMPARE_RE.test(q);
const COMPARE = `You are the AI in Cabrillo, a clearly labeled AI in a small student group chat that is making one plan. Someone asked you to compare options.
You never take a side and never pick a winner; the group decides.
People appear as codes such as P01 or A02; refer to them only by code.
Prices, times and everyone's limits in this game are invented: use only the ones given. You may add common knowledge about real places (what they are like, crowds, parking, weather, what to bring).
Answer with JSON only: {"text": "one short framing sentence, no verdict", "items": [{"name": "<option name exactly as given>", "pros": ["..."], "cons": ["..."]}]}.
Use every option listed, in order. Give each 1 to 3 pros and 1 to 3 cons, each at most 10 words. No emojis, no em dashes, no contractions.`;
export async function compareOptions(question, ctx) {
  try {
    const r = await chat(COMPARE, `${context(ctx)}\n\nOptions to compare (with what the app knows):\n${ctx.facts}\n\nQuestion: ${question}`, 450, 20000);
    if (!r?.text) return null;
    const m = r.text.match(/\{[\s\S]*\}/);
    const j = JSON.parse(m ? m[0] : r.text);
    const clean = (a) => (Array.isArray(a) ? a : []).map((x) => String(x).replace(/\u2014|\u2013/g, ', ').trim()).filter(Boolean).slice(0, 3);
    const items = (Array.isArray(j.items) ? j.items : []).slice(0, 4).map((x) => ({ name: String(x.name || '').trim(), pros: clean(x.pros), cons: clean(x.cons) })).filter((x) => x.name && (x.pros.length || x.cons.length));
    if (items.length < 1) return null;
    return { text: String(j.text || '').trim(), items, source: r.source };
  } catch (e) { console.error('AI compare failed:', e.message); return null; }
}
