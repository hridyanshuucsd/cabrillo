// Analytics for one class session, computed from the database (sessions, players, logs, feedback), so it works after
// the session is over and after a server restart. Everything is keyed by player codes; no names or emails.
// Used by the analytics page, by tables.csv and participants.csv, and by the transcript view.
import { q } from './db.js';
import { TASKS } from './tasks.js';

const round = (x, d = 1) => (x === null || x === undefined || Number.isNaN(x) ? null : Math.round(x * 10 ** d) / 10 ** d);
const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const mean = (xs) => (xs.length ? sum(xs) / xs.length : null);
const median = (xs) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const pct = (a, b) => (b ? round((100 * a) / b, 0) : null);
const count = (xs, f) => xs.filter(f).length;

// How a person's private limit reached the group, from most to least open.
export const LIMIT_WAYS = [
  ['self', 'Said it themselves'],
  ['ai_named', 'AI passed it on, with their name'],
  ['ai_anon', 'AI passed it on, without their name'],
  ['mentioned', 'Came up in their words only'],
  ['never', 'Never came up']
];
export const SCALES = [
  ['ai_helpful', 'How much did the AI help your group?', 'Not at all', 'A lot'],
  ['plan_ok', 'The plan we made works for me.', 'Disagree', 'Agree'],
  ['comfort', 'It was easy to bring up my limit.', 'Disagree', 'Agree'],
  ['in_charge', 'The group, not the AI, was in charge of the plan.', 'Disagree', 'Agree']
];
const MODES = { listen: 'Listening AI', ask: 'Answer-only AI' };

// What each number means. Shown at the bottom of the analytics page and useful in a methods section.
export const DEFINITIONS = [
  ['Table', 'One group chat. Only tables that started are counted. A table is "finished" when its results screen opened (a plan was locked, everyone asked to end, the host ended it, or the 40 minute backstop).'],
  ['People', 'Human participants. Labeled AI players that filled empty seats are counted separately and are left out of every per-person number.'],
  ['Plan locked', 'Every person at the table accepted the same complete plan.'],
  ['Time to plan', 'Seconds from the moment the chat opened to the moment the plan locked. The median is over tables that locked a plan.'],
  ['Limit came up', 'The person shared their private limit in one of the three ways (said it themselves from the draft, or asked the AI to pass it on with or without their name), or wrote words that match their limit in an ordinary message ("came up in their words only").'],
  ['Limit respected', 'For locked plans only: the final plan does not break the person\'s limit. For a limit a person wrote themselves, this is their own answer when they accepted.'],
  ['Messages', 'Chat messages a person sent to the group. Questions to the AI are counted separately (in the group, or private).'],
  ['Taps', 'Picks made by tapping a part of the plan, including "Me too" under someone\'s message.'],
  ['Top talker share', 'The share of a table\'s human messages sent by its most active person. With n people, an even split is 1/n.'],
  ['Private heads-up', 'Listening tables only: a note only one person sees, sent when the plan is heading somewhere that breaks their unshared limit. "Shared after" counts people who shared their limit after receiving one.'],
  ['AI questions of its own', 'Listening tables only: the limits check, a disagreement poll, or an open-part poll. Capped at 2 per chat.'],
  ['Feedback', 'The six taps on the results screen. Scales run from 1 to 5. The response rate is responses divided by people at finished tables.']
];

async function load(roomCode) {
  const sessions = (await q('select id, room_code, kind, scenario, started_at, ended_at, outcome, final_plan from sessions where room_code=$1 order by started_at, id', [roomCode])).rows;
  const ids = sessions.map((s) => s.id);
  if (!ids.length) return { sessions, players: [], logs: [], feedback: [] };
  const players = (await q('select session_id, pcode, role_id, is_ai, is_guest from session_players where session_id = any($1) order by session_id, pcode', [ids])).rows;
  const logs = (await q('select session_id, t_ms, actor, actor_type, type, payload from logs where session_id = any($1) order by session_id, id', [ids])).rows;
  const feedback = (await q('select session_id, pcode, ai_helpful, ai_amount, plan_ok, comfort, in_charge, play_again, comment, created_at from feedback where session_id = any($1) order by created_at', [ids])).rows;
  return { sessions, players, logs, feedback };
}

