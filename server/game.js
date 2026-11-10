import crypto from 'node:crypto';
import { taskById, fieldName, optionName, planComplete } from './tasks.js';
import { applyMessage, buildPanel, findConflict, topicOf, topicIn, isQuestion, detectOptions } from './listener.js';
import { q, logEvent } from './db.js';
import { answerQuestion, summarize, aiMode, playerLine, wantsCompare } from './ai.js';
import { PICKUP, placeField, placeOf, placesOf, estimate, route, rideOptions, slotsFor, driver, driverStart } from './places.js';

// The flow has three steps:
//   1. Briefing (stages "forming" and "setup"): the table fills while each person reads the task and their private limit.
//      Capped so that nobody waits more than about 3 minutes from joining to chatting.
//   2. Chat: no timer. People say what they want or tap a part of the plan; the plan locks when everyone accepts it.
//   3. Results ("done").
const SCALE = Number(process.env.TIME_SCALE || 1); // tests run faster with a smaller TIME_SCALE
export const DURATIONS = { setup: 90 };
const CHAT_MAX = 40 * 60;   // seconds; a backstop so abandoned tables close. Not shown to players.
const AI_NAMES = ['Ari', 'Kai', 'Noa', 'Remy'];
const COLORS = ['#2a78d6', '#eb6834', '#8f5bd6', '#1baf7a', '#c2410c'];
// Booking demo: what to book is decided in the group chat; which ride or which time is answered privately by each
// person, and the group sees only the result. Nothing is really booked or charged.
const BOOK_RE = /\b(book|reserve|order|call|get|grab|schedule)\b.{0,30}\b(uber|lyft|ride|rideshare|cab|taxi|car|table|restaurant|reservation|spot|dinner|lunch)\b|\b(make|need|get) a reservation\b|\breserve a table\b/i;
const RIDE_RE = /\b(uber|lyft|ride|rides|rideshare|cab|taxi|car|cars)\b/i;
// "show us a map", "how far is it": the AI posts a map of the place options.
const MAP_RE = /\b(map|how far|where is|where's|directions|distance|how long to get)\b/i;
const MEAL = { low: 13, mid: 24, high: 38, free: 10, under50: 10, over50: 18 };
const TABLE_TASKS = new Set(['dinner', 'anniversary']); // plans where the place is a restaurant
const AWAY_SECONDS = 45;     // a closed page counts as away after this long
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
    this.task = taskById(taskId || room.task);
    this.number = number || 1;
    this.mode = mode === 'ask' ? 'ask' : 'listen';
    this.t0 = Date.now();
    this.target = Math.min(5, Math.max(3, Number(target) || 4));
    this.limitPool = shuffle(this.task.limits); // dealt in this order; a seat given up returns its limit
    this.nextP = 1; this.nextAI = 0;
    this.players = [];
    this.forming = !!forming;
    for (const h of humans) this.players.push(this.newHuman(h));
    if (!this.forming) this.fillWithAI(Math.min(5, Math.max(3, humans.length)));
    // prefs: what each person wants for each part of the plan (from taps, and from the chat at listening tables).
    // parsed: the same reading of the chat at answer-only tables, kept for analysis only and never shown.
    this.prefs = {}; this.parsed = {};
    this.plan = {}; this.accepts = {}; this.announced = '';
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
    this.hearing = null; this.hearTimer = null; this.hearAt = 0;
    this.lastBroadcast = 0;
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
      selfOk: null, ready: false, wantsEnd: false, msgs: 0, picks: 0, nudged: false, alertOn: false, alerts: 0, flagOn: false, flags: 0, seatedAt: Date.now() };
  }
  fillWithAI(seats) {
    const added = [];
    while (this.players.length < seats) {
      const n = this.nextAI++;
      const p = { key: `ai${n + 1}`, name: `${AI_NAMES[n % AI_NAMES.length]} (AI)`, isAI: true, pcode: `A0${n + 1}`, color: '#52514e',
        limitId: this.freeLimit(), custom: null, limitSharedAt: null, limitMentionedAt: null, msgs: 0, picks: 0, revealed: false };
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
    if (replaced) p.limitId = replaced.limitId;
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
  withNames(text) { return String(text).replace(/\b[PA]0\d\b/g, (c) => this.byCode(c)?.name || c); }
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
  limitOk(p, plan) { return p.custom ? p.selfOk : (planComplete(this.task, plan) ? !this.limitOf(p).violates(plan) : null); }
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
        ? 'Hi, I am the AI for this table. I read the chat and keep the plan above up to date. Ask me anything with @AI, in the group or privately with the AI button. Your private limit stays private unless you share it or ask me to pass it on. I never vote.'
        : 'Hi, I am the AI for this table. I only answer when asked: start a message with @AI, or use the AI button next to the message box to ask in the group or privately. I can also pass on your private limit if you ask me to. I never vote.', 'ai_intro', null, true);
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
    this.log('system', 'session_outcome', { ...this.outcome, plan, humans: this.humans().length, ai_players: this.players.length - this.humans().length });
    // One row per seat for the analysis: what happened to this person's limit, and how much they took part.
    for (const p of this.players) {
      this.log(p.pcode, 'player_outcome', { ai: p.isAI, limit: this.limitId(p), shared: p.limitSharedAt !== null, shared_at: p.limitSharedAt, via: p.limitVia || null, anonymous: !!p.limitAnon,
        mentioned_at: p.limitMentionedAt, limit_ok: complete ? this.limitOk(p, plan) : null, accepted: !!this.accepts[p.key], msgs: p.msgs, picks: p.picks, private_questions: p.privateAsks || 0,
        alerts: p.alerts || 0, away: !p.isAI && this.isAway(p) });
    }
    this.log('system', 'session_ended', { outcome: this.deal ? 'deal' : 'no_deal' });
    try {
      await q('update sessions set ended_at=now(), outcome=$2, final_plan=$3 where id=$1', [this.id, this.deal ? 'deal' : 'no_deal', JSON.stringify({ plan, ...this.outcome })]);
    } catch (e) { console.error(e.message); }
    this.onDone?.(this);
  }

  pushChat(msg) {
    const m = { id: ++this.seq, t: this.t, ...msg };
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
    this.pushChat({ from: 'AI', name: 'AI', kind: 'ai', passedOn: true, text: anon ? `Someone at this table asked me to pass this on without their name: "${say}"` : `${p.name} asked me to pass this on: "${say}"` });
    this.log(p.pcode, 'limit_shared', { limit: this.limitId(p), via: 'ai', anonymous: anon, text: say });
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
    if (this.listening() && BOOK_RE.test(text)) this.proposeBooking(RIDE_RE.test(text) ? 'ride' : 'table', p);
    else if (this.listening() && MAP_RE.test(text)) this.showMap(p);
    else if (!p.isAI) this.answerGroupQuestion(p, text);
    this.afterChange();
    if (!p.isAI) this.queueAiReplies(p, text);
  }

  // Listening tables: when someone asks the group about a part of the plan ("what time tho?"), the AI answers with a
  // card for that part: the options, who picked what, and any shared limit an option would break. It is a reply, not
  // one of the AI's own questions, so it does not count toward the cap of 2.
  answerGroupQuestion(p, text) {
    if (!this.listening()) return;
    const field = topicOf(this.task, text);
    if (!field) return;
    if (Date.now() - (this.cardAt[field] || 0) < sec(40)) return;
    this.cardAt[field] = Date.now();
    const row = this.panel().find((f) => f.id === field);
    const name = fieldName(this.task, field).toLowerCase();
    const head = row.status === 'agreed' ? `Most of you picked ${optionName(this.task, field, row.leader)} for ${name}. Tap below if you want to change yours.`
      : row.options.length ? `Here is what people have picked for ${name} so far. Tap one to pick yours.` : `Nobody has picked ${name} yet. Here are the options; tap one to start.`;
    const notes = this.sharedNotes(field);
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
      if (bad.length) out.push(`${x.limitAnon ? 'Someone' : x.name} shared that ${list(bad.map((o) => o.name))} ${bad.length > 1 ? 'do' : 'does'} not work for them.`);
    }
    return out.join(' ');
  }
  // Options that a shared limit rules out, per part of the plan. codes: player codes instead of names (for the model).
  blockedView(codes) {
    const out = {};
    for (const f of this.task.fields) for (const o of f.options) for (const x of this.players) {
      if (x.limitSharedAt === null || !this.limitOf(x).violates({ [f.id]: o.id })) continue;
      ((out[f.id] = out[f.id] || {})[o.id] = out[f.id][o.id] || []).push(x.limitAnon ? (codes ? 'someone' : 'Someone') : codes ? x.pcode : x.name);
    }
    return out;
  }

  // Limit mentions are logged in both modes for analysis; the AI never acts on them.
  noteMention(p, text) {
    if (p.limitMentionedAt === null && this.limitOf(p).re.test(text)) { p.limitMentionedAt = this.t; this.log(p.pcode, 'limit_mentioned', { limit: this.limitId(p) }); }
  }
  // What the AI takes from a group message. Returns what changed. A question to the AI is never read as a wish.
  read(p, text) {
    this.noteMention(p, text);
    if (this.mode === 'listen' && this.pausedBy) return []; // paused: the AI does not read new messages
    // Listening tables: the chat updates the plan. Answer-only tables: only taps do (AI players count, since they cannot tap).
    const board = this.mode === 'listen' || p.isAI;
    const changes = applyMessage(this.task, board ? this.prefs : this.parsed, p.pcode, text);
    if (changes.length) this.log(board ? 'AI' : 'system', board ? 'panel_update' : 'chat_parsed', { from: p.pcode, changes: changes.map((c) => ({ field: c.field, option: c.option, kind: c.kind })) });
    return board ? changes : [];
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
    const add = m.sup.filter((x) => mine[x.field] !== x.option);
    if (!add.length) return;
    for (const x of add) mine[x.field] = x.option;
    p.picks++;
    this.pushChat({ from: p.pcode, name: p.name, kind: 'pick', text: `${p.name} agreed with ${m.name}: ${list(add.map((x) => optionName(this.task, x.field, x.option)))}.` });
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
    if (BOOK_RE.test(text)) {
      if (priv) return reply(`Booking a ${RIDE_RE.test(text) ? 'ride' : 'table'} is for the whole group, so it starts in the group chat: ask there (for example "@AI book a ${RIDE_RE.test(text) ? 'ride' : 'table'}"). I will then ask each person privately which options work for them.`, 'ai_answer', { source: 'rule' });
      return this.proposeBooking(RIDE_RE.test(text) ? 'ride' : 'table', p);
    }
    if (!priv && MAP_RE.test(text) && placesOf(this.task).length) { this.showMap(p, true); this.broadcast(); return; }
    if (aiMode() === 'scripted' && wantsCompare(text)) return this.compare(p, text, reply);
    this.setThinking(to, true);
    let a;
    try {
      a = await answerQuestion(this.anonymize(text), { task: this.task, asker: p.pcode, private: priv, summary: this.anonymize(this.summaryText()),
        facts: this.anonymize(this.factsText()), recent: this.recentChat(16, { withAI: true, forKey: to }) });
    } finally { this.setThinking(to, false); }
    if (this.stage !== 'chat') return;
    const fix = (t) => this.withNames(t);
    const blocks = (a.blocks || []).map((b) => b.type === 'compare' ? { ...b, items: b.items.map((x) => ({ ...x, pros: x.pros.map(fix), cons: x.cons.map(fix) })) }
      : b.type === 'table' ? { ...b, rows: b.rows.map((r) => r.map(fix)) } : b.items ? { ...b, items: b.items.map(fix) } : b);
    const pick = blocks.find((b) => b.type === 'pick');
    const extra = { blocks: blocks.filter((b) => !['pick', 'map'].includes(b.type)) };
    if (pick) extra.poll = pick.field;
    reply(fix(a.text), 'ai_answer', { source: a.source, blocks: blocks.map((b) => b.type) }, extra);
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
    if (who.length) pros.push(`${list(this.names(who))} ${who.length > 1 ? 'want' : 'wants'} it`);
    const no = this.blockedView()[field]?.[id] || [];
    if (no.length) cons.push(`Does not work for ${list(no)} (shared limit)`);
    if (placeField(this.task) === field) { const pl = placeOf(this.task, id); if (pl) { const e = estimate(PICKUP, pl); (e.minutes <= 20 ? pros : cons).push(`About ${e.minutes} min drive from campus`); } }
    return { name: o.name, pros: pros.slice(0, 3), cons: cons.slice(0, 3) };
  }
  // The same facts for every option, as text for the model: who wants what, which shared limits rule an option out,
  // and drive times. Names are replaced by codes before this is sent.
  factsText() {
    const blocked = this.blockedView(true), pf = placeField(this.task), panel = this.panel();
    return this.task.fields.map((f) => {
      const row = panel.find((x) => x.id === f.id);
      return `- ${f.name}: ${f.options.map((o) => {
        const notes = [];
        const who = row.options.find((x) => x.option === o.id)?.who || [];
        if (who.length) notes.push(`wanted by ${who.join(', ')}`);
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
      .slice(-n).map((m) => `${m.from}${m.to ? ' (private)' : ''}: ${this.anonymize(m.text)}${m.kind === 'question' ? ' (asked the AI)' : ''}${m.blocks?.length ? ` [also showed: ${m.blocks.map((b) => b.title || b.type).join(', ')}]` : ''}`).join('\n');
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
    if (JSON.stringify(next) === JSON.stringify(this.plan)) return;
    const had = Object.values(this.accepts).some(Boolean);
    this.plan = next; this.accepts = {};
    for (const h of this.humans()) h.selfOk = null;
    const complete = planComplete(this.task, next);
    this.log('system', 'plan_update', { plan: next, complete });
    if (had) this.log('system', 'accepts_reset');
    const key = JSON.stringify(next);
    if (complete && this.announced !== key) {
      this.announced = key;
      const text = `Every part of the plan has a choice: ${this.task.fields.map((f) => optionName(this.task, f.id, next[f.id])).join(', ')}. If it works for you, tap Accept. If it does not, say so or change a pick.`;
      this.pushChat({ from: 'system', name: 'Cabrillo', kind: 'plan', plan: next, text });
      this.log('system', 'plan_complete', { text, plan: next });
    }
  }

  // Runs after every message, pick, or shared limit.
  afterChange() {
    if (this.stage !== 'chat' || this.deal) { this.broadcast(); return; }
    this.lastChangeAt = Date.now();
    this.syncPlan();
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
      const breaks = !h.custom && h.limitSharedAt === null && this.limitOf(h).violates(heading);
      if (breaks && !h.alertOn && h.alerts < 2) {
        h.alerts++;
        this.aiSay('Heads up: the plan is heading somewhere that breaks your private limit, and the group does not know that. You can say it yourself, or I can pass it on for you.', 'limit_alert_private', { limit: this.limitId(h) }, true, h.key, { actions: 'limit' });
      }
      h.alertOn = breaks;
    }
  }

  // Listening tables only: once a limit has been shared, the AI speaks up if the plan stops fitting it.
  protectSharedLimits() {
    for (const p of this.players) {
      const breaks = !p.custom && p.limitSharedAt !== null && this.limitOf(p).violates(this.plan);
      if (breaks && !p.flagOn && (p.flags || 0) < 2) {
        p.flags = (p.flags || 0) + 1;
        this.aiSay(`Heads up: the plan so far does not fit ${p.limitAnon ? 'a limit that someone shared without their name' : `the limit ${p.name} shared`}. What could change so it works for everyone?`, 'shared_limit_conflict', { pcode: p.pcode, limit: this.limitId(p), plan: this.plan });
      }
      p.flagOn = breaks;
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
    this.deal = { plan: { ...this.plan }, t: this.t };
    this.log('system', 'deal_locked', { plan: this.plan, accepted_by: this.humans().filter((h) => this.accepts[h.key]).map((h) => h.pcode) });
    this.sys(`Plan locked: ${this.task.fields.map((f) => optionName(this.task, f.id, this.plan[f.id])).join(', ')}.`, 'deal_summary');
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
      const n = this.players.length;
      const b = { id: `b${this.bookings.length + 1}`, kind, n, answers: {}, status: 'asking', code: null, by: by?.pcode || null, auto: !by, whenName, place };
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
      this.pushChat({ from: 'AI', name: 'AI', kind: 'booking', bookingId: b.id, text: `${why} ${b.title}. I am asking each person privately which ${kind === 'ride' ? 'rides' : 'times'} work for them; the group only sees the result.` });
      this.log('AI', 'booking_proposed', { id: b.id, kind, auto: !by, requested_by: by?.pcode || null, place: place.id, when, options: b.options.map((o) => ({ id: o.id, per_person: o.perPerson })), route: b.routeSource || null });
      this.later(45, () => this.remindBooking(b));
      this.broadcast();
    } finally { this.preparing[kind] = false; }
  }
  // A person's private answer: every option that works for them, or none. They can change it until the result is in.
  bookingAnswer(key, id, ok) {
    const p = this.player(key); const b = this.bookings.find((x) => x.id === id);
    if (!p || p.isAI || !b || b.status !== 'asking' || this.stage !== 'chat') return;
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
    if (!this.active().every((h) => b.answers[h.pcode])) { this.broadcast(); return; }
    const all = [...this.humans().filter((h) => b.answers[h.pcode]).map((h) => b.answers[h.pcode]), ...this.players.filter((p) => p.isAI).map((p) => this.aiBookingAnswer(p, b))];
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
  remindBooking(b) {
    if (b.status !== 'asking' || this.stage !== 'chat') return;
    for (const h of this.active()) {
      if (b.answers[h.pcode]) continue;
      this.aiSay(`The ${b.kind === 'ride' ? 'ride' : 'table'} card above is waiting for your answer. Your answer stays private; the group only sees the result.`, 'booking_reminder', { id: b.id }, true, h.key);
    }
  }

  bookingView(b, me) {
    // Options above a spending limit that someone chose to share are marked, so nobody has to say it again.
    const over = (o) => this.players.filter((x) => x.limitSharedAt !== null && this.limitOf(x).maxPerPerson && o.perPerson > this.limitOf(x).maxPerPerson).map((x) => (x.limitAnon ? 'someone' : x.name));
    const { answers, by, ...rest } = b;
    const need = this.active();
    return { ...rest, options: b.options.map((o) => ({ ...o, over: over(o) })),
      mine: me ? (answers[me.pcode] ?? null) : null, answered: need.filter((h) => answers[h.pcode]).length, of: need.length };
  }

  // ---------- the listening AI ----------
  summaryText() {
    const parts = this.panel().map((f) => {
      if (f.status === 'open') return `${f.name}: not discussed yet`;
      if (f.status === 'agreed') return `${f.name}: ${optionName(this.task, f.id, f.leader)} (most agree)`;
      return `${f.name}: ${f.options.map((o) => `${o.name} (${o.who.join(', ')})`).join(' or ')}`;
    });
    return parts.join('; ') + '.';
  }
  names(pcodes) { return pcodes.map((c) => this.byCode(c)?.name || c); }

  // One line above the chat: what the AI is hearing. Built from rules at once; when an AI key is set, the model
  // rewrites it a few seconds after the chat goes quiet (so it can also reflect ideas that are not on the list).
  hearingRule() {
    const panel = this.panel();
    if (panel.every((f) => f.status === 'open')) return 'Nothing decided yet. Say what you want, or tap a part of the plan to pick.';
    const agreed = panel.filter((f) => f.status === 'agreed'), mixed = panel.filter((f) => f.status === 'split' || f.status === 'leaning'), open = panel.filter((f) => f.status === 'open');
    const out = [];
    if (agreed.length) out.push(`Most agree on ${list(agreed.map((f) => optionName(this.task, f.id, f.leader)))}.`);
    for (const f of mixed) out.push(`${f.name}: ${f.options.map((o) => `${o.name} (${list(this.names(o.who))})`).join(' or ')}.`);
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
    const r = await summarize({ task: this.task, summary: this.anonymize(this.summaryText()), recent: this.recentChat(16, { questions: false }) });
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
    if (this.interjections >= MAX_INTERJECTIONS || elapsed < sec(45) || now - this.lastInterjectAt < sec(60)) return;
    const panel = this.panel();
    const anyLimit = this.players.some((p) => p.limitSharedAt !== null || p.limitMentionedAt !== null);
    if (!this.didLimitsCheck && !anyLimit && (panel.some((f) => f.status === 'agreed' || f.status === 'leaning') || elapsed > sec(120))) {
      this.didLimitsCheck = true;
      this.interject('Before anything is settled: does anyone have a limit the group should know about? You can say it, or tap "Your private limit" and I will pass it on, with or without your name.', 'limits_check');
      this.aiPlayersRespondToLimits();
      return;
    }
    // A disagreement becomes a quick poll: the options people raised, with buttons to pick.
    const c = findConflict(panel.filter((f) => !this.asked.has(`conflict:${f.id}`)));
    if (c) {
      this.asked.add(`conflict:${c.field.id}`);
      const a = this.names(c.a.who), b = this.names(c.b.who);
      this.interject(`For ${c.field.name.toLowerCase()}, ${list(a)} ${a.length > 1 ? 'want' : 'wants'} ${c.a.name}, and ${list(b)} ${b.length > 1 ? 'want' : 'wants'} ${c.b.name}. What would work for everyone? Tap to pick.`, 'conflict', { field: c.field.id, a: c.a.option, b: c.b.option }, { poll: c.field.id });
      return;
    }
    const open = panel.find((f) => f.status === 'open' && !this.asked.has(`open:${f.id}`));
    if (open && elapsed > sec(150)) {
      this.asked.add(`open:${open.id}`);
      this.interject(`Nobody has talked about ${open.name.toLowerCase()} yet. What does the group think? Tap to pick.`, 'open_question', { field: open.id }, { poll: open.id });
    }
  }

  // ---------- AI players (fill empty seats) ----------
  // Labeled seat fillers. With an AI key the model writes their messages like a relaxed classmate and they reply to the
  // people at the table; without one, varied scripted lines. Either way the app decides what they may pick: they keep
  // to their limit, share it when the group heads the wrong way, and otherwise go along with the people at the table,
  // so a table with AI players can still reach a plan.
  llmPlayers() { return aiMode() !== 'scripted' && process.env.AI_PLAYERS !== 'scripted'; }
  // What the people at the table want for one part, when they agree with each other. If people want different
  // things, AI players stay out of it: a seat filler must not decide a disagreement between people.
  humanChoice(f) {
    const wanted = f.options.filter((o) => o.who.some((c) => !this.byCode(c)?.isAI));
    return wanted.length === 1 ? wanted[0] : null;
  }
  // What the people at the table want that this AI player can go along with, and whether something they want breaks its limit.
  followPlan(p) {
    const mine = this.prefs[p.pcode] || {}; const lim = this.limitOf(p);
    const picks = {}; let blocked = false;
    for (const f of this.panel()) {
      const want = this.humanChoice(f);
      if (!want || mine[f.id] === want.option) continue;
      if (lim.violates({ ...this.heading(), ...mine, ...picks, [f.id]: want.option })) { blocked = true; continue; }
      picks[f.id] = want.option;
    }
    return { picks, blocked };
  }
  scheduleAiPlayers() {
    this.players.filter((p) => p.isAI).forEach((p, i) => {
      this.later(rand(8, 16) + i * 10, () => this.aiPlayerSpeak(p, { reason: 'open' }));
      if (Math.random() < 0.4) this.later(rand(150, 240), () => this.aiPlayerReveal(p));
    });
  }
  // After a person writes, one AI player answers (two when it was a question to the group), one after the other,
  // so the second can react to the first. A newer message from a person replaces replies still waiting.
  queueAiReplies(from, text) {
    const ais = this.players.filter((p) => p.isAI);
    if (!ais.length || this.stage !== 'chat' || this.deal) return;
    const asked = isQuestion(text);
    const n = asked ? Math.min(2, ais.length) : Math.random() < 0.6 ? 1 : 0;
    if (!n) return;
    const who = [...ais].sort((a, b) => (a.lastMsgAt || 0) - (b.lastMsgAt || 0) + (Math.random() - 0.5) * 4000).slice(0, n);
    const token = this.replyToken = {};
    const topic = topicOf(this.task, text);
    (async () => {
      for (const [i, p] of who.entries()) {
        await sleep(sec(i ? rand(1.5, 3) : rand(1.2, 2.5)));
        if (this.replyToken !== token) return;
        await this.aiPlayerSpeak(p, { reason: 'reply', to: from, text, topic, token });
      }
    })().catch((e) => console.error('AI player reply failed:', e.message));
  }
  async aiPlayerSpeak(p, o = {}) {
    if (this.stage !== 'chat' || this.deal || p.speaking) return;
    if (o.reason === 'open' && p.msgs > 0) return;
    if (o.reason === 'limit' && p.revealed) return;
    p.speaking = true;
    try {
      const lim = this.limitOf(p);
      const mine = this.prefs[p.pcode] || (this.prefs[p.pcode] = {});
      const { picks: going } = this.followPlan(p);
      this.typing(p.key);
      const started = Date.now();
      let out = null;
      if (this.llmPlayers()) {
        const wantList = Object.entries({ ...lim.aiPrefs, ...mine }).map(([f, v]) => `${fieldName(this.task, f)}: ${optionName(this.task, f, v)}`).join(', ');
        const instruction = o.reason === 'limit' ? 'Tell the group about your limit now, in your own words. Set mentions_limit to true.'
          : o.reason === 'open' ? (this.recentChat(1) ? 'Join the conversation: react to what people said and suggest one thing you would like.' : 'The chat just started. Say hi and suggest one thing you would like, briefly.')
          : `Reply to ${o.to.pcode}'s newest message: "${this.anonymize(o.text)}".${o.topic ? ` They are asking about ${fieldName(this.task, o.topic).toLowerCase()} (part id ${o.topic}): say what you would pick and, briefly, why.` : ''}`;
        out = await playerLine({ task: this.task, me: p.pcode, wants: wantList, limit: lim.say || lim.text, shared: p.revealed,
          goingAlong: Object.entries(going).map(([f, v]) => `${fieldName(this.task, f)}: ${optionName(this.task, f, v)}`).join(', '),
          summary: this.anonymize(this.summaryText()), recent: this.recentChat(14), instruction });
      }
      if (!out) out = this.scriptedLine(p, o, going);
      if (!out || this.stage !== 'chat' || this.deal) return;
      if (o.token && this.replyToken !== o.token) return; // someone wrote again; the newer message gets the reply
      // Look like typing: a pause that grows with the length of the message.
      const wait = sec((1500 + Math.min(3500, out.text.length * 45)) / 1000) - (Date.now() - started);
      if (wait > 0) { this.typing(p.key); await sleep(wait); }
      if (this.stage !== 'chat' || this.deal) return;
      // Picks count only if they keep to this player's limit.
      const picks = {};
      for (const [f, v] of Object.entries({ ...going, ...(out.picks || {}) })) {
        const fld = this.task.fields.find((x) => x.id === f);
        if (!fld || !fld.options.some((x) => x.id === v)) continue;
        if (lim.violates({ ...this.heading(), ...mine, ...picks, [f]: v })) continue;
        picks[f] = v;
      }
      Object.assign(mine, picks);
      const reveal = !p.revealed && (o.reason === 'limit' || out.mentionsLimit);
      if (reveal) { p.revealed = true; p.limitSharedAt = this.t; p.limitVia = 'self'; this.log(p.pcode, 'limit_shared', { limit: this.limitId(p), via: 'self', anonymous: false }); }
      p.msgs++; p.lastMsgAt = Date.now();
      const text = this.withNames(out.text);
      // On listening tables, people can tap "Me too" on what this message asked for.
      const said = this.mode === 'listen' ? Object.entries(picks).filter(([f]) => out.picks && f in out.picks).map(([field, option]) => ({ field, option })) : [];
      this.pushChat({ from: p.pcode, name: p.name, kind: reveal ? 'limit' : 'chat', text, ...(said.length ? { sup: said } : {}) });
      this.log(p.pcode, 'chat_message', { text: this.anonymize(text), length: text.length, ai_player: o.reason, source: out.source || 'scripted', picks });
      this.afterChange();
    } finally { p.speaking = false; }
  }
  // Without an AI key: short, varied lines that still answer the question that was asked.
  scriptedLine(p, o, going) {
    const lim = this.limitOf(p), mine = this.prefs[p.pcode] || {};
    if (o.reason === 'limit') return { text: lim.say, picks: {}, mentionsLimit: true };
    const ok = (f, v) => v && !lim.violates({ ...this.heading(), ...mine, [f]: v });
    const nameOf = (f, v) => optionName(this.task, f, v);
    let field = o.topic && this.task.fields.some((f) => f.id === o.topic) ? o.topic : null;
    if (!field && o.reason === 'open') field = Object.keys(lim.aiPrefs)[0] || null;
    if (field) {
      const f = this.task.fields.find((x) => x.id === field);
      const v = [mine[field], going[field], lim.aiPrefs[field], ...f.options.map((x) => x.id)].find((x) => ok(field, x));
      if (!v) return null;
      const x = nameOf(field, v);
      const lines = o.reason === 'open'
        ? [`hey all! i'm thinking ${x} for ${f.name.toLowerCase()}`, `hi! ${x} could be fun?`, `hey, how about ${x}?`]
        : [`${x} works for me`, `i'd go with ${x} tbh`, `${x}? i'm down`, `maybe ${x}?`, `i vote ${x}`];
      return { text: pickOne(lines), picks: { [field]: v } };
    }
    const g = Object.entries(going);
    if (g.length) return { text: pickOne([`${list(g.map(([f, v]) => nameOf(f, v)))} sounds good to me`, `yeah i'm good with ${list(g.map(([f, v]) => nameOf(f, v)))}`, `${list(g.map(([f, v]) => nameOf(f, v)))} works`]), picks: {} };
    const open = Object.entries(lim.aiPrefs).find(([f, v]) => !mine[f] && ok(f, v));
    if (open) return { text: pickOne([`also, ${nameOf(...open)} for ${fieldName(this.task, open[0]).toLowerCase()}?`, `what about ${nameOf(...open)}?`]), picks: { [open[0]]: open[1] } };
    return Math.random() < 0.5 ? { text: pickOne(['sounds good', 'yeah fair', 'works for me', 'ok cool']), picks: {} } : null;
  }
  aiPlayersRespondToLimits() {
    this.players.filter((p) => p.isAI).forEach((p, i) => { if (Math.random() < 0.85) this.later(4 + i * 6, () => this.aiPlayerReveal(p)); });
  }
  aiPlayerReveal(p) {
    if (p.revealed || this.stage !== 'chat' || this.deal) return;
    return this.aiPlayerSpeak(p, { reason: 'limit' });
  }
  queueAiFollow() {
    for (const p of this.players) {
      if (!p.isAI || p.following) continue;
      p.following = true;
      this.later(rand(5, 10), () => { p.following = false; this.aiPlayerFollow(p); });
    }
  }
  // Quietly go along with what the people at the table picked (shown as a pick line, like a tap), or share the limit
  // when the group heads somewhere that breaks it.
  aiPlayerFollow(p) {
    if (this.stage !== 'chat' || this.deal || p.speaking) return;
    const { picks, blocked } = this.followPlan(p);
    if (blocked && !p.revealed) return this.aiPlayerReveal(p);
    const ids = Object.keys(picks);
    if (!ids.length) return;
    Object.assign(this.prefs[p.pcode] || (this.prefs[p.pcode] = {}), picks);
    const text = `${p.name} is fine with ${list(ids.map((f) => optionName(this.task, f, picks[f])))}.`;
    const last = this.chat[this.chat.length - 1];
    if (last && last.kind === 'pick' && last.from === p.pcode) this.chat.pop();
    this.pushChat({ from: p.pcode, name: p.name, kind: 'pick', text });
    this.log(p.pcode, 'pick', { follow: true, picks });
    this.afterChange();
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
      if (this.listening()) this.listen();
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
      task: { id: this.task.id, title: this.task.title, short: this.task.short, prompt: this.task.prompt, fields: this.task.fields.map((f) => ({ id: f.id, name: f.name, options: f.options.map((x) => ({ id: x.id, name: x.name })) })) },
      me: me ? {
        pcode: me.pcode, name: me.name, ready: me.ready, accepted: !!this.accepts[key], wantsEnd: me.wantsEnd, prefs: this.prefs[me.pcode] || {},
        limit: {
          text: lim.text, say: lim.say, custom: !!me.custom, canSwap: !!me.custom || this.spareLimits().length > 0,
          sharedAt: me.limitSharedAt, anon: me.limitAnon, via: me.limitVia, mentionedAt: me.limitMentionedAt,
          // how the plan so far sits with your limit: 'breaks', 'fits', or null when it cannot be checked
          now: me.custom ? null : (lim.violates(chatting ? this.heading() : final) ? 'breaks' : Object.keys(chatting ? this.heading() : final).length ? 'fits' : null),
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
          limit: visible ? this.limitOf(p).text : null, limitCustom: visible ? !!p.custom : false,
          limitOk: open ? this.limitOk(p, final) : null
        };
      }),
      panel: this.panelView(),
      // the model's line is used while it is fresh; otherwise the rule-based line
      hearing: this.mode === 'listen' && chatting ? (this.hearing && this.hearing.at > (this.lastChangeAt || 0) - 15000 ? this.hearing.text : this.hearingRule()) : null,
      aiThinking: this.thinkingPublic > 0 || this.thinkingFor.has(key),
      quiet: this.mode === 'listen' && chatting ? this.humans().filter((h) => h.msgs === 0 && h.picks === 0).map((h) => h.name) : [],
      plan: final, complete: planComplete(this.task, final), deal: this.deal, outcome: this.outcome,
      chat: this.chat.filter((m) => !m.to || m.to === key).slice(-80).map(({ to, ...m }) => m),
      aiPaused: this.aiPaused, pausedBy: this.pausedBy ? this.byCode(this.pausedBy)?.name : null,
      bookings: this.bookings.map((b) => this.bookingView(b, me)),
      maps: this.maps.map((m) => ({ ...m, leader: this.choice(m.field) })),
      surveyUrl: this.room.surveyUrl || null, roomCode: this.room.code, kind: this.room.kind
    };
  }

  hostView() {
    return {
      id: this.id, number: this.number, stage: this.stage, stageEndsAt: this.stageEndsAt, stageStartedAt: this.stageStartedAt || null, serverNow: Date.now(),
      target: this.target, humans: this.humans().length, ready: this.humans().filter((h) => h.ready).length, mode: this.mode, task: this.task.short, taskTitle: this.task.title,
      summary: this.summaryText(), plan: this.plan, complete: planComplete(this.task, this.plan), deal: this.deal, outcome: this.outcome,
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
