import crypto from 'node:crypto';
import { SCENARIO, roleById, useName, totalOf, ruleOk, ruleBreaks } from './scenario.js';
import { q, logEvent } from './db.js';
import { answerQuestion } from './ai.js';

const SCALE = Number(process.env.TIME_SCALE || 1); // tests run faster with TIME_SCALE=0.1
export const DURATIONS = { brief: 60, explore: 180, negotiate: 300, reveal: 60 };
const NEXT = { brief: 'explore', explore: 'negotiate', negotiate: 'reveal', reveal: 'done' };
const STAGE_NAME = { brief: 'Brief', explore: 'Explore', negotiate: 'Negotiate', reveal: 'Reveal' };
const sec = (s) => s * SCALE * 1000;
const rand = (a, b) => a + Math.random() * (b - a);
const shuffle = (arr) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

export class Table {
  constructor({ io, room, humans, onDone }) {
    this.id = crypto.randomBytes(5).toString('hex');
    this.io = io; this.room = room; this.onDone = onDone;
    this.t0 = Date.now();
    const seats = Math.min(5, Math.max(3, humans.length));
    const roles = shuffle(SCENARIO.roles.slice(0, seats).map((r) => r.id));
    this.players = humans.map((h, i) => ({
      key: h.key, name: h.name, userId: h.userId, isGuest: h.isGuest, isAI: false,
      roleId: roles[i], pcode: `P0${i + 1}`, sharedAt: null, ready: false, lastActive: Date.now(), prompted: false
    }));
    for (let i = humans.length, n = 1; i < seats; i++, n++) {
      const role = roleById(roles[i]);
      this.players.push({ key: `ai${n}`, name: `AI ${role.name}`, isAI: true, roleId: roles[i], pcode: `AI0${n + 1}`, sharedAt: null, nextMoveAt: 0, saidOk: false });
    }
    this.plan = { ...SCENARIO.start };
    this.accepts = {};
    this.chat = []; this.seq = 0;
    this.stage = 'lobby'; this.stageEndsAt = null;
    this.aiPaused = false; this.deal = null; this.outcome = null;
    this.timers = []; this.tick = null; this.lastRuleWarn = 0; this.lastInvalidNote = 0; this.prompts = 0;
    this.pendingQuestions = [];
  }

  get t() { return Date.now() - this.t0; }
  log(actor, type, payload, actorType) {
    if (payload && typeof payload.text === 'string') payload = { ...payload, text: this.anonymize(payload.text) };
    if (payload && typeof payload.question === 'string') payload = { ...payload, question: this.anonymize(payload.question) };
    logEvent(this.id, this.t, actor, actorType || (actor === 'AI' ? 'ai' : actor === 'system' ? 'system' : actor.startsWith('AI') ? 'ai' : 'human'), type, payload);
  }
  // Research logs use player codes, so display names typed into or generated in messages are replaced.
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
  role(p) { return roleById(p.roleId); }

  async start() {
    try {
      await q('insert into sessions (id, room_code, kind, scenario) values ($1,$2,$3,$4)', [this.id, this.room.code, this.room.kind, SCENARIO.id]);
      for (const p of this.players) {
        await q('insert into session_players (session_id, pcode, user_id, display_name, role_id, is_ai, is_guest) values ($1,$2,$3,$4,$5,$6,$7)',
          [this.id, p.pcode, p.userId || null, p.name, p.roleId, p.isAI, !!p.isGuest]);
      }
    } catch (e) { console.error('session insert failed', e.message); }
    this.log('system', 'session_started', { room: this.room.code, kind: this.room.kind, seats: this.players.map((p) => ({ pcode: p.pcode, role: p.roleId, ai: p.isAI })) });
    this.tick = setInterval(() => this.onTick(), 1000);
    this.enter('brief');
  }

  clearStageTimers() { this.timers.forEach(clearTimeout); this.timers = []; }