// One table: its timeline numbers, what the AI did, and one record per human participant.
function tableMetrics(s, players, logs, feedback) {
  const [taskId, mode] = String(s.scenario || '').split(':');
  const ev = (type) => logs.filter((l) => l.type === type);
  const first = (type, f = () => true) => logs.find((l) => l.type === type && f(l));
  const started = first('session_started');
  const number = started?.payload?.table ?? first('table_opened')?.payload?.table ?? null;
  const chatStart = first('stage_started', (l) => l.payload?.stage === 'chat')?.t_ms ?? null;
  const outcome = first('session_outcome')?.payload || null;
  const deal = first('deal_locked');
  const firstComplete = first('plan_complete');
  const since = (t) => (chatStart === null || t === null || t === undefined ? null : round((t - chatStart) / 1000, 0));
  const ended = outcome?.ended || (deal ? 'plan' : first('ended_by_group') ? 'group' : first('host_ended_all') || first('host_advanced', (l) => l.payload?.from === 'chat') ? 'host' : first('ended_by_backstop') ? 'backstop' : null);
  const humans = players.filter((p) => !p.is_ai);
  const outcomes = Object.fromEntries(ev('player_outcome').map((l) => [l.actor, l.payload]));

  const people = humans.map((p) => {
    const mine = logs.filter((l) => l.actor === p.pcode);
    const of = (type, f = () => true) => mine.filter((l) => l.type === type && f(l));
    const shared = of('limit_shared')[0];
    const mentioned = of('limit_mentioned')[0];
    const alerts = logs.filter((l) => l.type === 'limit_alert_private' && l.payload?.to === p.pcode);
    const o = outcomes[p.pcode];
    const lastVote = of('vote').slice(-1)[0];
    const msgs = of('chat_message');
    const fb = feedback.find((f) => f.pcode === p.pcode) || null;
    const way = shared ? (shared.payload?.via === 'ai' ? (shared.payload?.anonymous ? 'ai_anon' : 'ai_named') : 'self') : mentioned ? 'mentioned' : 'never';
    return {
      session_id: s.id, table: number, ai_mode: mode, task: taskId, pcode: p.pcode, is_guest: p.is_guest,
      limit_id: o?.limit || p.role_id, limit_custom: (o?.limit || p.role_id) === 'custom',
      limit_way: way, limit_came_up: way !== 'never', limit_shared: !!shared,
      shared_seconds: shared ? since(shared.t_ms) : null, mentioned_seconds: mentioned ? since(mentioned.t_ms) : null,
      alerts: alerts.length, shared_after_alert: !!(shared && alerts.length && shared.t_ms > alerts[0].t_ms),
      messages: msgs.length, characters: sum(msgs.map((m) => m.payload?.length || 0)),
      taps: of('pick').length + of('me_too').length, me_too: of('me_too').length,
      questions_group: of('question_asked', (l) => !l.payload?.private).length, questions_private: of('question_asked', (l) => !!l.payload?.private).length,
      booking_answers: of('booking_answer').length,
      ready_seconds: of('ready_clicked')[0]?.payload?.seconds_since_seated ?? null,
      accepted: o ? !!o.accepted : (lastVote ? !!lastVote.payload?.value : false),
      limit_ok: deal ? (o ? o.limit_ok : (lastVote?.payload?.value ? lastVote.payload.limit_ok : null)) : null,
      away: o ? !!o.away : false,
      feedback: !!fb, ai_helpful: fb?.ai_helpful ?? null, ai_amount: fb?.ai_amount ?? null, plan_ok: fb?.plan_ok ?? null, comfort: fb?.comfort ?? null, in_charge: fb?.in_charge ?? null, play_again: fb?.play_again ?? null
    };
  });

  const humanMsgs = people.map((p) => p.messages);
  const totalMsgs = sum(humanMsgs);
  const aiEv = (type, f = () => true) => count(logs, (l) => l.type === type && f(l));
  const fbScale = (k) => round(mean(people.map((p) => p[k]).filter((x) => x !== null)), 2);
  const t = {
    session_id: s.id, table: number, task: taskId, task_name: TASKS[taskId]?.short || taskId, ai_mode: mode, ai_mode_name: MODES[mode] || mode,
    started_at: s.started_at, started: !!started, finished: !!outcome,
    humans: humans.length, ai_players: players.length - humans.length,
    outcome: !started ? 'not started' : !outcome ? 'unfinished' : deal ? 'plan locked' : 'no plan',
    ended_how: ended, plan: s.final_plan?.plan || outcome?.plan || null,
    chat_seconds: outcome?.seconds ?? null, time_to_plan_s: deal ? since(deal.t_ms) : null, time_to_first_complete_s: firstComplete ? since(firstComplete.t_ms) : null,
    limits: people.length, limits_came_up: count(people, (p) => p.limit_came_up), limits_shared: count(people, (p) => p.limit_shared),
    ...Object.fromEntries(LIMIT_WAYS.map(([k]) => [`limit_${k}`, count(people, (p) => p.limit_way === k)])),
    limits_respected: deal ? count(people, (p) => p.limit_ok === true) : null, limits_broken: deal ? count(people, (p) => p.limit_ok === false) : null,
    messages: totalMsgs, messages_per_person: round(mean(humanMsgs), 1), top_talker_share: totalMsgs ? round(Math.max(...humanMsgs) / totalMsgs, 2) : null,
    silent_people: count(people, (p) => p.messages === 0 && p.taps === 0),
    taps: sum(people.map((p) => p.taps)), me_too: sum(people.map((p) => p.me_too)),
    questions_group: sum(people.map((p) => p.questions_group)), questions_private: sum(people.map((p) => p.questions_private)),
    ai_questions_own: aiEv('limits_check') + aiEv('conflict') + aiEv('open_question'), option_cards: aiEv('pick_card'),
    ai_answers: aiEv('ai_answer') + aiEv('ai_compare'), maps: aiEv('map_shown'), maps_auto: aiEv('map_shown', (l) => l.payload?.auto), routes: aiEv('route_shown'),
    rides_proposed: aiEv('booking_proposed', (l) => l.payload?.kind === 'ride'), rides_booked: aiEv('booking_done', (l) => l.payload?.kind === 'ride' || l.payload?.option),
    tables_proposed: aiEv('booking_proposed', (l) => l.payload?.kind === 'table'), tables_booked: aiEv('booking_done', (l) => l.payload?.kind === 'table' || l.payload?.slot),
    bookings_no_common: aiEv('booking_none'),
    private_alerts: aiEv('limit_alert_private'), alerted_people: count(people, (p) => p.alerts > 0), alerts_followed_by_share: count(people, (p) => p.shared_after_alert),
    shared_limit_flags: aiEv('shared_limit_conflict'), private_nudges: aiEv('ai_nudge_private'), ai_paused_by_people: aiEv('ai_paused_by_player', (l) => l.payload?.paused),
    accepts_reset: aiEv('accepts_reset'), host_notes: aiEv('host_announcement'),
    feedback_n: count(people, (p) => p.feedback), ...Object.fromEntries(SCALES.map(([k]) => [`${k}_mean`, fbScale(k)]))
  };
  return { table: t, people };
}

