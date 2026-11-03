import { SCENARIO, useName, ruleBreaks } from './scenario.js';

// The Administrator answers only from public scenario data and facts players chose to share.
function publicContext(ctx) {
  const plan = SCENARIO.uses.map((u) => `${u.name} ${ctx.plan[u.id]}%`).join(', ');
  const layers = SCENARIO.layers.map((l) => `- ${l.name}: ${l.fact}`).join('\n');
  const shared = ctx.shared.length ? ctx.shared.map((s) => `- ${s.role}: ${s.fact}`).join('\n') : '- none yet';
  return `Place: ${SCENARIO.place}. Question for the group: ${SCENARIO.question}
Public map layers:
${layers}
Rules: the plan must add up to 100%. No single use may go above ${SCENARIO.maxUse}%. Plans change in steps of ${SCENARIO.step}%. The deal locks when every human player accepts a valid plan. AI players cannot vote.
Current stage: ${ctx.stage}, about ${ctx.secondsLeft} seconds left.
Current shared plan: ${plan}.
Facts players have chosen to share:
${shared}`;
}

const SYSTEM = `You are "the Administrator", a clearly labeled AI player in a 10 minute campus planning role-play for university students.
You keep time, explain the rules, and answer factual questions about the lot using ONLY the public information below.
Never invent facts. Never guess or reveal any player's private goal or private fact unless it appears under "Facts players have chosen to share".
Never tell the group what to choose and never take a side. You cannot vote.
Answer in at most 2 short sentences, plain language, no emojis, no em dashes, no contractions. If the answer is not in the public information, say you do not have that information.`;

async function callLLM(question, ctx) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    if (process.env.ANTHROPIC_API_KEY) {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST', signal: controller.signal,
        headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({
          model: process.env.AI_MODEL || 'claude-haiku-5-5', max_tokens: 160,
          system: `${SYSTEM}\n\n${publicContext(ctx)}`,
          messages: [{ role: 'user', content: question }]
        })
      });
      if (!r.ok) throw new Error(`Anthropic ${r.status}: ${(await r.text()).slice(0, 200)}`);
      const d = await r.json();
      return { text: d.content?.map((c) => c.text || '').join('').trim(), source: 'anthropic' };
    }
    if (process.env.OPENAI_API_KEY) {
      const r = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST', signal: controller.signal,
        headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          model: process.env.AI_MODEL || 'gpt-4o-mini', max_tokens: 160,
          messages: [{ role: 'system', content: `${SYSTEM}\n\n${publicContext(ctx)}` }, { role: 'user', content: question }]
        })
      });
      if (!r.ok) throw new Error(`OpenAI ${r.status}: ${(await r.text()).slice(0, 200)}`);
      const d = await r.json();
      return { text: d.choices?.[0]?.message?.content?.trim(), source: 'openai' };
    }
    return null;
  } finally { clearTimeout(timer); }
}

// Scripted answers: used when no API key is set, and as a fallback if the model fails.
function scripted(question, ctx) {
  const s = question.toLowerCase();
  const layer = (id) => SCENARIO.layers.find((l) => l.id === id).fact;
  if (/park|stall|car|commut/.test(s)) return layer('parking');
  if (/shade|tree|sun|west/.test(s)) return layer('shade');
  if (/noise|loud|quiet|dining/.test(s)) return layer('noise');
  if (/traffic|walk|busy|people|crowd/.test(s)) return layer('traffic');
  if (/rule|limit|40|max/.test(s)) {
    const b = ruleBreaks(ctx.plan);
    return `No single use may go above ${SCENARIO.maxUse}%. ${b.length ? `Right now ${b.map((u) => u.name).join(' and ')} ${b.length > 1 ? 'are' : 'is'} over the limit.` : 'The current plan follows the rule.'}`;
  }
  if (/vote|accept|deal|lock|win|end/.test(s)) return 'The deal locks when every human player taps Accept on a plan that adds up to 100% and follows the 40% rule. AI players cannot vote.';
  if (/time|long|left|minute/.test(s)) return `About ${ctx.secondsLeft} seconds are left in this stage.`;
  if (/secret|fact|goal|private|card/.test(s)) return "I cannot see or share anyone's private card. Players decide for themselves what to share.";
  return 'I can answer questions about foot traffic, shade, parking use, noise, the rules, and the time left. I cannot share anyone\'s private card.';
}

export async function answerQuestion(question, ctx) {
  try {
    const r = await callLLM(question, ctx);
    if (r?.text) return r;
  } catch (e) { console.error('AI call failed, using scripted answer:', e.message); }
  return { text: scripted(question, ctx), source: 'scripted' };
}

export const aiMode = () => (process.env.ANTHROPIC_API_KEY ? 'anthropic' : process.env.OPENAI_API_KEY ? 'openai' : 'scripted');
export { useName };
