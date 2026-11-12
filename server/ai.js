// Everything that talks to a language model: answers to @AI questions, the "AI hears" line, and AI players' messages.
// Uses OpenAI or Anthropic when a key is set. Without a key, or when a call fails, the app falls back to rules and
// scripted lines, so a class session never depends on the model being up.

import { parseHours, typicalHours } from './artifacts.js';

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
  const once = () => (process.env.ANTHROPIC_API_KEY ? anthropic(system, user, maxTokens, controller.signal) : openai(system, user, maxTokens, json, controller.signal));
  try {
    try { return await once(); }
    catch (e) {
      // "Too many requests": an answer someone is waiting for gets one more try after a short pause; the "AI hears" line does not.
      if (low || !/ 429 /.test(String(e.message))) throw e;
      await new Promise((r) => setTimeout(r, 1500));
      return await once();
    }
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
    else if (b.type === 'todo' && strs(b.items, 8, 120).length) out.push({ type: 'todo', items: strs(b.items, 8, 120) });
    else if (b.type === 'bring' && strs(b.items, 8, 60).length) out.push({ type: 'bring', items: strs(b.items, 8, 60) });
    else if (b.type === 'agree' && strs(b.items, 4, 120).length) out.push({ type: 'agree', items: strs(b.items, 4, 120) });
    else if (b.type === 'weather') out.push({ type: 'weather' });
    else if (b.type === 'itinerary') out.push({ type: 'itinerary' });
    else if (b.type === 'pay') {
      const rows = (Array.isArray(b.rows) ? b.rows : []).slice(0, 10).map((r) => ({ who: str(r?.who, 40), to: str(r?.to, 40), for: str(r?.for, 60), amount: Math.round(Number(r?.amount) * 100) / 100 }))
        .filter((r) => r.who && r.amount > 0 && r.amount < 100000);
      if (rows.length) out.push({ type: 'pay', title: title || 'Who owes what', rows });
    }
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
  const fields = t.fields.map((f) => `- ${f.name} (part id ${f.id}${f.personal ? '; each person may choose their own, so people can differ here' : ''}): ${f.options.map((x) => x.name).join(', ')}`).join('\n');
  const info = t.info.map((i) => `- ${i.text}`).join('\n');
  return `Task for the group: ${t.prompt}
Parts of the plan and their options:
${fields}
Game information:
${info}
Plan so far (from the chat and taps):
${ctx.summary}
${ctx.facts ? `What the app knows about the options:\n${ctx.facts}\n` : ''}${ctx.people ? `Basic facts about each person at the table (fine to use):\n${ctx.people}\n` : ''}Recent chat, including earlier questions to the AI and its answers (people appear as codes such as P01; AI players, who fill empty seats, by first name; the AI as AI; newest last):
${ctx.recent || '(nothing yet)'}`;
}