// Totals for a set of tables (one AI mode, or all of them).
function aggregate(tables, people) {
  const done = tables.filter((t) => t.finished);
  const ids = new Set(done.map((t) => t.session_id));
  const ppl = people.filter((p) => ids.has(p.session_id));
  const locked = done.filter((t) => t.outcome === 'plan locked');
  const lockedIds = new Set(locked.map((t) => t.session_id));
  const lockedPpl = ppl.filter((p) => lockedIds.has(p.session_id));
  const times = locked.map((t) => t.time_to_plan_s).filter((x) => x !== null);
  const fb = ppl.filter((p) => p.feedback);
  const dist = (k, values) => Object.fromEntries(values.map((v) => [v, count(fb, (p) => p[k] === v)]));
  const scale = (k) => { const xs = fb.map((p) => p[k]).filter((x) => x !== null); return { n: xs.length, mean: round(mean(xs), 2), counts: [1, 2, 3, 4, 5].map((v) => count(xs, (x) => x === v)) }; };
  const per = (k) => round(mean(done.map((t) => t[k])), 1);
  const alerted = count(ppl, (p) => p.alerts > 0);
  return {
    tables_started: count(tables, (t) => t.started), tables: done.length, tables_unfinished: count(tables, (t) => t.started && !t.finished), tables_with_ai_players: count(done, (t) => t.ai_players > 0),
    people: ppl.length, people_per_table: round(mean(done.map((t) => t.humans)), 1),
    plans_locked: locked.length, plans_locked_pct: pct(locked.length, done.length),
    ended: Object.fromEntries(['plan', 'group', 'host', 'backstop'].map((k) => [k, count(done, (t) => t.ended_how === k)])),
    time_to_plan_median_s: round(median(times), 0), time_to_plan_min_s: times.length ? Math.min(...times) : null, time_to_plan_max_s: times.length ? Math.max(...times) : null,
    limits: ppl.length, limits_came_up: count(ppl, (p) => p.limit_came_up), limits_came_up_pct: pct(count(ppl, (p) => p.limit_came_up), ppl.length),
    limits_shared: count(ppl, (p) => p.limit_shared), limits_shared_pct: pct(count(ppl, (p) => p.limit_shared), ppl.length),
    limit_ways: Object.fromEntries(LIMIT_WAYS.map(([k]) => [k, count(ppl, (p) => p.limit_way === k)])),
    share_median_s: round(median(ppl.map((p) => p.shared_seconds).filter((x) => x !== null)), 0),
    limits_checked: count(lockedPpl, (p) => p.limit_ok !== null), limits_respected: count(lockedPpl, (p) => p.limit_ok === true),
    limits_respected_pct: pct(count(lockedPpl, (p) => p.limit_ok === true), count(lockedPpl, (p) => p.limit_ok !== null)),
    tables_all_respected: count(locked, (t) => t.limits_broken === 0), tables_all_respected_pct: pct(count(locked, (t) => t.limits_broken === 0), locked.length),
    messages_per_person: round(mean(ppl.map((p) => p.messages)), 1), taps_per_person: round(mean(ppl.map((p) => p.taps)), 1), me_too: sum(ppl.map((p) => p.me_too)),
    silent_people: count(ppl, (p) => p.messages === 0 && p.taps === 0),
    top_talker_share: round(mean(done.map((t) => t.top_talker_share).filter((x) => x !== null)), 2),
    questions_group_per_table: per('questions_group'), questions_private_per_table: per('questions_private'),
    people_asked_privately: count(ppl, (p) => p.questions_private > 0),
    ai_questions_own_per_table: per('ai_questions_own'), option_cards_per_table: per('option_cards'),
    maps: sum(done.map((t) => t.maps)), routes: sum(done.map((t) => t.routes)), rides_proposed: sum(done.map((t) => t.rides_proposed)), rides_booked: sum(done.map((t) => t.rides_booked)),
    tables_proposed: sum(done.map((t) => t.tables_proposed)), tables_booked: sum(done.map((t) => t.tables_booked)), bookings_no_common: sum(done.map((t) => t.bookings_no_common)),
    alerted_people: alerted, alerts_followed_by_share: count(ppl, (p) => p.shared_after_alert), alerts_followed_by_share_pct: pct(count(ppl, (p) => p.shared_after_alert), alerted),
    accepts_reset_per_table: per('accepts_reset'),
    feedback_n: fb.length, feedback_rate_pct: pct(fb.length, ppl.length),
    scales: Object.fromEntries(SCALES.map(([k]) => [k, scale(k)])),
    ai_amount: dist('ai_amount', ['too_little', 'about_right', 'too_much']), play_again: dist('play_again', ['no', 'maybe', 'yes'])
  };
}

