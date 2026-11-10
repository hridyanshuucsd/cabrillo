// Everything that talks to a language model: answers to @AI questions, the "AI hears" line, and AI players' messages.
// Uses OpenAI or Anthropic when a key is set. Without a key, or when a call fails, the app falls back to rules and
// scripted lines, so a class session never depends on the model being up.

// ---------- provider calls ----------
// OpenAI: the newest "Terra" model first (the balanced tier: natural chat at a fraction of the flagship price). If a
// model name is not accepted for this key the next one is tried, and the first that works is remembered. AI_MODEL pins one.
const OPENAI_MODELS = ['gpt-6.1-terra', 'gpt-5.6-terra', 'gpt-5.4-mini', 'gpt-4o-mini'];
// Models differ in which request fields they accept. These are tried in order when a request is refused as malformed
// (HTTP 400), and the first that works is remembered for each model, so the trial happens once.
const STYLES = [
  { limit: 'max_completion_tokens', room: 6, effort: 'low' }, // reasoning models: keep hidden reasoning short
  { limit: 'max_completion_tokens', room: 6 },
  { limit: 'max_tokens', room: 1 }
];
const state = { model: null, style: {}, jsonMode: {}, calls: 0, failures: 0, coolUntil: 0 };

// At most this many model calls run at once; the rest wait their turn. Low-priority calls (the "AI hears" line) are
// skipped when others are waiting or just after a rate-limit answer, since the app has a rule-based line to show instead.
const MAX_ACTIVE = Number(process.env.AI_CONCURRENCY || 8);
let active = 0; const waiting = [];
function takeSlot(low) {
  if (low && (waiting.length >= 4 || Date.now() < state.coolUntil)) return Promise.resolve(false);
  if (active < MAX_ACTIVE) { active++; return Promise.resolve(true); }
  if (waiting.length >= 40) return Promise.resolve(false);
  return new Promise((resolve) => waiting.push(resolve));
}
function freeSlot() { const next = waiting.shift(); if (next) next(true); else active--; }

async function openai(system, user, maxTokens, json, signal) {
  const chain = process.env.AI_MODEL ? [process.env.AI_MODEL] : OPENAI_MODELS;
  const start = Math.max(0, chain.indexOf(state.model));
  let lastErr = '';
  for (const model of chain.slice(start)) {
    let si = state.style[model] ?? 0;
    let useJson = json && state.jsonMode[model] !== false;
    let nextModel = false;
    for (let tries = 0; tries < 8; tries++) {
      const st = STYLES[si];
      const body = { model, [st.limit]: maxTokens * st.room, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] };
      if (st.effort) body.reasoning_effort = st.effort;
      if (useJson) body.response_format = { type: 'json_object' };
      const r = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST', signal, headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'content-type': 'application/json' }, body: JSON.stringify(body)
      });
      if (r.ok) {
        const d = await r.json();
        const text = d.choices?.[0]?.message?.content?.trim();
        if (!text) { lastErr = `${model}: empty answer`; nextModel = true; break; }
        state.model = model; state.style[model] = si; if (json) state.jsonMode[model] = useJson;
        return { text, source: `openai:${model}` };
      }
      const errText = (await r.text()).slice(0, 300);
      lastErr = `${model}: ${r.status} ${errText.slice(0, 160)}`;
      if (r.status === 429) { state.coolUntil = Date.now() + 8000; throw new Error(`OpenAI ${lastErr}`); }
      if (r.status === 403 || r.status === 404) { nextModel = true; break; } // this key cannot use this model
      if (r.status !== 400) throw new Error(`OpenAI ${lastErr}`);            // bad key or an outage: other models will not help
      // 400: the model does not take one of the fields. Drop JSON mode if that is what it objects to, else try the next style.
      if (useJson && /response_format|json/i.test(errText)) { useJson = false; continue; }
      if (si + 1 < STYLES.length) { si++; continue; }
      if (useJson) { useJson = false; si = 0; continue; }
      nextModel = true; break;
    }
    if (!nextModel) break;
  }
  throw new Error(`OpenAI ${lastErr}`);
}

