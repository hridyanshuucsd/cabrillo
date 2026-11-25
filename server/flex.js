// Flexible wishes. People rarely want exactly one thing: "Friday or Saturday works", "I'm easy on the budget",
// "I could do $30 if I have to". This module reads those from a chat message so the AI can note them, and works out
// what an option means for each person: their pick, also fine, fine if needed, or ruled out.
import { detectOptions, statesWish, topicIn } from './listener.js';

// "I'm flexible", "either works", "I can compromise", "whatever works for you guys".
const FLEX_RE = /\b(?:i'?m|i am|im)\s+(?:pretty |very |totally |super )?(?:flexible|easy|open|down for (?:anything|whatever|either)|fine with (?:anything|whatever|either|any of (?:them|those)|both))\b|\b(?:either (?:works|one works|is fine|one is fine|way works|is good)|any (?:of (?:them|those) (?:work|works|is fine)|time works|day works|works for me)|both work|whatever works|i can compromise|i'?m happy to compromise|happy to compromise|can be flexible|could be flexible|open to (?:anything|whatever|either|both)|don'?t mind (?:which|either|whatever)|no preference|no strong (?:preference|opinion)|up to you(?: guys| all)?|i'?ll go with (?:whatever|the group|the majority))\b/i;
// "I'm not flexible on the budget", "I can't compromise on that".
const RIGID_RE = /\b(?:not (?:very |that |really )?flexible|can'?t compromise|cannot compromise|won'?t compromise|no flexibility)\b/i;
// An option that is fine but not the person's first choice: "$30 if I have to", "Saturday could work if needed".
const STRETCH_RE = /\b(?:if (?:needed|need be|we have to|i have to|i must|necessary|everyone (?:else )?wants|you (?:guys|all) want|y'?all want|that'?s easier|it helps)|can stretch|could stretch|i could do|i could live with|i can live with|not ideal but|would be ok(?:ay)?|works in a pinch|as a backup|second choice)\b/i;

// What one message says about flexibility. Returns
//   multi:   { field: [options] } two or more options of one part named as fine ("Friday or Saturday")
//   stretch: [{ field, option }] options named as fine if needed (not a first choice)
//   flex:    [field] parts the person said they can go either way on ('*' when they did not say which)
//   rigid:   [field] parts they said they are not flexible on
export function readFlex(task, text, people) {
  const out = { multi: {}, stretch: [], flex: [], rigid: [] };
  const s = String(text || '');
  const found = detectOptions(task, s, people).filter((m) => !m.about && !m.negative);
  const wish = statesWish(s);
  const stretch = STRETCH_RE.test(s);
  if (wish || stretch) {
    const byField = {};
    for (const m of found) (byField[m.field] = byField[m.field] || []).push(m.option);
    for (const [f, opts] of Object.entries(byField)) {
      if (stretch && opts.length === 1) out.stretch.push({ field: f, option: opts[0] });
      else if (opts.length >= 2) out.multi[f] = opts;
    }
  }
  const named = [...new Set([...found.map((m) => m.field), ...detectOptions(task, s, people).map((m) => m.field)])];
  const topic = topicIn(task, s);
  const fields = named.length ? named : topic ? [topic] : ['*'];
  if (RIGID_RE.test(s)) out.rigid = fields;
  else if (FLEX_RE.test(s)) out.flex = fields;
  return out;
}

// How one option sits with one person: 'pick', 'yes' (also fine), 'maybe' (fine if needed), 'no', or null (not said).
// marks: their availability marks for the part; flexible: they said they can go either way on it.
export function stance(option, pick, marks, flexible) {
  if (marks?.[option] === 'no') return 'no';
  if (pick === option) return 'pick';
  if (marks?.[option] === 'yes') return 'yes';
  if (marks?.[option] === 'maybe') return 'maybe';
  return flexible ? 'yes' : null;
}