export async function computeAnalytics(room) {
  const data = await load(room.code);
  const tables = [], people = [];
  for (const s of data.sessions) {
    const m = tableMetrics(s, data.players.filter((p) => p.session_id === s.id), data.logs.filter((l) => l.session_id === s.id), data.feedback.filter((f) => f.session_id === s.id));
    if (!m.table.started) continue; // a table that was still filling when the session ended
    tables.push(m.table); people.push(...m.people);
  }
  tables.sort((a, b) => (a.table ?? 0) - (b.table ?? 0));
  const byMode = (mode) => aggregate(tables.filter((t) => t.ai_mode === mode), people);
  const tableOf = Object.fromEntries(tables.map((t) => [t.session_id, t]));
  const comments = data.feedback.filter((f) => f.comment && tableOf[f.session_id]).map((f) => ({ table: tableOf[f.session_id].table, ai_mode: tableOf[f.session_id].ai_mode, pcode: f.pcode, comment: f.comment }));
  const sources = {};
  for (const l of data.logs) { const src = l.payload?.source; if (src && ['ai_answer', 'hearing_update', 'chat_message', 'ai_compare'].includes(l.type)) sources[src] = (sources[src] || 0) + 1; }
  return {
    room: { code: room.code, task: room.task, ai_mode: room.aiMode, group_size: room.groupSize }, generated_at: new Date().toISOString(),
    first_started_at: tables[0]?.started_at || null,
    all: aggregate(tables, people), modes: { listen: byMode('listen'), ask: byMode('ask') }, mode_names: MODES,
    tables, participants: people, comments, model_sources: sources,
    limit_ways: LIMIT_WAYS, scales: SCALES, definitions: DEFINITIONS
  };
}

