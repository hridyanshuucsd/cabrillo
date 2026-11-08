import crypto from 'node:crypto';
import { taskById, fieldName, optionName, planComplete } from './tasks.js';
import { applyMessage, buildPanel, findConflict } from './listener.js';
import { q, logEvent } from './db.js';
import { answerQuestion } from './ai.js';

const SCALE = Number(process.env.TIME_SCALE || 1); // tests run faster with a smaller TIME_SCALE
export const DURATIONS = { setup: 60, chat: 360, confirm: 120, wrap: 60 };
const NEXT = { setup: 'chat', chat: 'confirm', confirm: 'wrap', wrap: 'done' };
const STAGE_NAME = { setup: 'Set up', chat: 'Chat', confirm: 'Confirm', wrap: 'Wrap up' };
const AI_NAMES = ['Ari', 'Kai', 'Noa', 'Remy'];
const COLORS = ['#2a78d6', '#eb6834', '#8f5bd6', '#1baf7a', '#c2410c'];
// Booking demo: the AI can prepare a ride or a table, ask everyone to approve the price, and split it.
// Nothing is really booked or charged; prices are fixed estimates for the study.
const BOOK_RE = /\b(book|reserve|order|call|get|grab|schedule)\b.{0,30}\b(uber|lyft|ride|rideshare|cab|taxi|car|table|restaurant|reservation|spot|dinner|lunch)\b|\b(make|need|get) a reservation\b|\breserve a table\b/i;
const RIDE_RE = /\b(uber|lyft|ride|rideshare|cab|taxi|car)\b/i;
const FARE = { cove: 24, balboa: 16, oldtown: 18, torrey: 28, shores: 22, clubroom: 12, apartment: 14 };
const PLACE = { cove: 'a cafe near La Jolla Cove', balboa: 'a cafe in Balboa Park', oldtown: 'a taco restaurant in Old Town', torrey: 'a cafe near Torrey Pines', shores: 'a grill near La Jolla Shores', clubroom: 'a pizza place near campus', apartment: 'a pizza place nearby' };
const MEAL = { low: 13, mid: 24, high: 38, free: 10, under50: 10, over50: 18 };
const MAX_INTERJECTIONS = 2; // public, unprompted AI messages per chat stage
const sec = (s) => s * SCALE * 1000;
const rand = (a, b) => a + Math.random() * (b - a);
const shuffle = (arr) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const ASK_AI = /(^|\s)@ai\b/i;
const list = (names) => names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
export const firstPerson = (s) => s.replace(/told you/g, 'told me').replace(/\b[Yy]ou are\b/g, 'I am').replace(/\bYou\b/g, 'I').replace(/\byou\b/g, 'I').replace(/\bYour\b/g, 'My').replace(/\byour\b/g, 'my');

export class Table {
  constructor({ io, room, humans, onDone, mode, taskId, number }) {
    this.id = crypto.randomBytes(5).toString('hex');
    this.io = io; this.room = room; this.onDone = onDone;
    this.task = taskById(taskId || room.task);
    this.number = number || 1;
    this.mode = mode === 'ask' ? 'ask' : 'listen';
    this.t0 = Date.now();
    const seats = Math.min(5, Math.max(3, humans.length));
    const limits = shuffle(this.task.limits).slice(0, seats);
    this.players = humans.map((h, i) => ({
      key: h.key, name: h.name, userId: h.userId, isGuest: h.isGuest, isAI: false, pcode: `P0${i + 1}`, color: COLORS[i],
      limitId: limits[i].id, limitSharedAt: null, limitMentionedAt: null, ready: false, confirmReady: false, msgs: 0, nudged: false
    }));
    for (let i = humans.length, n = 0; i < seats; i++, n++) {
      this.players.push({ key: `ai${n + 1}`, name: `${AI_NAMES[n]} (AI)`, isAI: true, pcode: `A0${n + 1}`, color: '#52514e',
        limitId: limits[i].id, limitSharedAt: null, limitMentionedAt: null, msgs: 0, revealed: false });
    }
    this.prefs = {}; this.plan = {}; this.accepts = {};
    this.chat = []; this.seq = 0;
    this.stage = 'lobby'; this.stageEndsAt = null;
    this.aiPaused = false;   // host runs the AI by hand (Wizard of Oz)
    this.pausedBy = null;    // a player paused the listening AI
    this.deal = null; this.outcome = null;
    this.timers = []; this.tick = null;
    this.interjections = 0; this.lastInterjectAt = 0; this.didLimitsCheck = false; this.didConsensus = false;
    this.asked = new Set(); this.pendingQuestions = [];
    this.bookings = [];
    this.lastBroadcast = 0;
  }

