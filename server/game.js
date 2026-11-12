import crypto from 'node:crypto';
import { taskById, fieldName, optionName, planComplete } from './tasks.js';
import { applyMessage, buildPanel, findConflict, topicOf, topicIn, isQuestion, statesWish, detectOptions, sameMessage } from './listener.js';
import { q, logEvent } from './db.js';
import { answerQuestion, summarize, aiMode, playerLine, wantsCompare, menuFor, hoursFor } from './ai.js';
import { planWhen, clock, openAt, forecast, sky, buildItinerary, BRING, OUTDOOR } from './artifacts.js';
import { FACTS, ROLE, BILLS, firstPerson } from './facts.js';
import { PICKUP, placeField, placeOf, placesOf, estimate, route, rideOptions, slotsFor, driver, driverStart, fieldKind, searchPlaces } from './places.js';

// The flow has three steps:
//   1. Briefing (stages "forming" and "setup"): the table fills while each person reads the task and their private limit.
//      Capped so that nobody waits more than about 3 minutes from joining to chatting.
//   2. Chat: no timer. People say what they want or tap a part of the plan; the plan locks when everyone accepts it.
//   3. Results ("done").
const SCALE = Number(process.env.TIME_SCALE || 1); // tests run faster with a smaller TIME_SCALE
export const DURATIONS = { setup: 90 };
const CHAT_MAX = 40 * 60;   // seconds; a backstop so abandoned tables close. Not shown to players.
const AI_NAMES = ['Ari', 'Kai', 'Noa', 'Remy', 'Sage', 'Juno'];
// How each AI player writes, so that two of them at one table do not sound alike.
const PERSONAS = {
  Ari: 'You are upbeat and quick to agree. You like food and being outside.',
  Kai: 'You are dry and practical. You think about logistics: timing, cost, how to get there. You rarely use exclamation marks.',
  Noa: 'You are easygoing and brief. You go with the flow and keep messages very short.',
  Remy: 'You are organized and like to get things settled. You write full sentences with normal capital letters.',
  Sage: 'You are thoughtful and a little wry. You notice small details.',
  Juno: 'You are energetic and direct. You say plainly what you want.'
};
// How an AI player asks the group about a part of the plan when no model is writing its lines.
const ASKS = { where: 'where should we go?', when: 'when works for everyone?', travel: 'how is everyone getting there?', budget: 'what budget are we thinking?', food: 'what are we doing for food?', what: 'what should we do?' };
const askLine = (task, f) => ASKS[f] || `what are we thinking for ${fieldName(task, f).toLowerCase()}?`;
// Something more specific than a settled option, for "what time exactly?": an hour that fits it, or a meeting spot.
function detailFor(task, field, name) {
  const s = name.toLowerCase();
  if (/\d\s*(am|pm)/.test(s)) return null; // already an exact time
  if (/morning|breakfast/.test(s)) return '10 am';
  if (/afternoon/.test(s)) return '2 pm';
  if (/\bnoon\b|lunch/.test(s)) return '12:30';
  if (/evening|night|dinner/.test(s)) return '7 pm';
  return placeField(task) === field ? 'meeting at the main entrance' : null;
}
// An AI player may not say the plan is finished while a part is open.
const DONE_RE = /\b(all set|we'?re set|we are set|we'?re good|we are good|that'?s (everything|the plan|settled|it then)|plan (is |looks )?(done|set|locked|sorted|good)|sounds like a plan|good to go|looks like we'?re|i think we'?re done|we'?re done|that settles)\b/i;
const COLORS = ['#2a78d6', '#eb6834', '#8f5bd6', '#1baf7a', '#c2410c'];
// Booking demo: what to book is decided in the group chat; which ride or which time is answered privately by each
// person, and the group sees only the result. Nothing is really booked or charged.
// "book an uber", "get us a lyft", "reserve a table for lunch". Not "we can get there by car".
const BOOK_RE = /\b(book|reserve|order|call|get|grab|schedule)\s+(?:\w+\s+){0,3}(uber|lyft|rideshare|cab|taxi)\b|\b(book|order|call|schedule)\s+(?:\w+\s+){0,3}(ride|car)\b|\b(book|reserve|get|grab)\s+(?:\w+\s+){0,3}(table|reservation)\b|\b(book|reserve)\b.{0,20}\b(restaurant|dinner|lunch|spot)\b|\b(make|need|get) a reservation\b/i;
const RIDE_RE = /\b(uber|lyft|ride|rides|rideshare|cab|taxi|car|cars)\b/i;
// "show us a map", "how far is it": the AI posts a map of the place options.
// "who owes what", "how much do we each owe", "let's settle up": the AI posts a bill people can pay from.
const PAY_RE = /\b(owe|owes|owed|settle up|pay (?:each other|back|up|now|the host|him|her|them)|who pays what|how much (?:do|does|should) (?:we|i|each|everyone|everybody)|ready to pay|split (?:the )?(?:cost|costs|bill|rent|total))\b/i;
// The same, in an ordinary chat message: only a clear ask, since "pay back" is also how people describe a plan option.
const PAY_ASK_RE = /\b(owe|owes|owed|settle up|who pays what|how much (?:do|does|should) (?:we|i|each|everyone|everybody)|ready to pay)\b/i;
const MAP_RE = /\b(map|how far|where is|where's|directions|distance|how long to get)\b/i;
const MEAL = { low: 13, mid: 24, high: 38, free: 10, under50: 10, over50: 18 };
const TABLE_TASKS = new Set(['dinner', 'anniversary']); // plans where the place is a restaurant
const AWAY_SECONDS = 45;
const REACTIONS = ['👍', '❤️', '😂', '😮', '🎉', '👎'];     // a closed page counts as away after this long
const MAX_INTERJECTIONS = 2; // unprompted questions from the listening AI per chat
const sec = (s) => s * SCALE * 1000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pickOne = (xs) => xs[Math.floor(Math.random() * xs.length)];
const rand = (a, b) => a + Math.random() * (b - a);
const shuffle = (arr) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const ASK_AI = /(^|\s)@ai\b/i;
const list = (names) => names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
const STOP = new Set(['need', 'have', 'that', 'this', 'with', 'from', 'will', 'want', 'cannot', 'only', 'must', 'more', 'than', 'most', 'least', 'they', 'them', 'there', 'because', 'about', 'would', 'could', 'should', 'just', 'really', 'very', 'before', 'after', 'until', 'every']);

// A limit a person wrote themselves. The app cannot check a plan against it, so the person says whether the plan fits.
function customLimit(text) {
  const words = [...new Set(text.toLowerCase().match(/[a-z0-9$]{4,}/g) || [])].filter((w) => !STOP.has(w));
  const need = Math.min(2, words.length);
  return { id: 'custom', custom: true, text, say: text, aiPrefs: {}, violates: () => false,
    re: { test: (s) => { const t = String(s).toLowerCase(); return need > 0 && words.filter((w) => t.includes(w)).length >= need; } } };
}

export class Table {
  // forming: a class table that seats people one at a time as they join, and starts when it is full
  // (or when the host starts it). Other tables are created with everyone already seated.
  constructor({ io, room, humans, onDone, mode, taskId, number, forming, target }) {
    this.id = crypto.randomBytes(5).toString('hex');
    this.io = io; this.room = room; this.onDone = onDone;
    // A copy for this table: people can add their own options to a part of the plan.
    const base = taskById(taskId || room.task);
    this.task = { ...base, fields: base.fields.map((f) => ({ ...f, options: [...f.options] })) };
    this.number = number || 1;
    this.mode = mode === 'ask' ? 'ask' : 'listen';
    this.t0 = Date.now();
    this.target = Math.min(5, Math.max(3, Number(target) || 4));
    this.limitPool = shuffle(this.task.limits); // dealt in this order; a seat given up returns its limit
    // Basic facts about each seat (see facts.js): each fact's values are dealt in a shuffled order, like limits.
    this.factDefs = FACTS[this.task.id] || []; this.factPools = {}; this.factNext = {};
    for (const f of this.factDefs) { this.factPools[f.id] = shuffle(f.values.map((_, i) => i)); this.factNext[f.id] = 0; }
    this.bills = [];
    // The plan board: availability marks, tasks, menus, and a history of changes.
    this.avail = {}; this.todos = []; this.menus = {}; this.history = []; this.customN = 0; this.todoN = 0;
    // More board artifacts: agreements the group stamps, who brings what, the day as a timeline, the weather, and
    // opening hours for each place (see artifacts.js).
    this.agreements = []; this.agreeN = 0;
    this.bring = (BRING[this.task.id] || []).map((x, i) => ({ id: `b${i + 1}`, ...x, owner: null, by: 'app' })); this.bringN = this.bring.length;
    this.itin = null; this.weather = null; this.weatherOn = OUTDOOR.has(this.task.id); this.hours = {}; this.closedWarned = new Set();
    this.nextP = 1; this.nextAI = 0;
    this.players = [];
    this.forming = !!forming;
    for (const h of humans) this.players.push(this.newHuman(h));
    if (!this.forming) this.fillWithAI(Math.min(5, Math.max(3, humans.length)));
    // prefs: what each person wants for each part of the plan (from taps, and from the chat at listening tables).
    // parsed: the same reading of the chat at answer-only tables, kept for analysis only and never shown.
    this.prefs = {}; this.parsed = {};
    this.plan = {}; this.ways = {}; this.planKey = JSON.stringify([{}, {}]); this.accepts = {}; this.announced = '';
    this.chat = []; this.seq = 0;
    this.stage = this.forming ? 'forming' : 'lobby'; this.stageEndsAt = null;
    this.openedAt = Date.now(); this.lastSeatChange = Date.now();
    this.awaySince = new Map(); // player key -> when their last connection closed
    this.aiPaused = false;   // host runs the AI by hand (Wizard of Oz)
    this.pausedBy = null;    // a player paused the listening AI
    this.deal = null; this.outcome = null;
    this.timers = []; this.tick = null;
    this.interjections = 0; this.lastInterjectAt = 0; this.didLimitsCheck = false;
    this.asked = new Set(); this.pendingQuestions = [];
    this.bookings = []; this.maps = []; this.auto = {}; this.preparing = {}; this.cardAt = {};
    this.thinkingPublic = 0; this.thinkingFor = new Map(); // who is waiting for an answer from the AI (everyone, or one person)
    this.endReason = null;
    this.nudged = new Set(); this.lastNudgeAt = 0; this.lastChatAt = 0; this.lastTypingAt = 0; this.lastAiSayAt = 0;
    this.hearing = null; this.hearTimer = null; this.hearAt = 0;
    this.lastBroadcast = 0;
  }

  // ---------- basic facts about each seat ----------
  // The next version of each fact that nobody at the table has (people who left give theirs back).
  dealFacts() {
    const out = {};
    for (const f of this.factDefs) {
      const pool = this.factPools[f.id];
      const used = new Set((this.players || []).map((p) => p.factPicks?.[f.id]));
      out[f.id] = pool.find((i) => !used.has(i)) ?? pool[this.factNext[f.id]++ % pool.length];
    }
    return out;
  }
  // The seat with a role in the scenario (for example, who found the beach house): people before AI players.
  roleHolder() {
    const r = ROLE[this.task.id]; if (!r) return null;
    const ok = (p) => !r.avoid.includes(this.limitId(p));
    return this.humans().find(ok) || this.players.find(ok) || null;
  }
  // One fact about a seat: { text, private, ... }. A fact set by the limit is private (saying it gives the limit away).
  // shown: the value the group can know; a private fact counts as known once the limit came up.
  fact(p, id, shown) {
    const f = this.factDefs.find((x) => x.id === id); if (!f) return null;
    const norm = (v) => (typeof v === 'string' ? { text: v } : { ...v });
    const byLimit = !p.custom && f.byLimit?.[p.limitId];
    if (byLimit && !(shown && p.limitSharedAt === null && p.limitMentionedAt === null)) return { ...norm(byLimit), private: true };
    return norm(f.values[p.factPicks?.[id] ?? 0]);
  }
  factsOf(p) {
    const out = this.factDefs.map((f) => ({ id: f.id, label: f.label, ...this.fact(p, f.id) }));
    const r = ROLE[this.task.id], holder = this.roleHolder();
    if (r && holder) out.unshift({ id: 'role', label: 'Who is who', text: holder === p ? r.mine : r.other(this.nameOf(holder)) });
    return out;
  }
  // A question about one of this seat's facts ("how many nights did you stay?"), or null.
  factAsked(p, text) {
    const s = ` ${String(text).toLowerCase()} `;
    const f = this.factDefs.find((x) => x.kw.some((k) => new RegExp(`[^a-z0-9]${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(s)));
    return f ? { id: f.id, ...this.fact(p, f.id) } : null;
  }

  spareLimits() { const used = new Set(this.players.map((p) => p.limitId)); return this.limitPool.filter((l) => !used.has(l.id)); }
  freeLimit() { return this.spareLimits()[0].id; }
  uniqueName(name) {
    const taken = new Set(this.players.map((p) => p.name.toLowerCase()));
    if (!taken.has(name.toLowerCase())) return name;
    for (let i = 2; ; i++) if (!taken.has(`${name} ${i}`.toLowerCase())) return `${name} ${i}`;
  }
  newHuman(h) {
    const n = this.nextP++;
    return { key: h.key, name: this.uniqueName(h.name), userId: h.userId, isGuest: h.isGuest, isAI: false, pcode: `P${String(n).padStart(2, '0')}`,
      color: COLORS[(n - 1) % COLORS.length], limitId: this.freeLimit(), custom: null, limitSharedAt: null, limitMentionedAt: null, limitAnon: false, limitVia: null,
      selfOk: null, ready: false, wantsEnd: false, msgs: 0, picks: 0, nudged: false, alertOn: false, alerts: 0, flagOn: false, flags: 0, seatedAt: Date.now(), factPicks: this.dealFacts() };
  }
  fillWithAI(seats) {
    const added = [];
    while (this.players.length < seats) {
      const n = this.nextAI++;
      // a first name nobody at the table has, so "Kai" always means one seat
      const taken = new Set(this.players.map((x) => (x.short || x.name).toLowerCase()));
      const short = AI_NAMES.find((x) => !taken.has(x.toLowerCase())) || `Player ${n + 1}`;
      const p = { key: `ai${n + 1}`, name: `${short} (AI)`, short, isAI: true, pcode: `A0${n + 1}`, color: '#52514e',
        limitId: this.freeLimit(), custom: null, limitSharedAt: null, limitMentionedAt: null, msgs: 0, picks: 0, revealed: false, said: [], objected: new Set(), factPicks: this.dealFacts() };
      this.players.push(p); added.push(p);
    }
    return added;
  }
  async insertPlayer(p) {
    try {
      await q('insert into session_players (session_id, pcode, user_id, display_name, role_id, is_ai, is_guest) values ($1,$2,$3,$4,$5,$6,$7)',
        [this.id, p.pcode, p.userId || null, p.name, p.limitId, p.isAI, !!p.isGuest]);
    } catch (e) { console.error('player insert failed', e.message); }
  }
  async insertSession() {
    try { await q('insert into sessions (id, room_code, kind, scenario) values ($1,$2,$3,$4)', [this.id, this.room.code, this.room.kind, `${this.task.id}:${this.mode}`]); }
    catch (e) { console.error('session insert failed', e.message); }
  }

  // ---------- seating while a class table forms ----------
  isOpen() { return this.stage === 'forming' && this.humans().length < this.target; }
  // A late arrival may also take an AI player's seat at a table that started less than 30 seconds ago.
  canSeat() { return this.stage === 'forming' ? !this.starting && this.humans().length < 5 : this.stage === 'setup' && Date.now() - this.stageStartedAt < 30000 && this.players.some((p) => p.isAI); }
  async seat(h) {
    if (!this.canSeat() || this.player(h.key)) return false;
    let replaced = null;
    if (this.stage === 'setup') { replaced = this.players.find((p) => p.isAI) || null; if (replaced) this.players = this.players.filter((p) => p !== replaced); }
    const p = this.newHuman(h);
    if (replaced) { p.limitId = replaced.limitId; p.factPicks = replaced.factPicks; }
    this.players.splice(this.humans().length, 0, p);
    this.lastSeatChange = Date.now();
    if (replaced) { try { await q('delete from session_players where session_id=$1 and pcode=$2', [this.id, replaced.pcode]); } catch {} }
    await this.insertPlayer(p);
    this.log('system', 'player_seated', { pcode: p.pcode, limit: p.limitId, stage: this.stage, replaced_ai: replaced?.pcode || null, humans: this.humans().length });
    this.broadcast();
    return true;
  }
  async unseat(key, reason) {
    const p = this.player(key);
    if (!p || p.isAI || this.stage !== 'forming') return false;
    this.players = this.players.filter((x) => x !== p);
    this.lastSeatChange = Date.now();
    try { await q('delete from session_players where session_id=$1 and pcode=$2', [this.id, p.pcode]); } catch {}
    this.log('system', 'player_left_before_start', { pcode: p.pcode, reason });
    this.broadcast();
    return true;
  }
  // Start a forming table: labeled AI players fill seats up to 3, then the briefing countdown begins
  // (or the chat opens at once if everyone already pressed Ready while the table filled).
  async begin(reason) {
    if (this.stage !== 'forming' || this.starting || !this.humans().length) return false;
    this.starting = true; this.forming = false;
    const added = this.fillWithAI(Math.max(3, this.players.length));
    for (const p of added) await this.insertPlayer(p);
    this.log('system', 'session_started', { room: this.room.code, kind: this.room.kind, table: this.number, task: this.task.id, ai_mode: this.mode, reason,
      seats: this.players.map((p) => ({ pcode: p.pcode, limit: this.limitId(p), ai: p.isAI })) });
    this.tick = setInterval(() => this.onTick(), 1000);
    this.enter('setup');
    if (this.active().every((h) => h.ready)) this.enter('chat');
    return true;
  }
  typing(key) {
    const p = this.player(key); if (!p || this.stage !== 'chat') return;
    if (!p.isAI) this.lastTypingAt = Date.now();
    for (const o of this.humans()) if (o !== p) this.io.to(`k:${o.key}`).emit('game:typing', { sessionId: this.id, pcode: p.pcode, name: p.name });
  }

  get t() { return Date.now() - this.t0; }
  log(actor, type, payload, actorType) {
    if (payload && typeof payload.text === 'string') payload = { ...payload, text: this.anonymize(payload.text) };
    if (payload && typeof payload.question === 'string') payload = { ...payload, question: this.anonymize(payload.question) };
    const type_ = actorType || (actor === 'AI' ? 'ai' : actor === 'system' ? 'system' : /^A0/.test(actor) ? 'ai_player' : 'human');
    logEvent(this.id, this.t, actor, type_, type, payload);
  }
  // Research logs and the AI model see player codes, never display names.
  anonymize(text) {
    let out = text;
    for (const p of [...this.players].sort((a, b) => b.name.length - a.name.length)) {
      if (p.isAI || p.name.length < 2) continue;
      const esc = p.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      out = out.replace(new RegExp(`\\b${esc}\\b`, 'gi'), p.pcode);
    }
    return out;
  }
  // In a sentence an AI player goes by its first name ("Kai"); lists of who picked what keep the "(AI)" label.
  nameOf(p) { return p ? p.short || p.name : ''; }
  // What the model sees: a code for a person (never a name), and the first name for an AI player.
  alias(p) { return p.isAI ? p.short : p.pcode; }
  aliasOf(code) { const p = this.byCode(code); return p ? this.alias(p) : code; }
  // Text for the model: people's names become codes; AI player codes and labels become first names.
  forModel(text) { return this.anonymize(String(text)).replace(/\bA0\d\b/g, (c) => this.byCode(c)?.short || c).replace(/ \(AI\)/g, ''); }
  // Text from the model, for the chat: codes become names again, in whatever letter case the model used ("p01", "@P01").
  withNames(text) { return String(text).replace(/@?\b([pa]0\d)\b/gi, (m, c) => { const p = this.byCode(c.toUpperCase()); return p ? this.nameOf(p) : m; }); }
  humans() { return this.players.filter((p) => !p.isAI); }
  // People whose page has been closed for a while do not hold up Ready, Accept, or a booking for everyone else.
  connected(p) { return !!this.io.sockets.adapter.rooms.get(`k:${p.key}`)?.size; }
  isAway(p) { return !p.isAI && this.awaySince?.has(p.key) && Date.now() - this.awaySince.get(p.key) > sec(AWAY_SECONDS); }
  active() { const a = this.humans().filter((p) => !this.isAway(p)); return a.length ? a : this.humans(); }
  player(key) { return this.players.find((p) => p.key === key); }
  byCode(pcode) { return this.players.find((p) => p.pcode === pcode); }
  limitOf(p) { return p.custom || this.task.limits.find((l) => l.id === p.limitId); }
  limitId(p) { return p.custom ? 'custom' : p.limitId; }
  // Does a plan fit this person's limit? null when it cannot be known yet.
  limitOk(p, plan) { return p.custom ? p.selfOk : (planComplete(this.task, plan) ? !this.limitOf(p).violates(this.planFor(p, plan)) : null); }
  // ---------- personal parts ----------
  // For a personal part (Getting there) the plan keeps the most common pick, and a person who picked something else
  // goes their own way. Limits are checked against the plan as it applies to that person.
  personal() { return this.task.fields.filter((f) => f.personal); }
  // The picks that differ from the plan, per personal part: { travel: { A02: 'transit' } }.
  waysOf(plan) {
    const out = {};
    for (const f of this.personal()) {
      if (!plan[f.id]) continue;
      for (const p of this.players) { const v = this.prefs[p.pcode]?.[f.id]; if (v && v !== plan[f.id]) (out[f.id] = out[f.id] || {})[p.pcode] = v; }
    }
    return out;
  }
  planFor(p, plan) {
    const locked = this.deal && plan === this.deal.plan ? this.deal.ways : null;
    let out = plan;
    for (const f of this.personal()) {
      const v = locked ? locked[f.id]?.[p.pcode] : this.prefs[p.pcode]?.[f.id];
      if (v && v !== plan[f.id]) out = { ...out, [f.id]: v };
    }
    return out;
  }
  // "Old Town, Sunday afternoon, Carpool (Kai: Bus or trolley), Under $15"
  planText(plan, ways) {
    return this.task.fields.map((f) => {
      const own = Object.entries(ways?.[f.id] || {}).map(([c, o]) => `${this.nameOf(this.byCode(c)) || c}: ${optionName(this.task, f.id, o)}`);
      return optionName(this.task, f.id, plan[f.id]) + (own.length ? ` (${own.join(', ')})` : '');
    }).join(', ');
  }
  // The same for the screen: who goes their own way, by name.
  waysView(ways) {
    return Object.fromEntries(Object.entries(ways || {}).map(([f, m]) => [f, Object.entries(m).map(([c, o]) => ({ pcode: c, name: this.nameOf(this.byCode(c)) || c, option: o, optionName: optionName(this.task, f, o) }))]));
  }
  // "Carpool (Kai: Bus or trolley)": the leading choice of a part, with anyone who goes their own way.
  leaderText(f, forModel) {
    const own = (f.own || []).map((x) => `${forModel ? this.aliasOf(x.pcode) : this.nameOf(this.byCode(x.pcode))}: ${optionName(this.task, f.id, x.option)}`);
    return optionName(this.task, f.id, f.leader) + (own.length ? ` (${own.join(', ')})` : '');
  }
  // Who a chat message can be about, for the reader: everyone else at the table, by the names people would type.
  peopleFor(p) { return this.players.filter((x) => x !== p).map((x) => ({ pcode: x.pcode, names: x.isAI ? [x.short.toLowerCase(), x.pcode.toLowerCase()] : [x.name.toLowerCase()] })); }
  listening() { return this.mode === 'listen' && !this.aiPaused && !this.pausedBy; }
  panel() { return buildPanel(this.task, this.prefs, this.players); }

  // Forming tables: the session row exists from the first seat, so joins and leaves are logged.
  async open() {
    await this.insertSession();
    this.log('system', 'table_opened', { room: this.room.code, table: this.number, task: this.task.id, ai_mode: this.mode, target: this.target });
  }

  async start() {
    await this.insertSession();
    for (const p of this.players) await this.insertPlayer(p);
    this.log('system', 'session_started', { room: this.room.code, kind: this.room.kind, table: this.number, task: this.task.id, ai_mode: this.mode, seats: this.players.map((p) => ({ pcode: p.pcode, limit: this.limitId(p), ai: p.isAI })) });
    this.tick = setInterval(() => this.onTick(), 1000);
    this.enter('setup');
  }

  clearStageTimers() { this.timers.forEach(clearTimeout); this.timers = []; }
  later(seconds, fn) { this.timers.push(setTimeout(fn, sec(seconds))); }

  enter(stage) {
    if (this.stage === 'done' || this.stage === stage) return;
    this.clearStageTimers();
    this.stage = stage;
    this.stageStartedAt = Date.now();
    this.stageEndsAt = null;
    if (stage === 'done') { this.finish(); this.broadcast(); return; }
    this.log('system', 'stage_started', { stage });
    if (stage === 'setup') {
      this.stageEndsAt = Date.now() + sec(DURATIONS.setup);
      this.later(DURATIONS.setup, () => this.enter('chat'));
    }
    if (stage === 'chat') {
      this.chatStartedAt = Date.now();
      this.sys(`${this.task.prompt} Decide ${list(this.task.fields.map((f) => f.name.toLowerCase()))}. Say what you want in the chat, or tap a part of the plan above to pick. The plan locks when everyone accepts it. There is no timer.`, 'stage_intro', { stage });
      this.aiSay(this.mode === 'listen'
        ? 'Hi, I am the AI. I keep the plan board up to date and never vote. Ask me anything with @AI.'
        : 'Hi, I am the AI. I answer when you ask with @AI, and I never vote.', 'ai_intro', null, true);
      this.scheduleAiPlayers();
    }
    this.broadcast();
  }

  async finish() {
    clearInterval(this.tick); this.clearStageTimers(); clearTimeout(this.hearTimer);
    const plan = this.deal ? this.deal.plan : this.plan;
    const cut = this.deal ? this.deal.t : Infinity;
    const surfaced = this.players.filter((p) => Math.min(p.limitSharedAt ?? Infinity, p.limitMentionedAt ?? Infinity) <= cut).length;
    const complete = planComplete(this.task, plan);
    const respected = complete ? this.players.filter((p) => this.limitOk(p, plan) === true).length : 0;
    const chatMs = this.chatStartedAt ? (this.deal ? this.t0 + this.deal.t : Date.now()) - this.chatStartedAt : 0;
    const ended = this.endReason || (this.deal ? 'plan' : 'unknown'); // plan | group | host | backstop
    this.outcome = { deal: !!this.deal, surfaced, respected, complete, of: this.players.length, mode: this.mode, interjections: this.interjections, ended,
      minutes: Math.round(chatMs / 6000 / SCALE) / 10, seconds: Math.round(chatMs / 1000 / SCALE) };
    const ways = this.deal ? this.deal.ways : this.waysOf(plan);
    this.log('system', 'session_outcome', { ...this.outcome, plan, ways, humans: this.humans().length, ai_players: this.players.length - this.humans().length });
    // One row per seat for the analysis: what happened to this person's limit, and how much they took part.
    for (const p of this.players) {
      this.log(p.pcode, 'player_outcome', { ai: p.isAI, limit: this.limitId(p), shared: p.limitSharedAt !== null, shared_at: p.limitSharedAt, via: p.limitVia || null, anonymous: !!p.limitAnon,
        mentioned_at: p.limitMentionedAt, limit_ok: complete ? this.limitOk(p, plan) : null, accepted: !!this.accepts[p.key], msgs: p.msgs, picks: p.picks, private_questions: p.privateAsks || 0,
        alerts: p.alerts || 0, away: !p.isAI && this.isAway(p) });
    }
    this.log('system', 'session_ended', { outcome: this.deal ? 'deal' : 'no_deal' });
    try {
      await q('update sessions set ended_at=now(), outcome=$2, final_plan=$3 where id=$1', [this.id, this.deal ? 'deal' : 'no_deal', JSON.stringify({ plan, ways, ...this.outcome })]);
    } catch (e) { console.error(e.message); }
    this.onDone?.(this);
  }

  pushChat(msg) {
    const m = { id: ++this.seq, t: this.t, ...msg };
    if (['chat', 'limit', 'question', 'pick'].includes(m.kind)) this.lastChatAt = Date.now();
    this.chat.push(m);
    if (this.chat.length > 400) this.chat.shift();
    return m;
  }
  // A person who sends more than 8 messages in 10 seconds is asked to slow down (only they see the note).
  tooFast(p) {
    const now = Date.now();
    p.sent = (p.sent || []).filter((x) => now - x < 10000);
    if (p.sent.length < 8) { p.sent.push(now); return false; }
    if (!p.warnedFast || now - p.warnedFast > 15000) {
      p.warnedFast = now;
      this.pushChat({ from: 'system', name: 'Cabrillo', kind: 'system', to: p.key, text: 'You are sending messages very fast. Wait a few seconds and try again.' });
      this.log(p.pcode, 'slow_down_notice');
      this.broadcast();
    }
    return true;
  }
  sys(text, type, payload) {
    if (this.stage === 'done') return;
    this.pushChat({ from: 'system', name: 'Cabrillo', kind: 'system', text });
    this.log('system', type, { text, ...(payload || {}) });
    this.broadcast();
  }
  // to: a player key for a private message that only that person sees. extra: fields the app uses to draw buttons.
  aiSay(text, type, payload, force, to, extra) {
    if (this.stage === 'done') return false;
    if (this.aiPaused && !force) return false;
    this.pushChat({ from: 'AI', name: 'AI', kind: to ? 'private' : 'ai', text, to: to || null, ...(extra || {}) });
    if (!to) this.lastAiSayAt = Date.now();
    this.log('AI', type, { text, ...(payload || {}), ...(to ? { to: this.player(to)?.pcode } : {}) });
    this.broadcast();
    return true;
  }

  // ---------- briefing ----------
  // Keep the limit you were given, swap it for another one, or write your own. Only before you tap Ready.
  async changeLimit(key, action, text) {
    const p = this.player(key);
    if (!p || p.isAI || p.ready || !['forming', 'setup'].includes(this.stage)) return;
    const from = this.limitId(p);
    if (action === 'own') {
      text = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 140);
      if (text.length < 8) return;
      p.custom = customLimit(text);
    } else if (action === 'swap') {
      if (p.custom) p.custom = null; // back to the one that was dealt
      else {
        const spare = this.spareLimits(); if (!spare.length) return;
        const at = this.limitPool.findIndex((l) => l.id === p.limitId);
        p.limitId = (spare.find((l) => this.limitPool.indexOf(l) > at) || spare[0]).id; // cycle through the spare ones
      }
    } else return;
    this.log(p.pcode, 'limit_changed', { action, from, to: this.limitId(p), ...(p.custom ? { text: p.custom.text } : {}) });
    try { await q('update session_players set role_id=$3 where session_id=$1 and pcode=$2', [this.id, p.pcode, this.limitId(p)]); } catch {}
    this.broadcast();
  }

  ready(key) {
    const p = this.player(key); if (!p || p.isAI || !['setup', 'forming'].includes(this.stage) || p.ready) return;
    p.ready = true; this.log(p.pcode, 'ready_clicked', { stage: this.stage, seconds_since_seated: Math.round((Date.now() - p.seatedAt) / 1000) });
    if (this.stage === 'setup' && this.active().every((h) => h.ready)) return this.enter('chat');
    this.broadcast();
  }

  // ---------- sharing a private limit ----------
  // Three ways. "Say it myself" is an ordinary chat message sent from a draft (see say). The other two ask the AI
  // to pass the limit on, with or without the person's name. The AI never reveals a limit on its own.
  shareLimit(key, mode) {
    const p = this.player(key);
    if (!p || p.isAI || p.limitSharedAt !== null || this.stage !== 'chat') return;
    const anon = mode === 'anon';
    p.limitSharedAt = this.t; p.limitAnon = anon; p.limitVia = 'ai';
    const say = this.limitOf(p).say;
    this.pushChat({ from: 'AI', name: 'AI', kind: 'ai', passedOn: true, text: anon ? `Shared without a name: "${say}"` : `From ${p.name}: "${say}"` });
    this.lastAiSayAt = Date.now();
    this.log(p.pcode, 'limit_shared', { limit: this.limitId(p), via: 'ai', anonymous: anon, text: say });
    if (!anon && !p.custom) this.read(p, say);
    this.afterChange();
  }

  say(key, text, opts) {
    const p = this.player(key); text = String(text || '').trim().slice(0, 300);
    if (!p || !text || this.stage !== 'chat') return;
    if (ASK_AI.test(text)) return this.ask(key, text);
    if (!p.isAI && this.tooFast(p)) return;
    p.msgs++; p.lastMsgAt = Date.now();
    // A message sent from the "Say it myself" draft counts as sharing the limit, even if the person reworded it.
    const own = !!opts?.limit && !p.isAI && p.limitSharedAt === null;
    if (own) { p.limitSharedAt = this.t; p.limitAnon = false; p.limitVia = 'self'; this.log(p.pcode, 'limit_shared', { limit: this.limitId(p), via: 'self', anonymous: false, text }); }
    const msg = this.pushChat({ from: p.pcode, name: p.name, kind: own ? 'limit' : 'chat', text });
    this.log(p.pcode, 'chat_message', { text, length: text.length });
    const changes = this.read(p, text);
    // Listening tables: the options this message asked for, so others can tap "Me too" instead of typing it again.
    const sup = this.mode === 'listen' ? changes.filter((c) => c.kind === 'supports').map((c) => ({ field: c.field, option: c.option })) : [];
    if (sup.length) msg.sup = sup;
    for (const c of changes) if (c.kind === 'about_other') this.suggestFor(p, c);
    // Listening tables: what the AI saved from this message, shown in small print under it.
    if (this.listening()) { const saved = this.savedLines(p, changes); if (saved.length) { msg.saved = saved; this.note(saved.join('; ')); } }
    if (this.listening() && PAY_ASK_RE.test(text) && BILLS[this.task.id]) this.openBill(p);
    else if (this.listening() && BOOK_RE.test(text)) this.proposeBooking(RIDE_RE.test(text) ? 'ride' : 'table', p);
    else if (this.listening() && MAP_RE.test(text)) this.showMap(p);
    else if (!p.isAI) this.answerGroupQuestion(p, text);
    this.afterChange();
    if (!p.isAI) this.queueAiReplies(p, text, changes);
  }
  // "Kai can take the trolley": when a person says how an AI player could do a personal part, the AI player takes it
  // up if it keeps to its limit. What a person says about another person is never counted for either of them.
  suggestFor(from, c) {
    const x = this.byCode(c.about), f = this.task.fields.find((y) => y.id === c.field);
    if (!x?.isAI || !f?.personal || c.negative) return;
    const mine = this.prefs[x.pcode] || (this.prefs[x.pcode] = {});
    if (mine[f.id] === c.option || this.limitOf(x).violates({ ...this.heading(), ...mine, [f.id]: c.option })) return;
    mine[f.id] = c.option;
    this.log(x.pcode, 'pick', { follow: true, suggested_by: from.pcode, picks: { [f.id]: c.option } });
  }

  // Listening tables: when someone asks the group about a part of the plan ("what time tho?"), the AI answers with a
  // card for that part: the options, who picked what, and any shared limit an option would break. It is a reply, not
  // one of the AI's own questions, so it does not count toward the cap of 2.
  answerGroupQuestion(p, text) {
    if (!this.listening()) return;
    const field = topicOf(this.task, text);
    if (!field) return;
    const row = this.panel().find((f) => f.id === field);
    if (row.status === 'agreed') return; // settled: the plan above the chat already shows it
    if (Date.now() - (this.cardAt[field] || 0) < sec(40)) return;
    this.cardAt[field] = Date.now();
    const name = fieldName(this.task, field).toLowerCase();
    const head = row.options.length ? `Picks for ${name} so far:` : `Options for ${name}:`;
    const notes = [row.personal ? 'For this part each person can go their own way.' : '', this.sharedNotes(field)].filter(Boolean).join(' ');
    this.aiSay(notes ? `${head} ${notes}` : head, 'pick_card', { field, asked_by: p.pcode }, false, null, { poll: field, card: 'pick' });
    if (placeField(this.task) === field && !this.maps.length) { this.auto.map = true; this.showMap(null); }
  }
  // Shared limits that rule out options of one part, in words, for example "Ari shared that Sunday morning does not work for them."
  sharedNotes(field) {
    const out = [];
    for (const x of this.players) {
      if (x.limitSharedAt === null) continue;
      const lim = this.limitOf(x);
      const bad = this.task.fields.find((f) => f.id === field).options.filter((o) => lim.violates({ [field]: o.id }));
      if (bad.length) out.push(`${x.limitAnon ? 'Someone' : this.nameOf(x)} shared that ${list(bad.map((o) => o.name))} ${bad.length > 1 ? 'do' : 'does'} not work for them.`);
    }
    return out.join(' ');
  }
  // Options that a shared limit rules out, per part of the plan. codes: player codes instead of names (for the model).
  blockedView(codes) {
    const out = {};
    for (const f of this.task.fields) for (const o of f.options) for (const x of this.players) {
      if (x.limitSharedAt === null || !this.limitOf(x).violates({ [f.id]: o.id })) continue;
      ((out[f.id] = out[f.id] || {})[o.id] = out[f.id][o.id] || []).push(x.limitAnon ? (codes ? 'someone' : 'Someone') : codes ? this.alias(x) : this.nameOf(x));
    }
    return out;
  }

  // Limit mentions are logged in both modes for analysis; the AI never acts on them.
  noteMention(p, text) {
    if (p.limitMentionedAt === null && this.limitOf(p).re.test(text)) { p.limitMentionedAt = this.t; this.log(p.pcode, 'limit_mentioned', { limit: this.limitId(p) }); }
  }
  // What a group message says about the plan. At listening tables it updates the plan (the AI reads the chat); at
  // answer-only tables a person's words are only kept for the analysis. Either way the result is returned, so AI
  // players can answer what was said. A question to the AI is never read as a wish.
  read(p, text) {
    this.noteMention(p, text);
    if (this.mode === 'listen' && this.pausedBy) return []; // paused: the AI does not read new messages
    // Listening tables: the chat updates the plan. Answer-only tables: only taps do (AI players count, since they cannot tap).
    const board = this.mode === 'listen' || p.isAI;
    const changes = applyMessage(this.task, board ? this.prefs : this.parsed, p.pcode, text, this.peopleFor(p));
    if (changes.length) this.log(board ? 'AI' : 'system', board ? 'panel_update' : 'chat_parsed', { from: p.pcode, changes: changes.map((c) => ({ field: c.field, option: c.option, kind: c.kind, ...(c.about ? { about: c.about } : {}) })) });
    return changes;
  }

  // Tap a part of the plan to pick an option (or an empty option to take your pick back).
  // A pick counts exactly like saying it in the chat.
  pick(key, field, option) {
    const p = this.player(key);
    if (!p || p.isAI || this.stage !== 'chat' || this.deal) return;
    const f = this.task.fields.find((x) => x.id === field);
    if (!f || (option && !f.options.some((x) => x.id === option))) return;
    const mine = this.prefs[p.pcode] || (this.prefs[p.pcode] = {});
    if ((mine[field] || '') === option) return; // already so; a double tap changes nothing
    if (option) mine[field] = option; else delete mine[field];
    p.picks++;
    // Several taps in a row by one person show as one line: "Maya picked Old Town, Sunday afternoon and Bus or trolley."
    const last = this.chat[this.chat.length - 1];
    let picks = {};
    if (last && last.kind === 'pick' && last.from === p.pcode && last.picks) { picks = last.picks; this.chat.pop(); }
    picks = { ...picks, [field]: option || null };
    const names = Object.entries(picks).filter(([, v]) => v).map(([k, v]) => optionName(this.task, k, v));
    const gone = Object.entries(picks).filter(([, v]) => !v).map(([k]) => fieldName(this.task, k).toLowerCase());
    const text = Object.keys(picks).length === 1 && names.length ? `${p.name} picked ${names[0]} for ${f.name.toLowerCase()}.`
      : `${p.name} ${[names.length ? `picked ${list(names)}` : '', gone.length ? `removed their pick for ${list(gone)}` : ''].filter(Boolean).join(' and ')}.`;
    this.pushChat({ from: p.pcode, name: p.name, kind: 'pick', picks, text });
    this.log(p.pcode, 'pick', { field, option: option || null });
    this.afterChange();
  }

  // "Me too" under someone's message: take the options that message asked for, in one tap.
  metoo(key, msgId) {
    const p = this.player(key); const m = this.chat.find((x) => x.id === Number(msgId));
    if (!p || p.isAI || !m?.sup?.length || m.from === p.pcode || this.stage !== 'chat' || this.deal) return;
    const mine = this.prefs[p.pcode] || (this.prefs[p.pcode] = {});
    const add = m.sup.filter((x) => !mine[x.field]); // "Me too" adds a pick; it never switches one you already made
    if (!add.length) return;
    for (const x of add) mine[x.field] = x.option;
    p.picks++;
    this.pushChat({ from: p.pcode, name: p.name, kind: 'pick', text: `${p.name} agreed with ${this.nameOf(this.byCode(m.from)) || m.name}: ${list(add.map((x) => optionName(this.task, x.field, x.option)))}.` });
    this.log(p.pcode, 'me_too', { message: m.id, with: m.from, picks: Object.fromEntries(add.map((x) => [x.field, x.option])) });
    this.afterChange();
  }

  // A question to the AI: "@AI ..." in the group chat (everyone sees the question and the answer), or asked privately
  // with the AI button (only the person who asked sees either). Works at both kinds of table.
  async ask(key, text, opts) {
    const p = this.player(key); text = String(text || '').replace(ASK_AI, ' ').trim().slice(0, 300);
    if (!p || p.isAI || !text || this.stage !== 'chat') return;
    if (this.tooFast(p)) return;
    const priv = !!opts?.private;
    const to = priv ? p.key : null;
    if (priv) p.privateAsks = (p.privateAsks || 0) + 1; else { p.msgs++; p.lastMsgAt = Date.now(); }
    this.pushChat({ from: p.pcode, name: p.name, kind: 'question', text, to, ...(priv ? { private: true } : {}) });
    this.log(p.pcode, 'question_asked', { text, private: priv });
    if (!priv) this.noteMention(p, text);
    this.broadcast();
    const reply = (t, type, payload, extra) => this.aiSay(t, type, { ...payload, question: text, to_player: p.pcode, private: priv }, true, to, { answer: true, ...(extra || {}) });
    if (this.aiPaused) { // a teammate is running the AI by hand
      if (priv) return reply('A person is running the AI at this table right now, so I cannot answer privately. Ask in the group chat instead.', 'ai_answer', { source: 'rule' });
      this.pendingQuestions.push({ pcode: p.pcode, name: p.name, text }); this.broadcast(); return;
    }
    if (PAY_RE.test(text) && BILLS[this.task.id] && !priv) return this.openBill(p);
    if (BOOK_RE.test(text)) {
      if (priv) return reply(`Booking a ${RIDE_RE.test(text) ? 'ride' : 'table'} is for the whole group, so it starts in the group chat: ask there (for example "@AI book a ${RIDE_RE.test(text) ? 'ride' : 'table'}"). I will then ask each person privately which options work for them.`, 'ai_answer', { source: 'rule' });
      return this.proposeBooking(RIDE_RE.test(text) ? 'ride' : 'table', p);
    }
    if (!priv && MAP_RE.test(text) && placesOf(this.task).length) { this.showMap(p, true); this.broadcast(); return; }
    if (aiMode() === 'scripted' && wantsCompare(text)) return this.compare(p, text, reply);
    this.setThinking(to, true);
    let a;
    try {
      a = await answerQuestion(this.forModel(text), { task: this.task, asker: p.pcode, private: priv, summary: this.summaryText(true), people: this.peopleText(priv ? p : null),
        facts: this.factsText(), recent: this.recentChat(16, { withAI: true, forKey: to }) });
    } finally { this.setThinking(to, false); }
    if (this.stage !== 'chat') return;
    const fix = (t) => this.withNames(t);
    const blocks = (a.blocks || []).map((b) => b.type === 'compare' ? { ...b, items: b.items.map((x) => ({ ...x, pros: x.pros.map(fix), cons: x.cons.map(fix) })) }
      : b.type === 'table' ? { ...b, rows: b.rows.map((r) => r.map(fix)) } : b.items ? { ...b, items: b.items.map(fix) } : b);
    const pick = blocks.find((b) => b.type === 'pick');
    const extra = { blocks: blocks.filter((b) => !['pick', 'map'].includes(b.type)) };
    if (a.links?.length) extra.blocks.push({ type: 'links', title: 'Sources', items: a.links.map((l) => ({ url: /^https?:\/\//.test(l.url) ? l.url : '', title: l.title })).filter((l) => l.url) });
    if (pick) extra.poll = pick.field;
    const todoBlk = blocks.find((b) => b.type === 'todo');
    if (todoBlk && !priv) { this.addTodosFromAI(todoBlk.items); extra.blocks = extra.blocks.filter((b) => b !== todoBlk); extra.board = 'tasks'; }
    const pay = blocks.find((b) => b.type === 'pay');
    if (pay && !priv) extra.blocks = extra.blocks.filter((b) => b !== pay);
    for (const b of blocks) {
      if (priv || !['bring', 'agree', 'weather', 'itinerary'].includes(b.type)) continue;
      extra.blocks = extra.blocks.filter((x) => x !== b);
      if (b.type === 'bring') { this.bringFromAI(b.items); extra.board = 'bring'; }
      if (b.type === 'agree') { this.agreementsFromAI(b.items); extra.board = 'agreements'; }
      if (b.type === 'weather') { this.wantWeather(null); extra.board = 'weather'; }
      if (b.type === 'itinerary') { this.refreshArtifacts(); extra.board = 'day'; }
    }
    reply(fix(a.text), 'ai_answer', { source: a.source, blocks: blocks.map((b) => b.type) }, extra);
    if (pay && !priv) this.billFromModel(pay, p);
    if (!priv && blocks.some((b) => b.type === 'map') && placesOf(this.task).length) { this.showMap(p, true); this.broadcast(); }
  }
  // "The AI is working on an answer": shown to everyone for a group question, and only to the asker for a private one.
  setThinking(to, on) {
    if (to) { const n = (this.thinkingFor.get(to) || 0) + (on ? 1 : -1); if (n > 0) this.thinkingFor.set(to, n); else this.thinkingFor.delete(to); }
    else this.thinkingPublic = Math.max(0, this.thinkingPublic + (on ? 1 : -1));
    this.broadcast();
  }
  // Without an AI key, "@AI pros and cons of ..." still gets a card, built from what the app itself knows. The options
  // are the ones named in the question, or every option of the part of the plan it is about.
  compare(p, text, reply) {
    const found = detectOptions(this.task, text).filter((m) => !m.negative);
    const byField = {};
    for (const m of found) (byField[m.field] = byField[m.field] || new Set()).add(m.option);
    let field = Object.keys(byField).sort((a, b) => byField[b].size - byField[a].size)[0] || null;
    let ids = field && byField[field].size >= 2 ? [...byField[field]] : null;
    if (!ids) {
      field = topicIn(this.task, text) || field || this.panel().find((f) => f.status === 'split' || f.status === 'leaning')?.id || this.task.fields[0].id;
      const row = this.panel().find((f) => f.id === field);
      const all = this.task.fields.find((f) => f.id === field).options.map((o) => o.id);
      ids = [...row.options.map((o) => o.option), ...all].filter((x, i, arr) => arr.indexOf(x) === i).slice(0, 4);
    }
    const f = this.task.fields.find((x) => x.id === field);
    const items = ids.map((id) => this.optionFacts(field, id)).map((x) => ({ name: x.name, pros: x.pros.length ? x.pros : ['Nothing in its favor said yet'], cons: x.cons.length ? x.cons : ['No downsides raised yet'] }));
    reply(`Here is what I know about each option for ${f.name.toLowerCase()}. The group decides.`, 'ai_compare', { source: 'scripted', field, options: ids },
      { card: 'compare', compare: { field, title: `${f.name}: pros and cons`, items } });
  }
  // What the app itself knows about one option: who wants it, shared limits it breaks, and the drive time.
  optionFacts(field, id) {
    const f = this.task.fields.find((x) => x.id === field), o = f.options.find((x) => x.id === id);
    const pros = [], cons = [];
    const who = this.panel().find((x) => x.id === field).options.find((x) => x.option === id)?.who || [];
    if (who.length) pros.push(`${list(this.names(who, true))} ${who.length > 1 ? 'want' : 'wants'} it`);
    const no = this.blockedView()[field]?.[id] || [];
    if (no.length) cons.push(`Does not work for ${list(no)} (shared limit)`);
    if (placeField(this.task) === field) { const pl = placeOf(this.task, id); if (pl) { const e = estimate(PICKUP, pl); (e.minutes <= 20 ? pros : cons).push(`About ${e.minutes} min drive from campus`); } }
    return { name: o.name, pros: pros.slice(0, 3), cons: cons.slice(0, 3) };
  }
  // Basic facts about everyone at the table, for the model: codes for people, first names for AI players. A private
  // fact (one that would give a limit away) is left out unless that limit came up, except the asker's own in a private question.
  peopleText(asker) {
    if (!this.factDefs.length && !ROLE[this.task.id]) return '';
    return this.players.map((x) => `- ${this.alias(x)}: ${this.factsOf(x).filter((f) => !f.private || x === asker || x.limitSharedAt !== null).map((f) => this.forModel(f.text.replace(/\bYou are\b/, 'is').replace(/\bYou have\b/, 'has').replace(/\bYou\b/, 'they').replace(/\byour\b/g, 'their').replace(/\byou\b/g, 'them'))).join(' ')}`).join('\n');
  }
  // The same facts for every option, as text for the model: who wants what, which shared limits rule an option out,
  // and drive times. Names are replaced by codes before this is sent.
  factsText() {
    const blocked = this.blockedView(true), pf = placeField(this.task), panel = this.panel();
    return this.task.fields.map((f) => {
      const row = panel.find((x) => x.id === f.id);
      return `- ${f.name}${f.personal ? ' (each person may go their own way)' : ''}: ${f.options.map((o) => {
        const notes = [];
        const who = row.options.find((x) => x.option === o.id)?.who || [];
        if (who.length) notes.push(`wanted by ${who.map((c) => this.aliasOf(c)).join(', ')}`);
        if (blocked[f.id]?.[o.id]) notes.push(`does not work for ${list(blocked[f.id][o.id])}, who shared a limit`);
        if (pf === f.id) { const pl = placeOf(this.task, o.id); if (pl) notes.push(`${estimate(PICKUP, pl).minutes} min drive from campus`); }
        return notes.length ? `${o.name} (${notes.join('; ')})` : o.name;
      }).join('; ')}`;
    }).join('\n');
  }
  // The recent chat as text for the model. withAI: also the AI's answers, so follow-ups make sense. forKey: also that
  // person's private exchange with the AI (only ever used for their own private question). questions: include
  // questions people asked the AI.
  recentChat(n, { withAI = false, forKey = null, questions = true } = {}) {
    return this.chat.filter((m) => (!m.to || (forKey && m.to === forKey))
        && (['chat', 'limit', 'pick'].includes(m.kind) || (questions && m.kind === 'question') || (withAI && m.answer && (m.kind === 'ai' || m.kind === 'private'))))
      .slice(-n).map((m) => (m.kind === 'pick' ? `(${this.forModel(m.text)})`
        : `${this.aliasOf(m.from)}${m.to ? ' (private)' : ''}: ${this.forModel(m.text)}${m.kind === 'question' ? ' (asked the AI)' : ''}${m.blocks?.length ? ` [also showed: ${m.blocks.map((b) => b.title || b.type).join(', ')}]` : ''}`)).join('\n');
  }

  pauseAI(key, paused) {
    const p = this.player(key); if (!p || p.isAI || this.mode !== 'listen' || this.stage !== 'chat') return;
    paused = !!paused;
    if (paused === !!this.pausedBy) return;
    this.pausedBy = paused ? p.pcode : null;
    this.log(p.pcode, 'ai_paused_by_player', { paused });
    this.sys(paused ? `${p.name} paused the AI. It will not read or post until someone resumes it. Taps on the plan still count.` : `${p.name} resumed the AI.`, 'ai_pause_notice', { paused });
  }

  // ---------- the plan ----------
  // The plan is whatever most of the table wants for each part. It is never set by one person or by the AI.
  syncPlan() {
    const next = {};
    for (const f of this.panel()) if (f.status === 'agreed') next[f.id] = f.leader;
    const ways = this.waysOf(next);
    const key = JSON.stringify([next, ways]);
    if (key === this.planKey) return;
    const had = Object.values(this.accepts).some(Boolean);
    this.plan = next; this.ways = ways; this.planKey = key; this.accepts = {};
    for (const b of this.bills) if (b.source === 'app' && b.status === 'open') b.status = 'stale';
    for (const h of this.humans()) h.selfOk = null;
    const complete = planComplete(this.task, next);
    this.log('system', 'plan_update', { plan: next, ways, complete });
    if (had) this.log('system', 'accepts_reset');
    if (complete && this.announced !== key) {
      this.announced = key;
      const text = `Every part of the plan has a choice: ${this.planText(next, ways)}. If it works for you, tap Accept. If it does not, say so or change a pick.`;
      this.pushChat({ from: 'system', name: 'Cabrillo', kind: 'plan', plan: next, ways: this.waysView(ways), text });
      this.log('system', 'plan_complete', { text, plan: next, ways });
    }
  }

  // Runs after every message, pick, or shared limit.
  afterChange() {
    if (this.stage !== 'chat' || this.deal) { this.broadcast(); return; }
    this.lastChangeAt = Date.now();
    this.syncPlan();
    this.refreshArtifacts();
    this.queueAiFollow();
    if (this.mode === 'listen') {
      this.privateAlerts();
      if (this.listening()) { this.protectSharedLimits(); this.autoCards(); this.queueHearing(); }
    }
    this.broadcast();
  }

  // Where the group is heading: the leading option for each part, even before most people agree.
  heading() { const h = {}; for (const f of this.panel()) if (f.leader) h[f.id] = f.leader; return h; }

  // Listening tables only: a private note when the plan is heading somewhere that breaks your limit and the group
  // does not know. Only that person sees it. This is a rule in the app; the limit is not sent to the AI model.
  privateAlerts() {
    const heading = this.heading();
    for (const h of this.humans()) {
      const lim = this.limitOf(h);
      const breaks = !h.custom && h.limitSharedAt === null && lim.violates(this.planFor(h, heading));
      if (breaks && !h.alertOn && h.alerts < 2) {
        h.alerts++;
        // If the clash is only about a personal part, the person can go their own way: offer the options right there.
        const own = this.personal().find((f) => heading[f.id] && f.options.some((o) => !lim.violates({ ...heading, [f.id]: o.id })));
        const text = own
          ? `Heads up: the group is leaning toward ${optionName(this.task, own.id, heading[own.id])} for ${own.name.toLowerCase()}, which breaks your private limit, and the group does not know that. For this part each person can go their own way: tap yours below. You can also say why, or I can pass it on for you.`
          : 'Heads up: the plan is heading somewhere that breaks your private limit, and the group does not know that. You can say it yourself, or I can pass it on for you.';
        this.aiSay(text, 'limit_alert_private', { limit: this.limitId(h), ...(own ? { personal: own.id } : {}) }, true, h.key, { actions: 'limit', ...(own ? { poll: own.id } : {}) });
      }
      h.alertOn = breaks;
    }
  }

  // Listening tables only: once a limit has been shared, the AI speaks up if the plan stops fitting it. It waits a
  // few seconds after its last message, so two AI messages do not land back to back.
  protectSharedLimits() {
    let soon = Date.now() - this.lastAiSayAt < sec(8);
    for (const p of this.players) {
      const lim = this.limitOf(p);
      const breaks = !p.custom && p.limitSharedAt !== null && lim.violates(this.planFor(p, this.plan));
      if (!breaks) { p.flagOn = false; continue; }
      if (p.flagOn || (p.flags || 0) >= 2 || soon) continue;
      p.flagOn = true; p.flags = (p.flags || 0) + 1; soon = true;
      const whose = p.limitAnon ? 'something shared without a name' : `what ${this.nameOf(p)} shared`;
      const own = this.personal().find((f) => this.plan[f.id] && f.options.some((o) => !lim.violates({ ...this.plan, [f.id]: o.id })));
      if (own && p.isAI) { p.flags--; p.flagOn = false; continue; } // an AI player picks its own way by itself (see aiPlayersFollow)
      this.aiSay(own
        ? `${optionName(this.task, own.id, this.plan[own.id])} does not fit ${whose}. Each person can pick their own way for ${own.name.toLowerCase()}.`
        : `Heads up: the plan does not fit ${whose}. What could change?`, 'shared_limit_conflict', { pcode: p.pcode, limit: this.limitId(p), plan: this.plan, ...(own ? { personal: own.id } : {}) });
    }
  }

  // Listening tables only: cards the AI adds on its own when the chat calls for them. One of each per chat.
  autoCards() {
    const field = placeField(this.task);
    if (field && !this.auto.map && !this.maps.length && (this.panel().find((f) => f.id === field)?.options.length || 0) >= 2) {
      this.auto.map = true; this.showMap(null);
    }
    const place = field && this.plan[field] ? placeOf(this.task, this.plan[field]) : null;
    if (place && !this.auto.ride && this.plan.travel === 'rideshare' && !this.bookings.some((b) => b.kind === 'ride')) {
      this.auto.ride = true; this.proposeBooking('ride', null);
    }
    if (place && !this.auto.route && ['transit', 'carpool'].includes(this.plan.travel)) { this.auto.route = true; this.showRoute(place, this.plan.travel); }
    if (BILLS[this.task.id] && planComplete(this.task, this.plan) && !this.bills.some((b) => b.planKey === this.planKey && b.status !== 'stale')
      && Date.now() - this.lastAiSayAt > sec(6)) this.openBill(null);
    if (place && !this.auto.table && TABLE_TASKS.has(this.task.id) && this.plan.when && !this.bookings.some((b) => b.kind === 'table')) {
      this.auto.table = true; this.proposeBooking('table', null);
    }
  }

  accept(key, value, fits) {
    const p = this.player(key);
    if (!p || p.isAI || this.stage !== 'chat' || this.deal) return;
    if (value && !planComplete(this.task, this.plan)) return;
    this.accepts[key] = !!value;
    if (p.custom) p.selfOk = value ? fits !== false : null; // a limit you wrote yourself: you say whether the plan fits it
    this.log(p.pcode, 'vote', { value: !!value, plan: this.plan, limit_ok: this.limitOk(p, this.plan) });
    if (value && this.active().every((h) => this.accepts[h.key])) return this.lockDeal();
    this.broadcast();
  }

  lockDeal() {
    this.deal = { plan: { ...this.plan }, ways: JSON.parse(JSON.stringify(this.ways)), t: this.t };
    this.log('system', 'deal_locked', { plan: this.plan, ways: this.ways, accepted_by: this.humans().filter((h) => this.accepts[h.key]).map((h) => h.pcode) });
    this.sys(`Plan locked: ${this.planText(this.plan, this.ways)}.`, 'deal_summary');
    this.clearStageTimers();
    this.timers.push(setTimeout(() => this.enter('done'), 2500));
    this.broadcast();
  }

  // With no timer, a table that cannot agree can end without a plan, but only if every person asks to.
  endVote(key, value) {
    const p = this.player(key);
    if (!p || p.isAI || this.stage !== 'chat' || this.deal) return;
    p.wantsEnd = !!value;
    this.log(p.pcode, 'end_vote', { value: !!value });
    if (value && this.active().every((h) => h.wantsEnd)) { this.log('system', 'ended_by_group'); this.endReason = 'group'; return this.enter('done'); }
    this.broadcast();
  }

  // ---------- maps and the booking demo ----------
  opt(field, id) { return this.task.fields.find((f) => f.id === field)?.options.find((x) => x.id === id); }
  choice(field) {
    const plan = this.deal ? this.deal.plan : this.plan;
    if (plan[field]) return plan[field];
    return this.panel().find((f) => f.id === field)?.leader || null;
  }
  // by: the person who asked, or null when the AI added the map because people were comparing places.
  showMap(by, asked) {
    const places = placesOf(this.task);
    if (!places.length) { if (asked) this.aiSay('There is no place to show on a map for this plan.', 'map_unavailable', {}, true); return; }
    if (!asked && this.lastMapAt && Date.now() - this.lastMapAt < sec(60)) return;
    this.lastMapAt = Date.now();
    const field = placeField(this.task);
    const m = { id: `m${this.maps.length + 1}`, field, auto: !by, places: places.map((x) => ({ ...x, ...estimate(PICKUP, x) })), origin: PICKUP };
    this.maps.push(m);
    this.pushChat({ from: 'AI', name: 'AI', kind: 'map', mapId: m.id, text: `Map of the options, with drive times from campus: ${m.places.map((x) => `${x.name} ${x.minutes} min`).join(', ')}.` });
    this.log('AI', 'map_shown', { id: m.id, requested_by: by?.pcode || null, auto: !by, places: m.places.map((x) => x.id) });
  }

  // Listening tables: once the plan has a place and says bus or carpool, the AI shows the way there.
  async showRoute(place, travel) {
    const r = await route(PICKUP, place);
    if (this.stage !== 'chat') return;
    const transit = travel === 'transit';
    const m = { id: `m${this.maps.length + 1}`, kind: 'route', auto: true, mode: transit ? 'transit' : 'driving', origin: PICKUP, place, route: r.points, miles: r.miles,
      minutes: transit ? Math.round(r.minutes * 2.2 + 8) : r.minutes };
    this.maps.push(m);
    this.pushChat({ from: 'AI', name: 'AI', kind: 'map', mapId: m.id, text: `How to get to ${place.name} ${transit ? 'by bus or trolley' : 'by car'}: about ${m.minutes} minutes from campus.` });
    this.log('AI', 'route_shown', { id: m.id, place: place.id, mode: m.mode, minutes: m.minutes });
    this.broadcast();
  }

  // ---------- rides and tables ----------
  // Whether to book is a group matter and happens in the chat. Which ride, or which time, is not: the AI asks each
  // person privately which options work for them, and the group sees only the result (never who said what).
  // by: the person who asked, or null when the AI offers it because the plan calls for it.
  // Who a ride is for: the people going by rideshare, or, before anyone has picked it, everyone who has not chosen
  // another way to get there.
  riders() {
    const f = this.personal().find((x) => x.options.some((o) => o.id === 'rideshare'));
    if (!f) return this.players;
    const way = (p) => this.prefs[p.pcode]?.[f.id] || this.plan[f.id] || null;
    const r = this.players.filter((p) => way(p) === 'rideshare');
    return r.length ? r : this.players.filter((p) => !this.prefs[p.pcode]?.[f.id]);
  }
  async proposeBooking(kind, by) {
    if (this.stage !== 'chat') return;
    const say = (text, type) => { if (by) this.aiSay(text, type, { kind }, true); };
    const what = kind === 'ride' ? 'ride' : 'table';
    if (this.preparing[kind] || this.bookings.some((b) => b.kind === kind && b.status !== 'none')) {
      if (!this.preparing[kind]) say(`There is already a ${what} card above.`, 'booking_duplicate');
      return;
    }
    const field = placeField(this.task);
    const placeId = field ? this.choice(field) : null;
    const place = placeId ? placeOf(this.task, placeId) : null;
    if (!field) return say(`In this demo I can book a ${what} only when the plan has a place to go, and this one does not.`, 'booking_unavailable');
    if (!place) {
      const named = placeId ? optionName(this.task, field, placeId) : null;
      return say(named ? `${named} is not a place I can book for.` : `Pick a ${fieldName(this.task, field).toLowerCase()} first, and I will book ${kind === 'ride' ? 'the ride' : 'a table'} there.`, 'booking_needs_place');
    }
    this.preparing[kind] = true;
    try {
      const when = this.choice('when'), budget = this.choice('budget');
      const whenName = when ? optionName(this.task, 'when', when) : null;
      const riders = kind === 'ride' ? this.riders() : this.players;
      if (!riders.length) return say('Everyone has picked another way to get there, so there is no ride to book.', 'booking_unavailable');
      const n = riders.length;
      const b = { id: `b${this.bookings.length + 1}`, kind, n, riders: riders.map((p) => p.pcode), answers: {}, status: 'asking', code: null, by: by?.pcode || null, auto: !by, whenName, place };
      if (kind === 'ride') {
        const r = await route(PICKUP, place);
        b.origin = PICKUP; b.route = r.points; b.miles = r.miles; b.minutes = r.minutes; b.routeSource = r.source;
        b.options = rideOptions(r, n);
        b.title = `Ride to ${place.name}`;
      } else {
        const per = this.opt('budget', budget)?.per || MEAL[budget] || 20;
        b.restaurant = place.restaurant; b.perPerson = per; b.total = per * n;
        b.options = slotsFor(whenName).map((x) => ({ id: x, name: x, perPerson: per }));
        b.title = `Table for ${n} at ${place.restaurant}`;
      }
      if (this.stage !== 'chat') return;
      this.bookings.push(b);
      const why = by ? `${by.name} asked me to book.` : kind === 'ride' ? 'The plan says rideshare, so I priced the ride.' : 'You picked a place and a time, so I can hold a table.';
      const some = n < this.players.length;
      this.pushChat({ from: 'AI', name: 'AI', kind: 'booking', bookingId: b.id, text: `${why} ${b.title}${some ? ` for ${n}` : ''}. I am asking each ${some ? 'rider' : 'person'} privately which ${kind === 'ride' ? 'rides' : 'times'} work for them; the group only sees the result.` });
      this.lastAiSayAt = Date.now();
      this.log('AI', 'booking_proposed', { id: b.id, kind, auto: !by, requested_by: by?.pcode || null, place: place.id, when, options: b.options.map((o) => ({ id: o.id, per_person: o.perPerson })), route: b.routeSource || null });
      this.later(45, () => this.remindBooking(b));
      this.broadcast();
    } finally { this.preparing[kind] = false; }
  }
  // A person's private answer: every option that works for them, or none. They can change it until the result is in.
  bookingAnswer(key, id, ok) {
    const p = this.player(key); const b = this.bookings.find((x) => x.id === id);
    if (!p || p.isAI || !b || b.status !== 'asking' || this.stage !== 'chat' || !b.riders.includes(p.pcode)) return;
    const ids = [...new Set((Array.isArray(ok) ? ok : []).map(String))].filter((x) => b.options.some((o) => o.id === x));
    const changed = !!b.answers[p.pcode];
    b.answers[p.pcode] = ids;
    this.log(p.pcode, 'booking_answer', { id, kind: b.kind, ok: ids, none: !ids.length, changed });
    this.settleBooking(b);
  }
  // AI players answer by their limit: any option within what they can spend.
  aiBookingAnswer(p, b) { const max = this.limitOf(p).maxPerPerson; return b.options.filter((o) => !max || o.perPerson <= max).map((o) => o.id); }
  // Once every person here has answered: book the cheapest ride (or the earliest time) that works for everyone.
  settleBooking(b) {
    if (b.status !== 'asking' || this.stage !== 'chat') return;
    if (!this.bookingNeeds(b).every((h) => b.answers[h.pcode])) { this.broadcast(); return; }
    const all = [...this.humans().filter((h) => b.answers[h.pcode]).map((h) => b.answers[h.pcode]), ...this.players.filter((p) => p.isAI && b.riders.includes(p.pcode)).map((p) => this.aiBookingAnswer(p, b))];
    const common = b.options.filter((o) => all.every((a) => a.includes(o.id)));
    const ride = b.kind === 'ride';
    if (!common.length) {
      b.status = 'none';
      this.aiSay(`Not booked: no ${ride ? 'ride' : 'time'} works for everyone. I am not showing who said what. You can talk it over and ask me again${ride ? ', or pick another way to get there' : ''}.`, 'booking_none', { id: b.id, kind: b.kind }, true);
      return;
    }
    const pick = ride ? common.reduce((x, y) => (y.total < x.total ? y : x)) : common[0];
    b.choice = pick.id; b.status = 'booked'; b.code = `DEMO-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
    if (ride) {
      b.total = pick.total; b.perPerson = pick.perPerson; b.cars = pick.cars;
      // The ride plays out on the map so the group can see it: a driver is found, drives to the pickup, then to the place.
      const now = Date.now(), k = Math.max(SCALE, 0.05);
      b.driver = driver(b.choice); b.driverFrom = driverStart(b.origin);
      b.phases = { matchedAt: now + 3000 * k, pickupAt: now + 18000 * k, dropoffAt: now + 48000 * k };
      this.aiSay(`Booked (demo, nothing was charged): ${pick.name} is the cheapest ride that works for everyone, so ${b.cars > 1 ? `${b.cars} ${pick.name} cars are` : `a ${pick.name} car is`} on the way to take you to ${b.place.name}. That is $${b.perPerson.toFixed(2)} each. Watch the map to see how the ride would go.`, 'booking_done', { id: b.id, kind: b.kind, code: b.code, option: b.choice, per_person: b.perPerson }, true);
    } else {
      b.slot = pick.id;
      this.aiSay(`Reserved (demo, nothing was charged): ${b.title}, ${b.slot}, the earliest time that works for everyone. Confirmation ${b.code}. About $${b.perPerson.toFixed(2)} each.`, 'booking_done', { id: b.id, kind: b.kind, code: b.code, slot: b.slot, per_person: b.perPerson }, true);
    }
  }
  // The people whose private answer a booking is waiting for.
  bookingNeeds(b) { return this.active().filter((h) => b.riders.includes(h.pcode)); }
  remindBooking(b) {
    if (b.status !== 'asking' || this.stage !== 'chat') return;
    for (const h of this.bookingNeeds(b)) {
      if (b.answers[h.pcode]) continue;
      this.aiSay(`The ${b.kind === 'ride' ? 'ride' : 'table'} card above is waiting for your answer. Your answer stays private; the group only sees the result.`, 'booking_reminder', { id: b.id }, true, h.key);
    }
  }

  bookingView(b, me) {
    // Options above a spending limit that someone chose to share are marked, so nobody has to say it again.
    const over = (o) => this.players.filter((x) => x.limitSharedAt !== null && this.limitOf(x).maxPerPerson && o.perPerson > this.limitOf(x).maxPerPerson).map((x) => (x.limitAnon ? 'someone' : this.nameOf(x)));
    const { answers, by, riders, ...rest } = b;
    const need = this.bookingNeeds(b);
    return { ...rest, options: b.options.map((o) => ({ ...o, over: over(o) })),
      // rider: whether this booking includes you. When it does not, the card shows who it is for instead of a question.
      rider: !me || riders.includes(me.pcode), riderNames: riders.length < this.players.length ? riders.map((c) => this.nameOf(this.byCode(c))) : null,
      mine: me ? (answers[me.pcode] ?? null) : null, answered: need.filter((h) => answers[h.pcode]).length, of: need.length };
  }

  // ---------- who owes what (a demo: no money moves) ----------
  // by: the person who asked, or null when the AI posts it because the plan is complete.
  openBill(by) {
    if (this.stage !== 'chat') return;
    const def = BILLS[this.task.id]; if (!def) return;
    const plan = { ...this.heading(), ...this.plan };
    const missing = def.needs.filter((f) => !plan[f]);
    if (missing.length) {
      if (by) this.aiSay(`I can work out who owes what once you pick ${list(missing.map((f) => fieldName(this.task, f).toLowerCase()))}.`, 'bill_needs', { missing }, true);
      return;
    }
    const open = this.bills.find((b) => b.planKey === this.planKey && b.status === 'open' && b.source === 'app');
    if (open) { if (by) this.aiSay('The bill is already above. Tap your row to pay.', 'bill_duplicate', {}, true); return; }
    const holder = this.roleHolder();
    // a private fact counts at its public value until the limit comes up, so the bill never gives a limit away
    const seats = this.players.map((x) => ({ pcode: x.pcode, name: this.nameOf(x), role: x === holder, fact: (id) => this.fact(x, id, true) }));
    const r = def.compute(plan, seats);
    this.postBill({ ...r, source: 'app', auto: !by, by: by?.pcode || null });
  }
  // A "pay" block from the model (@AI "who owes what" in any scenario): rows name people by code or name.
  billFromModel(blk, by) {
    const who = (x) => { const s = String(x || '').trim(); return this.byCode(s.toUpperCase()) || this.players.find((p) => [p.name, p.short].filter(Boolean).some((n) => n.toLowerCase() === s.toLowerCase())) || null; };
    const rows = [];
    for (const r of blk.rows || []) {
      const from = who(r.who); if (!from) continue;
      const to = who(r.to);
      if (to === from) continue;
      rows.push({ pcode: from.pcode, amount: r.amount, to: to ? to.pcode : 'other', toName: to ? null : (r.to || 'the group'), note: r.for || '' });
    }
    if (rows.length) this.postBill({ title: blk.title || 'Who owes what', rows, method: null, notes: [], source: 'ai', auto: false, by: by.pcode });
  }
  postBill(r) {
    const b = { id: `bill${this.bills.length + 1}`, title: r.title, notes: r.notes || [], method: ['venmo', 'zelle', 'cash'].includes(r.method) ? r.method : null,
      rows: r.rows.map((x, i) => ({ ...x, id: i })), paid: {}, status: 'open', source: r.source, planKey: this.planKey, auto: r.auto };
    this.bills.push(b);
    const cash = b.method === 'cash';
    this.pushChat({ from: 'AI', name: 'AI', kind: 'bill', billId: b.id, text: `${r.auto ? 'Every part of the plan is set, so here is who owes what.' : 'Here is who owes what.'} ${cash ? 'You picked cash, so tap your row once you have paid in person.' : 'Ready to pay? Tap your row and I will send it for you. This is a demo: no money moves.'}` });
    this.lastAiSayAt = Date.now();
    this.log('AI', 'bill_proposed', { id: b.id, source: b.source, auto: b.auto, requested_by: r.by, method: b.method, rows: b.rows.map((x) => ({ from: x.pcode, to: x.to, amount: x.amount })) });
    // AI players pay their rows after a moment, like a person would
    for (const row of b.rows) {
      const x = this.byCode(row.pcode);
      if (x?.isAI) this.later(rand(4, 9), () => this.payRow(x, b, row.id, b.method || 'venmo'));
    }
    this.broadcast();
  }
  payBill(key, billId, rowId, method) {
    const p = this.player(key); const b = this.bills.find((x) => x.id === billId);
    if (!p || p.isAI || !b) return;
    this.payRow(p, b, Number(rowId), method);
  }
  payRow(p, b, rowId, method) {
    const row = b.rows.find((x) => x.id === rowId);
    if (!row || row.pcode !== p.pcode || b.paid[rowId] || b.status !== 'open' || this.stage !== 'chat') return;
    method = b.method || (['venmo', 'zelle'].includes(method) ? method : 'venmo');
    b.paid[rowId] = { method, t: this.t };
    const M = { venmo: 'Venmo', zelle: 'Zelle', cash: 'cash' }[method];
    const to = row.to === 'host' || row.to === 'other' ? row.toName : this.nameOf(this.byCode(row.to));
    this.log(p.pcode, 'bill_paid', { id: b.id, row: rowId, amount: row.amount, to: row.to, method });
    if (!p.isAI) this.aiSay(method === 'cash' ? `Marked as paid: $${row.amount.toFixed(2)} to ${to} in cash.` : `Done: you paid $${row.amount.toFixed(2)} to ${to} with ${M}, through the AI. (Demo: no money moved.)`, 'bill_receipt', { id: b.id, row: rowId }, true, p.key);
    if (b.rows.every((x) => b.paid[x.id])) {
      b.status = 'settled';
      this.aiSay(`Everyone has paid${b.method === 'cash' ? '' : ' (demo: no money moved)'}. You are all square.`, 'bill_settled', { id: b.id }, true);
    }
    this.broadcast();
  }
  billView(b, me) {
    const nm = (code, label) => (code === 'host' || code === 'other' ? label : this.nameOf(this.byCode(code)) || code);
    return { id: b.id, title: b.title, notes: b.notes, method: b.method, status: b.status, auto: b.auto,
      rows: b.rows.map((r) => ({ id: r.id, pcode: r.pcode, name: nm(r.pcode), to: r.to, toName: nm(r.to, r.toName), amount: r.amount, note: r.note, paid: b.paid[r.id]?.method || null, mine: !!me && r.pcode === me.pcode, toMe: !!me && r.to === me.pcode })),
      // a person whose private fact the bill does not count yet (the group does not know it) sees why, privately
      hidden: me && this.factDefs.some((f) => typeof f.byLimit?.[me.limitId] === 'object' && !me.custom && me.limitSharedAt === null && me.limitMentionedAt === null && b.source === 'app')
        ? `This bill counts you as: ${this.factDefs.filter((f) => typeof f.byLimit?.[me.limitId] === 'object').map((f) => this.fact(me, f.id, true).text.replace(/^You /, 'you ').replace(/\.$/, '')).join('; ')}. The group does not know your limit, so it cannot count the real numbers. Share it and I will fix your amount.` : null };
  }

  // ---------- the plan board ----------
  // A short record of what changed, newest last, shown under "Changes" on the board.
  note(text) { this.history.push({ t: this.t, text }); if (this.history.length > 200) this.history.shift(); }
  // What the AI saved from one message: "Maya → Old Town", "Dev: not Saturday morning", "Kai → Bus or trolley (suggested)".
  savedLines(p, changes) {
    const out = [];
    for (const c of changes) {
      const o = optionName(this.task, c.field, c.option);
      if (c.kind === 'supports') out.push(`${this.nameOf(p)} → ${o}`);
      else if (c.kind === 'rejected' || c.kind === 'dropped') out.push(`${this.nameOf(p)}: not ${o}`);
      else if (c.kind === 'about_other') out.push(`${this.nameOf(this.byCode(c.about))} → ${o} (suggested)`);
    }
    return out.slice(0, 4);
  }
  // Anyone can add their own option to a part of the plan ("Maya's apartment", "Thursday 7 pm", a real place).
  addOption(key, field, name, geo) {
    const p = this.player(key); const f = this.task.fields.find((x) => x.id === field);
    if (!p || p.isAI || !f || this.stage !== 'chat' || this.deal) return { error: 'You cannot add an option right now.' };
    name = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 50);
    if (name.length < 2) return { error: 'Type a name for the option.' };
    const dup = f.options.find((o) => o.name.toLowerCase() === name.toLowerCase());
    if (dup) { this.pick(key, field, dup.id); return { ok: true, id: dup.id }; }
    if (f.options.length >= 10) return { error: 'This part already has 10 options.' };
    const id = `x${++this.customN}`;
    const g = geo && Number.isFinite(Number(geo.lat)) && Number.isFinite(Number(geo.lng)) ? { lat: Number(geo.lat), lng: Number(geo.lng), address: String(geo.address || '').slice(0, 90), food: !!geo.food } : null;
    f.options.push({ id, name, kw: [name.toLowerCase()], custom: true, by: p.pcode, ...(g ? { geo: g } : {}) });
    const mine = this.prefs[p.pcode] || (this.prefs[p.pcode] = {});
    mine[field] = id; p.picks++;
    if (fieldKind(this.task, f) === 'time') ((this.avail[p.pcode] = this.avail[p.pcode] || {})[field] = this.avail[p.pcode][field] || {})[id] = 'yes';
    this.pushChat({ from: p.pcode, name: p.name, kind: 'pick', text: `${p.name} added ${name} to ${f.name.toLowerCase()} and picked it.` });
    this.note(`${p.name} added ${name} to ${f.name.toLowerCase()}`);
    this.log(p.pcode, 'option_added', { field, id, name, place: !!g });
    this.afterChange();
    return { ok: true, id };
  }
  async findPlaces(query) { return searchPlaces(query); }
  // Availability: for a time part, each person marks every option yes, maybe or no. Their pick is the time they said
  // yes to that the most people can make, so the group meets in the middle by itself.
  setAvail(key, field, option, value) {
    const p = this.player(key); const f = this.task.fields.find((x) => x.id === field);
    if (!p || p.isAI || !f || !f.options.some((o) => o.id === option) || this.stage !== 'chat' || this.deal) return;
    const marks = ((this.avail[p.pcode] = this.avail[p.pcode] || {})[field] = this.avail[p.pcode][field] || {});
    if (['yes', 'maybe', 'no'].includes(value)) marks[option] = value; else delete marks[option];
    p.picks++;
    this.log(p.pcode, 'availability', { field, option, value: marks[option] || null });
    this.availPicks(field);
    this.note(`${p.name}: ${optionName(this.task, field, option)} ${marks[option] || 'cleared'}`);
    this.afterChange();
  }
  availScore(field) {
    const score = {};
    for (const m of Object.values(this.avail)) for (const [o, v] of Object.entries(m[field] || {})) score[o] = (score[o] || 0) + (v === 'yes' ? 1 : v === 'maybe' ? 0.4 : 0);
    return score;
  }
  availPicks(field) {
    const score = this.availScore(field), order = this.task.fields.find((x) => x.id === field).options.map((o) => o.id);
    for (const h of this.humans()) {
      const m = this.avail[h.pcode]?.[field]; if (!m) continue;
      const mine = this.prefs[h.pcode] || (this.prefs[h.pcode] = {});
      const yes = Object.keys(m).filter((o) => m[o] === 'yes'), maybe = Object.keys(m).filter((o) => m[o] === 'maybe');
      const cand = yes.length ? yes : maybe;
      if (!cand.length) { if (mine[field] && m[mine[field]] === 'no') delete mine[field]; continue; }
      mine[field] = [...cand].sort((a, b) => (score[b] || 0) - (score[a] || 0) || order.indexOf(a) - order.indexOf(b))[0];
    }
  }
  // Reactions on chat messages.
  react(key, msgId, emoji) {
    const p = this.player(key); const m = this.chat.find((x) => x.id === Number(msgId));
    if (!p || p.isAI || !m || m.to || !REACTIONS.includes(emoji) || this.stage !== 'chat') return;
    m.reacts = m.reacts || {};
    const who = new Set(m.reacts[emoji] || []);
    if (who.has(p.pcode)) who.delete(p.pcode); else who.add(p.pcode);
    if (who.size) m.reacts[emoji] = [...who]; else delete m.reacts[emoji];
    this.log(p.pcode, 'reaction', { message: m.id, emoji, on: who.has(p.pcode) });
    this.broadcast();
  }
  // A shared to-do list. Anyone adds a task, claims it, checks it off, or removes one.
  todo(key, action, a = {}) {
    const p = this.player(key);
    if (!p || p.isAI || this.stage === 'done') return;
    const t = this.todos.find((x) => x.id === a.id);
    if (action === 'add') {
      const text = String(a.text || '').replace(/\s+/g, ' ').trim().slice(0, 120);
      if (text.length < 2 || this.todos.length >= 30) return;
      this.todos.push({ id: `t${++this.todoN}`, text, owner: a.mine ? p.pcode : null, done: false, by: p.pcode });
      this.note(`${p.name} added a task: ${text}`);
    } else if (!t) return;
    else if (action === 'toggle') { t.done = !t.done; this.note(`${p.name} ${t.done ? 'finished' : 'reopened'}: ${t.text}`); }
    else if (action === 'claim') { t.owner = t.owner === p.pcode ? null : p.pcode; this.note(`${p.name} ${t.owner ? 'took' : 'let go of'}: ${t.text}`); }
    else if (action === 'remove') { this.todos = this.todos.filter((x) => x !== t); this.note(`${p.name} removed a task: ${t.text}`); }
    else return;
    this.log(p.pcode, 'todo', { action, id: a.id || this.todos[this.todos.length - 1]?.id });
    this.broadcast();
  }
  addTodosFromAI(items) {
    for (const text of items.slice(0, 8)) if (this.todos.length < 30) this.todos.push({ id: `t${++this.todoN}`, text: String(text).slice(0, 120), owner: null, done: false, by: 'AI' });
    this.note(`The AI added ${items.length} task${items.length === 1 ? '' : 's'}`);
  }
  // A menu for a restaurant option: real items found with web search when that works, otherwise a sample menu that
  // says so. Each person taps what they would order; the totals can become a bill.
  async openMenu(key, placeId) {
    const p = this.player(key); if (!p || p.isAI || this.stage !== 'chat') return { error: 'Not now.' };
    const place = placeOf(this.task, placeId); if (!place) return { error: 'That option is not a place.' };
    if (this.menus[placeId]) return { ok: true };
    this.menus[placeId] = { place: { id: place.id, name: place.restaurant || place.name }, items: [], loading: true, orders: {}, source: null };
    this.broadcast();
    const m = await menuFor(place.restaurant || place.name, place.address || place.name);
    const menu = this.menus[placeId];
    menu.items = m.items.map((x, i) => ({ id: `i${i}`, name: x.name, price: x.price, note: x.note || '' }));
    menu.source = m.source; menu.sample = !!m.sample; menu.links = m.links || []; menu.loading = false;
    this.log(p.pcode, 'menu_opened', { place: placeId, items: menu.items.length, sample: menu.sample });
    this.note(`${p.name} opened the menu for ${menu.place.name}`);
    this.broadcast();
    return { ok: true };
  }
  order(key, placeId, itemId, delta) {
    const p = this.player(key); const m = this.menus[placeId];
    if (!p || p.isAI || !m || !m.items.some((x) => x.id === itemId) || this.stage !== 'chat') return;
    const mine = (m.orders[p.pcode] = m.orders[p.pcode] || {});
    mine[itemId] = Math.max(0, Math.min(9, (mine[itemId] || 0) + (Number(delta) > 0 ? 1 : -1)));
    if (!mine[itemId]) delete mine[itemId];
    this.log(p.pcode, 'menu_order', { place: placeId, item: itemId, qty: mine[itemId] || 0 });
    this.broadcast();
  }
  // Split the menu orders: the person who taps pays, and everyone else pays them back their own order plus 20% for
  // tax and tip.
  menuBill(key, placeId) {
    const p = this.player(key); const m = this.menus[placeId];
    if (!p || p.isAI || !m || this.stage !== 'chat') return;
    const rows = [];
    for (const [code, items] of Object.entries(m.orders)) {
      if (code === p.pcode) continue;
      const sub = Object.entries(items).reduce((a, [id, q]) => a + (m.items.find((x) => x.id === id)?.price || 0) * q, 0);
      if (sub > 0) rows.push({ pcode: code, amount: Math.round(sub * 120) / 100, to: p.pcode, note: Object.entries(items).map(([id, q]) => `${q > 1 ? `${q}× ` : ''}${m.items.find((x) => x.id === id)?.name}`).join(', ') });
    }
    if (!rows.length) return this.aiSay('Nobody else has ordered from the menu yet.', 'bill_needs', {}, true, p.key);
    this.postBill({ title: `${m.place.name}: who owes ${this.nameOf(p)}`, rows, method: null, notes: [`${this.nameOf(p)} pays the restaurant. Amounts include about 20% for tax and tip.`], source: 'menu', auto: false, by: p.pcode });
  }

  // ---------- the listening AI ----------
  // The tally in words. forModel: people as codes and AI players by first name (the form every model prompt uses).
  summaryText(forModel) {
    const who = (codes) => (forModel ? codes.map((c) => this.aliasOf(c)) : codes).join(', ');
    const parts = this.panel().map((f) => {
      if (f.status === 'open') return `${f.name}: not discussed yet`;
      if (f.status === 'agreed') return `${f.name}: ${this.leaderText(f, forModel)} (${f.own.length ? 'settled, each their own way' : 'most agree'})`;
      return `${f.name}: ${f.options.map((o) => `${o.name} (${who(o.who)})`).join(' or ')}`;
    });
    return parts.join('; ') + '.';
  }
  // short: first names for AI players, for use inside a sentence.
  names(pcodes, short) { return pcodes.map((c) => { const p = this.byCode(c); return p ? (short ? this.nameOf(p) : p.name) : c; }); }

  // One line above the chat: what the AI is hearing. Built from rules at once; when an AI key is set, the model
  // rewrites it a few seconds after the chat goes quiet (so it can also reflect ideas that are not on the list).
  hearingRule() {
    const panel = this.panel();
    if (panel.every((f) => f.status === 'open')) return 'Nothing decided yet. Say what you want, or tap a part of the plan to pick.';
    const agreed = panel.filter((f) => f.status === 'agreed'), mixed = panel.filter((f) => f.status === 'split' || f.status === 'leaning'), open = panel.filter((f) => f.status === 'open');
    const out = [];
    if (agreed.length) out.push(`Most agree on ${list(agreed.map((f) => this.leaderText(f)))}.`);
    for (const f of mixed) out.push(`${f.name}: ${f.options.map((o) => `${o.name} (${list(this.names(o.who, true))})`).join(' or ')}.`);
    if (open.length) out.push(`Not discussed: ${list(open.map((f) => f.name.toLowerCase()))}.`);
    return out.join(' ');
  }
  queueHearing() {
    if (aiMode() === 'scripted' || process.env.AI_SUMMARY === 'off') return;
    clearTimeout(this.hearTimer);
    // Wait for a pause in the chat, and refresh at most once every 10 seconds per table, so a full class stays well
    // within the model's rate limits. The rule-based line is shown in the meantime.
    const wait = Math.max(3000, 10000 - (Date.now() - this.hearAt));
    this.hearTimer = setTimeout(() => this.refreshHearing().catch(() => {}), wait);
  }
  async refreshHearing() {
    if (this.stage !== 'chat' || !this.listening()) return;
    this.hearAt = Date.now();
    const seq = this.seq;
    const r = await summarize({ task: this.task, summary: this.summaryText(true), recent: this.recentChat(16, { questions: false }) });
    if (!r?.text || this.stage !== 'chat') return;
    this.hearing = { text: this.withNames(r.text), seq, at: Date.now() };
    this.log('AI', 'hearing_update', { text: r.text, source: r.source });
    this.broadcast();
  }

  interject(text, type, payload, extra) {
    if (this.aiSay(text, type, payload, false, null, extra)) { this.interjections++; this.lastInterjectAt = Date.now(); }
  }

  listen() {
    const now = Date.now(), elapsed = now - this.stageStartedAt;
    // Quiet people get a private invitation, never a public call-out.
    if (elapsed > sec(120) && this.humans().length > 1) {
      for (const h of this.humans()) {
        if (h.nudged || h.msgs > 0 || h.picks > 0) continue;
        h.nudged = true;
        this.aiSay('You have not said much yet. If you have a preference or a limit, the group would want to know. You can also just tap a part of the plan. No pressure.', 'ai_nudge_private', null, false, h.key);
      }
    }
    // Its own questions are spaced out, and never land right after another message from the AI.
    if (this.interjections >= MAX_INTERJECTIONS || elapsed < sec(45) || now - this.lastInterjectAt < sec(60) || now - this.lastAiSayAt < sec(20)) return;
    const panel = this.panel();
    const anyLimit = this.players.some((p) => p.limitSharedAt !== null || p.limitMentionedAt !== null);
    if (!this.didLimitsCheck && !anyLimit && (panel.some((f) => f.status === 'agreed' || f.status === 'leaning') || elapsed > sec(120))) {
      this.didLimitsCheck = true;
      this.interject('Before this settles: any limits the group should know? Say it, or tap "Your private limit".', 'limits_check');
      this.aiPlayersRespondToLimits();
      return;
    }
    // A disagreement becomes a quick poll: the options people raised, with buttons to pick.
    // Only what people want counts as a disagreement (or an AI player whose shared limit is in the way): two AI
    // players with different ideas are not a conflict, since they go along with the people at the table.
    const real = (c) => { const x = this.byCode(c); return !!x && (!x.isAI || x.revealed); };
    const c = findConflict(panel.filter((f) => !this.asked.has(`conflict:${f.id}`)).map((f) => ({ ...f, options: f.options.filter((o) => o.who.some(real)) })));
    if (c) {
      this.asked.add(`conflict:${c.field.id}`);
      const a = this.names(c.a.who, true), b = this.names(c.b.who, true);
      this.interject(`${c.field.name}: ${list(a)} ${a.length > 1 ? 'want' : 'wants'} ${c.a.name}, ${list(b)} ${b.length > 1 ? 'want' : 'wants'} ${c.b.name}. What works for everyone?`, 'conflict', { field: c.field.id, a: c.a.option, b: c.b.option }, { poll: c.field.id });
      return;
    }
    const open = panel.find((f) => f.status === 'open' && !this.asked.has(`open:${f.id}`) && !this.nudged.has(f.id));
    if (open && elapsed > sec(150)) {
      this.asked.add(`open:${open.id}`);
      this.interject(`Nobody has picked ${open.name.toLowerCase()} yet.`, 'open_question', { field: open.id }, { poll: open.id });
    }
  }

  // ---------- AI players (fill empty seats) ----------
  // Labeled seat fillers. The app decides what an AI player does on its turn and what it may pick: it keeps to its
  // limit, says the limit once when the group heads the wrong way, goes along with what the people at the table agree
  // on, and never settles anything by itself. With an AI key the model words each message like a relaxed classmate;
  // without one, short scripted lines are used. Every line is checked before it is posted: no repeats, no restating
  // what is settled, no "we are set" while a part is open, and no player codes.
  llmPlayers() { return aiMode() !== 'scripted' && process.env.AI_PLAYERS !== 'scripted'; }
  ais() { return this.players.filter((p) => p.isAI); }
  // What the people at the table want for one part, when they agree with each other. If people want different
  // things, AI players stay out of it: a seat filler must not decide a disagreement between people.
  humanChoice(f) {
    const wanted = f.options.filter((o) => o.who.some((c) => !this.byCode(c)?.isAI));
    return wanted.length === 1 ? wanted[0] : null;
  }
  // What this AI player would now go along with (picks); what the people want that breaks its limit (blocked); and,
  // for a personal part such as Getting there, the way it will go instead (own).
  followPlan(p) {
    const mine = this.prefs[p.pcode] || {}; const lim = this.limitOf(p);
    const picks = {}, own = {}, blocked = [];
    const fits = (f, v) => !lim.violates({ ...this.heading(), ...mine, ...picks, ...own, [f]: v });
    for (const row of this.panel()) {
      const f = this.task.fields.find((x) => x.id === row.id);
      const humanOpts = row.options.filter((o) => o.who.some((c) => !this.byCode(c)?.isAI)).map((o) => o.option);
      let want = this.humanChoice(row)?.option || null;
      // a personal part where people differ: ride along with whichever of their ways fits
      if (!want && f.personal && !mine[f.id] && humanOpts.length) want = humanOpts.find((v) => fits(f.id, v)) || humanOpts[0];
      if (!want || mine[f.id] === want) continue;
      if (fits(f.id, want)) { picks[f.id] = want; continue; }
      if (f.personal) {
        if (mine[f.id] && fits(f.id, mine[f.id])) continue; // already going its own way
        const alt = [lim.aiPrefs[f.id], ...f.options.map((o) => o.id)].find((v) => v && fits(f.id, v));
        if (alt) own[f.id] = alt;
      }
      blocked.push({ field: f.id, option: want, personal: !!f.personal });
    }
    return { picks, own, blocked };
  }
  scheduleAiPlayers() {
    this.ais().forEach((p, i) => {
      this.later(rand(6, 10) + i * rand(9, 13), () => this.aiPlayerSpeak(p, { reason: 'open', index: i }));
    });
  }
  // AI players a message names: "kai?", "@Ari what do you think", or a code such as "a02".
  namedAIs(text) {
    const s = ` ${String(text).toLowerCase()} `;
    return this.ais().filter((p) => new RegExp(`[^a-z0-9]@?(?:${p.short.toLowerCase()}|${p.pcode.toLowerCase()})(?![a-z0-9])`).test(s));
  }
  // How many AI player messages in a row end the chat right now. After three they wait for a person.
  aiRun() {
    let n = 0;
    for (let i = this.chat.length - 1; i >= 0; i--) {
      const m = this.chat[i];
      if (m.to || !['chat', 'limit', 'question', 'pick'].includes(m.kind)) continue;
      const who = this.byCode(m.from);
      if (who && !who.isAI) break;
      if (who && m.kind !== 'pick') n++;
    }
    return n;
  }
  // After a person writes: an AI player they named answers; a question to the group gets up to two answers, one after
  // the other, so the second can react to the first; anything else gets at most one short reply. A newer message
  // from a person replaces replies still waiting.
  queueAiReplies(from, text, changes = []) {
    const ais = this.ais();
    if (!ais.length || this.stage !== 'chat' || this.deal) return;
    const named = this.namedAIs(text);
    let who = named;
    if (!who.length) {
      const asked = isQuestion(text), wished = changes.some((c) => c.kind === 'supports');
      const n = asked ? Math.min(2, ais.length) : Math.random() < (wished ? (this.humans().length > 1 ? 0.5 : 0.8) : 0.3) ? 1 : 0;
      // An AI player with a stake in the part that was asked about answers first (its limit, or a pick it made);
      // otherwise the one who has been quiet longest.
      const topic = asked ? topicOf(this.task, text) : null;
      const stake = (p) => (topic && (this.limitOf(p).aiPrefs[topic] || this.prefs[p.pcode]?.[topic]) ? 0 : 1);
      who = [...ais].sort((a, b) => stake(a) - stake(b) || (a.lastMsgAt || 0) - (b.lastMsgAt || 0) + (Math.random() - 0.5) * 4000).slice(0, n);
    }
    if (!who.length) return;
    const token = this.replyToken = {};
    (async () => {
      for (const [i, p] of who.entries()) {
        await sleep(sec(i ? rand(1.5, 3) : rand(1.2, 2.5)));
        for (let k = 0; k < 40 && p.speaking; k++) await sleep(150); // finishing another message first
        if (this.replyToken !== token) return;
        await this.aiPlayerSpeak(p, { reason: 'reply', to: from, text, changes, named: named.includes(p), second: i > 0, token });
      }
    })().catch((e) => console.error('AI player reply failed:', e.message));
  }
  // When the chat has gone quiet with parts still open, one AI player moves it along: once per open part.
  aiNudge() {
    const ais = this.ais(); const now = Date.now();
    if (!ais.length || this.deal) return;
    if (now - Math.max(this.lastChatAt || this.stageStartedAt, this.lastTypingAt || 0) < sec(28) || now - (this.lastNudgeAt || 0) < sec(45)) return;
    if (!this.humans().some((h) => h.msgs > 0 || h.picks > 0) && now - this.stageStartedAt < sec(75)) return;
    if (!this.panel().some((f) => f.status !== 'agreed' && !this.nudged.has(f.id)) || this.aiRun() >= 3) return;
    this.lastNudgeAt = now;
    const p = [...ais].sort((a, b) => (a.lastMsgAt || 0) - (b.lastMsgAt || 0))[0];
    this.aiPlayerSpeak(p, { reason: 'nudge' }).catch((e) => console.error('AI player nudge failed:', e.message));
  }

  // What an AI player does on its turn, or null to stay quiet. A move says:
  //   move    what to tell the model            lines   how to say it without a model
  //   offer   options the line should state; whichever of them it names becomes the player's pick
  //   need    the line must name what it offers  picks   picks that hold without being named ("works for me")
  //   names   other options the line may mention topic   the part of the plan the move is about
  //   must    a reply is owed (a question, or a message addressed to this player)
  //   limit   the line tells the group about the player's limit
  aiMove(p, o) {
    const T = this.task, lim = this.limitOf(p), mine = this.prefs[p.pcode] || {};
    const panel = this.panel();
    const row = (id) => panel.find((f) => f.id === id);
    const fld = (id) => T.fields.find((f) => f.id === id);
    const fname = (id) => fieldName(T, id).toLowerCase();
    const oname = (f, v) => optionName(T, f, v);
    const lower = (x) => x.charAt(0).toLowerCase() + x.slice(1);
    const { picks: going, own, blocked } = this.followPlan(p);
    const fits = (f, v) => !!v && !lim.violates({ ...this.heading(), ...mine, [f]: v });
    // What this player would pick for a part: its own pick, what the people want, what suits its limit, then something
    // another player already raised, then anything else. Options that someone's shared limit rules out come last.
    const ruledOut = this.blockedView();
    const wish = (f) => {
      const raised = row(f).options.map((x) => x.option);
      const rest = shuffle(fld(f).options.map((x) => x.id)).sort((a, b) => !!ruledOut[f]?.[a] - !!ruledOut[f]?.[b]);
      return [mine[f], going[f], own[f], lim.aiPrefs[f], ...raised.filter((v) => !ruledOut[f]?.[v]), ...rest].find((v) => fits(f, v)) || null;
    };
    const open = panel.filter((f) => f.status !== 'agreed');
    const P = o.to?.pcode;

    // Says the limit, once. b: what the group wants that breaks it (if anything). Once the limit is known, only a
    // personal part still needs saying ("i'll take the trolley and meet you there").
    const sayLimit = (b = blocked[0]) => {
      const alt = b ? own[b.field] || [mine[b.field], lim.aiPrefs[b.field], ...fld(b.field).options.map((x) => x.id)].find((v) => fits(b.field, v)) || null : null;
      const personal = !!b && !!fld(b.field).personal && !!alt;
      const way = alt ? lower(oname(b.field, alt)) : '';
      if (p.revealed) {
        if (!personal || mine[b.field] === alt) return null;
        return { kind: 'ownway', must: true, topic: b.field, offer: { [b.field]: alt }, need: true, names: [`${b.field}:${b.option}`],
          move: `The others are going by ${oname(b.field, b.option)}. They already know your limit. Say in a few words that you will take the ${way} yourself and meet them there.`,
          lines: [`i'll take the ${way} and meet you all there`, `you all go ahead, i'll take the ${way}`, `${way} for me, see you there`] };
      }
      // a limit line may also say what suits the limit ("so Sunday is better for me"); that then counts as a pick
      const offer = Object.fromEntries(Object.entries(lim.aiPrefs).filter(([f, v]) => fits(f, v)));
      if (alt) offer[b.field] = alt;
      if (personal) return { kind: 'ownway', must: true, limit: true, topic: b.field, offer,
        move: `The others are leaning toward ${oname(b.field, b.option)} for ${fname(b.field)}. That breaks your limit, and for this part each person may go their own way. Say, with your reason, that you will take the ${way} yourself and meet them there.`,
        lines: [`${lim.say} I will take the ${way} and meet you all there.`] };
      if (b) return { kind: 'limit', must: true, limit: true, topic: b.field, offer,
        move: `The group is leaning toward ${oname(b.field, b.option)} for ${fname(b.field)}, which breaks your limit. Tell them your limit in your own words${alt ? `, and ask whether ${oname(b.field, alt)} could work instead` : ''}.`,
        lines: [alt ? `${lim.say} Could we do ${oname(b.field, alt)} instead?` : lim.say] };
      return { kind: 'limit', must: true, limit: true, offer, move: 'Tell the group about your limit now, in your own words. Do not ask for anything else.', lines: [lim.say] };
    };
    if (o.reason === 'limit') return sayLimit();

    if (o.reason === 'open') {
      // each AI player opens on a part nobody has raised yet, so two of them do not say the same thing
      const f = open.find((x) => !x.options.length)?.id, v = f ? wish(f) : null;
      if (!f) return { kind: 'open', move: 'Say hi to the group in two or three words.', lines: ['hey all', 'hi everyone', 'hey hey'] };
      if (o.index > 0 || !v) return { kind: 'open', topic: f, move: `Say hi in two or three words, then ask the group about ${fname(f)} in your own words. Do not suggest an option yourself.`, lines: [`hey! ${askLine(T, f)}`, `hi all. ${askLine(T, f)}`] };
      return { kind: 'open', topic: f, offer: { [f]: v }, need: true, propose: true, move: `Say hi, then float ${oname(f, v)} for ${fname(f)} as an idea. It is a suggestion, not a decision.`,
        lines: [`hey all! how about ${oname(f, v)}?`, `hi! i was thinking ${oname(f, v)}`, `hey, ${oname(f, v)} maybe?`] };
    }

    if (o.reason === 'nudge') {
      const free = (x) => !this.nudged.has(x.id) && !this.asked.has(`open:${x.id}`) && !this.asked.has(`conflict:${x.id}`);
      const f = open.find((x) => x.status === 'open' && free(x)) || open.find(free);
      if (!f) return null;
      this.nudged.add(f.id);
      const v = wish(f.id);
      if (f.status !== 'open') {
        const names = f.options.map((x) => x.name), allowed = f.options.map((x) => `${f.id}:${x.option}`);
        if (names.length === 1) return { kind: 'nudge', topic: f.id, names: allowed, move: `The chat went quiet. ${names[0]} was suggested for ${fname(f.id)} and nobody has answered. Ask whether it works for everyone, in a few words.`,
          lines: [`does ${names[0]} work for everyone?`, `${names[0]} ok with you all?`] };
        return { kind: 'nudge', topic: f.id, names: allowed, move: `The chat went quiet and ${fname(f.id)} is still undecided between ${list(names)}. Ask the group which one it should be, in a few words. Do not pick a side.`,
          lines: [`so for ${fname(f.id)}, ${names.join(' or ')}?`, `${names.join(' or ')}? we should pick one`] };
      }
      if (!v) return { kind: 'nudge', topic: f.id, move: `The chat went quiet and nobody has brought up ${fname(f.id)}. Ask the group about it in a few words.`, lines: [askLine(T, f.id)] };
      return { kind: 'nudge', topic: f.id, offer: { [f.id]: v }, need: true, propose: true, move: `The chat went quiet and nobody has brought up ${fname(f.id)}. Suggest ${oname(f.id, v)} for it in a few words, as a question.`,
        lines: [`also, ${oname(f.id, v)} for ${fname(f.id)}?`, `what about ${oname(f.id, v)}?`, `${oname(f.id, v)} for ${fname(f.id)} maybe?`] };
    }

    // ----- a reply to a person -----
    let text = o.text; const must = !!o.named;
    // Where this player stands, for "kai?" or "what do you think?": honest about its limit, and useful about what is open.
    const standing = (lead) => {
      if (lim.violates(this.planFor(p, this.heading())) && p.revealed) return { kind: 'object', must: true, move: `${lead} Answer honestly in a few words: the plan so far still does not work for you because of the limit you shared.`, lines: ['not quite, it still clashes with my limit', 'almost, but it still breaks my limit'] };
      const f = open.find((x) => x.status === 'open'), v = f && wish(f.id);
      if (f && v) return { kind: 'answer', must: true, topic: f.id, offer: { [f.id]: v }, need: true, propose: true, move: `${lead} Say you are good with the plan so far, and suggest ${oname(f.id, v)} for ${fname(f.id)}, which is still open.`,
        lines: [`good so far. ${oname(f.id, v)} for ${fname(f.id)}?`, `i like it so far. maybe ${oname(f.id, v)}?`] };
      if (open.length) return { kind: 'answer', must: true, move: `${lead} Say in a few words that you are good with the plan so far.`, lines: ['good with it so far', "i'm happy with it so far", 'all good on my end so far'] };
      return { kind: 'answer', must: true, move: `${lead} Say in a few words that the plan works for you.`, lines: ['the plan works for me', "i'm good with the plan", 'all good on my end'] };
    };
    // "kai?" or "kai? respond?": the person is waiting for an answer to what they said just before
    if (o.named && !topicOf(T, text) && String(text).replace(/@?\b[a-z0-9]+\b/gi, (w) => (this.namedAIs(` ${w} `).length ? '' : w)).replace(/[^a-z]+/gi, ' ').trim().split(' ').filter(Boolean).length <= 2) {
      const mineOf = this.chat.filter((m) => m.from === P && ['chat', 'limit'].includes(m.kind) && m.text !== text);
      const prev = mineOf[mineOf.length - 1];
      if (!prev || this.chat.some((m) => m.id > prev.id && m.from === p.pcode && ['chat', 'limit'].includes(m.kind))) return standing(`${P} is calling on you: "${this.forModel(text)}".`);
      text = prev.text;
    }
    // what the message asks for, read the way the app reads every message
    const said = statesWish(text) ? detectOptions(T, text, this.peopleFor(o.to)).filter((x) => !x.negative) : [];
    const wished = said.filter((x) => !x.about);
    const quoted = `"${this.forModel(text)}"`;
    const inWay = [...blocked, ...wished.filter((c) => !fits(c.field, c.option) && !blocked.some((b) => b.field === c.field)).map((c) => ({ field: c.field, option: c.option }))];
    if (inWay.length && !p.revealed) return sayLimit(inWay[0]);
    // the person said how this AI player could do a personal part ("Kai can take the trolley")
    const forMe = said.find((x) => x.about === p.pcode && fld(x.field).personal);
    if (forMe) {
      const x = oname(forMe.field, forMe.option);
      if (mine[forMe.field] === forMe.option) return { kind: 'ownway', must: true, topic: forMe.field, names: [`${forMe.field}:${forMe.option}`, ...wished.map((c) => `${c.field}:${c.option}`)],
        move: `${P} said: ${quoted}. Going by ${x} works for you. Say so in a few words; you will meet them there.`,
        lines: [`works for me, i'll take the ${lower(x)} and meet you there`, `yep, ${lower(x)} for me. see you there`, `${lower(x)} is perfect for me, thanks`] };
      const alt = [mine[forMe.field], lim.aiPrefs[forMe.field], ...fld(forMe.field).options.map((y) => y.id)].find((v) => fits(forMe.field, v));
      return { kind: 'limit', must: true, limit: !p.revealed, topic: forMe.field, offer: alt ? { [forMe.field]: alt } : {}, names: [`${forMe.field}:${forMe.option}`],
        move: `${P} said: ${quoted}. Going by ${x} breaks your limit. Say so, with your reason${alt ? `, and say you will take the ${lower(oname(forMe.field, alt))} instead` : ''}.`,
        lines: [alt ? `${lim.say} I will take the ${lower(oname(forMe.field, alt))} instead.` : lim.say] };
    }
    const asked = isQuestion(text);
    // a question about this player's own situation ("how many nights did you stay?"): answer with its fact
    const fact = asked ? this.factAsked(p, text) : null;
    if (fact && !(fact.private && p.revealed && p.said.some((x) => sameMessage(firstPerson(fact.text), x)))) {
      return { kind: 'fact', must: true, limit: fact.private && !p.revealed, mustSay: fact.text, names: [...detectOptions(T, text), ...detectOptions(T, fact.text)].map((x) => `${x.field}:${x.option}`),
        move: `${P} asked: ${quoted}. Answer with this fact about yourself, in your own words: "${firstPerson(fact.text)}"`, lines: [firstPerson(fact.text)] };
    }
    let topic = topicOf(T, text);
    if (!topic && asked) { const fs = [...new Set(detectOptions(T, text).filter((m) => !m.negative).map((m) => m.field))]; if (fs.length === 1) topic = fs[0]; }

    if (asked && topic) {
      const r = row(topic);
      if (r.status === 'agreed') {
        const x = oname(topic, r.leader), names = [`${topic}:${r.leader}`];
        if (o.second) return { kind: 'detail', topic, names, move: `${P} asked: ${quoted}. Another player has just answered. Say in two or three words whether that works for you, or offer one small adjustment.`, lines: ['that works for me', 'same, works', 'fine by me'] };
        const slot = detailFor(T, topic, x);
        return { kind: 'detail', must: true, topic, names, expect: slot && /\d/.test(slot) ? /\d/ : null,
          move: `${P} asked: ${quoted}. ${fieldName(T, topic)} is settled as ${x}, so they want something more specific. Suggest one concrete answer that fits ${x}${slot ? `, for example ${slot}` : ''}. It is only a suggestion.`,
          lines: slot ? [`${slot}?`, `how about ${slot}?`, `maybe ${slot}`, `${slot} works for me`] : ['not sure, whatever works for you all', 'i am easy on that'] };
      }
      const v = wish(topic);
      if (!v) return { kind: 'answer', must: true, topic, move: `${P} asked: ${quoted}. Say that you are flexible on ${fname(topic)}.`, lines: ['i am flexible on that', 'no strong feelings from me'] };
      const x = oname(topic, v), again = mine[topic] === v;
      if (o.second && r.options.some((opt) => opt.option === v && opt.who.some((c) => c !== p.pcode && this.byCode(c)?.isAI)))
        return { kind: 'answer', topic, picks: { [topic]: v }, move: `${P} asked: ${quoted}. Another player just said ${x}, which is also what you would pick. Agree in two or three words.`, lines: ['same', 'same for me', 'yeah same here', '+1'] };
      // the limit is the reason for this answer: say it, like a person would ("sunday afternoon, mornings i have practice")
      if (!p.revealed && fld(topic).options.some((opt) => lim.violates({ [topic]: opt.id })))
        return { kind: 'answer', must: true, limit: true, topic, offer: { ...Object.fromEntries(Object.entries(lim.aiPrefs).filter(([f, y]) => fits(f, y))), [topic]: v }, propose: !again,
          move: `${P} asked: ${quoted}. Answer that ${x} is what you would pick, and give your limit as the reason, in your own words.`, lines: [`${x} for me. ${lim.say}`] };
      return { kind: 'answer', must: true, topic, offer: { [topic]: v }, need: true, propose: !again,
        move: `${P} asked: ${quoted}. Answer that ${x} is what you would pick${again ? '. You said so before, so use different and fewer words' : ', and add one short reason or detail'}.`,
        lines: again ? [`still ${x} for me`, `${x} still works best for me`, `${x} for me`] : [`${x} for me`, `i'd go with ${x} tbh`, `${x}? i'm down`, `i vote ${x}`, `${x} works best for me`] };
    }
    if (asked) {
      // "is everyone ok with this?", "kai what do you think?"
      if (/\b(everyone|everybody|all good|we good|ok with|okay with|works? for|sound good|sounds good|agree|ready|good to go|that work|what do you think|thoughts|you think)\b/i.test(text)) return { ...standing(`${P} asked: ${quoted}.`), must: true };
      if (!must && Math.random() < 0.4) return null;
      return { kind: 'answer', must, move: `${P} asked: ${quoted}. Answer in a few words, as yourself. If you do not know, say so briefly.`, lines: must ? ['not sure tbh', 'no idea honestly'] : [] };
    }
    if (wished.length) {
      // something the person wants still breaks the limit this player already shared: say so once more, briefly
      const hard = wished.find((c) => !fld(c.field).personal && !fits(c.field, c.option));
      if (hard) {
        const key = `${hard.field}:${hard.option}`;
        if (p.objected.has(key)) return null;
        p.objected.add(key);
        return { kind: 'object', must: true, topic: hard.field, names: [key], move: `${P} wants ${oname(hard.field, hard.option)}, which breaks the limit you already shared. Remind them in a few words, without repeating your earlier message.`,
          lines: [`${oname(hard.field, hard.option)} still does not work for me though`, 'that one still clashes with my limit'] };
      }
      // a personal part where this player goes its own way: fine for the others, said once
      const apart = wished.find((c) => fld(c.field).personal && !fits(c.field, c.option));
      if (apart && wished.length === 1) {
        const way = mine[apart.field] ? lower(oname(apart.field, mine[apart.field])) : null;
        const key = `own:${apart.field}`;
        if (!way || p.objected.has(key)) return null;
        p.objected.add(key);
        return { kind: 'ownway', must, topic: apart.field, names: [`${apart.field}:${apart.option}`, `${apart.field}:${mine[apart.field]}`], move: `${P} said: ${quoted}. That is fine for the others. You are still taking the ${way} yourself. Say so in a few words, without repeating your reason.`,
          lines: [`you all go ahead, i'll still take the ${way}`, `sounds good, i'll meet you there on the ${way}`] };
      }
      const mineToo = wished.filter((c) => c !== apart);
      const fields = mineToo.map((c) => c.field);
      // people want different things here: an AI player does not take a side
      const humanWishes = (f) => new Set(this.humans().map((h) => this.prefs[h.pcode]?.[f] || this.parsed[h.pcode]?.[f]).filter(Boolean));
      if (fields.some((f) => humanWishes(f).size > 1)) return must ? { kind: 'react', must, move: `${P} said: ${quoted}. People at the table want different things there. Say in a few words that either works for you; do not take a side.`, lines: ['either works for me', 'no strong preference from me'] } : null;
      const picks = Object.fromEntries(mineToo.filter((c) => fits(c.field, c.option)).map((c) => [c.field, c.option]));
      // move things along: ask about a part nobody has raised yet
      const next = !o.second && open.find((f) => f.status === 'open' && !fields.includes(f.id));
      if (next) return { kind: 'agree', must, picks, move: `${P} said: ${quoted}. You are fine with that. Agree in two or three words, then ask the group about ${fname(next.id)} in your own words. Do not repeat what they said.`,
        lines: [`works for me. ${askLine(T, next.id)}`, `i'm down. ${askLine(T, next.id)}`, `sounds good. ${askLine(T, next.id)}`] };
      return { kind: 'agree', must, picks, move: `${P} said: ${quoted}. You are fine with that. Agree in two to four words. Do not repeat what they said.`, lines: ['works for me', "i'm down", 'sounds good', 'same', 'yep that works'] };
    }
    if (!must && Math.random() < 0.5) return null;
    return { kind: 'react', must, move: `${P} said: ${quoted}. React in a few words, the way a friend would. Do not bring up a new topic.`, lines: must ? ["i'm here", 'yeah, here', 'here, what is up'] : ['fair', 'makes sense', 'ok cool', 'true'] };
  }

  // How a person types an option name in a chat: "by nights stayed", "bus or trolley", but "Balboa Park" and "La Jolla Cove"
  // keep their capitals (a name with a capital after its first word is a proper name).
  casual(line) {
    let out = line;
    for (const f of this.task.fields) for (const o of f.options) {
      if (/\s[A-Z]/.test(o.name)) continue;
      out = out.split(o.name).join(o.name.charAt(0).toLowerCase() + o.name.slice(1));
    }
    return out;
  }
  // Checks a line against the move it was written for, and works out the picks it stands for: the options the line
  // names, as far as the move offers them and they keep to the player's limit. So the plan only ever shows what an
  // AI player actually said. Returns { why } when the line cannot be posted. scripted: one of the app's own lines.
  judgeLine(p, text, m, scripted) {
    const lim = this.limitOf(p), mine = this.prefs[p.pcode] || {};
    if (!text || text.length < 2) return { why: 'empty' };
    if (/\b[pa]0\d\b/i.test(text)) return { why: 'a player code' };
    if (p.said.some((x) => sameMessage(text, x))) return { why: 'repeats itself' };
    const recent = this.chat.filter((x) => !x.to && ['chat', 'limit'].includes(x.kind)).slice(-3);
    if (recent.some((x) => x.from !== p.pcode && sameMessage(text, x.text))) return { why: 'echoes the last messages' };
    if (DONE_RE.test(text) && this.panel().some((f) => f.status !== 'agreed')) return { why: 'says the plan is done' };
    const named = detectOptions(this.task, text).filter((x) => !x.negative);
    const picks = { ...(m.picks || {}) }, offer = m.offer || {};
    const fits = (f, v) => !lim.violates({ ...this.heading(), ...mine, ...picks, [f]: v });
    if (m.limit) {
      // a limit line is judged by whether it says the limit; it picks only what suits the limit and what it names
      if (!scripted && !lim.re.test(text)) return { why: 'does not say the limit' };
      for (const x of named) if (offer[x.field] === x.option && fits(x.field, x.option)) picks[x.field] = x.option;
      return { picks };
    }
    const stated = {};
    for (const x of named) {
      if (x.field in offer) {
        if (!fits(x.field, x.option)) return { why: 'names an option that breaks its limit' };
        if (stated[x.field]) return { why: 'names two options for one part' };
        stated[x.field] = x.option; continue;
      }
      if (picks[x.field] === x.option || (m.names || []).includes(`${x.field}:${x.option}`)) continue;
      return { why: 'names something the move is not about' };
    }
    if (m.need && Object.keys(offer).some((f) => !stated[f])) return { why: 'does not say what it picks' };
    if (m.expect && !m.expect.test(text)) return { why: 'does not answer' };
    if (m.mustSay && !scripted) {
      const key = String(m.mustSay).toLowerCase().match(/[a-z0-9$]{4,}/g)?.filter((w) => !['your', 'have', 'with', 'they', 'room', 'only'].includes(w)) || [];
      if (key.length && !key.some((w) => text.toLowerCase().includes(w))) return { why: 'does not answer' };
    }
    return { picks: { ...picks, ...stated } };
  }

  async aiPlayerSpeak(p, o = {}) {
    if (this.stage !== 'chat' || this.deal || p.speaking) return;
    if (o.reason === 'open' && p.msgs > 0) return;
    p.speaking = true;
    try {
      const startSeq = this.seq;
      const m = this.aiMove(p, o);
      if (!m) return;
      // AI players do not talk among themselves: after three of their messages in a row they wait for a person.
      if (!m.must && o.reason !== 'open' && this.aiRun() >= 3) return;
      const lim = this.limitOf(p);
      const mine = this.prefs[p.pcode] || (this.prefs[p.pcode] = {});
      this.typing(p.key);
      const started = Date.now();
      let out = null, source = 'scripted', dropped = null;
      if (this.llmPlayers()) {
        const panel = this.panel();
        const who = (codes) => list(codes.map((c) => this.aliasOf(c)));
        const res = await playerLine({
          task: this.task, name: p.short, persona: PERSONAS[p.short] || '',
          settled: panel.filter((f) => f.status === 'agreed').map((f) => `${f.name}: ${this.leaderText(f, true)}`).join('. '),
          open: panel.filter((f) => f.status !== 'agreed').map((f) => `${f.name} (${f.options.length ? f.options.map((x) => `${who(x.who)} said ${x.name}`).join('; ') : 'nobody has said anything'})`).join('; '),
          wants: Object.entries({ ...lim.aiPrefs, ...mine }).map(([f, v]) => `${fieldName(this.task, f)}: ${optionName(this.task, f, v)}`).join('; '),
          limit: lim.text, shared: p.revealed, fits: !lim.violates(this.planFor(p, this.heading())),
          about: this.factsOf(p).map((f) => firstPerson(f.text)).join(' '),
          recent: this.recentChat(12), said: p.said.slice(-6).map((x) => this.forModel(x)), move: `${m.move} One short message.`
        });
        if (res) {
          const text = this.withNames(res.text);
          const j = this.judgeLine(p, text, m, false);
          if (!j.why) { out = { text, picks: j.picks }; source = res.source; }
          else { dropped = j.why; this.log(p.pcode, 'ai_player_line_dropped', { text, why: j.why, move: m.kind }); }
        }
      }
      if (!out) {
        for (const line of shuffle(m.lines || [])) { const text = this.casual(line); const j = this.judgeLine(p, text, m, true); if (!j.why) { out = { text, picks: j.picks }; break; } }
        if (!out) return;
      }
      if (this.stage !== 'chat' || this.deal) return;
      if (o.token && this.replyToken !== o.token) return; // someone wrote again; the newer message gets the reply
      // Look like typing: a pause that grows with the length of the message.
      const wait = sec((1500 + Math.min(3500, out.text.length * 45)) / 1000) - (Date.now() - started);
      if (wait > 0) { this.typing(p.key); await sleep(wait); }
      if (this.stage !== 'chat' || this.deal) return;
      if (o.token && this.replyToken !== o.token) return;
      if (o.reason === 'open' && m.topic && this.panel().find((f) => f.id === m.topic).options.length) return; // someone got there first
      // an opener or a nudge that a person's new message overtook is no longer what the chat needs
      if ((o.reason === 'open' || o.reason === 'nudge') && this.chat.some((x) => x.id > startSeq && ['chat', 'question'].includes(x.kind) && !this.byCode(x.from)?.isAI && x.from !== 'AI')) return;
      // A pick counts only if the option exists and keeps to this player's limit (checked again: the chat has moved on).
      const picks = {};
      for (const [f, v] of Object.entries(out.picks || {})) {
        if (!this.task.fields.find((x) => x.id === f)?.options.some((x) => x.id === v)) continue;
        if (lim.violates({ ...this.heading(), ...mine, ...picks, [f]: v })) continue;
        picks[f] = v;
      }
      const reveal = !p.revealed && !!m.limit;
      // On listening tables, people can tap "Me too" on something this message proposed.
      const said = this.mode === 'listen' && m.propose ? Object.entries(picks).filter(([f, v]) => mine[f] !== v && f in (m.offer || {})).map(([field, option]) => ({ field, option })) : [];
      Object.assign(mine, picks);
      if (reveal) { p.revealed = true; p.limitSharedAt = this.t; p.limitVia = 'self'; this.log(p.pcode, 'limit_shared', { limit: this.limitId(p), via: 'self', anonymous: false }); }
      p.msgs++; p.lastMsgAt = Date.now();
      p.said.push(out.text); if (p.said.length > 10) p.said.shift();
      const savedAI = this.listening() ? Object.entries(picks).map(([f, v]) => `${p.short} → ${optionName(this.task, f, v)}`) : [];
      this.pushChat({ from: p.pcode, name: p.name, kind: reveal ? 'limit' : 'chat', text: out.text, ...(said.length ? { sup: said } : {}), ...(savedAI.length ? { saved: savedAI } : {}) });
      this.log(p.pcode, 'chat_message', { text: out.text, length: out.text.length, ai_player: o.reason, move: m.kind, source, picks, ...(dropped ? { model_line_dropped: dropped } : {}) });
      this.afterChange();
    } finally { p.speaking = false; }
  }
  aiPlayersRespondToLimits() {
    this.ais().forEach((p, i) => { if (Math.random() < 0.85) this.later(4 + i * 6, () => this.aiPlayerReveal(p)); });
  }
  aiPlayerReveal(p) {
    if (this.stage !== 'chat' || this.deal) return;
    return this.aiPlayerSpeak(p, { reason: 'limit' });
  }
  queueAiFollow() {
    if (this.followDue || !this.ais().length) return;
    this.followDue = true;
    this.later(rand(4, 7), () => { this.followDue = false; this.aiPlayersFollow(); });
  }
  // AI players quietly go along with what the people at the table picked, in one line for all of them, like a tap:
  // "Ari and Kai (AI players) are fine with Sunday afternoon." One whose limit is in the way says so instead; for a
  // personal part it says which way it will go.
  aiPlayersFollow() {
    if (this.stage !== 'chat' || this.deal) return;
    const went = [];
    for (const p of this.ais()) {
      if (p.speaking) { this.queueAiFollow(); continue; }
      const { picks, own, blocked } = this.followPlan(p);
      if (blocked.length && (!p.revealed || Object.keys(own).length)) this.aiPlayerReveal(p);
      if (!Object.keys(picks).length) continue;
      Object.assign(this.prefs[p.pcode] || (this.prefs[p.pcode] = {}), picks);
      this.log(p.pcode, 'pick', { follow: true, picks });
      went.push({ p, picks });
    }
    if (!went.length) return;
    const last = this.chat[this.chat.length - 1];
    let follow = {};
    if (last?.kind === 'pick' && last.follow) { follow = last.follow; this.chat.pop(); } // one line while nothing else was said
    for (const { p, picks } of went) follow[p.pcode] = { ...(follow[p.pcode] || {}), ...picks };
    this.pushChat({ from: 'ai-players', name: 'AI players', kind: 'pick', follow, text: this.followText(follow) });
    this.afterChange();
  }
  followText(follow) {
    const codes = Object.keys(follow);
    const what = (picks) => list(this.task.fields.filter((f) => picks[f.id]).map((f) => optionName(this.task, f.id, picks[f.id])));
    const short = (c) => this.byCode(c)?.short || c;
    if (codes.length === 1) return `${short(codes[0])} (AI) is fine with ${what(follow[codes[0]])}.`;
    if (codes.every((c) => what(follow[c]) === what(follow[codes[0]]))) return `${list(codes.map(short))} (AI players) are fine with ${what(follow[codes[0]])}.`;
    return codes.map((c) => `${short(c)} (AI) is fine with ${what(follow[c])}.`).join(' ');
  }

  // Track who has closed the page. When someone has been away long enough, re-check anything that was waiting on everyone.
  checkPresence() {
    let changed = false;
    for (const p of this.humans()) {
      if (this.connected(p)) { if (this.awaySince.delete(p.key) && p.wasAway) { p.wasAway = false; this.log(p.pcode, 'player_back'); changed = true; } continue; }
      if (!this.awaySince.has(p.key)) this.awaySince.set(p.key, Date.now());
      if (this.isAway(p) && !p.wasAway) { p.wasAway = true; this.log(p.pcode, 'player_away', { stage: this.stage }); changed = true; }
    }
    if (!changed) return;
    const act = this.active();
    if (this.stage === 'setup' && act.every((h) => h.ready)) return this.enter('chat');
    if (this.stage === 'chat' && !this.deal) {
      if (planComplete(this.task, this.plan) && act.every((h) => this.accepts[h.key])) return this.lockDeal();
      if (act.every((h) => h.wantsEnd)) { this.endReason = 'group'; return this.enter('done'); }
      for (const b of this.bookings) this.settleBooking(b);
    }
    this.broadcast();
  }

  onTick() {
    if (this.stage !== 'done') this.checkPresence();
    if (this.stage === 'chat' && !this.deal) {
      if (Date.now() - this.stageStartedAt > sec(CHAT_MAX)) { this.log('system', 'ended_by_backstop'); this.endReason = 'backstop'; return this.enter('done'); }
      if (this.listening()) { this.listen(); this.protectSharedLimits(); this.autoCards(); }
      this.aiNudge();
      // Every change already broadcasts; this slower refresh only keeps away markers current.
      if (Date.now() - this.lastBroadcast > 5000) this.broadcast();
    }
  }

  // ---------- host controls ----------
  // "Next" in the host console: open the chat now, or end the table.
  hostAdvance() {
    if (this.stage === 'done') return;
    this.log('host', 'host_advanced', { from: this.stage }, 'host');
    if (this.stage === 'setup') return this.enter('chat');
    if (this.stage === 'chat') { this.endReason = 'host'; return this.enter('done'); }
  }
  // A note from the host to the table, for example "about two minutes left". Shown as a system line, not as the AI.
  hostAnnounce(text) {
    text = String(text || '').trim().slice(0, 200);
    if (!text || this.stage !== 'chat') return false;
    this.pushChat({ from: 'system', name: 'Host', kind: 'system', host: true, text: `From your host: ${text}` });
    this.log('host', 'host_announcement', { text }, 'host');
    this.broadcast();
    return true;
  }
  hostPause(paused) { this.aiPaused = !!paused; this.log('host', 'host_ai_paused', { paused: this.aiPaused }, 'host'); this.broadcast(); }
  hostSay(text) {
    text = String(text || '').trim().slice(0, 300); if (!text) return;
    this.pendingQuestions = [];
    this.pushChat({ from: 'AI', name: 'AI', kind: 'ai', text });
    this.log('AI', 'ai_message_wizard', { text }, 'wizard');
    this.broadcast();
  }

  // ---------- views ----------
  panelView() {
    const blocked = this.blockedView();
    return this.panel().map((f) => ({ ...f, leaderName: f.leader ? optionName(this.task, f.id, f.leader) : null, count: f.leader ? f.options.find((o) => o.option === f.leader).who.length : 0,
      // own: who goes their own way for a personal part
      own: f.own.map((x) => ({ pcode: x.pcode, name: this.nameOf(this.byCode(x.pcode)), option: x.option, optionName: optionName(this.task, f.id, x.option) })),
      options: f.options.map((o) => ({ ...o, codes: o.who, who: this.names(o.who) })), blocked: blocked[f.id] || {} }));
  }

  viewFor(key) {
    const me = this.player(key);
    const open = this.stage === 'done';
    const final = this.deal ? this.deal.plan : this.plan;
    const lim = me ? this.limitOf(me) : null;
    const chatting = this.stage === 'chat';
    return {
      id: this.id, number: this.number, stage: this.stage, stageEndsAt: this.stageEndsAt, serverNow: Date.now(), mode: this.mode, target: this.target,
      autoStart: this.room.autoStart !== false,
      task: { id: this.task.id, title: this.task.title, short: this.task.short, prompt: this.task.prompt, fields: this.task.fields.map((f) => ({ id: f.id, name: f.name, personal: !!f.personal, kind: fieldKind(this.task, f), options: f.options.map((x) => ({ id: x.id, name: x.name, custom: !!x.custom, by: x.by ? this.nameOf(this.byCode(x.by)) : null })) })),
        info: this.task.info.map((i) => i.text.replace(/^For this game: /, '').replace(/^\w/, (c) => c.toUpperCase())) },
      me: me ? {
        pcode: me.pcode, name: me.name, ready: me.ready, accepted: !!this.accepts[key], wantsEnd: me.wantsEnd, prefs: this.prefs[me.pcode] || {},
        facts: this.factsOf(me).map(({ label, text, private: priv }) => ({ label, text, private: !!priv })),
        limit: {
          text: lim.text, say: lim.say, custom: !!me.custom, canSwap: !!me.custom || this.spareLimits().length > 0,
          sharedAt: me.limitSharedAt, anon: me.limitAnon, via: me.limitVia, mentionedAt: me.limitMentionedAt,
          // how the plan so far sits with your limit: 'breaks', 'fits', or null when it cannot be checked
          now: me.custom ? null : (lim.violates(this.planFor(me, chatting ? this.heading() : final)) ? 'breaks' : Object.keys(chatting ? this.heading() : final).length ? 'fits' : null),
          ok: this.limitOk(me, final)
        }
      } : null,
      players: this.players.map((p) => {
        const mine = p.key === key;
        const visible = mine || open || (p.limitSharedAt !== null && !p.limitAnon);
        return {
          pcode: p.pcode, name: p.name, isAI: p.isAI, isYou: mine, color: p.color,
          ready: !!p.ready, accepted: !!this.accepts[p.key], wantsEnd: !!p.wantsEnd, msgs: p.msgs, away: this.isAway(p),
          limitSharedAt: visible ? p.limitSharedAt : null, limitAnon: open ? !!p.limitAnon : false, limitMentionedAt: mine || open ? p.limitMentionedAt : null,
          limit: visible ? this.limitOf(p).text : null, limitSay: visible && !mine ? this.limitOf(p).say : null, limitCustom: visible ? !!p.custom : false,
          limitOk: open ? this.limitOk(p, final) : null
        };
      }),
      panel: this.panelView(),
      // the model's line is used while it is fresh; otherwise the rule-based line
      hearing: this.mode === 'listen' && chatting ? (this.hearing && this.hearing.at > (this.lastChangeAt || 0) - 15000 ? this.hearing.text : this.hearingRule()) : null,
      aiThinking: this.thinkingPublic > 0 || this.thinkingFor.has(key),
      quiet: this.mode === 'listen' && chatting ? this.humans().filter((h) => h.msgs === 0 && h.picks === 0).map((h) => h.name) : [],
      plan: final, ways: this.waysView(this.deal ? this.deal.ways : this.ways), complete: planComplete(this.task, final), deal: this.deal, outcome: this.outcome,
      chat: this.chatFor(me, key),
      aiPaused: this.aiPaused, pausedBy: this.pausedBy ? this.byCode(this.pausedBy)?.name : null,
      bookings: this.bookings.map((b) => this.bookingView(b, me)),
      bills: this.bills.map((b) => this.billView(b, me)),
      board: this.boardView(me),
      maps: this.maps.map((m) => ({ ...m, leader: this.choice(m.field) })),
      surveyUrl: this.room.surveyUrl || null, roomCode: this.room.code, kind: this.room.kind
    };
  }


  // ---------- more board artifacts ----------
  // Where and when the group is heading: the agreed choice for each part, or the leading one before that.
  aim() {
    const h = { ...this.heading(), ...this.plan };
    const pf = placeField(this.task);
    const place = pf && h[pf] ? placeOf(this.task, h[pf]) : null;
    const names = this.task.fields.map((f) => (h[f.id] ? optionName(this.task, f.id, h[f.id]) : '')).filter(Boolean);
    return { h, place, when: planWhen(names), travel: h.travel ? optionName(this.task, 'travel', h.travel) : '' };
  }
  // Keeps the itinerary, hours and weather in step with the plan. Lookups run in the background and broadcast.
  refreshArtifacts() {
    const { h, place, when, travel } = this.aim();
    if (place && !this.itin?.edited) {
      const key = JSON.stringify([place.id, travel, when?.minutes, when?.dayName]);
      if (this.itin?.key !== key) this.itin = { ...buildItinerary(this.task, h, place, travel, when), key, edited: false };
    }
    if (place && !this.hours[place.id]) this.checkHours(place);
    if (place && when && this.weatherOn && when.daysAway <= 15) {
      const key = `${place.id}|${when.date}`;
      if (this.weather?.key !== key) this.loadWeather(place, when, key);
    }
    this.closedCheck();
  }
  async checkHours(place) {
    this.hours[place.id] = { loading: true };
    let r = { hours: null, links: [] };
    try { r = await hoursFor(place.name, place.address || ''); } catch { /* no hours */ }
    this.hours[place.id] = { loading: false, hours: r.hours, links: r.links || [] };
    this.log('system', 'hours_checked', { place: place.id, source: r.hours?.source || null });
    if (this.stage === 'chat') { this.closedCheck(); this.broadcast(); }
  }
  async loadWeather(place, when, key) {
    this.weather = { key, loading: true, place: place.name, when };
    const data = await forecast(place.lat, place.lng, when.date);
    if (this.weather?.key !== key) return;
    this.weather = { key, loading: false, place: place.name, when, data };
    this.log('system', 'weather_loaded', { place: place.id, date: when.date, ok: !!data });
    if (this.stage === 'chat') this.broadcast();
  }
  // Listening tables: one short heads-up when the place the group is heading to is closed at the planned time.
  closedCheck() {
    if (!this.listening() || this.stage !== 'chat' || this.deal) return;
    const { place, when } = this.aim();
    if (!place || !when || when.minutes === null) return;
    const hrs = this.hours[place.id]?.hours;
    const st = openAt(hrs, when.weekday, when.minutes);
    const key = `${place.id}|${when.weekday}|${when.minutes}`;
    if (st.open !== false || this.closedWarned.has(key) || Date.now() - this.lastAiSayAt < sec(6)) return;
    this.closedWarned.add(key);
    const typical = hrs?.source === 'typical' ? 'usually ' : '';
    const range = st.today ? ` It is ${typical}open ${clock(st.today[0])} to ${clock(st.today[1])} that day.` : '';
    this.aiSay(`Heads up: ${place.name} is ${typical}closed on ${when.dayName} at ${clock(when.minutes)}.${range}`, 'closed_heads_up', { place: place.id, day: when.weekday, minutes: when.minutes, source: hrs?.source }, false, null, { board: 'hours' });
  }
  // Agreements: things the group promised each other. Anyone writes one; each person stamps it when they agree.
  agreement(key, action, a = {}) {
    const p = this.player(key);
    if (!p || p.isAI || this.stage === 'done') return;
    const x = this.agreements.find((y) => y.id === a.id);
    if (action === 'add') {
      const text = String(a.text || '').replace(/\s+/g, ' ').trim().slice(0, 120);
      if (text.length < 3 || this.agreements.length >= 12) return;
      this.agreements.push({ id: `g${++this.agreeN}`, text, by: p.pcode, stamps: [p.pcode] });
      this.note(`${p.name} wrote an agreement: ${text}`);
    } else if (!x) return;
    else if (action === 'stamp') {
      const on = !x.stamps.includes(p.pcode);
      x.stamps = on ? [...x.stamps, p.pcode] : x.stamps.filter((c) => c !== p.pcode);
      this.note(`${p.name} ${on ? 'agreed to' : 'took back agreeing to'}: ${x.text}`);
    } else if (action === 'remove') { this.agreements = this.agreements.filter((y) => y !== x); this.note(`${p.name} removed an agreement: ${x.text}`); }
    else return;
    this.log(p.pcode, 'agreement', { action, id: a.id || this.agreements[this.agreements.length - 1]?.id });
    this.broadcast();
  }
  agreementsFromAI(items) {
    for (const text of items) if (this.agreements.length < 12 && !this.agreements.some((y) => y.text.toLowerCase() === text.toLowerCase())) this.agreements.push({ id: `g${++this.agreeN}`, text, by: 'AI', stamps: [] });
    this.note(`The AI wrote down ${items.length} agreement${items.length === 1 ? '' : 's'}`);
  }
  // Who brings what: claim an item, add one, or remove one nobody needs.
  bringItem(key, action, a = {}) {
    const p = this.player(key);
    if (!p || p.isAI || this.stage === 'done') return;
    const x = this.bring.find((y) => y.id === a.id);
    if (action === 'add') {
      const name = String(a.name || '').replace(/\s+/g, ' ').trim().slice(0, 60);
      if (name.length < 2 || this.bring.length >= 30) return;
      this.bring.push({ id: `b${++this.bringN}`, cat: 'Added', name, owner: a.mine ? p.pcode : null, by: p.pcode });
      this.note(`${p.name} added ${name} to the list`);
    } else if (!x) return;
    else if (action === 'claim') { x.owner = x.owner === p.pcode ? null : p.pcode; this.note(`${p.name} ${x.owner ? 'will bring' : 'is no longer bringing'} ${x.name.toLowerCase()}`); }
    else if (action === 'remove') { this.bring = this.bring.filter((y) => y !== x); this.note(`${p.name} took ${x.name.toLowerCase()} off the list`); }
    else return;
    this.log(p.pcode, 'bring', { action, id: a.id || this.bring[this.bring.length - 1]?.id });
    this.broadcast();
  }
  bringFromAI(items) {
    let n = 0;
    for (const name of items) if (this.bring.length < 30 && !this.bring.some((y) => y.name.toLowerCase() === name.toLowerCase())) { this.bring.push({ id: `b${++this.bringN}`, cat: 'From the AI', name, owner: null, by: 'AI' }); n++; }
    if (n) this.note(`The AI added ${n} thing${n === 1 ? '' : 's'} to bring`);
  }
  // The itinerary: move the whole day by 15 minutes, make a stop longer or shorter, rename, add or remove a stop.
  // Any edit keeps the itinerary as the group made it; "reset" builds it again from the plan.
  itinerary(key, action, a = {}) {
    const p = this.player(key);
    if (!p || p.isAI || this.stage === 'done' || !this.itin) return;
    const it = this.itin; const st = it.stops.find((x) => x.id === a.id);
    const d = Number(a.delta) > 0 ? 15 : -15;
    if (action === 'shift') { it.start = Math.max(0, Math.min(23 * 60 + 45, it.start + d)); this.note(`${p.name} moved the day to start at ${clock(it.start)}`); }
    else if (action === 'length' && st && st.kind !== 'end') { st.mins = Math.max(5, Math.min(12 * 60, st.mins + d)); this.note(`${p.name} made "${st.title}" ${st.mins} min`); }
    else if (action === 'rename' && st) { const t = String(a.title || '').replace(/\s+/g, ' ').trim().slice(0, 60); if (t.length < 2) return; st.title = t; this.note(`${p.name} renamed a stop to "${t}"`); }
    else if (action === 'add') {
      const t = String(a.title || '').replace(/\s+/g, ' ').trim().slice(0, 60); if (t.length < 2 || it.stops.length >= 10) return;
      const at = Math.max(1, it.stops.findIndex((x) => x.kind === 'end'));
      it.stops.splice(at === -1 ? it.stops.length : at, 0, { id: `s${Date.now().toString(36)}`, kind: 'extra', title: t, mins: 30 });
      this.note(`${p.name} added "${t}" to the day`);
    } else if (action === 'remove' && st && !['meet', 'end'].includes(st.kind)) { it.stops = it.stops.filter((x) => x !== st); this.note(`${p.name} removed "${st.title}" from the day`); }
    else if (action === 'reset') { this.itin = null; this.refreshArtifacts(); this.note(`${p.name} rebuilt the day from the plan`); this.log(p.pcode, 'itinerary', { action }); return this.broadcast(); }
    else return;
    it.edited = true;
    this.log(p.pcode, 'itinerary', { action, id: a.id || null });
    this.broadcast();
  }
  // Show the weather for this plan (for indoor scenarios it appears only when someone asks).
  wantWeather(key) {
    const p = key ? this.player(key) : null;
    if (key && (!p || p.isAI)) return;
    this.weatherOn = true;
    if (p) this.log(p.pcode, 'weather_requested', {});
    this.refreshArtifacts(); this.broadcast();
  }
  artifactsView(me) {
    const name = (c) => (c === 'AI' ? 'AI' : this.nameOf(this.byCode(c)) || c);
    const seat = (c) => this.byCode(c)?.color || null; // the same color as the person's avatar in the chat
    const { place, when } = this.aim();
    // opening hours for each place option, judged at the planned day and time
    const hours = {};
    for (const pl of placesOf(this.task)) {
      const h = this.hours[pl.id];
      if (!h) continue;
      const st = when ? openAt(h.hours, when.weekday, when.minutes) : { open: null };
      hours[pl.id] = { loading: !!h.loading, kind: h.hours?.kind || null, source: h.hours?.source || null, always: !!h.hours?.always,
        today: st.today || null, open: st.open, week: h.hours?.always ? null : h.hours?.days || null, links: h.links || [] };
    }
    let itin = null;
    if (this.itin) {
      let t = this.itin.start;
      itin = { start: this.itin.start, edited: this.itin.edited, stops: this.itin.stops.map((x) => { const at = t; t += x.mins; return { ...x, at, label: clock(at) }; }) };
      itin.end = t; itin.endLabel = clock(t);
    }
    let weather = null;
    if (this.weatherOn && this.weather) {
      const w = this.weather;
      const hrs = w.data?.hours || [];
      const at = Math.floor((w.when?.minutes ?? 14 * 60) / 60);
      const now = hrs.find((x) => x.h === at) || hrs[Math.floor(hrs.length / 2)];
      weather = { loading: !!w.loading, place: w.place, dayName: w.when?.dayName, date: w.when?.date, hour: at, hourLabel: clock(at * 60),
        sky: now ? sky(now.code) : null, temp: now?.temp ?? null, rain: now?.rain ?? null, source: w.data?.source || null,
        hi: hrs.length ? Math.max(...hrs.map((x) => x.temp)) : null, lo: hrs.length ? Math.min(...hrs.map((x) => x.temp)) : null,
        hours: hrs.filter((x) => x.h >= Math.max(6, at - 4) && x.h <= Math.min(23, at + 5)).map((x) => ({ ...x, sky: sky(x.code), label: clock(x.h * 60) })) };
    } else if (this.weatherOn) weather = { waiting: true, needs: !place ? 'place' : !when ? 'day' : when.daysAway > 15 ? 'far' : 'place' };
    return {
      when: when ? { ...when, label: `${when.dayName}${when.minutes !== null ? ` at ${clock(when.minutes)}` : ''}`, dateLabel: when.date } : null,
      placeName: place?.name || null, placeId: place?.id || null, hours, itin, weather, weatherOn: this.weatherOn,
      agreements: this.agreements.map((x) => ({ id: x.id, text: x.text, byName: name(x.by), byAI: x.by === 'AI', stamps: x.stamps.map((c) => ({ name: name(c), seat: seat(c), you: me && c === me.pcode })), mine: !!me && x.stamps.includes(me.pcode) })),
      people: this.humans().length,
      bring: this.bring.map((x) => ({ id: x.id, cat: x.cat, name: x.name, owner: x.owner ? name(x.owner) : null, seat: x.owner ? seat(x.owner) : null, mine: !!me && x.owner === me.pcode, byAI: x.by === 'AI' }))
    };
  }

  // Everything the board shows that is not already in the panel: availability, places, tasks, menus, history.
  boardView(me) {
    const name = (c) => this.nameOf(this.byCode(c)) || c;
    const avail = {};
    for (const f of this.task.fields) {
      if (fieldKind(this.task, f) !== 'time') continue;
      // one row per seat: what they marked, or their pick (from the chat or a tap) as a yes. AI players show only their pick.
      avail[f.id] = { score: this.availScore(f.id), rows: this.players.map((x) => {
        const marks = !x.isAI && this.avail[x.pcode]?.[f.id] ? { ...this.avail[x.pcode][f.id] } : {};
        const pick = this.prefs[x.pcode]?.[f.id];
        if (pick && !marks[pick]) marks[pick] = 'yes';
        return { pcode: x.pcode, name: x.isAI ? `${x.short} (AI)` : x.name, isAI: x.isAI, you: x === me, marks };
      }) };
    }
    const places = placesOf(this.task).map((x) => ({ ...x, ...estimate(PICKUP, x), food: !!this.task.fields.find((f) => f.id === placeField(this.task))?.options.find((o) => o.id === x.id)?.geo?.food || TABLE_TASKS.has(this.task.id) }));
    const menus = Object.fromEntries(Object.entries(this.menus).map(([id, m]) => [id, { ...m, orders: undefined,
      mine: me ? m.orders[me.pcode] || {} : {},
      orders: Object.entries(m.orders).map(([c, items]) => ({ name: name(c), you: me && c === me.pcode, items: Object.entries(items).map(([i, q]) => ({ name: m.items.find((x) => x.id === i)?.name, qty: q, price: m.items.find((x) => x.id === i)?.price || 0 })) })) }]));
    return { avail, places, origin: PICKUP, placeField: placeField(this.task), todos: this.todos.map((t) => ({ ...t, ownerName: t.owner ? name(t.owner) : null, mine: me && t.owner === me.pcode, byName: t.by === 'AI' ? 'AI' : name(t.by) })),
      menus, history: this.history.slice(-40).map((h) => ({ ...h, text: h.text })), changes: this.history.length, summary: this.mode === 'listen' ? null : this.hearingRule(), ...this.artifactsView(me) };
  }

  // The chat as one person sees it. "Me too" under a message is offered only where it adds a pick for this person:
  // not for a part they already picked (it would switch their pick), not for a part that is settled, and only under
  // the newest message that asks for that option.
  chatFor(me, key) {
    const seen = this.chat.filter((m) => !m.to || m.to === key).slice(-80);
    const mine = me ? this.prefs[me.pcode] || {} : {};
    const settled = new Set(this.panel().filter((f) => f.status === 'agreed').map((f) => f.id));
    const newest = {};
    for (const m of seen) for (const x of m.sup || []) newest[`${x.field}:${x.option}`] = m.id;
    return seen.map(({ to, sup, follow, reacts, ...m }) => {
      const offer = me && !this.deal && sup && m.from !== me.pcode ? sup.filter((x) => !mine[x.field] && !settled.has(x.field) && newest[`${x.field}:${x.option}`] === m.id) : [];
      const r = reacts ? Object.entries(reacts).map(([e, who]) => ({ e, n: who.length, mine: !!me && who.includes(me.pcode), who: who.map((c) => this.nameOf(this.byCode(c))) })) : null;
      return { ...m, ...(offer.length ? { sup: offer } : {}), ...(r?.length ? { reacts: r } : {}) };
    });
  }

  hostView() {
    return {
      id: this.id, number: this.number, stage: this.stage, stageEndsAt: this.stageEndsAt, stageStartedAt: this.stageStartedAt || null, serverNow: Date.now(),
      target: this.target, humans: this.humans().length, ready: this.humans().filter((h) => h.ready).length, mode: this.mode, task: this.task.short, taskTitle: this.task.title,
      summary: this.summaryText(), plan: this.plan, ways: this.waysView(this.ways), complete: planComplete(this.task, this.plan), deal: this.deal, outcome: this.outcome,
      aiPaused: this.aiPaused, pausedBy: this.pausedBy, interjections: this.interjections,
      players: this.players.map((p) => ({ pcode: p.pcode, name: p.name, isAI: p.isAI, msgs: p.msgs, accepted: !!this.accepts[p.key], away: this.isAway(p), limitUp: p.limitSharedAt !== null || p.limitMentionedAt !== null })),
      // Private exchanges are not shown in the live console (it is often on a projector); they stay in the research logs.
      chat: this.chat.slice(-12).map((m) => (m.to ? { id: m.id, t: m.t, from: m.from, name: m.name, kind: m.kind, to: this.player(m.to)?.name, text: m.from === 'AI' ? 'a private note (not shown here)' : 'a private question (not shown here)' }
        : { id: m.id, t: m.t, from: m.from, name: m.name, kind: m.kind, text: m.text, to: null })), pendingQuestions: this.pendingQuestions
    };
  }

  broadcast() {
    this.lastBroadcast = Date.now();
    for (const p of this.humans()) this.io.to(`k:${p.key}`).emit('game:state', this.viewFor(p.key));
    this.io.to(`host:${this.room.code}`).emit('host:table', this.hostView());
  }
}