// ---------- CSV rows ----------
export const TABLE_COLS = ['session_id', 'table', 'task', 'ai_mode', 'humans', 'ai_players', 'started_at', 'outcome', 'ended_how', 'chat_seconds', 'time_to_plan_s', 'time_to_first_complete_s',
  'limits', 'limits_came_up', 'limits_shared', 'limit_self', 'limit_ai_named', 'limit_ai_anon', 'limit_mentioned', 'limit_never', 'limits_respected', 'limits_broken',
  'messages', 'messages_per_person', 'top_talker_share', 'silent_people', 'taps', 'me_too', 'questions_group', 'questions_private',
  'ai_questions_own', 'option_cards', 'ai_answers', 'maps', 'maps_auto', 'routes', 'rides_proposed', 'rides_booked', 'tables_proposed', 'tables_booked', 'bookings_no_common',
  'private_alerts', 'alerted_people', 'alerts_followed_by_share', 'shared_limit_flags', 'private_nudges', 'ai_paused_by_people', 'accepts_reset', 'host_notes',
  'feedback_n', 'ai_helpful_mean', 'plan_ok_mean', 'comfort_mean', 'in_charge_mean'];
export const PARTICIPANT_COLS = ['session_id', 'table', 'ai_mode', 'task', 'pcode', 'is_guest', 'limit_id', 'limit_custom', 'limit_way', 'limit_came_up', 'limit_shared', 'shared_seconds', 'mentioned_seconds',
  'alerts', 'shared_after_alert', 'messages', 'characters', 'taps', 'me_too', 'questions_group', 'questions_private', 'booking_answers', 'ready_seconds', 'accepted', 'limit_ok', 'away',
  'feedback', 'ai_helpful', 'ai_amount', 'plan_ok', 'comfort', 'in_charge', 'play_again'];

// ---------- transcript of one table ----------
// A readable, anonymized timeline: who said or did what, with seconds since the chat opened. Private items are marked.
const SAID = new Set(['chat_message', 'question_asked']);
const AI_SAID = new Set(['ai_intro', 'limits_check', 'conflict', 'open_question', 'pick_card', 'ai_answer', 'ai_compare', 'shared_limit_conflict', 'limit_alert_private', 'ai_nudge_private',
  'booking_done', 'booking_none', 'booking_reminder', 'booking_duplicate', 'booking_needs_place', 'booking_unavailable', 'map_unavailable', 'ai_message_wizard']);
