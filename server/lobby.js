import crypto from 'node:crypto';
import { q } from './db.js';
import { Table } from './game.js';
import { DEFAULT_TASK, MIXED, ORDER } from './tasks.js';

const SCALE = Number(process.env.TIME_SCALE || 1);
const FILL_AFTER = Number(process.env.FILL_AFTER_SECONDS || 60) * 1000; // Play now: AI fills empty seats after this wait
const GATHER = Number(process.env.GATHER_SECONDS || 10) * 1000;       // Play now: wait for a 4th or 5th player
const KEEP_TABLE = 30 * 60 * 1000;
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

// Split n waiting players into tables as close to the target size as possible, never fewer than 3 or more than 5.
export function partition(n, target = 5) {
  if (n <= 0) return [];
  if (n <= 5) return [n];
  target = Math.min(5, Math.max(3, Number(target) || 5));
  let k = Math.ceil(n / target);
  while (k > 1 && Math.floor(n / k) < 3) k--;
  const base = Math.floor(n / k), extra = n % k;
  return Array.from({ length: k }, (_, i) => base + (i < extra ? 1 : 0));
}
const shuffle = (arr) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

export class Lobby {
  constructor(io) {
    this.io = io;
    this.rooms = new Map();   // code -> room
    this.tables = new Map();  // table id -> Table
    this.playerTable = new Map(); // identity key -> table id
    this.rooms.set('QUICK', this.blankRoom('QUICK', 'quick', null, null));
    setInterval(() => this.checkQuick(), 1000);
  }

  blankRoom(code, kind, ownerKey, surveyUrl, task, aiMode, groupSize) {
    // order: the scenario sequence for 'mixed' rooms, shuffled once so every table gets a different one.
    return { code, kind, ownerKey, surveyUrl, task: task || DEFAULT_TASK, aiMode: aiMode || 'listen', groupSize: groupSize || 4, order: shuffle(ORDER),
      tablesMade: 0, waiting: new Map(), tableIds: [], gatherTimer: null };
  }

  async createRoom(kind, owner, surveyUrl, task, aiMode, groupSize) {
    let code;
    do { code = Array.from(crypto.randomBytes(5), (b) => ALPHABET[b % ALPHABET.length]).join(''); } while (this.rooms.has(code));
    const room = this.blankRoom(code, kind, owner.key, surveyUrl || null, task, aiMode, groupSize);
    this.rooms.set(code, room);
    await q('insert into rooms (code, owner_key, kind, survey_url, task, ai_mode, group_size) values ($1,$2,$3,$4,$5,$6,$7)', [code, owner.key, kind, surveyUrl || null, room.task, room.aiMode, room.groupSize]);
    return room;
  }

  async getRoom(code) {
    code = String(code || '').toUpperCase().trim();
    if (this.rooms.has(code)) return this.rooms.get(code);
    const r = await q('select code, owner_key, kind, survey_url, task, ai_mode, group_size from rooms where code=$1', [code]);
    if (!r.rows[0]) return null;
    const row = r.rows[0];
    const room = this.blankRoom(row.code, row.kind, row.owner_key, row.survey_url, row.task, row.ai_mode, row.group_size);
    this.rooms.set(room.code, room);
    return room;
  }

  activeTableFor(key) {
    const id = this.playerTable.get(key);
    const t = id && this.tables.get(id);
    return t && t.stage !== 'done' ? t : null;
  }

  async join(code, ident, socket) {
    const room = await this.getRoom(code);
    if (!room) return { error: 'No room with that code.' };
    socket.join(`room:${room.code}`);
    const active = this.activeTableFor(ident.key);
    if (active) { socket.emit('game:start', { sessionId: active.id }); return { ok: true }; }
    if (room.kind === 'class' && room.ownerKey === ident.key) { this.emitRoom(room); return { ok: true, host: true }; }
    const w = room.waiting.get(ident.key) || { ...ident, sockets: new Set(), joinedAt: Date.now() };
    w.sockets.add(socket.id); w.name = ident.name;
    room.waiting.set(ident.key, w);
    // A person can wait in only one room at a time.
    for (const other of this.rooms.values()) if (other !== room && other.waiting.delete(ident.key)) this.emitRoom(other);
    this.emitRoom(room);
    if (room.kind === 'quick') this.checkQuick();
    return { ok: true };
  }

  leave(code, key) {
    const room = this.rooms.get(String(code || '').toUpperCase());
    if (room?.waiting.delete(key)) this.emitRoom(room);
  }

  dropSocket(socketId) {
    for (const room of this.rooms.values()) {
      for (const [key, w] of room.waiting) {
        if (w.sockets.delete(socketId) && w.sockets.size === 0) { room.waiting.delete(key); this.emitRoom(room); }
      }
    }
  }