// The AI answers anything a person asks, in the shape that fits best. Plain sentences by default; a list, steps,
// a table, pros and cons, plan options to tap, or a map when those make the answer easier to use.
const ASK = `You are the AI in Cabrillo, a clearly labeled AI assistant inside a small student group chat where the group is making one plan.
Someone tagged you with @AI. Answer whatever they ask: about the plan, the options, the places, logistics, splitting costs, what to bring, ideas, or anything else, including questions that have nothing to do with the plan. Be helpful and specific, like a friendly, organized classmate.
Rules:
- You never vote, never decide for the group, and never pick a winner between the group's options; lay out trade-offs instead. For anything outside the plan (facts, ideas, advice, math), answer directly.
- You cannot see anyone's private limit unless it was shared in the chat. Never guess one.
- The game's own prices, times and limits are invented: for those, use only the information given. Real-world facts about real places are fine.
- Everyone at the table is a student at UC San Diego (La Jolla, San Diego, California). Unless they say otherwise, assume they mean places in and around San Diego. Never ask for their location.
- When you have web search, use it for real-world and current information (places near campus, hours, prices, events, weather, reviews) and name real places. Without it, give your best general knowledge of San Diego and say that details such as hours and prices may have changed.
- People appear as codes such as P01, and AI players by first name. When you mention a person, write the code exactly as given (for example P01); never invent a name.
- Plain language. No emojis, no em dashes, no contractions. Keep "text" short: at most 2 sentences and 30 words. The chat moves fast; put any detail in blocks, which appear on the group's plan board.
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
{"type": "map"}                           (shows the place options on a map)
{"type": "pay", "title": "...", "rows": [{"who": "<code or AI player name>", "amount": 25.5, "to": "<code, AI player name, or a payee such as the restaurant>", "for": "..."}]}   (who owes whom how much, as a card each person can pay from through the AI; use it when people ask who owes what, want to split a cost, or want to pay; amounts in dollars, worked out from the facts given)
{"type": "todo", "items": ["...", ...]}   (tasks the group still has to do; they are added to the group's shared to-do list, where people can claim them)
{"type": "bring", "items": ["...", ...]}  (things someone has to bring; they are added to the group's who-brings-what list, where people claim them)
{"type": "agree", "items": ["...", ...]}  (a rule or promise the group has clearly agreed on in the chat, such as "we split gas evenly"; it goes on the agreements card for everyone to stamp; never for something still under discussion)
{"type": "weather"}                       (shows the forecast for the plan's place and day on the board)
{"type": "itinerary"}                     (shows the day as a timeline on the board: meeting up, getting there, the main event, getting back)
When people ask who owes what, use a pay block (not a table) so they can pay from it. When people ask what else they need to do, use a todo block. When people ask what to bring, use a bring block. When people ask about the weather, use a weather block and say the forecast is on the board; when they ask about the schedule or timing of the day, use an itinerary block.`;
const PRIVATE_NOTE = `
This question was asked privately: only the person who asked sees your answer. Speak to them directly ("you"). You may help them think through their own situation, or how to raise something with the group.
You do not know their private limit unless they typed it in this private exchange. If they mention "my limit" without saying what it is, do not assume what it is about (money, time, travel or anything else): give wording they can fill in, or ask them what it is.
Do not use a map block.`;

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

// ---------- @AI with web search ----------
// Questions about the real world (places near campus, hours, prices, events, weather) are answered with OpenAI's
// web search through the Responses API. Sources come back as links under the answer. Any failure falls back to the
// ordinary answer, so a question always gets a reply.
const LIVE_RE = /\b(near|nearby|close to (campus|ucsd|us)|around (here|campus|ucsd)|open (now|late|today|on)|opening hours|hours|closes|address|recommend|recommendations?|suggest some|reviews?|rated|rating|tickets?|menu|weather|forecast|today|tonight|tomorrow|this (weekend|week|friday|saturday|sunday)|events?|happening|availability|reservations?|deals?|discounts?|look ?up|search|google|real (places?|options?)|in san diego|what (are|is) (some|the best|good)|any good)\b/i;
export const wantsSearch = (q) => process.env.AI_SEARCH !== 'off' && !!process.env.OPENAI_API_KEY && !process.env.ANTHROPIC_API_KEY && LIVE_RE.test(q);
const SEARCH_MODELS = ['gpt-6.1-terra', 'gpt-6-astra', 'gpt-5.6-terra'];
let searchModel = null;
async function searchAnswer(system, user) {
  if (!(await takeSlot(false))) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 35000);
  state.calls++;
  try {
    const chain = process.env.AI_SEARCH_MODEL ? [process.env.AI_SEARCH_MODEL] : [...new Set([searchModel, state.model, ...SEARCH_MODELS].filter(Boolean))];
    for (const model of chain) {
      for (const reasoning of [{ effort: 'low' }, null]) {
        const body = { model, instructions: system, input: user, max_output_tokens: 4000,
          tools: [{ type: 'web_search', user_location: { type: 'approximate', country: 'US', city: 'San Diego', region: 'California', timezone: 'America/Los_Angeles' } }] };
        if (reasoning) body.reasoning = reasoning;
        const r = await fetch('https://api.openai.com/v1/responses', { method: 'POST', signal: controller.signal,
          headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
        if (r.ok) {
          const d = await r.json();
          const parts = (d.output || []).filter((o) => o.type === 'message').flatMap((o) => o.content || []).filter((c) => c.type === 'output_text');
          const text = d.output_text || parts.map((c) => c.text).join('\n');
          const links = [];
          for (const a of parts.flatMap((c) => c.annotations || [])) if (a.type === 'url_citation' && a.url && !links.some((l) => l.url === a.url)) links.push({ url: a.url, title: str(a.title || a.url, 80) });
          if (!text) break;
          searchModel = model;
          return { text, links: links.slice(0, 5), source: `openai-search:${model}` };
        }
        if (r.status === 429) { state.coolUntil = Date.now() + 8000; throw new Error('search rate limited'); }
        if (r.status !== 400) break; // this model cannot search with this key: try the next
      }
    }
    throw new Error('no model could search');
  } catch (e) { state.failures++; throw e; }
  finally { clearTimeout(timer); freeSlot(); }
}
// Markdown links and citation markers that search answers put inside the text: the sources are shown as links instead.
const unlink = (t) => String(t).replace(/\s*\(\[[^\]]*\]\([^)]*\)\)/g, '').replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '$1').replace(/【[^】]*】/g, '');