export async function transcript(room, sessionId) {
  const s = (await q('select id, scenario from sessions where id=$1 and room_code=$2', [sessionId, room.code])).rows[0];
  if (!s) return null;
  const logs = (await q('select t_ms, actor, actor_type, type, payload from logs where session_id=$1 order by id', [sessionId])).rows;
  const chatStart = logs.find((l) => l.type === 'stage_started' && l.payload?.stage === 'chat')?.t_ms ?? 0;
  const [taskId] = String(s.scenario).split(':');
  const task = TASKS[taskId];
  const opt = (f, o) => task?.fields.find((x) => x.id === f)?.options.find((x) => x.id === o)?.name || o;
  const anyOpt = (o) => task?.fields.flatMap((f) => f.options).find((x) => x.id === o)?.name || o;
  const planText = (plan) => (task && plan ? task.fields.map((f) => opt(f.id, plan[f.id]) || 'open').join(', ') : '');
  const rows = [];
  for (const l of logs) {
    const p = l.payload || {};
    const row = { t: Math.round((l.t_ms - chatStart) / 1000), who: l.actor, kind: l.type, text: null, private: false };
    if (SAID.has(l.type)) { row.text = p.text; row.private = !!p.private; if (l.type === 'question_asked') row.kind = p.private ? 'private question to the AI' : 'question to the AI'; else row.kind = l.actor_type === 'ai_player' ? 'AI player' : 'message'; }
    else if (AI_SAID.has(l.type)) { row.text = p.text; row.private = !!p.to || !!p.private; row.to = p.to || (p.private ? p.to_player : null) || null; row.kind = l.type === 'ai_answer' || l.type === 'ai_compare' ? 'AI answer' : l.type === 'ai_message_wizard' ? 'AI (typed by the host)' : 'AI'; }
    else if (l.type === 'limit_shared') { row.kind = 'shared limit'; row.text = p.via === 'ai' ? `${p.anonymous ? 'through the AI, without a name' : 'through the AI, with their name'}${p.text ? `: ${p.text}` : ''}` : 'said it themselves (their message follows)'; }
    else if (l.type === 'pick') { row.kind = 'tap'; row.text = p.follow ? `goes along with ${Object.entries(p.picks || {}).map(([f, o]) => opt(f, o)).join(', ')}` : p.option ? `picked ${opt(p.field, p.option)}` : `removed their pick for ${p.field}`; }
    else if (l.type === 'me_too') { row.kind = 'tap'; row.text = `"Me too" on ${p.with}'s message: ${Object.entries(p.picks || {}).map(([f, o]) => opt(f, o)).join(', ')}`; }
    else if (l.type === 'plan_complete') { row.who = 'system'; row.kind = 'plan complete'; row.text = planText(p.plan); }
    else if (l.type === 'vote') { row.kind = p.value ? 'accepted' : 'withdrew acceptance'; row.text = p.limit_ok === false ? 'the plan breaks their limit' : ''; }
    else if (l.type === 'deal_locked') { row.who = 'system'; row.kind = 'plan locked'; row.text = planText(p.plan); }
    else if (l.type === 'map_shown' || l.type === 'route_shown') { row.kind = 'AI card'; row.text = l.type === 'map_shown' ? `map of the options${p.auto ? ' (added by the AI)' : ` (asked for by ${p.requested_by})`}` : `route to ${anyOpt(p.place)} (${p.mode === 'transit' ? 'bus or trolley' : 'by car'})`; }
    else if (l.type === 'booking_proposed') { row.kind = 'AI card'; row.text = `${p.kind} card${p.auto ? ' (added by the AI)' : ` (asked for by ${p.requested_by})`}: asks each person privately`; }
    else if (l.type === 'booking_answer') { row.kind = 'private answer'; row.private = true; row.text = p.none ? 'none of the options work' : `works: ${(p.ok || []).join(', ')}`; }
    else if (l.type === 'host_announcement') { row.kind = 'host note'; row.text = p.text; }
    else if (l.type === 'ai_paused_by_player') { row.kind = p.paused ? 'paused the AI' : 'resumed the AI'; row.text = ''; }
    else if (l.type === 'end_vote') { row.kind = p.value ? 'asked to end without a plan' : 'took back asking to end'; row.text = ''; }
    else if (l.type === 'stage_started') { row.who = 'system'; row.kind = p.stage === 'chat' ? 'chat opened' : `${p.stage} started`; row.text = ''; }
    else if (l.type === 'session_outcome') { row.who = 'system'; row.kind = 'ended'; row.text = p.deal ? 'plan locked' : `no plan (${p.ended || 'ended'})`; }
    else continue;
    rows.push(row);
  }
  return { session_id: sessionId, task: task?.short || taskId, rows };
}