  // A late arrival takes an AI player's seat, or an empty seat, while the table is still in Set up.
  canSeat() { return this.stage === 'setup' && (this.players.some((p) => p.isAI) || this.players.length < 5); }
  async addHuman(h) {
    if (!this.canSeat() || this.player(h.key)) return false;
    const n = this.humans().length + 1;
    const pcode = `P0${n}`;
    const ai = this.players.find((p) => p.isAI);
    let limitId;
    if (ai) { limitId = ai.limitId; this.players = this.players.filter((p) => p !== ai); }
    else { const used = new Set(this.players.map((p) => p.limitId)); limitId = this.task.limits.find((l) => !used.has(l.id)).id; }
    const p = { key: h.key, name: h.name, userId: h.userId, isGuest: h.isGuest, isAI: false, pcode, color: COLORS[(n - 1) % COLORS.length],
      limitId, limitSharedAt: null, limitMentionedAt: null, ready: false, confirmReady: false, msgs: 0, nudged: false };
    this.players.splice(this.humans().length, 0, p);
    try {
      if (ai) await q('delete from session_players where session_id=$1 and pcode=$2', [this.id, ai.pcode]);
      await q('insert into session_players (session_id, pcode, user_id, display_name, role_id, is_ai, is_guest) values ($1,$2,$3,$4,$5,$6,$7)', [this.id, pcode, h.userId || null, h.name, limitId, false, !!h.isGuest]);
    } catch (e) { console.error('late seat insert failed', e.message); }
    this.log('system', 'player_joined_late', { pcode, replaced_ai: ai ? ai.pcode : null, limit: limitId });
    this.sys(`${h.name} joined the table.`, 'join_notice');
    return true;
  }

  get t() { return Date.now() - this.t0; }
  log(actor, type, payload, actorType) {
    if (payload && typeof payload.text === 'string') payload = { ...payload, text: this.anonymize(payload.text) };
    if (payload && typeof payload.question === 'string') payload = { ...payload, question: this.anonymize(payload.question) };
    const type_ = actorType || (actor === 'AI' ? 'ai' : actor === 'system' ? 'system' : /^A0/.test(actor) ? 'ai_player' : 'human');
    logEvent(this.id, this.t, actor, type_, type, payload);
  }
  // Research logs use player codes, so display names typed into messages are replaced.
  anonymize(text) {
    let out = text;
    for (const p of [...this.players].sort((a, b) => b.name.length - a.name.length)) {
      if (p.isAI || p.name.length < 2) continue;
      const esc = p.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      out = out.replace(new RegExp(`\\b${esc}\\b`, 'gi'), p.pcode);
    }
    return out;
  }
  humans() { return this.players.filter((p) => !p.isAI); }
  player(key) { return this.players.find((p) => p.key === key); }
  byCode(pcode) { return this.players.find((p) => p.pcode === pcode); }
  limitOf(p) { return this.task.limits.find((l) => l.id === p.limitId); }
  listening() { return this.mode === 'listen' && !this.aiPaused && !this.pausedBy; }
  panel() { return buildPanel(this.task, this.prefs, this.players); }

  async start() {
    try {
      await q('insert into sessions (id, room_code, kind, scenario) values ($1,$2,$3,$4)', [this.id, this.room.code, this.room.kind, `${this.task.id}:${this.mode}`]);
      for (const p of this.players) {
        await q('insert into session_players (session_id, pcode, user_id, display_name, role_id, is_ai, is_guest) values ($1,$2,$3,$4,$5,$6,$7)',
          [this.id, p.pcode, p.userId || null, p.name, p.limitId, p.isAI, !!p.isGuest]);
      }
    } catch (e) { console.error('session insert failed', e.message); }
    this.log('system', 'session_started', { room: this.room.code, kind: this.room.kind, table: this.number, task: this.task.id, ai_mode: this.mode, seats: this.players.map((p) => ({ pcode: p.pcode, limit: p.limitId, ai: p.isAI })) });
    this.tick = setInterval(() => this.onTick(), 1000);
    this.enter('setup');
  }

