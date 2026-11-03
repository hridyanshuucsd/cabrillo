import crypto from 'node:crypto';
import { q } from './db.js';
import { Table } from './game.js';

const SCALE = Number(process.env.TIME_SCALE || 1);
const FILL_AFTER = Number(process.env.FILL_AFTER_SECONDS || 60) * 1000; // Play now: AI fills empty seats after this wait
const GATHER = Number(process.env.GATHER_SECONDS || 10) * 1000;       // Play now: wait for a 4th or 5th player
const KEEP_TABLE = 30 * 60 * 1000;
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

// Split n waiting players into tables of 3 to 5 people.
export function partition(n) {
  if (n <= 0) return [];
  if (n <= 5) return [n];
  const k = Math.ceil(n / 5), base = Math.floor(n / k), extra = n % k;
  return Array.from({ length: k }, (_, i) => base + (i < extra ? 1 : 0));
}

export class Lobby {
  constructor(io) {
    this.io = io;
    this.rooms = new Map();   // code -> room
    this.tables = new Map();  // table id -> Table
    this.playerTable = new Map(); // identity key -> table id
    this.rooms.set('QUICK', this.blankRoom('QUICK', 'quick', null, null));
    setInterval(() => this.checkQuick(), 1000);
  }

  blankRoom(code, kind, ownerKey, surveyUrl) {
    return { code, kind, ownerKey, surveyUrl, waiting: new Map(), tableIds: [], gatherTimer: null };
  }

  async createRoom(kind, owner, surveyUrl) {
    let code;
    do { code = Array.from(crypto.randomBytes(5), (b) => ALPHABET[b % ALPHABET.length]).join(''); } while (this.rooms.has(code));
    const room = this.blankRoom(code, kind, owner.key, surveyUrl || null);
    this.rooms.set(code, room);
    await q('insert into rooms (code, owner_key, kind, survey_url) values ($1,$2,$3,$4)', [code, owner.key, kind, surveyUrl || null]);
    return room;
  }

  async getRoom(code) {
    code = String(code || '').toUpperCase().trim();
    if (this.rooms.has(code)) return this.rooms.get(code);
    const r = await q('select code, owner_key, kind, survey_url from rooms where code=$1', [code]);
    if (!r.rows[0]) return null;
    const room = this.blankRoom(r.rows[0].code, r.rows[0].kind, r.rows[0].owner_key, r.rows[0].survey_url);
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
      code: room.code, kind: room.kind, ownerKey: room.ownerKey, surveyUrl: room.surveyUrl,
      waiting: [...room.waiting.values()].map((w) => ({ name: w.name })),
      tables: room.tableIds.map((id) => this.tables.get(id)).filter(Boolean).map((t) => ({ id: t.id, stage: t.stage, size: t.players.length }))
    };
  }
  emitRoom(room) { this.io.to(`room:${room.code}`).emit('room:state', this.roomState(room)); }

  async start(code, byKey) {
    const room = await this.getRoom(code);
    if (!room) return { error: 'No room with that code.' };
    if (room.ownerKey !== byKey) return { error: 'Only the person who created this room can start it.' };
    const waiting = [...room.waiting.values()];
    if (!waiting.length) return { error: 'Nobody is waiting yet.' };
    this.formTables(room, waiting);
    return { ok: true };
  }

  formTables(room, waiting) {
    const people = [...waiting].sort(() => Math.random() - 0.5);
    let i = 0;
    for (const size of partition(people.length)) {
      const group = people.slice(i, i + size); i += size;
      group.forEach((w) => room.waiting.delete(w.key));
      const table = new Table({ io: this.io, room, humans: group, onDone: (t) => this.onDone(t) });
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