// ---------- menus ----------
// A restaurant's menu: real dishes and prices from web search when that works, otherwise a sample menu for that kind
// of food, clearly marked as a sample.
const SAMPLE_MENUS = [
  [/korean|bbq|barbecue|kbbq/i, [['Bulgogi combo', 24], ['Pork belly', 22], ['Short rib', 29], ['Kimchi fried rice', 14], ['Japchae', 13], ['Tofu stew', 15]]],
  [/pizza|italian/i, [['Margherita pizza', 16], ['Pepperoni pizza', 18], ['Caesar salad', 11], ['Garlic knots', 7], ['Penne alla vodka', 19], ['Tiramisu', 9]]],
  [/ramen|japanese|sushi|omakase/i, [['Tonkotsu ramen', 16], ['Spicy miso ramen', 17], ['Veggie ramen', 15], ['Gyoza', 8], ['Karaage', 9], ['Matcha ice cream', 6]]],
  [/taco|mexican|old town/i, [['Carne asada tacos', 13], ['Fish tacos', 14], ['California burrito', 12], ['Veggie burrito', 11], ['Chips and guacamole', 8], ['Horchata', 4]]],
  [/dim sum|chinese|convoy/i, [['Har gow', 8], ['Siu mai', 8], ['BBQ pork buns', 7], ['Turnip cake', 7], ['Chow mein', 13], ['Egg tarts', 6]]],
  [/cafe|coffee|bakery|brunch/i, [['Latte', 6], ['Avocado toast', 12], ['Breakfast burrito', 13], ['Croissant', 5], ['Acai bowl', 13], ['Iced tea', 4]]],
  [/court|price center|campus/i, [['Burger and fries', 11], ['Chicken bowl', 12], ['Burrito', 10], ['Salad', 10], ['Boba tea', 6], ['Smoothie', 7]]]
];
export async function menuFor(name, address) {
  if (wantsSearch('menu near') && process.env.AI_SEARCH !== 'off') {
    try {
      const r = await searchAnswer('Find the current menu of the named restaurant in San Diego. Answer with JSON only: {"items": [{"name": "...", "price": 12.5, "note": "..."}]} with 6 to 10 popular items and their prices in US dollars. If you cannot find this restaurant, answer {"items": []}.', `Restaurant: ${name}, ${address}`);
      const j = r?.text ? jsonObjects(unfence(unlink(r.text))).map((o) => o.value).find((v) => Array.isArray(v?.items)) : null;
      const items = (j?.items || []).map((x) => ({ name: str(x?.name, 50), price: Math.round(Number(x?.price) * 100) / 100, note: str(x?.note, 60) })).filter((x) => x.name && x.price > 0 && x.price < 200).slice(0, 10);
      if (items.length >= 3) return { items, source: r.source, links: r.links, sample: false };
    } catch (e) { console.error('Menu search failed, using a sample menu:', e.message); }
  }
  const hit = SAMPLE_MENUS.find(([re]) => re.test(`${name} ${address}`)) || [null, [['House special', 15], ['Salad', 10], ['Sandwich', 12], ['Soup', 8], ['Dessert', 7], ['Drink', 4]]];
  return { items: hit[1].map(([n, price]) => ({ name: n, price })), source: 'sample', sample: true };
}