  clearStageTimers() { this.timers.forEach(clearTimeout); this.timers = []; }
  later(seconds, fn) { this.timers.push(setTimeout(fn, sec(seconds))); }

  enter(stage) {
    if (this.stage === 'done') return;
    this.clearStageTimers();
    this.stage = stage;
    if (stage === 'done') { this.stageEndsAt = null; this.finish(); this.broadcast(); return; }
    const length = DURATIONS[stage];
    this.stageStartedAt = Date.now();
    this.stageEndsAt = Date.now() + sec(length);
    this.later(length, () => this.enter(NEXT[stage]));
    if (stage !== 'wrap') this.later(length - 30, () => this.sys(`30 seconds left in ${STAGE_NAME[stage]}.`, 'time_warning', { stage }));
    this.log('system', 'stage_started', { stage });

    if (stage === 'setup') {
      this.aiSay(this.mode === 'listen'
        ? 'Hi, I am the AI for this table. I read the chat, keep the Plan so far up to date, and ask a question now and then. I cannot see your private limits and I never vote. Anyone can pause me.'
        : 'Hi, I am the AI for this table. I only answer when someone asks me, with @AI or the Ask button. I cannot see your private limits and I never vote.', 'ai_intro', null, true);
    }
    if (stage === 'chat') {
      this.sys(`Chat: 6 minutes. ${this.task.prompt} Decide: ${this.task.fields.map((f) => f.name.toLowerCase()).join(', ')}. Tap "Ready to confirm" when you think you agree.`, 'stage_intro', { stage });
      this.scheduleAiPlayers();
    }
    if (stage === 'confirm') {
      if (this.mode === 'listen') {
        for (const f of this.panel()) if (f.leader) this.plan[f.id] = f.leader;
        const filled = this.task.fields.filter((f) => this.plan[f.id]);
        this.aiSay(filled.length
          ? `Here is a draft from your chat: ${filled.map((f) => `${f.name}: ${optionName(this.task, f.id, this.plan[f.id])}`).join('; ')}. Change anything that is wrong, then accept.`
          : 'I could not find a clear choice in the chat yet, so the plan starts empty. Fill in each part, then accept.', 'draft_plan', { plan: this.plan }, true);
      }
      this.sys('Confirm: 2 minutes. Check every part of the plan and tap Accept. It locks when every person accepts a complete plan. Any change clears all accepts.', 'stage_intro', { stage });
    }
    if (stage === 'wrap') this.wrapUp();
    this.broadcast();
  }

  wrapUp() {
    const plan = this.deal ? this.deal.plan : this.plan;
    const cut = this.deal ? this.deal.t : Infinity;
    const surfaced = this.players.filter((p) => { const t = Math.min(p.limitSharedAt ?? Infinity, p.limitMentionedAt ?? Infinity); return t <= cut; }).length;
    const complete = planComplete(this.task, plan);
    const respected = complete ? this.players.filter((p) => !this.limitOf(p).violates(plan)).length : 0;
    this.outcome = { deal: !!this.deal, surfaced, respected, complete, of: this.players.length, mode: this.mode, interjections: this.interjections };
    this.log('system', 'session_outcome', { ...this.outcome, plan });
    const n = this.players.length;
    this.sys(this.deal
      ? `Plan locked. ${surfaced} of ${n} private limits came up before the deal, and the plan works for ${respected} of ${n} people.`
      : `Time is up without a locked plan. ${surfaced} of ${n} private limits came up in the chat.`, 'wrap_summary');
  }