async function anthropic(system, user, maxTokens, signal) {
  const model = process.env.AI_MODEL || 'claude-haiku-5-5';
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST', signal, headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] })
  });
  if (r.status === 429) state.coolUntil = Date.now() + 8000;
  if (!r.ok) throw new Error(`Anthropic ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const d = await r.json();
  state.model = model;
  return { text: d.content?.map((c) => c.text || '').join('').trim(), source: `anthropic:${model}` };
}

// One call to whichever provider has a key. Returns { text, source }, or null when there is no key or no free slot.
// Throws when the provider fails; every caller catches that and falls back.
async function chat(system, user, maxTokens, { json = false, timeoutMs = 12000, low = false } = {}) {
  if (aiMode() === 'scripted') return null;
  if (!(await takeSlot(low))) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  state.calls++;
  try {
    return process.env.ANTHROPIC_API_KEY ? await anthropic(system, user, maxTokens, controller.signal) : await openai(system, user, maxTokens, json, controller.signal);
  } catch (e) { state.failures++; throw e; }
  finally { clearTimeout(timer); freeSlot(); }
}

export const aiMode = () => (process.env.ANTHROPIC_API_KEY ? 'anthropic' : process.env.OPENAI_API_KEY ? 'openai' : 'scripted');
// For /api/health: which model is answering, so a host can check before class without seeing any key.
export const aiInfo = () => ({ ai: aiMode(), model: state.model, calls: state.calls, failures: state.failures });
// Called once at start: finds the model and request style that work for this key, so the first person to ask does not wait for it.
export async function warmUp() {
  if (aiMode() === 'scripted') return;
  try {
    await chat('You are a test.', 'Reply with the word ok.', 20);
    await chat('You are a test. Answer with JSON only.', 'Reply with {"ok": true} as JSON.', 30, { json: true });
    console.log(`AI ready: ${state.model}`);
  } catch (e) { console.error('AI warm-up failed (the app uses scripted lines until a call works):', e.message); }
}

// ---------- reading what the model wrote ----------
const str = (x, n) => String(x ?? '').replace(/—|–/g, ', ').replace(/\s+/g, ' ').trim().slice(0, n);
const strs = (a, k, n) => (Array.isArray(a) ? a : []).map((x) => str(x, n)).filter(Boolean).slice(0, k);
// Every complete {...} object in a piece of text, in order, with where each one sits.
export function jsonObjects(text) {
  const out = [];
  let s = text.indexOf('{');
  while (s >= 0) {
    let depth = 0, inStr = false, esc = false, end = -1;
    for (let i = s; i < text.length; i++) {
      const c = text[i];
      if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
      if (c === '"') inStr = true; else if (c === '{') depth++; else if (c === '}' && --depth === 0) { end = i + 1; break; }
    }
    if (end < 0) break;
    try { out.push({ value: JSON.parse(text.slice(s, end)), start: s, end }); s = text.indexOf('{', end); }
    catch { s = text.indexOf('{', s + 1); }
  }
  return out;
}
const unfence = (t) => String(t).replace(/```(?:json)?/gi, ' ').trim();