  enter(stage) {
    if (this.stage === 'done') return;
    this.clearStageTimers();
    this.stage = stage;
    if (stage === 'done') { this.stageEndsAt = null; this.finish(); this.broadcast(); return; }
    const length = sec(DURATIONS[stage]);
    this.stageStartedAt = Date.now();
    this.stageEndsAt = Date.now() + length;
    this.timers.push(setTimeout(() => this.enter(NEXT[stage]), length));
    if (stage !== 'reveal') this.timers.push(setTimeout(() => this.aiSay(`30 seconds left in ${STAGE_NAME[stage]}.`, 'time_warning', { stage }), length - sec(30)));
    this.log('system', 'stage_started', { stage });

    if (stage === 'brief') {
      const seats = this.players.map((p) => `${p.name} (${this.role(p).name}${p.isAI ? ', AI' : ''})`).join(', ');
      this.aiSay(`Welcome. I am the Administrator, an AI player. I keep time and the rules, and I cannot vote. At this table: ${seats}. Read your card: only you can see your goal and your private fact.`, 'room_greeting');
    }
    if (stage === 'explore') {
      this.aiSay('Explore: 3 minutes. Switch the map layers, ask me about the lot, and decide whether to share your private fact with the table.', 'stage_intro', { stage });
      for (const p of this.players.filter((x) => x.isAI)) {
        if (Math.random() < 0.7) this.timers.push(setTimeout(() => this.share(p.key), rand(0.2, 0.8) * length));
      }
    }
    if (stage === 'negotiate') {
      this.aiSay(`Negotiate: 5 minutes. Edit the shared plan with plus and minus. It must add up to 100%, and no single use may go above ${SCENARIO.maxUse}%. Tap Accept when the plan works for you. The deal locks when every human accepts.`, 'stage_intro', { stage });
      const now = Date.now();
      this.humans().forEach((p) => { p.lastActive = now; });
      this.players.filter((p) => p.isAI).forEach((p, i) => { p.nextMoveAt = now + sec(rand(25, 40) + i * 12); });
      this.warnRule(true);
    }
    if (stage === 'reveal') this.reveal();
    this.broadcast();
  }

  reveal() {
    const cut = this.deal ? this.deal.t : Infinity;
    const shared = this.players.filter((p) => p.sharedAt !== null && p.sharedAt <= cut).length;
    this.outcome = { deal: !!this.deal, sharedBeforeDeal: shared, of: this.players.length };
    this.log('system', 'cards_revealed', this.outcome);
    this.aiSay(this.deal
      ? `Deal reached. ${shared} of ${this.players.length} private facts were shared before the deal. Look at what everyone was holding.`
      : `Time is up without a deal. ${shared} of ${this.players.length} private facts were shared. Look at what everyone was holding.`, 'reveal_summary', null, true);
  }

  async finish() {
    clearInterval(this.tick); this.clearStageTimers();
    this.log('system', 'session_ended', { outcome: this.deal ? 'deal' : 'no_deal' });
    try {
      await q('update sessions set ended_at=now(), outcome=$2, final_plan=$3 where id=$1', [this.id, this.deal ? 'deal' : 'no_deal', JSON.stringify(this.plan)]);
    } catch (e) { console.error(e.message); }
    this.onDone?.(this);
  }

  pushChat(msg) {
    this.chat.push({ id: ++this.seq, t: this.t, ...msg });
    if (this.chat.length > 200) this.chat.shift();
  }

  aiSay(text, type, payload, force) {
    if (this.stage === 'done') return;
    if (this.aiPaused && !force) return; // Wizard of Oz mode: a teammate speaks for the AI
    this.pushChat({ from: 'AI', name: 'Administrator (AI)', kind: 'ai', text });
    this.log('AI', type, { text, ...(payload || {}) });
    this.broadcast();
  }

  // ---------- player actions ----------
  touch(p) { if (p && !p.isAI) p.lastActive = Date.now(); }

  ready(key) {
    const p = this.player(key); if (!p || this.stage !== 'brief' || p.ready) return;
    p.ready = true; this.log(p.pcode, 'ready_clicked');
    if (this.humans().every((h) => h.ready)) { this.log('system', 'stage_ended_early', { stage: 'brief' }); this.enter('explore'); return; }
    this.broadcast();
  }

  share(key) {
    const p = this.player(key);
    if (!p || p.sharedAt !== null || !['brief', 'explore', 'negotiate'].includes(this.stage)) return;
    p.sharedAt = this.t; this.touch(p);
    const r = this.role(p);
    this.pushChat({ from: p.pcode, name: p.name, kind: 'fact', text: r.fact, role: r.name });
    this.log(p.pcode, 'fact_shared', { fact_id: r.factId, stage: this.stage });
    this.broadcast();
  }

  say(key, text) {
    const p = this.player(key); text = String(text || '').trim().slice(0, 300);
    if (!p || !text || this.stage === 'done') return;
    this.touch(p);
    this.pushChat({ from: p.pcode, name: p.name, kind: 'chat', text });
    this.log(p.pcode, 'chat_message', { text, stage: this.stage });
    this.broadcast();
  }

