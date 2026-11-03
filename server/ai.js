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
Stage: ${ctx.stage}, about ${ctx.secondsLeft} seconds left.
Recent chat (player codes, newest last):
${ctx.recent}`;
}

const SYSTEM = `You are the AI in Cabrillo, a clearly labeled AI that listens to a small student group chat while they make one plan.
You help the group decide; you never decide for them, never take a side, and you cannot vote.
You cannot see anyone's private limits. Never guess them.
Use only the information below. If the answer is not there, say you do not have that information.
Answer in at most 2 short sentences, plain language, no emojis, no em dashes, no contractions.`;

async function callLLM(question, ctx) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    if (process.env.ANTHROPIC_API_KEY) {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST', signal: controller.signal,
        headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({ model: process.env.AI_MODEL || 'claude-haiku-5-5', max_tokens: 160, system: `${SYSTEM}\n\n${context(ctx)}`, messages: [{ role: 'user', content: question }] })
      });
      if (!r.ok) throw new Error(`Anthropic ${r.status}: ${(await r.text()).slice(0, 200)}`);
      const d = await r.json();
      return { text: d.content?.map((c) => c.text || '').join('').trim(), source: 'anthropic' };
    }
    if (process.env.OPENAI_API_KEY) {
      const r = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST', signal: controller.signal,
        headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model: process.env.AI_MODEL || 'gpt-4o-mini', max_tokens: 160, messages: [{ role: 'system', content: `${SYSTEM}\n\n${context(ctx)}` }, { role: 'user', content: question }] })
      });
      if (!r.ok) throw new Error(`OpenAI ${r.status}: ${(await r.text()).slice(0, 200)}`);
      const d = await r.json();
      return { text: d.choices?.[0]?.message?.content?.trim(), source: 'openai' };
    }
    return null;
  } finally { clearTimeout(timer); }
}

function scripted(question, ctx) {
  const s = question.toLowerCase();
  if (/(so far|summary|summar|decided|where are we|recap|plan)/.test(s)) return `Plan so far: ${ctx.summary}`;
  if (/(private|limit|secret|card|what do (they|others) need)/.test(s)) return 'I cannot see anyone\'s private limits. Each person decides what to share.';
  if (/(time|how long|left|minute)/.test(s)) return `About ${ctx.secondsLeft} seconds are left in this stage.`;
  for (const i of ctx.task.info) if (i.kw.some((k) => s.includes(k))) return i.text;
  if (/(vote|decide|choose for us|pick for us|what should we)/.test(s)) return 'I do not vote or choose for the group. I can list the options people have raised and what is still open.';
  if (/(option|choices)/.test(s)) return ctx.task.fields.map((f) => `${f.name}: ${f.options.map((x) => x.name).join(', ')}`).join('. ') + '.';
  return 'I can recap the plan so far, list what is still open, and share game information about travel, cost, and timing. I cannot see private limits.';
}

export async function answerQuestion(question, ctx) {
  try {
    const r = await callLLM(question, ctx);
    if (r?.text) return r;
  } catch (e) { console.error('AI call failed, using scripted answer:', e.message); }
  return { text: scripted(question, ctx), source: 'scripted' };
}

export const aiMode = () => (process.env.ANTHROPIC_API_KEY ? 'anthropic' : process.env.OPENAI_API_KEY ? 'openai' : 'scripted');