// Keeps only well-formed blocks, with sizes capped, so the app never draws something broken.
export function cleanBlocks(blocks, task) {
  const out = [];
  for (const b of Array.isArray(blocks) ? blocks : []) {
    if (out.length >= 2) break;
    if (!b || typeof b !== 'object') continue;
    const title = str(b.title, 80);
    if ((b.type === 'list' || b.type === 'steps') && strs(b.items, 8, 160).length) out.push({ type: b.type, title, items: strs(b.items, 8, 160) });
    else if (b.type === 'table') {
      const columns = strs(b.columns, 4, 40);
      const rows = (Array.isArray(b.rows) ? b.rows : []).slice(0, 8).map((r) => strs(r, columns.length || 4, 60)).filter((r) => r.length);
      if (columns.length && rows.length) out.push({ type: 'table', title, columns, rows });
    } else if (b.type === 'compare') {
      const items = (Array.isArray(b.items) ? b.items : []).slice(0, 4).map((x) => ({ name: str(x?.name, 60), pros: strs(x?.pros, 3, 90), cons: strs(x?.cons, 3, 90) })).filter((x) => x.name && (x.pros.length || x.cons.length));
      if (items.length) out.push({ type: 'compare', title, items });
    } else if (b.type === 'pick' && task.fields.some((f) => f.id === b.field)) out.push({ type: 'pick', field: b.field });
    else if (b.type === 'map') out.push({ type: 'map' });
  }
  return out;
}
// Turns the model's reply into { text, blocks }. The reply should be one JSON object, but models sometimes write a
// sentence followed by a block, or wrap the JSON in a code fence; none of that may reach the chat as raw text.
export function parseAnswer(raw, task) {
  const text = unfence(raw);
  const objs = jsonObjects(text);
  const whole = objs.find((o) => o.value && typeof o.value === 'object' && (typeof o.value.text === 'string' || Array.isArray(o.value.blocks)));
  if (whole) return { text: str(whole.value.text, 700) || 'Here you go.', blocks: cleanBlocks(whole.value.blocks, task) };
  // No wrapper object: take any objects that look like blocks, and use the words around them as the text.
  const loose = objs.filter((o) => o.value && typeof o.value === 'object' && typeof o.value.type === 'string');
  let rest = text;
  for (const o of [...objs].reverse()) rest = `${rest.slice(0, o.start)} ${rest.slice(o.end)}`;
  rest = str(rest.replace(/[\s[\],]+$/g, ''), 700);
  const blocks = cleanBlocks(loose.map((o) => o.value), task);
  return { text: rest || (blocks.length ? 'Here you go.' : ''), blocks };
}

// ---------- @AI questions ----------
function context(ctx) {
  const t = ctx.task;
  const fields = t.fields.map((f) => `- ${f.name} (part id ${f.id}): ${f.options.map((x) => x.name).join(', ')}`).join('\n');
  const info = t.info.map((i) => `- ${i.text}`).join('\n');
  return `Task for the group: ${t.prompt}
Parts of the plan and their options:
${fields}
Game information:
${info}
Plan so far (from the chat and taps):
${ctx.summary}
${ctx.facts ? `What the app knows about the options:\n${ctx.facts}\n` : ''}Recent chat, including earlier questions to the AI and its answers (people appear as codes such as P01; AI players as A01; the AI as AI; newest last):
${ctx.recent || '(nothing yet)'}`;
}

// The AI answers anything a person asks, in the shape that fits best. Plain sentences by default; a list, steps,
// a table, pros and cons, plan options to tap, or a map when those make the answer easier to use.
const ASK = `You are the AI in Cabrillo, a clearly labeled AI assistant inside a small student group chat where the group is making one plan.
Someone tagged you with @AI. Answer whatever they ask: about the plan, the options, the places, logistics, splitting costs, what to bring, ideas, or anything else, including questions that have nothing to do with the plan. Be helpful and specific, like a friendly, organized classmate.
Rules:
- You never vote, never decide for the group, and never pick a winner between the group's options; lay out trade-offs instead. For anything outside the plan (facts, ideas, advice, math), answer directly.
- You cannot see anyone's private limit unless it was shared in the chat. Never guess one.
- Prices, times, schedules and limits in this game are invented: for those, use only the information given. You may use common knowledge about real places and the world.
- You cannot browse. For live information (today's weather, hours right now, current prices), say you cannot check it live and give general guidance.
- People appear as codes such as P01 or A02. Refer to people only by code.
- Plain language. No emojis, no em dashes, no contractions. Keep "text" to at most 3 sentences; put detail in blocks.
- Use earlier questions and answers in the chat for follow-ups ("what about the second one").
- For pros and cons or a comparison, use one compare block. Compare only the options asked about; "the top two" means the two options with the most support so far.
Answer with one JSON object and nothing else:
{"text": "...", "blocks": [ ... ]}
"blocks" is optional, at most 2, and only when it helps. Blocks go inside the "blocks" array, never after the object. Block types:
{"type": "list", "title": "...", "items": ["...", ...]}            (up to 8 short items)
{"type": "steps", "title": "...", "items": ["...", ...]}           (up to 8 short steps, in order)
{"type": "table", "title": "...", "columns": ["...", ...], "rows": [["...", ...], ...]}   (up to 4 columns, 8 rows)
{"type": "compare", "title": "...", "items": [{"name": "<option name exactly as given>", "pros": ["..."], "cons": ["..."]}]}   (2 to 4 items; up to 3 pros and 3 cons each, at most 10 words each)
{"type": "pick", "field": "<part id>"}    (shows the options of one part of the plan as buttons to tap)
{"type": "map"}                           (shows the place options on a map)`;
const PRIVATE_NOTE = `
This question was asked privately: only the person who asked sees your answer. Speak to them directly ("you"). You may help them think through their own situation, or how to raise something with the group. Do not use a map block.`;

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
    const r = await chat(ASK + (ctx.private ? PRIVATE_NOTE : ''), `${context(ctx)}\n\nQuestion from ${ctx.asker}${ctx.private ? ' (asked privately)' : ''}: ${question}`, 700, { json: true, timeoutMs: 25000 });
    if (r?.text) {
      const a = parseAnswer(r.text, ctx.task);
      if (a.text) return { ...a, source: r.source };
    }
  } catch (e) { console.error('AI call failed, using scripted answer:', e.message); }
  return { text: scripted(question, ctx), blocks: [], source: 'scripted' };
}

