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
Use only the information below. If the answer is not there, say you do not have that information.
Answer in at most 2 short sentences, plain language, no emojis, no em dashes, no contractions.`;

// One call to whichever provider has a key. Returns { text, source } or null when no key is set.
async function chat(system, user, maxTokens) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
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
      const model = process.env.AI_MODEL || 'gpt-4o-mini';
      const call = (limitKey) => fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST', signal: controller.signal,
        headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model, [limitKey]: maxTokens, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] })
      });
      // Older models take max_tokens; newer ones only take max_completion_tokens.
      let r = await call('max_tokens');
      if (r.status === 400) r = await call('max_completion_tokens');
      if (!r.ok) throw new Error(`OpenAI ${r.status}: ${(await r.text()).slice(0, 200)}`);
      const d = await r.json();
      return { text: d.choices?.[0]?.message?.content?.trim(), source: 'openai' };
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