  async finish() {
    clearInterval(this.tick); this.clearStageTimers();
    this.log('system', 'session_ended', { outcome: this.deal ? 'deal' : 'no_deal' });
    try {
      await q('update sessions set ended_at=now(), outcome=$2, final_plan=$3 where id=$1', [this.id, this.deal ? 'deal' : 'no_deal', JSON.stringify({ plan: this.deal ? this.deal.plan : this.plan, ...this.outcome })]);
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
  // to: a player key for a private message that only that person sees.
  aiSay(text, type, payload, force, to) {
    if (this.stage === 'done') return false;
    if (this.aiPaused && !force) return false;
    this.pushChat({ from: 'AI', name: 'AI', kind: to ? 'private' : 'ai', text, to: to || null });
    this.log('AI', type, { text, ...(payload || {}), ...(to ? { to: this.player(to)?.pcode } : {}) });
    this.broadcast();
    return true;
  }

  // ---------- player actions ----------
  ready(key) {
    const p = this.player(key); if (!p || p.isAI || this.stage !== 'setup' || p.ready) return;
    p.ready = true; this.log(p.pcode, 'ready_clicked');
    if (this.humans().every((h) => h.ready)) { this.log('system', 'stage_ended_early', { stage: 'setup' }); this.enter('chat'); return; }
    this.broadcast();
  }

  confirmReady(key) {
    const p = this.player(key); if (!p || p.isAI || this.stage !== 'chat' || p.confirmReady) return;
    p.confirmReady = true; this.log(p.pcode, 'ready_to_confirm');
    if (this.humans().every((h) => h.confirmReady)) { this.log('system', 'stage_ended_early', { stage: 'chat' }); this.enter('confirm'); return; }
    this.broadcast();
  }

  shareLimit(key) {
    const p = this.player(key);
    if (!p || p.limitSharedAt !== null || !['setup', 'chat', 'confirm'].includes(this.stage)) return;
    p.limitSharedAt = this.t; p.msgs++;
    this.pushChat({ from: p.pcode, name: p.name, kind: 'limit', text: firstPerson(this.limitOf(p).text) });
    this.log(p.pcode, 'limit_shared', { limit: p.limitId, stage: this.stage });
    this.broadcast();
  }

  say(key, text) {
    const p = this.player(key); text = String(text || '').trim().slice(0, 300);
    if (!p || !text || this.stage === 'done') return;
    if (ASK_AI.test(text)) return this.ask(key, text);
    p.msgs++; p.lastMsgAt = Date.now();
    this.pushChat({ from: p.pcode, name: p.name, kind: 'chat', text });
    this.log(p.pcode, 'chat_message', { text, stage: this.stage, length: text.length });
    this.read(p, text);
    if (this.mode === 'listen' && this.listening() && BOOK_RE.test(text)) this.proposeBooking(p, text);
    this.broadcast();
  }

  // What the listening AI takes from a message. Limit mentions are logged in both modes for analysis.
  read(p, text) {
    const lim = this.limitOf(p);
    if (p.limitMentionedAt === null && lim.re.test(text)) { p.limitMentionedAt = this.t; this.log(p.pcode, 'limit_mentioned', { limit: p.limitId, stage: this.stage }); }
    if (this.stage !== 'chat' && this.stage !== 'setup') return;
    if (this.mode === 'listen' && this.pausedBy) return; // paused: the AI does not read new messages
    const changes = applyMessage(this.task, this.prefs, p.pcode, text);
    // Parsed in both modes so the two conditions can be compared; only the listening AI shows it to players.
    if (changes.length) this.log(this.mode === 'listen' ? 'AI' : 'system', this.mode === 'listen' ? 'panel_update' : 'chat_parsed', { from: p.pcode, changes: changes.map((c) => ({ field: c.field, option: c.option, kind: c.kind })) });
  }

  async ask(key, text) {
    const p = this.player(key); text = String(text || '').replace(ASK_AI, ' ').trim().slice(0, 300);
    if (!p || !text || this.stage === 'done' || this.stage === 'wrap') return;
    p.msgs++;
    this.pushChat({ from: p.pcode, name: p.name, kind: 'question', text });
    this.log(p.pcode, 'question_asked', { text, stage: this.stage });
    this.read(p, text);
    if (BOOK_RE.test(text) && !this.aiPaused) { this.broadcast(); return this.proposeBooking(p, text); }
    if (this.aiPaused) { this.pendingQuestions.push({ pcode: p.pcode, name: p.name, text }); this.broadcast(); return; }
    this.broadcast();
    const recent = this.chat.filter((m) => !m.to && ['chat', 'question', 'limit'].includes(m.kind)).slice(-12).map((m) => `${this.byCode(m.from)?.pcode || m.from}: ${this.anonymize(m.text)}`).join('\n');
    const a = await answerQuestion(text, { task: this.task, stage: this.stage, secondsLeft: this.secondsLeft(), summary: this.summaryText(), recent });
    this.aiSay(a.text, 'ai_answer', { source: a.source, question: text, to_player: p.pcode });
  }

  pauseAI(key, paused) {
    const p = this.player(key); if (!p || p.isAI || this.mode !== 'listen' || this.stage === 'done') return;
    paused = !!paused;
    if (paused === !!this.pausedBy) return;
    this.pausedBy = paused ? p.pcode : null;
    this.log(p.pcode, 'ai_paused_by_player', { paused });
    this.sys(paused ? `${p.name} paused the AI. It will not read or post until someone resumes it.` : `${p.name} resumed the AI.`, 'ai_pause_notice', { paused });
  }

  setField(key, field, option) {
    const p = this.player(key);
    if (!p || p.isAI || this.stage !== 'confirm' || this.deal) return;
    const f = this.task.fields.find((x) => x.id === field);
    if (!f || !f.options.some((x) => x.id === option) || this.plan[field] === option) return;
    const from = this.plan[field] || null;
    this.plan = { ...this.plan, [field]: option };
    const had = Object.values(this.accepts).some(Boolean);
    this.accepts = {};
    this.log(p.pcode, 'plan_edit', { field, from, to: option, plan: this.plan });
    if (had) this.log('system', 'accepts_reset');
    this.broadcast();
  }

  accept(key, value) {
    const p = this.player(key);
    if (!p || p.isAI || this.stage !== 'confirm' || this.deal) return;
    this.accepts[key] = !!value;
    this.log(p.pcode, 'vote', { value: !!value, plan: this.plan, limit_ok: planComplete(this.task, this.plan) ? !this.limitOf(p).violates(this.plan) : null });
    if (this.humans().every((h) => this.accepts[h.key])) {
      if (planComplete(this.task, this.plan)) return this.lockDeal();
      this.sys(`Everyone accepted, but the plan is missing: ${this.task.fields.filter((f) => !this.plan[f.id]).map((f) => f.name).join(', ')}.`, 'incomplete_plan');
    }
    this.broadcast();
  }

  lockDeal() {
    this.deal = { plan: { ...this.plan }, t: this.t };
    this.log('system', 'deal_locked', { plan: this.plan, accepted_by: this.humans().map((h) => h.pcode) });
    this.sys(`Plan locked: ${this.task.fields.map((f) => optionName(this.task, f.id, this.plan[f.id])).join(', ')}.`, 'deal_summary');
    this.clearStageTimers();
    this.timers.push(setTimeout(() => this.enter('wrap'), 2500));
    this.broadcast();
  }

  // ---------- booking demo (future agent actions) ----------
  opt(field, id) { return this.task.fields.find((f) => f.id === field)?.options.find((x) => x.id === id); }
  choice(field) {
    const plan = this.deal ? this.deal.plan : this.plan;
    if (plan[field]) return plan[field];
    return this.panel().find((f) => f.id === field)?.leader || null;
  }
  proposeBooking(p, text) {
    if (!['setup', 'chat', 'confirm'].includes(this.stage)) return;
    const kind = RIDE_RE.test(text) ? 'ride' : 'table';
    if (this.bookings.some((b) => b.kind === kind && b.status !== 'declined')) {
      this.aiSay(`There is already a ${kind === 'ride' ? 'ride' : 'table'} request above. Approve or decline that one first.`, 'booking_duplicate', { kind }, true);
      return;
    }
    const hasWhere = this.task.fields.some((f) => f.id === 'where');
    if (!hasWhere) {
      this.aiSay('In this demo I can book rides and restaurant tables for outings and socials, not for this task.', 'booking_unavailable', { kind }, true);
      return;
    }
    const where = this.choice('where'), when = this.choice('when'), budget = this.choice('budget');
    const n = this.players.length;
    const placeName = where ? optionName(this.task, 'where', where) : 'the place you pick';
    const whenName = when ? optionName(this.task, 'when', when) : 'the time you pick';
    let title, details, total;
    if (kind === 'ride') {
      const cars = Math.ceil(n / 4), fare = this.opt('where', where)?.fare || FARE[where] || 20;
      total = fare * cars;
      title = `${cars > 1 ? `${cars} rides` : 'A ride'} to ${placeName}`;
      details = [`${whenName}, pickup at UC San Diego`, `${n} people, ${cars} car${cars > 1 ? 's' : ''}`, `Estimated fare: $${total} total`];
    } else {
      const per = this.opt('budget', budget)?.per || MEAL[budget] || 20;
      total = per * n;
      title = `Table for ${n} at ${this.opt('where', where)?.place || PLACE[where] || 'a restaurant nearby'}`;
      details = [whenName, `About $${per} per person${budget ? `, within your ${optionName(this.task, 'budget', budget)} budget` : ''}`, `Estimated total: $${total}`];
    }
    const perPerson = Math.round((total / n) * 100) / 100;
    // The AI cannot see private cards, but it respects limits people chose to share.
    const over = this.players.filter((x) => x.limitSharedAt !== null && this.limitOf(x).maxPerPerson && perPerson > this.limitOf(x).maxPerPerson);
    if (over.length) details.push(`Heads up: ${list(over.map((x) => `${x.name} ($${this.limitOf(x).maxPerPerson})`))} shared a spending limit, and this is above it.`);
    const b = { id: `b${this.bookings.length + 1}`, kind, title, details, total, perPerson, n, votes: {}, status: 'pending', code: null, by: p.pcode };
    this.bookings.push(b);
    this.pushChat({ from: 'AI', name: 'AI', kind: 'booking', bookingId: b.id, text: `${p.name} asked me to book. ${title}. Split ${n} ways: $${perPerson.toFixed(2)} each. Is the price right for everyone?` });
    this.log('AI', 'booking_proposed', { id: b.id, kind, total, per_person: perPerson, requested_by: p.pcode, where, when });
    this.broadcast();
  }
  bookingVote(key, id, value) {
    const p = this.player(key); const b = this.bookings.find((x) => x.id === id);
    if (!p || p.isAI || !b || b.status !== 'pending' || this.stage === 'done') return;
    b.votes[p.pcode] = !!value;
    this.log(p.pcode, 'booking_vote', { id, value: !!value });
    if (!value) {
      b.status = 'declined';
      this.aiSay(`Not booked: ${p.name} said the price does not work. I will not book anything until everyone agrees. Want a cheaper option?`, 'booking_declined', { id }, true);
      return;
    }
    if (this.humans().every((h) => b.votes[h.pcode])) {
      b.status = 'booked'; b.code = `DEMO-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
      this.aiSay(`Booked (demo, nothing was charged): ${b.title}. Confirmation ${b.code}. I sent each person a payment request for $${b.perPerson.toFixed(2)}.`, 'booking_done', { id, code: b.code }, true);
      return;
    }
    this.broadcast();
  }

  // ---------- the listening AI ----------
  summaryText() {
    const parts = this.panel().map((f) => {
      if (f.status === 'open') return `${f.name}: not discussed yet`;
      if (f.status === 'agreed') return `${f.name}: ${optionName(this.task, f.id, f.leader)} (most agree)`;
      return `${f.name}: ${f.options.map((o) => `${o.name} (${o.who.length})`).join(' or ')}`;
    });
    return parts.join('; ') + '.';
  }
  names(pcodes) { return pcodes.map((c) => this.byCode(c)?.name || c); }

  interject(text, type, payload) {
    if (this.aiSay(text, type, payload)) { this.interjections++; this.lastInterjectAt = Date.now(); }
  }

  listen() {
    const now = Date.now(), elapsed = now - this.stageStartedAt;
    // Quiet people get a private invitation, never a public call-out.
    if (elapsed > sec(120) && this.humans().length > 1) {
      for (const h of this.humans()) {
        if (h.nudged || h.msgs > 0) continue;
        h.nudged = true;
        this.aiSay('You have not said much yet. If you have a preference or a limit, the group would want to know. No pressure.', 'ai_nudge_private', null, false, h.key);
      }
    }
    if (this.interjections >= MAX_INTERJECTIONS || elapsed < sec(45) || now - this.lastInterjectAt < sec(60)) return;
    const panel = this.panel();
    const anyLimit = this.players.some((p) => p.limitSharedAt !== null || p.limitMentionedAt !== null);
    if (!this.didLimitsCheck && !anyLimit && (panel.some((f) => f.status === 'agreed' || f.status === 'leaning') || elapsed > sec(120))) {
      this.didLimitsCheck = true;
      this.interject('Before anything is settled: does anyone have a day, budget, or travel limit the group should know about?', 'limits_check');
      this.aiPlayersRespondToLimits();
      return;
    }
    const c = findConflict(panel.filter((f) => !this.asked.has(`conflict:${f.id}`)));
    if (c) {
      this.asked.add(`conflict:${c.field.id}`);
      const a = this.names(c.a.who), b = this.names(c.b.who);
      this.interject(`For ${c.field.name.toLowerCase()}, ${list(a)} ${a.length > 1 ? 'prefer' : 'prefers'} ${c.a.name}, and ${list(b)} ${b.length > 1 ? 'prefer' : 'prefers'} ${c.b.name}. What would make one of these work for everyone?`, 'conflict', { field: c.field.id, a: c.a.option, b: c.b.option });
      return;
    }
    const open = panel.find((f) => f.status === 'open' && !this.asked.has(`open:${f.id}`));
    if (open && elapsed > sec(150)) {
      this.asked.add(`open:${open.id}`);
      this.interject(`Nobody has talked about ${open.name.toLowerCase()} yet. What does the group think?`, 'open_question', { field: open.id });
      return;
    }
    if (!this.didConsensus && panel.every((f) => f.status === 'agreed')) {
      this.didConsensus = true;
      this.interject(`It sounds like most of you agree: ${panel.map((f) => optionName(this.task, f.id, f.leader)).join(', ')}. If that is right, tap "Ready to confirm".`, 'consensus_check');
    }
  }

  // ---------- AI players (fill empty seats in Play now) ----------
  scheduleAiPlayers() {
    this.players.filter((p) => p.isAI).forEach((p, i) => {
      const prefs = Object.entries(this.limitOf(p).aiPrefs);
      const [f1, o1] = prefs[0];
      this.later(rand(10, 25) + i * 8, () => this.stage === 'chat' && this.say(p.key, `I would like ${optionName(this.task, f1, o1)} for ${fieldName(this.task, f1).toLowerCase()}.`));
      if (prefs[1]) { const [f2, o2] = prefs[1]; this.later(rand(70, 110) + i * 10, () => this.stage === 'chat' && this.say(p.key, `${optionName(this.task, f2, o2)} works best for me.`)); }
      if (Math.random() < 0.4) this.later(rand(150, 240), () => this.aiPlayerReveal(p));
    });
  }
  aiPlayersRespondToLimits() {
    this.players.filter((p) => p.isAI).forEach((p, i) => { if (Math.random() < 0.85) this.later(4 + i * 5, () => this.aiPlayerReveal(p)); });
  }
  aiPlayerReveal(p) {
    if (p.revealed || this.stage !== 'chat') return;
    p.revealed = true;
    this.say(p.key, this.limitOf(p).say);
  }

  onTick() {
    if (this.stage === 'chat' && this.mode === 'listen' && this.listening()) this.listen();
    // Every change already broadcasts; this slower refresh only keeps quiet-member lists and counts current.
    if ((this.stage === 'chat' || this.stage === 'confirm') && Date.now() - this.lastBroadcast > 5000) this.broadcast();
  }

  // ---------- host controls (Wizard of Oz) ----------
  hostAdvance() {
    if (this.stage === 'done') return;
    this.log('host', 'host_advanced', { from: this.stage }, 'host');
    this.enter(NEXT[this.stage] || 'done');
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
  secondsLeft() { return this.stageEndsAt ? Math.max(0, Math.round((this.stageEndsAt - Date.now()) / 1000)) : 0; }
  panelView() {
    return this.panel().map((f) => ({ ...f, leaderName: f.leader ? optionName(this.task, f.id, f.leader) : null, options: f.options.map((o) => ({ ...o, who: this.names(o.who) })) }));
  }

  viewFor(key) {
    const me = this.player(key);
    const open = this.stage === 'wrap' || this.stage === 'done';
    const final = this.deal ? this.deal.plan : this.plan;
    return {
      id: this.id, number: this.number, stage: this.stage, stageEndsAt: this.stageEndsAt, serverNow: Date.now(), mode: this.mode,
      durations: Object.fromEntries(Object.entries(DURATIONS).map(([k, v]) => [k, v * SCALE])),
      task: { id: this.task.id, title: this.task.title, short: this.task.short, prompt: this.task.prompt, fields: this.task.fields.map((f) => ({ id: f.id, name: f.name, options: f.options.map((x) => ({ id: x.id, name: x.name })) })) },
      me: me ? {
        pcode: me.pcode, name: me.name, ready: me.ready, confirmReady: me.confirmReady, accepted: !!this.accepts[key],
        limit: { text: this.limitOf(me).text, sharedAt: me.limitSharedAt, mentionedAt: me.limitMentionedAt, ok: planComplete(this.task, final) ? !this.limitOf(me).violates(final) : null }
      } : null,
      players: this.players.map((p) => {
        const mine = p.key === key;
        return {
          pcode: p.pcode, name: p.name, isAI: p.isAI, isYou: mine, color: p.color, initial: p.isAI ? 'AI' : p.name.slice(0, 1).toUpperCase(),
          ready: !!p.ready, confirmReady: !!p.confirmReady, accepted: !!this.accepts[p.key], msgs: p.msgs,
          limitSharedAt: p.limitSharedAt, limitMentionedAt: mine || open ? p.limitMentionedAt : null,
          limit: mine || open || p.limitSharedAt !== null ? this.limitOf(p).text : null,
          limitOk: open && planComplete(this.task, final) ? !this.limitOf(p).violates(final) : null
        };
      }),
      panel: this.mode === 'listen' ? this.panelView() : null,
      quiet: this.mode === 'listen' && this.stage === 'chat' ? this.humans().filter((h) => h.msgs === 0).map((h) => h.name) : [],
      plan: this.plan, complete: planComplete(this.task, this.plan), deal: this.deal, outcome: this.outcome,
      chat: this.chat.filter((m) => !m.to || m.to === key).slice(-80).map(({ to, ...m }) => m),
      aiPaused: this.aiPaused, pausedBy: this.pausedBy ? this.byCode(this.pausedBy)?.name : null,
      bookings: this.bookings.map((b) => ({ id: b.id, kind: b.kind, title: b.title, details: b.details, total: b.total, perPerson: b.perPerson, n: b.n, status: b.status, code: b.code,
        mine: me ? (b.votes[me.pcode] ?? null) : null,
        approved: this.humans().filter((h) => b.votes[h.pcode]).map((h) => h.name), waiting: this.humans().filter((h) => b.votes[h.pcode] === undefined).map((h) => h.name) })),
      surveyUrl: this.room.surveyUrl || null, roomCode: this.room.code, kind: this.room.kind
    };
  }

  hostView() {
    return {
      id: this.id, number: this.number, stage: this.stage, stageEndsAt: this.stageEndsAt, serverNow: Date.now(), secondsLeft: this.secondsLeft(),
      mode: this.mode, task: this.task.short, taskTitle: this.task.title, summary: this.summaryText(), plan: this.plan, deal: this.deal, outcome: this.outcome,
      aiPaused: this.aiPaused, pausedBy: this.pausedBy, interjections: this.interjections,
      players: this.players.map((p) => ({ pcode: p.pcode, name: p.name, isAI: p.isAI, msgs: p.msgs, accepted: !!this.accepts[p.key], limitUp: p.limitSharedAt !== null || p.limitMentionedAt !== null })),
      chat: this.chat.slice(-12).map((m) => ({ ...m, to: m.to ? this.player(m.to)?.name : null })), pendingQuestions: this.pendingQuestions
    };
  }

  broadcast() {
    this.lastBroadcast = Date.now();
    for (const p of this.humans()) this.io.to(`k:${p.key}`).emit('game:state', this.viewFor(p.key));
    this.io.to(`host:${this.room.code}`).emit('host:table', this.hostView());
  }
}