  async ask(key, text) {
    const p = this.player(key); text = String(text || '').trim().slice(0, 300);
    if (!p || !text || !['brief', 'explore', 'negotiate'].includes(this.stage)) return;
    this.touch(p);
    this.pushChat({ from: p.pcode, name: p.name, kind: 'question', text });
    this.log(p.pcode, 'question_asked', { text, stage: this.stage });
    if (this.aiPaused) { this.pendingQuestions.push({ pcode: p.pcode, name: p.name, text }); this.broadcast(); return; }
    this.broadcast();
    const ctx = {
      stage: this.stage, plan: this.plan, secondsLeft: Math.max(0, Math.round((this.stageEndsAt - Date.now()) / 1000)),
      shared: this.players.filter((x) => x.sharedAt !== null).map((x) => ({ role: this.role(x).name, fact: this.role(x).fact }))
    };
    const a = await answerQuestion(text, ctx);
    this.aiSay(a.text, 'ai_answer', { source: a.source, question: text, to: p.pcode });
  }

  edit(key, use, delta) {
    const p = this.player(key);
    if (!p || this.stage !== 'negotiate' || this.deal) return false;
    if (!SCENARIO.uses.some((u) => u.id === use) || ![SCENARIO.step, -SCENARIO.step].includes(delta)) return false;
    const from = this.plan[use], to = from + delta;
    if (to < 0 || to > 100 || (delta > 0 && totalOf(this.plan) + delta > SCENARIO.total)) return false;
    this.plan = { ...this.plan, [use]: to };
    this.touch(p);
    const hadAccepts = Object.values(this.accepts).some(Boolean);
    this.accepts = {};
    this.log(p.pcode, 'proposal_edit', { use, from, to, total: totalOf(this.plan), plan: this.plan });
    if (hadAccepts) this.log('system', 'accepts_reset');
    this.warnRule(false);
    this.broadcast();
    return true;
  }

  accept(key, value) {
    const p = this.player(key);
    if (!p || p.isAI || this.stage !== 'negotiate' || this.deal) return;
    this.accepts[key] = !!value; this.touch(p);
    const r = this.role(p);
    this.log(p.pcode, 'vote', { value: !!value, goal_met: r.check(this.plan), plan: this.plan });
    const humans = this.humans();
    if (humans.every((h) => this.accepts[h.key])) {
      if (totalOf(this.plan) === SCENARIO.total && ruleOk(this.plan)) return this.lockDeal();
      if (Date.now() - this.lastInvalidNote > 5000) {
        this.lastInvalidNote = Date.now();
        const why = totalOf(this.plan) !== SCENARIO.total ? `the plan adds up to ${totalOf(this.plan)}%, not 100%` : `${ruleBreaks(this.plan).map((u) => u.name).join(' and ')} is above ${SCENARIO.maxUse}%`;
        this.aiSay(`Everyone accepted, but the deal cannot lock because ${why}.`, 'invalid_deal', { plan: this.plan });
      }
    }
    this.broadcast();
  }

  lockDeal() {
    this.deal = { plan: { ...this.plan }, t: this.t };
    this.log('system', 'deal_locked', { plan: this.plan, accepted_by: this.humans().map((h) => h.pcode) });
    this.aiSay(`Deal locked: ${SCENARIO.uses.map((u) => `${u.name} ${this.plan[u.id]}%`).join(', ')}. Revealing all cards.`, 'deal_summary', null, true);
    this.clearStageTimers();
    this.timers.push(setTimeout(() => this.enter('reveal'), 2500));
    this.broadcast();
  }

  warnRule(force) {
    const b = ruleBreaks(this.plan);
    if (!b.length || (!force && Date.now() - this.lastRuleWarn < sec(20))) return;
    this.lastRuleWarn = Date.now();
    this.aiSay(`Rule check: ${b.map((u) => `${u.name} is at ${this.plan[u.id]}%`).join(', ')}, above the ${SCENARIO.maxUse}% limit.`, 'rule_warning', { breaks: b.map((u) => u.id), plan: this.plan });
  }

