// The listening AI's reading of the chat. Rule based, so it works without any API key and is easy to explain:
// it spots which plan options each person supports or rejects, and builds the shared "Plan so far".

const NEG_BEFORE = /\b(not|no|never|cannot|can't|cant|don't|dont|won't|wont|hate|skip|instead of|rather than|without|except|against)\b[^.!?]{0,14}$/;
const NEG_AFTER = /^[^.!?]{0,16}\b(is out|won't work|wont work|does not work|doesn't work|is bad|is too|no thanks|not for me)\b/;

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

// prefs: { pcode: { field: option } }. Updates in place and returns what changed.
export function applyMessage(task, prefs, pcode, text) {
  const mine = prefs[pcode] || (prefs[pcode] = {});
  const changes = [];
  for (const m of detectOptions(task, text)) {
    if (m.negative) {
      if (mine[m.field] === m.option) { delete mine[m.field]; changes.push({ ...m, kind: 'dropped' }); }
      else changes.push({ ...m, kind: 'rejected' });
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
