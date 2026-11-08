// Checks every scenario: five limits, valid AI preferences, and at least one plan that respects every limit.
// Run: node tests/scenarios.mjs
import { TASKS } from '../server/tasks.js';
let bad = 0;
const fail = (t, m) => { bad++; console.log(`FAIL ${t}: ${m}`); };
for (const t of Object.values(TASKS)) {
  if (t.limits.length !== 5) fail(t.id, `has ${t.limits.length} limits, needs 5`);
  const ids = new Set();
  for (const f of t.fields) for (const x of f.options) { if (!x.kw?.length) fail(t.id, `${x.id} has no keywords`); }
  for (const l of t.limits) {
    if (ids.has(l.id)) fail(t.id, `duplicate limit ${l.id}`); ids.add(l.id);
    for (const [f, v] of Object.entries(l.aiPrefs)) { const fld = t.fields.find((x) => x.id === f); if (!fld || !fld.options.some((x) => x.id === v)) fail(t.id, `${l.id} aiPrefs ${f}=${v} invalid`); }
    if (!l.re.test(l.say)) fail(t.id, `${l.id}: its own AI line is not detected as a mention`);
    if (!l.re.test(l.text)) fail(t.id, `${l.id}: the card text is not detected as a mention`);
  }
  // enumerate every complete plan
  let plans = [{}];
  for (const f of t.fields) plans = plans.flatMap((p) => f.options.map((x) => ({ ...p, [f.id]: x.id })));
  const good = plans.filter((p) => t.limits.every((l) => !l.violates(p)));
  if (!good.length) fail(t.id, 'no plan respects all five limits');
  // every limit must rule something out, and no limit may rule out everything
  for (const l of t.limits) { const n = plans.filter((p) => l.violates(p)).length; if (n === 0 || n === plans.length) fail(t.id, `${l.id} rules out ${n} of ${plans.length} plans`); }
  console.log(`${t.id.padEnd(12)} ${t.fields.length} fields, ${plans.length} plans, ${good.length} respect all limits`);
}
console.log(bad ? `${bad} problem(s)` : `All ${Object.keys(TASKS).length} scenarios pass.`);
process.exit(bad ? 1 : 0);