// ---------- opening hours ----------
// A place's weekly hours from web search when that works; otherwise the typical hours for that kind of place, which
// the app labels as typical. Never invented as if real.
export async function hoursFor(name, address) {
  if (address && wantsSearch('opening hours')) { // only real places with an address; the game's own options get typical hours
    try {
      const r = await searchAnswer('Find the current opening hours of the named place in San Diego. Answer with JSON only: {"kind": "<kind of place, 1 to 3 words>", "always": false, "hours": {"sun": "11:00-21:00", "mon": "closed", "tue": "...", "wed": "...", "thu": "...", "fri": "...", "sat": "..."}} using 24-hour times. For a beach, park or trail that is always open, answer {"kind": "...", "always": true}. If you cannot find the place, answer {"hours": null}.', `Place: ${name}, ${address}`);
      const j = r?.text ? jsonObjects(unfence(unlink(r.text))).map((o) => o.value).find((v) => v && ('hours' in v || 'always' in v)) : null;
      const hours = parseHours(j);
      if (hours) return { hours: { ...hours, kind: str(hours.kind, 30) }, links: r.links || [] };
    } catch (e) { console.error('Hours search failed, using typical hours:', e.message); }
  }
  return { hours: typicalHours(name), links: [] };
}

export async function answerQuestion(question, ctx) {
  if (wantsSearch(question)) {
    try {
      const r = await searchAnswer(ASK + (ctx.private ? PRIVATE_NOTE : '') + '\nYou have web search for this question.', `${context(ctx)}\n\nQuestion from ${ctx.asker}${ctx.private ? ' (asked privately)' : ''}: ${question}`);
      if (r?.text) {
        const a = parseAnswer(unlink(r.text), ctx.task);
        a.text = unlink(a.text);
        for (const b of a.blocks) if (b.items) b.items = b.items.map(unlink);
        if (a.text) return { ...a, links: r.links, source: r.source };
      }
    } catch (e) { console.error('AI search failed, answering without it:', e.message); }
  }
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
People appear as codes such as P01, and AI players by first name: write them exactly as given. Plain language, no emojis, no em dashes, no contractions.`;

// Returns null without a key, when the model is busy, or on any failure; the caller then keeps its rule-based line.
export async function summarize(ctx) {
  try {
    const t = ctx.task;
    const r = await chat(HEARING, `Task: ${t.prompt}\nParts of the plan and their options:\n${t.fields.map((f) => `- ${f.name}${f.personal ? ' (each person may choose their own)' : ''}: ${f.options.map((x) => x.name).join(', ')}`).join('\n')}\nTally so far: ${ctx.summary}\nRecent chat (newest last):\n${ctx.recent}`, 80, { low: true });
    const text = r?.text?.replace(/\s+/g, ' ').replace(/^["']|["']$/g, '').trim();
    return text && text.length <= 240 ? { text, source: r.source } : null;
  } catch (e) { console.error('AI summary failed:', e.message); return null; }
}

// ---------- AI players ----------
// An AI player is a labeled seat filler that chats like a relaxed classmate. The app decides what the player does on
// its turn (answer a question, agree, say its limit, nudge an open part) and what it may pick; the model only words
// it. Every line is checked again by the app before it is posted (see Table.aiPlayerSpeak).
const PLAYER = `You write the chat messages of one AI player in a small group chat of college students who are making a plan together. An AI player is a clearly labeled stand-in that fills an empty seat. Everyone can see the label, so never pretend to be human, and do not mention being an AI unless someone asks.

Voice: a relaxed college student texting friends. Short, specific, natural. Lowercase is fine. Light slang at most ("tbh", "lowkey", "down"), and not in every message. No emojis, no em dashes, no hashtags.

Every message:
- Does exactly what "Your move" says and nothing else. One message, one point, at most 14 words.
- Is new. Never repeat or reword your earlier messages or what someone else just said. If you only agree, two or three words are enough ("works for me", "same", "i'm down").
- Leaves settled parts alone. Do not bring up a part listed under "Settled" unless your move is about it.
- Is honest about the plan. Never say the plan is done, set or sorted while anything is listed under "Still open".
- Uses the plan's options. If someone asks for a detail the options do not cover (an exact hour, a meeting spot), suggest one that fits what is settled.
- Names people correctly. People appear as codes such as P01. If you mention a person, write the code exactly (P01), never a made-up name. Other AI players appear by first name. Most messages need no name at all.

Reply with JSON only: {"text": "...", "picks": {"<part id>": "<option id>"}, "mentions_limit": true or false}
"picks": options your message says you want for yourself, using the ids given; leave it empty if the message states no choice. "mentions_limit": true only when the message tells the group about your private limit.`;

const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu;
// One short chat line: no quotes around it and no emojis.
export function tidyLine(text) {
  let t = str(text, 240).replace(EMOJI, '').replace(/^["'“”]+|["'“”]+$/g, '').replace(/\s+/g, ' ').trim();
  // Too long: keep the first sentence if that is a whole thought, otherwise drop the line (never cut mid-sentence).
  if (t.length > 140) { const end = t.search(/[.?!](\s|$)/); t = end >= 12 && end < 140 ? t.slice(0, end + 1) : ''; }
  return t;
}

// ctx: task, name, persona, settled, open, wants, limit, shared, fits, recent, said (own earlier lines), move.
export async function playerLine(ctx) {
  try {
    const t = ctx.task;
    const parts = t.fields.map((f) => `- ${f.name} [${f.id}]${f.personal ? ' (each person may go their own way)' : ''}: ${f.options.map((o) => `${o.name} [${o.id}]`).join('; ')}`).join('\n');
    const user = `You are ${ctx.name}. ${ctx.persona}
The task: ${t.prompt}
Parts of the plan and their options (ids in brackets):
${parts}
Settled: ${ctx.settled || 'nothing yet'}
Still open: ${ctx.open || 'nothing; every part has a choice'}
What you would pick: ${ctx.wants || 'nothing in particular, you are easygoing'}
About you (true; say these when asked): ${ctx.about || 'nothing special'}
Your private limit: "${ctx.limit}" ${ctx.shared ? 'You have already told the group.' : 'The group does not know it yet.'}${ctx.fits === false ? ' The plan so far breaks it.' : ''}
Recent chat (newest last):
${ctx.recent || '(nobody has said anything yet)'}
Your earlier messages (never repeat or reword these):
${ctx.said?.length ? ctx.said.map((x) => `- ${x}`).join('\n') : '(none yet)'}
Your move: ${ctx.move}`;
    const r = await chat(PLAYER, user, 120, { json: true });
    if (!r?.text) return null;
    const j = jsonObjects(unfence(r.text)).find((o) => typeof o.value?.text === 'string')?.value;
    if (!j) return null;
    const text = tidyLine(j.text);
    if (!text) return null;
    return { text, picks: j.picks && typeof j.picks === 'object' ? j.picks : {}, mentionsLimit: !!j.mentions_limit, source: r.source };
  } catch (e) { console.error('AI player line failed:', e.message); return null; }
}
