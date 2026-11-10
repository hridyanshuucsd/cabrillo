// The listening AI's reading of the chat. Rule based, so it works without any API key and is easy to explain:
// it spots which plan options each person supports or rejects, and builds the shared "Plan so far".

const NEG_BEFORE = /\b(not|no|never|cannot|can't|cant|don't|dont|won't|wont|hate|skip|instead of|rather than|without|except|against|busy|working|work|practice|class|shift|booked|allergic to|avoid)\b[^.!?]{0,14}$/;
const NEG_AFTER = /^[^.!?]{0,16}\b(is out|are out|won't work|wont work|does not work|doesn't work|do not work|don't work|is bad|is too|no thanks|not for me|so not|not then|no good|is a no|can't make|cannot make|can't do|cannot do|won't be able|is not possible|isn't possible|is hard|are hard|is far|is expensive|is pricey|is packed|is crowded|is a pain|is rough)\b/;

const wordChar = (c) => !!c && ((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9'));
// Every place a keyword appears as whole words. A plural "s" or "es" is fine: "bus" matches "buses", but not "busy"
// or "business", and "$10" does not match "$100".
function keywordHits(s, kw) {
  const out = [];
  for (let from = 0; ;) {
    const i = s.indexOf(kw, from);
    if (i < 0) return out;
    const startOk = !wordChar(kw[0]) || !wordChar(s[i - 1]);
    const endOk = !wordChar(kw[kw.length - 1]) || /^(?:s|es)?(?:[^a-z0-9]|$)/.test(s.slice(i + kw.length, i + kw.length + 3));
    if (startOk && endOk) out.push(i);
    from = i + 1;
  }
}

// Who a mention is about, when it is not the writer: "let Kai travel by trolley", "Kai can take the bus",
// "I'll drive and Kai can take the bus". The name has to open its clause and lead straight to the option, with no
// "I", "we" or "my" in between. Agreement ("Kai is right, the bus is easiest") and "me and Kai" stay the writer's own.
const FIRST_PERSON = /\b(i|i'm|im|i'll|ill|i'd|i've|ive|me|my|mine|myself|we|we'll|we're|we'd|us|our|let's|lets)\b/;
const SUBJECT_BREAK = /[,;.!?]|\b(?:and|but|so|then|while)\s+(?:others|the others|the rest|everyone|everybody|we|i|you|they)\b/;
const NOT_ABOUT = /\b(right|agree|agreed|agrees|idea|point|true|correct|exactly)\b/;
const LEAD = '(?:let|have|make|ok|okay|so|then|maybe|and|but|well|yeah|yes|sure|hey|also|if|can|could|should|would|will|does|did|since|because|cause|cuz|what if|how about|what about|i think|i guess|i say|i feel like|imo|tbh|honestly)';
const CLAUSE_START = new RegExp(`(?:^|[,;.!?]|\\band|\\bbut)\\s*(?:${LEAD}\\s+)*$`);
const escapeRe = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function aboutWhom(s, at, people) {
  const part = s.slice(Math.max(0, at - 80), at);
  let best = null;
  for (const p of people) for (const name of p.names) {
    if (name.length < 2) continue;
    const re = new RegExp(`(^|[^a-z0-9@])(@?${escapeRe(name)})(?![a-z0-9'])`, 'g');
    let m, start = -1, end = -1;
    while ((m = re.exec(part))) { start = m.index + m[1].length; end = m.index + m[0].length; } // the last whole-word use of the name
    if (end < 0 || (best && end <= best.end)) continue;
    const between = part.slice(end), before = part.slice(0, start);
    if (between.length > 40 || SUBJECT_BREAK.test(between) || FIRST_PERSON.test(between) || NOT_ABOUT.test(between)) continue;
    if (/\b(i|me|myself|we|us)\s+and\s*$/.test(before) || !CLAUSE_START.test(before)) continue;
    best = { pcode: p.pcode, end };
  }
  return best?.pcode || null;
}

// Returns every option mentioned in a message, with whether the mention is negative.
// people (optional): the other people at the table, as [{ pcode, names }] with names in lowercase. A mention that is
// about one of them ("Kai can take the trolley") carries about: their code.
export function detectOptions(task, text, people) {
  const s = ` ${String(text).toLowerCase().replace(/[’‘]/g, "'")} `;
  const all = [];
  for (const f of task.fields) for (const opt of f.options) for (const raw of opt.kw) {
    const kw = raw.trim();
    for (const i of keywordHits(s, kw)) all.push({ field: f.id, option: opt.id, at: i, end: i + kw.length });
  }
  // Where two keywords overlap, the longer one is what the person wrote: "web app" is a website, not an app.
  const kept = [];
  for (const m of all.sort((a, b) => (b.end - b.at) - (a.end - a.at) || a.at - b.at)) {
    if (kept.some((k) => m.at < k.end && k.at < m.end && (k.field !== m.field || k.option !== m.option))) continue;
    kept.push(m);
  }
  const found = [];
  for (const m of kept.sort((a, b) => a.at - b.at)) {
    if (found.some((x) => x.field === m.field && x.option === m.option)) continue; // the first mention of each option
    const negative = NEG_BEFORE.test(s.slice(Math.max(0, m.at - 40), m.at)) || NEG_AFTER.test(s.slice(m.end, m.end + 30));
    const hit = { field: m.field, option: m.option, negative, at: m.at };
    const about = people?.length ? aboutWhom(s, m.at, people) : null;
    if (about) hit.about = about;
    found.push(hit);
  }
  // If one field has several mentions, keep them all (for example "Old Town instead of Torrey").
  return found;
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
  return words.length <= 4 && !/^(is|are|does|do|did|how|what|where|when|which|who|can|could|would|will|any|anyone|tell|give|name)$/.test(words[0]);
}

// prefs: { pcode: { field: option } }. Updates in place and returns what changed.
// people: see detectOptions. Something said about another person is noted (kind "about_other") and never counted as
// the writer's own wish.
export function applyMessage(task, prefs, pcode, text, people) {
  const mine = prefs[pcode] || (prefs[pcode] = {});
  const changes = [];
  const wish = statesWish(text);
  for (const m of detectOptions(task, text, people)) {
    if (m.about) {
      changes.push({ ...m, kind: 'about_other' });
    } else if (m.negative) {
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
// seated: the players at the table ({ pcode, isAI }).
//  - A part is "agreed" when more than half of the table wants the same option, and the people at the table lead it:
//    AI players fill empty seats, so their picks never settle a part on their own or break a tie between people.
//  - A personal part (for example Getting there) lets each person go their own way. It is also settled once every
//    seat has a pick, whatever the picks are. "own" lists the seats whose pick differs from the leading one.
export function buildPanel(task, prefs, seated) {
  const n = seated.length;
  const anyHuman = seated.some((p) => !p.isAI);
  return task.fields.map((f) => {
    const counts = {}, human = {};
    for (const p of seated) {
      const v = prefs[p.pcode]?.[f.id];
      if (!v) continue;
      (counts[v] = counts[v] || []).push(p.pcode);
      if (!p.isAI) human[v] = (human[v] || 0) + 1;
    }
    const ranked = Object.entries(counts).sort((a, b) => b[1].length - a[1].length);
    const top = ranked[0], second = ranked[1];
    let leader = top && (!second || top[1].length > second[1].length) ? top[0] : null;
    let status = 'open';
    if (ranked.length) status = 'split';
    if (leader) status = counts[leader].length > n / 2 ? 'agreed' : 'leaning';
    if (status === 'agreed' && anyHuman) {
      const mineH = human[leader] || 0;
      if (!mineH || Object.entries(human).some(([o, c]) => o !== leader && c >= mineH)) status = 'leaning';
    }
    let own = [];
    if (f.personal) {
      if (status !== 'agreed' && ranked.length && seated.every((p) => prefs[p.pcode]?.[f.id])) {
        // everyone has said how they will do it: settled, even if they all differ. The most common way leads
        // (with a tie, the one that people rather than AI players picked).
        leader = leader || [...ranked].sort((a, b) => b[1].length - a[1].length || (human[b[0]] || 0) - (human[a[0]] || 0))[0][0];
        status = 'agreed';
      }
      if (leader) own = seated.filter((p) => prefs[p.pcode]?.[f.id] && prefs[p.pcode][f.id] !== leader).map((p) => ({ pcode: p.pcode, option: prefs[p.pcode][f.id] }));
    }
    return {
      id: f.id, name: f.name, status, leader, personal: !!f.personal, own,
      options: ranked.map(([option, who]) => ({ option, name: f.options.find((x) => x.id === option)?.name || option, who }))
    };
  });
}

// Two people currently prefer different options for the same field. A personal part is never a conflict:
// each person can go their own way.
export function findConflict(panel) {
  for (const f of panel) {
    if (f.personal) continue;
    if (f.options.length >= 2 && f.status !== 'agreed') return { field: f, a: f.options[0], b: f.options[1] };
  }
  return null;
}

// Which part of the plan a message asks the group about, for example "what time tho?" asks about When.
// Returns a field id or null. Only questions count: a statement that names a part is not a question about it.
const TOPIC = [
  [/\b(what times?|which times?|when|what days?|which days?|times?|days?|dates?|hours?|o'?clock|how early|how late)\b/, ['when', 'day', 'time', 'meet', 'start', 'lease', 'draft']],
  [/\b(where|what place|which place|location|spot|area|meet up|meet)\b/, ['where', 'area', 'stay', 'show']],
  [/\b(get there|getting there|how do we get|how are we getting|drive|driving|ride|rides|transport|travel|bus|car|cars)\b/, ['travel', 'transport', 'ride', 'truck']],
  [/\b(budget|cost|costs|price|how much|spend|money|afford|pay|rent)\b/, ['budget', 'rent', 'payer', 'app', 'split']],
  [/\b(eat|food|drink|drinks|snack|snacks|grocer|groceries|dinner|lunch|menu)\b/, ['food', 'main', 'drinks', 'snacks', 'groceries']],
  [/\b(what should we do|what do we do|activity|which game|what game|which sport|what show|gift|project)\b/, ['what', 'game', 'sport', 'show', 'gift', 'idea']],
];
// A question, or a request to the group ("tell me an exact hour").
const REQUEST = /^(?:ok |okay |so |and |then |pls |please |can someone |someone |somebody )*(tell me|give me|name an?|lmk|let me know|pick an?|choose an?)\b|\b(tell me|give me|let me know|lmk)\b/;
export function isQuestion(text) {
  const s = String(text).toLowerCase().trim();
  return s.includes('?') || /^(what|where|when|how|which|who|should|shall|any|thoughts|ideas|anyone|so what|ok what|okay what)\b/.test(s) || /\b(should we|thoughts\??$|any ideas|you guys think|y'all think)\b/.test(s) || REQUEST.test(s);
}
export function topicOf(task, text) { return isQuestion(text) ? topicIn(task, text) : null; }
// The part of the plan a message is about, question or not.
export function topicIn(task, text) {
  const s = ` ${String(text).toLowerCase()} `;
  const ids = new Set(task.fields.map((f) => f.id));
  // A field named in the question by its own name wins (for example "what about quiet hours?").
  for (const f of task.fields) if (keywordHits(s, f.name.toLowerCase()).length) return f.id;
  for (const [re, fields] of TOPIC) if (re.test(s)) { const hit = fields.find((id) => ids.has(id)); if (hit) return hit; }
  return null;
}

// Two chat messages that say the same thing: used to stop AI players from repeating themselves or each other.
const FILLER = new Set(['the', 'a', 'an', 'for', 'me', 'i', 'im', 'is', 'it', 'its', 'to', 'of', 'and', 'so', 'we', 'us', 'that', 'this', 'works', 'work', 'sounds', 'good', 'yeah', 'yep', 'ok', 'okay', 'lol', 'tbh', 'ngl', 'too', 'be', 'do', 'can', 'on', 'in', 'at', 'my', 'with', 'just', 'then', 'still', 'also', 'honestly', 'think', 'would', 'could', 'are', 'you', 'all', 'guys']);
const contentWords = (t) => [...new Set(String(t).toLowerCase().replace(/[^a-z0-9$ ]/g, ' ').split(/\s+/).filter((w) => w && !FILLER.has(w)))];
const squash = (t) => String(t).toLowerCase().replace(/[^a-z0-9$]+/g, ' ').trim();
export function sameMessage(a, b) {
  if (squash(a) === squash(b)) return true;
  const x = contentWords(a), y = new Set(contentWords(b));
  if (!x.length) return false;
  if (x.length === 1) return y.size <= 2 && y.has(x[0]); // two short messages about the same single thing
  return x.filter((w) => y.has(w)).length / x.length >= 0.75;
}