  roomState(room) {
    return {
      code: room.code, kind: room.kind, ownerKey: room.ownerKey, surveyUrl: room.surveyUrl, task: room.task, aiMode: room.aiMode, groupSize: room.groupSize,
      waiting: [...room.waiting.values()].map((w) => ({ name: w.name })),
      openSeats: room.tableIds.map((id) => this.tables.get(id)).filter((t) => t && t.canSeat()).length,
      tables: room.tableIds.map((id) => this.tables.get(id)).filter(Boolean).map((t) => ({ id: t.id, number: t.number, task: t.task.short, stage: t.stage, size: t.players.length, mode: t.mode }))
    };
  }
  emitRoom(room) { this.io.to(`room:${room.code}`).emit('room:state', this.roomState(room)); }

  async start(code, byKey) {
    const room = await this.getRoom(code);
    if (!room) return { error: 'No room with that code.' };
    if (room.ownerKey !== byKey) return { error: 'Only the person who created this room can start it.' };
    let waiting = [...room.waiting.values()];
    if (!waiting.length) return { error: 'Nobody is waiting yet.' };
    // One or two late arrivals: seat them at tables still in Set up (taking an AI seat or an empty one) before making a new table.
    if (waiting.length < 3) {
      for (const w of waiting) {
        const t = room.tableIds.map((id) => this.tables.get(id)).filter((x) => x && x.canSeat()).sort((a, b) => a.humans().length - b.humans().length)[0];
        if (!t || !room.waiting.has(w.key)) continue;
        room.waiting.delete(w.key); // removed first, so a second press of Start cannot seat the same person twice
        if (await t.addHuman(w)) {
          this.playerTable.set(w.key, t.id);
          this.io.to(`k:${w.key}`).emit('game:start', { sessionId: t.id });
        } else room.waiting.set(w.key, w);
      }
      waiting = [...room.waiting.values()];
      this.emitRoom(room);
      if (!waiting.length) return { ok: true, seated: true };
    }
    this.formTables(room, waiting);
    return { ok: true };
  }

  formTables(room, waiting) {
    const people = [...waiting].sort(() => Math.random() - 0.5);
    let i = 0;
    for (const size of partition(people.length, room.kind === 'class' ? room.groupSize : 5)) {
      const group = people.slice(i, i + size); i += size;
      group.forEach((w) => room.waiting.delete(w.key));
      const n = room.tablesMade, S = room.order.length;
      // 'mixed' gives each table the next scenario in the room's shuffled order, so no two tables share one until all are used.
      const taskId = room.task === MIXED ? room.order[n % S] : room.task;
      // "compare" alternates the listening AI and the answer-only AI across tables, for class tests.
      // When scenarios repeat (more tables than scenarios), the repeat gets the other AI mode.
      const flip = room.task === MIXED ? Math.floor(n / S) : 0;
      const mode = room.aiMode === 'compare' ? ((n + flip) % 2 === 0 ? 'listen' : 'ask') : room.aiMode;
      room.tablesMade++;
      const table = new Table({ io: this.io, room, humans: group, mode, taskId, number: n + 1, onDone: (t) => this.onDone(t) });
      this.tables.set(table.id, table);
      room.tableIds.push(table.id);
      group.forEach((w) => { this.playerTable.set(w.key, table.id); this.io.to(`k:${w.key}`).emit('game:start', { sessionId: table.id }); });
      table.start();
    }
    clearTimeout(room.gatherTimer); room.gatherTimer = null;
    this.emitRoom(room);
  }

  // Play now: start as soon as 3 people wait (after a short gather window),
  // or fill empty seats with labeled AI players once someone has waited long enough.
  checkQuick() {
    const room = this.rooms.get('QUICK');
    const waiting = [...room.waiting.values()];
    if (!waiting.length) return;
    if (waiting.length >= 5) return this.formTables(room, waiting.slice(0, 5));
    if (waiting.length >= 3 && !room.gatherTimer) {
      room.gatherTimer = setTimeout(() => { room.gatherTimer = null; const w = [...room.waiting.values()]; if (w.length) this.formTables(room, w.slice(0, 5)); }, GATHER);
      return;
    }
    const oldest = Math.min(...waiting.map((w) => w.joinedAt));
    if (waiting.length < 3 && Date.now() - oldest >= FILL_AFTER) this.formTables(room, waiting);
  }

  onDone(table) {
    setTimeout(() => {
      this.tables.delete(table.id);
      for (const [k, id] of this.playerTable) if (id === table.id) this.playerTable.delete(k);
      const room = this.rooms.get(table.room.code);
      if (room) room.tableIds = room.tableIds.filter((x) => x !== table.id);
    }, KEEP_TABLE);
    const room = this.rooms.get(table.room.code);
    if (room) this.emitRoom(room);
  }
}
