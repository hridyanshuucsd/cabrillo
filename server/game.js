import crypto from 'node:crypto';
import { taskById, fieldName, optionName, planComplete } from './tasks.js';
import { applyMessage, buildPanel, findConflict } from './listener.js';
import { q, logEvent } from './db.js';
import { answerQuestion, summarize, aiMode } from './ai.js';
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
// Booking demo: the AI can prepare a ride or a table, ask everyone to approve the price, and split it.
// Nothing is really booked or charged.
const BOOK_RE = /\b(book|reserve|order|call|get|grab|schedule)\b.{0,30}\b(uber|lyft|ride|rideshare|cab|taxi|car|table|restaurant|reservation|spot|dinner|lunch)\b|\b(make|need|get) a reservation\b|\breserve a table\b/i;
const RIDE_RE = /\b(uber|lyft|ride|rides|rideshare|cab|taxi|car|cars)\b/i;
// "show us a map", "how far is it": the AI posts a map of the place options.
const MAP_RE = /\b(map|how far|where is|where's|directions|distance|how long to get)\b/i;
const MEAL = { low: 13, mid: 24, high: 38, free: 10, under50: 10, over50: 18 };
const TABLE_TASKS = new Set(['dinner', 'anniversary']); // plans where the place is a restaurant
const AWAY_SECONDS = 45;     // a closed page counts as away after this long
const MAX_INTERJECTIONS = 2; // unprompted questions from the listening AI per chat
const sec = (s) => s * SCALE * 1000;
const rand = (a, b) => a + Math.random() * (b - a);
const shuffle = (arr) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const ASK_AI = /(^|\s)@ai\b/i;
const optionName2 = (b) => b.options.find((o) => o.id === b.choice).name;
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
    this.bookings = []; this.maps = []; this.auto = {}; this.preparing = {};
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
      this.sys(`${this.task.prompt} Decide ${list(this.task.fields.map((f) => f.name.toLowerCase()))}. Say what you want in the chat, or tap a part of the plan above to pick. The plan locks when everyone accepts it. There is no timer.`, 'stage_intro', { stage });
      this.aiSay(this.mode === 'listen'
        ? 'Hi, I am the AI for this table. I read the chat and keep the plan above up to date. Your private limit stays private unless you share it or ask me to pass it on. I never vote.'
        : 'Hi, I am the AI for this table. I only answer when asked: start a message with @AI, or turn on the AI button next to the message box. I can also pass on your private limit if you ask me to. I never vote.', 'ai_intro', null, true);
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
    this.outcome = { deal: !!this.deal, surfaced, respected, complete, of: this.players.length, mode: this.mode, interjections: this.interjections, minutes: Math.round((Date.now() - (this.chatStartedAt || Date.now())) / 6000 / SCALE) / 10 };
    this.log('system', 'session_outcome', { ...this.outcome, plan });
    this.log('system', 'session_ended', { outcome: this.deal ? 'deal' : 'no_deal' });
    try {
      await q('update sessions set ended_at=now(), outcome=$2, final_plan=$3 where id=$1', [this.id, this.deal ? 'deal' : 'no_deal', JSON.stringify({ plan, ...this.outcome })]);
    } catch (e) { console.error(e.message); }
    this.onDone?.(this);
  }

  pushChat(msg) {
    this.chat.push({ id: ++this.seq, t: this.t, ...msg });
    if (this.chat.length > 300) this.chat.shift();
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
    p.msgs++; p.lastMsgAt = Date.now();
    // A message sent from the "Say it myself" draft counts as sharing the limit, even if the person reworded it.
    const own = !!opts?.limit && !p.isAI && p.limitSharedAt === null;
    if (own) { p.limitSharedAt = this.t; p.limitAnon = false; p.limitVia = 'self'; this.log(p.pcode, 'limit_shared', { limit: this.limitId(p), via: 'self', anonymous: false, text }); }
    this.pushChat({ from: p.pcode, name: p.name, kind: own ? 'limit' : 'chat', text });
    this.log(p.pcode, 'chat_message', { text, length: text.length });
    this.read(p, text);
    if (this.listening() && BOOK_RE.test(text)) this.proposeBooking(RIDE_RE.test(text) ? 'ride' : 'table', p);
    else if (this.listening() && MAP_RE.test(text)) this.showMap(p);
    this.afterChange();
  }

  // What the AI takes from a message. Limit mentions are logged in both modes for analysis; the AI never acts on them.
  read(p, text) {
    const lim = this.limitOf(p);
    if (p.limitMentionedAt === null && lim.re.test(text)) { p.limitMentionedAt = this.t; this.log(p.pcode, 'limit_mentioned', { limit: this.limitId(p) }); }
    if (this.mode === 'listen' && this.pausedBy) return; // paused: the AI does not read new messages
    // Listening tables: the chat updates the plan. Answer-only tables: only taps do (AI players count, since they cannot tap).
    const board = this.mode === 'listen' || p.isAI;
    const changes = applyMessage(this.task, board ? this.prefs : this.parsed, p.pcode, text);
    if (changes.length) this.log(board ? 'AI' : 'system', board ? 'panel_update' : 'chat_parsed', { from: p.pcode, changes: changes.map((c) => ({ field: c.field, option: c.option, kind: c.kind })) });
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
    const text = option ? `${p.name} picked ${optionName(this.task, field, option)} for ${f.name.toLowerCase()}.` : `${p.name} removed their pick for ${f.name.toLowerCase()}.`;
    // Several taps in a row on the same part show as one line.
    const last = this.chat[this.chat.length - 1];
    if (last && last.kind === 'pick' && last.from === p.pcode && last.field === field) this.chat.pop();
    this.pushChat({ from: p.pcode, name: p.name, kind: 'pick', field, text });
    this.log(p.pcode, 'pick', { field, option: option || null });
    this.afterChange();
  }

  async ask(key, text) {
    const p = this.player(key); text = String(text || '').replace(ASK_AI, ' ').trim().slice(0, 300);
    if (!p || !text || this.stage !== 'chat') return;
    p.msgs++;
    this.pushChat({ from: p.pcode, name: p.name, kind: 'question', text });
    this.log(p.pcode, 'question_asked', { text });
    this.read(p, text);
    this.afterChange();
    if (BOOK_RE.test(text) && !this.aiPaused) return this.proposeBooking(RIDE_RE.test(text) ? 'ride' : 'table', p);
    if (MAP_RE.test(text) && !this.aiPaused && placesOf(this.task).length) { this.showMap(p, true); this.broadcast(); return; }
    if (this.aiPaused) { this.pendingQuestions.push({ pcode: p.pcode, name: p.name, text }); this.broadcast(); return; }
    const a = await answerQuestion(text, { task: this.task, summary: this.summaryText(), recent: this.recentChat(12) });
    this.aiSay(this.withNames(a.text), 'ai_answer', { source: a.source, question: text, to_player: p.pcode });
  }
  recentChat(n) {
    return this.chat.filter((m) => !m.to && ['chat', 'question', 'limit', 'pick'].includes(m.kind)).slice(-n).map((m) => `${m.from}: ${this.anonymize(m.text)}`).join('\n');
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
      this.sys(`Every part of the plan has a choice: ${this.task.fields.map((f) => optionName(this.task, f.id, next[f.id])).join(', ')}. If it works for you, tap Accept. If it does not, say so or change a pick.`, 'plan_complete', { plan: next });
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
    if (value && this.active().every((h) => h.wantsEnd)) { this.log('system', 'ended_by_group'); return this.enter('done'); }
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

  // The AI prepares a ride (with car types, route and fare) or a table (with times), everyone approves the price,
  // and the cost is split. by: the person who asked, or null when the AI offers it because the plan calls for it.
  async proposeBooking(kind, by) {
    if (this.stage !== 'chat') return;
    const say = (text, type) => { if (by) this.aiSay(text, type, { kind }, true); };
    if (this.preparing[kind] || this.bookings.some((b) => b.kind === kind && b.status !== 'declined')) {
      if (!this.preparing[kind]) say(`There is already a ${kind === 'ride' ? 'ride' : 'table'} request above. Approve or decline that one first.`, 'booking_duplicate');
      return;
    }
    const field = placeField(this.task);
    const placeId = field ? this.choice(field) : null;
    const place = placeId ? placeOf(this.task, placeId) : null;
    if (!field) return say(`In this demo I can book a ${kind === 'ride' ? 'ride' : 'table'} only when the plan has a place to go, and this one does not.`, 'booking_unavailable');
    if (!place) {
      const named = placeId ? optionName(this.task, field, placeId) : null;
      return say(named ? `${named} is not a place I can book for.` : `Pick a ${fieldName(this.task, field).toLowerCase()} first, and I will book ${kind === 'ride' ? 'the ride' : 'a table'} there.`, 'booking_needs_place');
    }
    this.preparing[kind] = true;
    try {
      const when = this.choice('when'), budget = this.choice('budget');
      const whenName = when ? optionName(this.task, 'when', when) : null;
      const n = this.players.length;
      const b = { id: `b${this.bookings.length + 1}`, kind, n, votes: {}, status: 'pending', code: null, by: by?.pcode || null, auto: !by, whenName, place };
      if (kind === 'ride') {
        const r = await route(PICKUP, place);
        b.origin = PICKUP; b.route = r.points; b.miles = r.miles; b.minutes = r.minutes; b.routeSource = r.source;
        b.options = rideOptions(r, n);
        b.choice = b.options.reduce((x, y) => (y.total < x.total ? y : x)).id;
        b.title = `Ride to ${place.name}`;
      } else {
        const per = this.opt('budget', budget)?.per || MEAL[budget] || 20;
        b.restaurant = place.restaurant; b.per = per;
        b.slots = slotsFor(whenName); b.slot = b.slots[1];
        b.title = `Table for ${n} at ${place.restaurant}`;
      }
      this.price(b);
      if (this.stage !== 'chat') return;
      this.bookings.push(b);
      const why = by ? `${by.name} asked me to book.` : kind === 'ride' ? 'You chose rideshare, so I priced the ride.' : 'You picked a place and a time, so I can hold a table.';
      this.pushChat({ from: 'AI', name: 'AI', kind: 'booking', bookingId: b.id, text: `${why} ${b.title}. Split ${n} ways: $${b.perPerson.toFixed(2)} each. Is the price right for everyone?` });
      this.log('AI', 'booking_proposed', { id: b.id, kind, auto: !by, total: b.total, per_person: b.perPerson, requested_by: by?.pcode || null, place: place.id, when, option: b.choice || b.slot, route: b.routeSource || null });
      this.broadcast();
    } finally { this.preparing[kind] = false; }
  }
  price(b) {
    if (b.kind === 'ride') { const o = b.options.find((x) => x.id === b.choice); b.total = o.total; b.perPerson = o.perPerson; b.cars = o.cars; }
    else { b.total = b.per * b.n; b.perPerson = b.per; }
  }
  // Anyone can switch the car type or the time before everyone approves; a change clears earlier approvals.
  bookingOption(key, id, option) {
    const p = this.player(key); const b = this.bookings.find((x) => x.id === id);
    if (!p || p.isAI || !b || b.status !== 'pending') return;
    if (b.kind === 'ride' && b.options.some((o) => o.id === option)) b.choice = option;
    else if (b.kind === 'table' && b.slots.includes(option)) b.slot = option;
    else return;
    const had = Object.keys(b.votes).length > 0;
    b.votes = {};
    this.price(b);
    this.log(p.pcode, 'booking_option', { id, option, total: b.total, approvals_reset: had });
    this.broadcast();
  }
  bookingVote(key, id, value) {
    const p = this.player(key); const b = this.bookings.find((x) => x.id === id);
    if (!p || p.isAI || !b || b.status !== 'pending' || this.stage === 'done') return;
    b.votes[p.pcode] = !!value;
    this.log(p.pcode, 'booking_vote', { id, value: !!value });
    if (!value) {
      b.status = 'declined';
      this.aiSay(`Not booked: ${p.name} said the price does not work. I will not book anything until everyone agrees.`, 'booking_declined', { id }, true);
      return;
    }
    if (this.active().every((h) => b.votes[h.pcode])) {
      b.status = 'booked'; b.code = `DEMO-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
      if (b.kind === 'ride') {
        // The ride plays out on the map so the group can see it: a driver is found, drives to the pickup, then to the place.
        const now = Date.now(), k = Math.max(SCALE, 0.05);
        b.driver = driver(b.choice); b.driverFrom = driverStart(b.origin);
        b.phases = { matchedAt: now + 3000 * k, pickupAt: now + 18000 * k, dropoffAt: now + 48000 * k };
        this.aiSay(`Booked (demo, nothing was charged): ${b.cars > 1 ? `${b.cars} ${optionName2(b)} cars` : `a ${optionName2(b)} car`} to ${b.place.name}. I sent each person a payment request for $${b.perPerson.toFixed(2)}. Watch the map to see how the ride would go.`, 'booking_done', { id, code: b.code, option: b.choice }, true);
      } else {
        this.aiSay(`Reserved (demo, nothing was charged): ${b.title}, ${b.slot}. Confirmation ${b.code}. I sent each person a payment request for $${b.perPerson.toFixed(2)}.`, 'booking_done', { id, code: b.code, slot: b.slot }, true);
      }
      return;
    }
    this.broadcast();
  }

  bookingView(b, me) {
    // The AI respects spending limits that people chose to share.
    const over = this.players.filter((x) => x.limitSharedAt !== null && this.limitOf(x).maxPerPerson && b.perPerson > this.limitOf(x).maxPerPerson)
      .map((x) => `${x.limitAnon ? 'Someone' : x.name} ($${this.limitOf(x).maxPerPerson})`);
    const { votes, by, ...rest } = b;
    return { ...rest, warn: over.length ? `${list(over)} shared a spending limit, and this is above it.` : null,
      mine: me ? (votes[me.pcode] ?? null) : null,
      approved: this.humans().filter((h) => votes[h.pcode]).map((h) => h.name), waiting: this.active().filter((h) => votes[h.pcode] === undefined).map((h) => h.name) };
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
    const wait = Math.max(2500, 7000 - (Date.now() - this.hearAt));
    this.hearTimer = setTimeout(() => this.refreshHearing().catch(() => {}), wait);
  }
  async refreshHearing() {
    if (this.stage !== 'chat' || !this.listening()) return;
    this.hearAt = Date.now();
    const seq = this.seq;
    const r = await summarize({ task: this.task, summary: this.anonymize(this.summaryText()), recent: this.recentChat(16) });
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
  // They state what their limit needs, share the limit when the group heads the wrong way, and otherwise go along
  // with what the people at the table want, so a table with AI players can still reach a plan.
  humanChoice(f) { return f.options.find((o) => o.who.some((c) => !this.byCode(c)?.isAI)) || null; }
  scheduleAiPlayers() {
    this.players.filter((p) => p.isAI).forEach((p, i) => {
      Object.entries(this.limitOf(p).aiPrefs).slice(0, 2).forEach(([field, option], k) => {
        this.later((k ? rand(70, 110) : rand(10, 25)) + i * 8, () => {
          if (this.stage !== 'chat' || this.deal || this.prefs[p.pcode]?.[field]) return;
          if (this.humanChoice(this.panel().find((f) => f.id === field))) return this.aiPlayerFollow(p); // people already weighed in
          this.say(p.key, k ? `${optionName(this.task, field, option)} works best for me.` : `I would like ${optionName(this.task, field, option)} for ${fieldName(this.task, field).toLowerCase()}.`);
        });
      });
      if (Math.random() < 0.4) this.later(rand(150, 240), () => this.aiPlayerReveal(p));
    });
  }
  aiPlayersRespondToLimits() {
    this.players.filter((p) => p.isAI).forEach((p, i) => { if (Math.random() < 0.85) this.later(4 + i * 5, () => this.aiPlayerReveal(p)); });
  }
  aiPlayerReveal(p) {
    if (p.revealed || this.stage !== 'chat' || this.deal) return;
    p.revealed = true; p.limitSharedAt = this.t; p.limitVia = 'self'; p.msgs++;
    const text = this.limitOf(p).say;
    this.pushChat({ from: p.pcode, name: p.name, kind: 'limit', text });
    this.log(p.pcode, 'limit_shared', { limit: p.limitId, via: 'self', anonymous: false });
    this.read(p, text);
    this.afterChange();
  }
  queueAiFollow() {
    for (const p of this.players) {
      if (!p.isAI || p.following) continue;
      p.following = true;
      this.later(rand(5, 10), () => { p.following = false; this.aiPlayerFollow(p); });
    }
  }
  aiPlayerFollow(p) {
    if (this.stage !== 'chat' || this.deal) return;
    const mine = this.prefs[p.pcode] || (this.prefs[p.pcode] = {});
    const lim = this.limitOf(p);
    const took = []; let blocked = false;
    for (const f of this.panel()) {
      const want = this.humanChoice(f);
      if (!want || mine[f.id] === want.option) continue;
      if (lim.violates({ ...this.heading(), ...mine, [f.id]: want.option })) {
        blocked = true;
        if (!mine[f.id] && lim.aiPrefs[f.id]) mine[f.id] = lim.aiPrefs[f.id];
        continue;
      }
      mine[f.id] = want.option; took.push(want.name);
    }
    if (blocked && !p.revealed) return this.aiPlayerReveal(p); // the group is heading somewhere that breaks its limit
    if (!took.length) return;
    p.msgs++;
    const text = `${list(took)} ${took.length > 1 ? 'work' : 'works'} for me.`;
    this.pushChat({ from: p.pcode, name: p.name, kind: 'chat', text });
    this.log(p.pcode, 'chat_message', { text, length: text.length, follow: true });
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
      if (act.every((h) => h.wantsEnd)) return this.enter('done');
    }
    this.broadcast();
  }

  onTick() {
    if (this.stage !== 'done') this.checkPresence();
    if (this.stage === 'chat' && !this.deal) {
      if (Date.now() - this.stageStartedAt > sec(CHAT_MAX)) { this.log('system', 'ended_by_backstop'); return this.enter('done'); }
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
    if (this.stage === 'chat') return this.enter('done');
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
    return this.panel().map((f) => ({ ...f, leaderName: f.leader ? optionName(this.task, f.id, f.leader) : null, count: f.leader ? f.options.find((o) => o.option === f.leader).who.length : 0,
      options: f.options.map((o) => ({ ...o, codes: o.who, who: this.names(o.who) })) }));
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
      chat: this.chat.slice(-12).map((m) => ({ ...m, to: m.to ? this.player(m.to)?.name : null })), pendingQuestions: this.pendingQuestions
    };
  }

  broadcast() {
    this.lastBroadcast = Date.now();
    for (const p of this.humans()) this.io.to(`k:${p.key}`).emit('game:state', this.viewFor(p.key));
    this.io.to(`host:${this.room.code}`).emit('host:table', this.hostView());
  }
}
