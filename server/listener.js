// The listening AI's reading of the chat. Rule based, so it works without any API key and is easy to explain:
// it spots which plan options each person supports or rejects, and builds the shared "Plan so far".

const NEG_BEFORE = /\b(not|no|never|cannot|can't|cant|don't|dont|won't|wont|hate|skip|instead of|rather than|without|except|against|busy|working|work|practice|class|shift|booked|allergic to|avoid)\b[^.!?]{0,14}$/;
const NEG_AFTER = /^[^.!?]{0,16}\b(is out|are out|won't work|wont work|does not work|doesn't work|do not work|don't work|is bad|is too|no thanks|not for me|so not|not then|no good|is a no|can't make|cannot make|can't do|cannot do|won't be able|is not possible|isn't possible)\b/;

// Returns every option mentioned in a message, with whether the mention is negative.
export function detectOptions(task, text) {
  const s = ` ${String(text).toLowerCase()} `;
  const found = [];
  for (const f of task.fields) {
    for (const opt of f.options) {
      // Use the earliest keyword in the message (the longest one if two start at the same place).
      let best = null;
      for (const kw of opt.kw) {
        const i = s.indexOf(kw);
        if (i >= 0 && (!best || i < best.i || (i === best.i && kw.length > best.kw.length))) best = { i, kw };
      }
      if (!best) continue;
      const { i, kw } = best;
      const negative = NEG_BEFORE.test(s.slice(Math.max(0, i - 40), i)) || NEG_AFTER.test(s.slice(i + kw.length, i + kw.length + 30));
      found.push({ field: f.id, option: opt.id, negative, at: i });
    }
  }
  // If one field has several mentions, keep them all (for example "Old Town instead of Torrey").
  return found.sort((a, b) => a.at - b.at);
}

// A message can name an option without asking for it: "if we take an uber, what does each of us pay?" or
// "is Old Town far?". Those do not count as a wish. A proposal phrased as a question does: "how about Old Town?",
// "should we take the bus?", or a bare "Old Town?".
const PROPOSAL = /\b(how about|what about|what if|should we|shall we|can we|could we|why don't we|why dont we|why not|let's|lets|let us|wanna|want to|maybe|i vote|i say|i'm thinking|im thinking|i am thinking|down for|i'd go|id go|i would go|i prefer|i'd prefer|i like|i love|we could|we should)\b/;
export function statesWish(text) {
  const s = String(text).toLowerCase().trim();
  const proposal = PROPOSAL.test(s);
  if (/^(if|suppose|assuming|say we)\b/.test(s) && !proposal) return false;
  if (!isQuestion(s)) return true;
  if (proposal) return true;
  const words = s.replace(/[^a-z0-9$' ]/g, ' ').trim().split(/\s+/);
  return words.length <= 4 && !/^(is|are|does|do|did|how|what|where|when|which|who|can|could|would|will|any|anyone)$/.test(words[0]);
}

// prefs: { pcode: { field: option } }. Updates in place and returns what changed.
export function applyMessage(task, prefs, pcode, text) {
  const mine = prefs[pcode] || (prefs[pcode] = {});
  const changes = [];
  const wish = statesWish(text);
  for (const m of detectOptions(task, text)) {
    if (m.negative) {
      if (mine[m.field] === m.option) { delete mine[m.field]; changes.push({ ...m, kind: 'dropped' }); }
      else changes.push({ ...m, kind: 'rejected' });
    } else if (!wish) {
      changes.push({ ...m, kind: 'asked_about' }); // named in a question or a what-if: noted, not counted
    } else if (mine[m.field] !== m.option) {
      mine[m.field] = m.option; changes.push({ ...m, kind: 'supports' });
    }
  }
  return changes;
}

// Builds the panel: for each field, who supports what, the leading option, and a status.
export function buildPanel(task, prefs, seated) {
  const n = seated.length;
  return task.fields.map((f) => {
    const counts = {};
    for (const p of seated) { const v = prefs[p.pcode]?.[f.id]; if (v) (counts[v] = counts[v] || []).push(p.pcode); }
    const ranked = Object.entries(counts).sort((a, b) => b[1].length - a[1].length);
    const top = ranked[0], second = ranked[1];
    const leader = top && (!second || top[1].length > second[1].length) ? top[0] : null;
    let status = 'open';
    if (ranked.length) status = 'split';
    if (leader) status = counts[leader].length > n / 2 ? 'agreed' : 'leaning';
    return {
      id: f.id, name: f.name, status, leader,
      options: ranked.map(([option, who]) => ({ option, name: f.options.find((x) => x.id === option)?.name || option, who }))
    };
  });
}

// Two people currently prefer different options for the same field.
export function findConflict(panel) {
  for (const f of panel) {
    if (f.options.length >= 2 && f.status !== 'agreed') return { field: f, a: f.options[0], b: f.options[1] };
  }
  return null;
}

// Which part of the plan a message asks the group about, for example "what time tho?" asks about When.
// Returns a field id or null. Only questions count: a statement that names a part is not a question about it.
const TOPIC = [
  [/\b(what time|which time|when|what day|which day|time|day|date)\b/, ['when', 'day', 'time', 'meet', 'start', 'lease', 'draft']],
  [/\b(where|what place|which place|location|spot|area|meet up|meet)\b/, ['where', 'area', 'stay', 'show']],
  [/\b(get there|getting there|how do we get|drive|ride|transport|travel|bus|car)\b/, ['travel', 'transport', 'ride', 'truck']],
  [/\b(budget|cost|price|how much|spend|money|afford|pay|rent)\b/, ['budget', 'rent', 'payer', 'app', 'split']],
  [/\b(eat|food|drink|snack|grocer|dinner|lunch|menu)\b/, ['food', 'main', 'drinks', 'snacks', 'groceries']],
  [/\b(what should we do|what do we do|activity|which game|what game|which sport|what show|gift|project)\b/, ['what', 'game', 'sport', 'show', 'gift', 'idea']],
];
export function isQuestion(text) {
  const s = String(text).toLowerCase().trim();
  return s.includes('?') || /^(what|where|when|how|which|who|should|shall|any|thoughts|ideas|anyone|so what|ok what|okay what)\b/.test(s) || /\b(should we|thoughts\??$|any ideas|you guys think|y'all think)\b/.test(s);
}
export function topicOf(task, text) { return isQuestion(text) ? topicIn(task, text) : null; }
// The part of the plan a message is about, question or not.
export function topicIn(task, text) {
  const s = ` ${String(text).toLowerCase()} `;
  const ids = new Set(task.fields.map((f) => f.id));
  // A field named in the question by its own name wins (for example "what about quiet hours?").
  for (const f of task.fields) if (s.includes(f.name.toLowerCase())) return f.id;
  for (const [re, fields] of TOPIC) if (re.test(s)) { const hit = fields.find((id) => ids.has(id)); if (hit) return hit; }
  return null;
}