  // ---------- AI players and quiet prompts ----------
  onTick() {
    if (this.stage !== 'negotiate' || this.deal) return;
    const now = Date.now();
    for (const p of this.players.filter((x) => x.isAI)) {
      if (now < p.nextMoveAt) continue;
      p.nextMoveAt = now + sec(rand(30, 45));
      const r = this.role(p);
      if (r.check(this.plan)) { if (!p.saidOk) { p.saidOk = true; this.say(p.key, 'This plan works for my role.'); } continue; }
      const target = r.target;
      if (totalOf(this.plan) >= SCENARIO.total) {
        const donor = SCENARIO.uses.filter((u) => u.id !== target && this.plan[u.id] >= SCENARIO.step)
          .sort((a, b) => this.plan[b.id] - this.plan[a.id])[0];
        if (!donor) continue;
        this.say(p.key, `${r.aiLine} I will move 10 from ${donor.name.toLowerCase()}.`);
        this.edit(p.key, donor.id, -SCENARIO.step);
      } else {
        this.say(p.key, r.aiLine);
      }
      this.edit(p.key, target, SCENARIO.step);
    }
    // Invite one quiet human in, at most twice per session.
    if (this.prompts < 2 && now - this.stageStartedAt > sec(90) && this.humans().length > 1) {
      const quiet = this.humans().find((h) => !h.prompted && now - h.lastActive > sec(100));
      if (quiet) {
        quiet.prompted = true; this.prompts++;
        this.aiSay(`${quiet.name}, we have not heard from you in a while. Is there anything you would like to add?`, 'quiet_prompt', { target: quiet.pcode });
      }
    }
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
    this.pushChat({ from: 'AI', name: 'Administrator (AI)', kind: 'ai', text });
    this.log('AI', 'ai_message_wizard', { text }, 'wizard');
    this.broadcast();
  }

  // ---------- views ----------
  secondsLeft() { return this.stageEndsAt ? Math.max(0, Math.round((this.stageEndsAt - Date.now()) / 1000)) : 0; }

  viewFor(key) {
    const me = this.player(key);
    const open = this.stage === 'reveal' || this.stage === 'done';
    return {
      id: this.id, stage: this.stage, stageEndsAt: this.stageEndsAt, serverNow: Date.now(),
      durations: Object.fromEntries(Object.entries(DURATIONS).map(([k, v]) => [k, v * SCALE])),
      scenario: { title: SCENARIO.title, place: SCENARIO.place, question: SCENARIO.question, uses: SCENARIO.uses, layers: SCENARIO.layers, maxUse: SCENARIO.maxUse, step: SCENARIO.step },
      plan: this.plan, total: totalOf(this.plan), ruleOk: ruleOk(this.plan), breaks: ruleBreaks(this.plan).map((u) => u.id),
      me: me ? {
        pcode: me.pcode, name: me.name, ready: me.ready, sharedAt: me.sharedAt, accepted: !!this.accepts[key],
        role: { id: me.roleId, ...pick(this.role(me), ['name', 'initial', 'color', 'goal', 'fact']), goalMet: this.role(me).check(this.plan) }
      } : null,
      players: this.players.map((p) => {
        const r = this.role(p), mine = p.key === key;
        return {
          pcode: p.pcode, name: p.name, isAI: p.isAI, isYou: mine, role: r.name, initial: r.initial, color: r.color,
          ready: !!p.ready, accepted: !!this.accepts[p.key], sharedAt: p.sharedAt,
          fact: mine || open || p.sharedAt !== null ? r.fact : null,
          goal: mine || open ? r.goal : null,
          goalMet: mine || open ? r.check(open && this.deal ? this.deal.plan : this.plan) : null
        };
      }),
      chat: this.chat.slice(-80), deal: this.deal, outcome: this.outcome,
      aiPaused: this.aiPaused, surveyUrl: this.room.surveyUrl || null, roomCode: this.room.code, kind: this.room.kind
    };
  }

  hostView() {
    return {
      id: this.id, stage: this.stage, stageEndsAt: this.stageEndsAt, serverNow: Date.now(), secondsLeft: this.secondsLeft(),
      plan: this.plan, total: totalOf(this.plan), ruleOk: ruleOk(this.plan), aiPaused: this.aiPaused, deal: this.deal, outcome: this.outcome,
      players: this.players.map((p) => ({ pcode: p.pcode, name: p.name, isAI: p.isAI, role: this.role(p).name, accepted: !!this.accepts[p.key], sharedAt: p.sharedAt, goalMet: this.role(p).check(this.plan) })),
      chat: this.chat.slice(-10), pendingQuestions: this.pendingQuestions
    };
  }

  broadcast() {
    for (const p of this.humans()) this.io.to(`k:${p.key}`).emit('game:state', this.viewFor(p.key));
    this.io.to(`host:${this.room.code}`).emit('host:table', this.hostView());
  }
}

function pick(o, keys) { return Object.fromEntries(keys.map((k) => [k, o[k]])); }
export { useName };