// Without a key, "@AI pros and cons" still gets a card, filled with the app's own facts (see Table.compare).
const COMPARE_RE = /\b(pros?|cons?|compare|comparison|vs\.?|versus|difference|differences|better|best|which one|trade-?offs?|upsides?|downsides?|good and bad|worth it)\b/i;
export const wantsCompare = (q) => COMPARE_RE.test(q);

// ---------- the "AI hears" line ----------
const HEARING = `You are the AI in Cabrillo. You listen to a small group chat while the group makes one plan, and you keep one line above the chat that says what you are hearing.
Write ONE sentence of at most 22 words: what the group seems to want so far and what is still open or in conflict.
Include ideas people raised even if they are not on the option list. Do not give advice, do not take a side, do not invent anything.
Refer to people by their codes exactly as written (for example P01). Plain language, no emojis, no em dashes, no contractions.`;

// Returns null without a key, when the model is busy, or on any failure; the caller then keeps its rule-based line.
export async function summarize(ctx) {
  try {
    const t = ctx.task;
    const r = await chat(HEARING, `Task: ${t.prompt}\nParts of the plan and their options:\n${t.fields.map((f) => `- ${f.name}: ${f.options.map((x) => x.name).join(', ')}`).join('\n')}\nTally so far: ${ctx.summary}\nRecent chat (newest last):\n${ctx.recent}`, 80, { low: true });
    const text = r?.text?.replace(/\s+/g, ' ').replace(/^["']|["']$/g, '').trim();
    return text && text.length <= 240 ? { text, source: r.source } : null;
  } catch (e) { console.error('AI summary failed:', e.message); return null; }
}

// ---------- AI players ----------
// An AI player is a labeled seat filler that chats like a relaxed classmate. The model only writes the words and says
// which options the player now wants; the app checks every pick against the player's limit before it counts.
const PLAYER = `You are playing one member of a small college group chat. The others can see you are an AI player, so never claim to be human, but talk like a relaxed college student texting friends.
Write ONE short message (at most 16 words). Casual: lowercase is fine, contractions are fine, "tbh", "ngl", "lol" are fine sometimes. No emojis, no em dashes, no hashtags.
Reply to the newest message when there is one: answer a question if you can, react to an idea, or ask a short follow-up. Sound like a person, not a form ("sunday afternoon works, mornings i have practice" is good; "I would like Sunday afternoon for when" is bad).
Do not repeat or reword what someone else just said, and never repeat yourself. If you agree, say so in a few words and add one new thing: a reason, a small detail, or a question.
Stick to the options given for each part of the plan. Do not invent exact clock times, meeting spots, prices or places that are not in the options.
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
    const r = await chat(PLAYER, user, 120, { json: true });
    if (!r?.text) return null;
    const j = jsonObjects(unfence(r.text)).find((o) => typeof o.value?.text === 'string')?.value;
    if (!j) return null;
    const text = str(j.text, 200);
    if (!text) return null;
    return { text, picks: j.picks && typeof j.picks === 'object' ? j.picks : {}, mentionsLimit: !!j.mentions_limit, source: r.source };
  } catch (e) { console.error('AI player line failed:', e.message); return null; }
}
