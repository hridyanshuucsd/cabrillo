import crypto from 'node:crypto';
import { q } from './db.js';
import { Table } from './game.js';
import { DEFAULT_TASK, MIXED, ORDER } from './tasks.js';

const SCALE = Number(process.env.TIME_SCALE || 1);
const FILL_AFTER = Number(process.env.FILL_AFTER_SECONDS || 60) * 1000; // Play now: AI fills empty seats after this wait
const GATHER = Number(process.env.GATHER_SECONDS || 10) * 1000;       // Play now: wait for a 4th or 5th player
const KEEP_TABLE = 30 * 60 * 1000;
const SCALE_SWEEP = Math.min(1, Number(process.env.TIME_SCALE || 1)) || 1;
const AWAY_LIMIT = 25 * 1000 * SCALE_SWEEP;  // a person who closes the page while their table fills loses the seat after this
const IDLE_START = Number(process.env.IDLE_START_SECONDS || 40) * 1000 * SCALE_SWEEP; // a table of 3+ starts if nobody new joins for this long
const MAX_FILL = 90 * 1000 * SCALE_SWEEP;    // ...or once it has been filling this long, so nobody waits more than about 3 minutes in all
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
    this.lastSeen = new Map(); // identity key -> last time it had a live connection
    setInterval(() => this.checkQuick(), 1000);
    setInterval(() => this.sweep(), 5000 * SCALE_SWEEP);
  }

  blankRoom(code, kind, ownerKey, surveyUrl, task, aiMode, groupSize) {
    // order: the scenario sequence for 'mixed' rooms, shuffled once so every table gets a different one.
    // autoStart (class): a table starts by itself when it fills. The host can turn this off to hold tables until they press Start.
    return { code, kind, ownerKey, surveyUrl, task: task || DEFAULT_TASK, aiMode: aiMode || 'listen', groupSize: groupSize || 4, order: shuffle(ORDER),
      tablesMade: 0, waiting: new Map(), tableIds: [], gatherTimer: null, autoStart: true, joined: new Set() };
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
    if (active) { socket.emit('game:start', { sessionId: active.id }); return { ok: true, sessionId: active.id }; }
    if (room.kind === 'class' && room.ownerKey === ident.key) { this.emitRoom(room); return { ok: true, host: true }; }
    if (room.kind === 'class') return this.seatInClass(room, ident, socket);
    const w = room.waiting.get(ident.key) || { ...ident, sockets: new Set(), joinedAt: Date.now() };
    w.sockets.add(socket.id); w.name = ident.name;
    room.waiting.set(ident.key, w);
    // A person can wait in only one room at a time.
    for (const other of this.rooms.values()) if (other !== room && other.waiting.delete(ident.key)) this.emitRoom(other);
    this.emitRoom(room);
    if (room.kind === 'quick') this.checkQuick();
    return { ok: true };
  }

  // ---------- class sessions: seat each person the moment they join ----------
  roomTables(room) { return room.tableIds.map((id) => this.tables.get(id)).filter(Boolean); }

  async makeTable(room, humans, forming) {
    const n = room.tablesMade, S = room.order.length;
    // 'mixed' gives each table the next scenario in the room's shuffled order, so no two tables share one until all are used.
    const taskId = room.task === MIXED ? room.order[n % S] : room.task;
    // "compare" keeps the two AI modes balanced: a new table gets whichever mode fewer tables in this session have.
    // (Counting tables that exist, not tables ever made, so a table that closed while empty does not skew the split.)
    // On a tie, a scenario that is repeating gets the mode it has not had yet; otherwise the listening AI goes first.
    let mode = room.aiMode;
    if (room.aiMode === 'compare') {
      const live = this.roomTables(room);
      const listen = live.filter((t) => t.mode === 'listen').length, ask = live.length - listen;
      const had = live.filter((t) => t.task.id === taskId).map((t) => t.mode);
      mode = listen !== ask ? (listen < ask ? 'listen' : 'ask') : (had.includes('listen') && !had.includes('ask') ? 'ask' : 'listen');
    }
    room.tablesMade++;
    const table = new Table({ io: this.io, room, humans, mode, taskId, number: n + 1, forming, target: room.kind === 'class' ? room.groupSize : 5, onDone: (t) => this.onDone(t) });
    this.tables.set(table.id, table);
    room.tableIds.push(table.id);
    return table;
  }

  async seatInClass(room, ident, socket) {
    // Fill one table at a time: the open table with the most people, else a table that started under 30 seconds ago, else a new one.
    const tables = this.roomTables(room);
    let t = tables.filter((x) => x.isOpen()).sort((a, b) => b.humans().length - a.humans().length || a.number - b.number)[0];
    if (!t) t = tables.filter((x) => x.stage === 'setup' && x.canSeat()).sort((a, b) => a.humans().length - b.humans().length)[0];
    if (!t) { t = await this.makeTable(room, [], true); await t.open(); }
    // two people can join in the same instant; recheck after the awaits above
    if (!(await t.seat(ident))) {
      if (this.activeTableFor(ident.key)) return { ok: true, sessionId: this.activeTableFor(ident.key).id };
      t = await this.makeTable(room, [], true); await t.open(); await t.seat(ident);
    }
    this.playerTable.set(ident.key, t.id);
    this.lastSeen.set(ident.key, Date.now());
    room.joined.add(ident.key);
    socket.emit('game:start', { sessionId: t.id });
    if (t.stage === 'forming' && room.autoStart && t.humans().length >= t.target) {
      await this.dropAway(t, 3000); // someone who already closed the page does not count toward a full table
      if (t.humans().length >= t.target) await t.begin('full');
    }
    this.emitRoom(room);
    return { ok: true, sessionId: t.id };
  }

  // Remove people from a filling table who have had no connection for longer than ms.
  async dropAway(t, ms) {
    const now = Date.now();
    for (const p of [...t.humans()]) {
      if (this.io.sockets.adapter.rooms.get(`k:${p.key}`)?.size) { this.lastSeen.set(p.key, now); continue; }
      if (now - (this.lastSeen.get(p.key) || p.seatedAt) > ms) { await t.unseat(p.key, 'disconnected'); this.playerTable.delete(p.key); }
    }
  }

  async leaveTable(sessionId, key) {
    const t = this.tables.get(sessionId);
    if (!t || !(await t.unseat(key, 'left'))) return { error: 'You can only leave before the table starts.' };
    this.playerTable.delete(key);
    await this.closeIfEmpty(t);
    this.emitRoom(t.room);
    return { ok: true };
  }

  async closeIfEmpty(t) {
    if (t.stage !== 'forming' || t.humans().length) return;
    this.tables.delete(t.id);
    t.room.tableIds = t.room.tableIds.filter((x) => x !== t.id);
    try { await q('delete from sessions where id=$1', [t.id]); } catch {}
  }

  async startTable(code, sessionId, byKey) {
    const room = await this.getRoom(code);
    if (!room || room.ownerKey !== byKey) return { error: 'Only the host can start tables.' };
    const t = this.tables.get(sessionId);
    if (!t || t.room !== room || !(await t.begin('host'))) return { error: 'That table has already started.' };
    this.emitRoom(room);
    return { ok: true };
  }

  // Start every table that is still filling. People at a table of 1 or 2 first move to another filling or just-started table
  // with room (up to 5); anyone left plays with labeled AI players in the empty seats.
  async startAll(code, byKey) {
    const room = await this.getRoom(code);
    if (!room || room.ownerKey !== byKey) return { error: 'Only the host can start tables.' };
    const forming = () => this.roomTables(room).filter((t) => t.stage === 'forming' && t.humans().length);
    for (const small of forming().filter((t) => t.humans().length < 3).sort((a, b) => a.humans().length - b.humans().length)) {
      for (const p of [...small.humans()]) {
        const dest = this.roomTables(room).filter((t) => t !== small && t.humans().length >= 3 && t.canSeat()).sort((a, b) => a.humans().length - b.humans().length)[0];
        if (!dest) break;
        await small.unseat(p.key, 'moved');
        if (await dest.seat(p)) { this.playerTable.set(p.key, dest.id); this.io.to(`k:${p.key}`).emit('game:start', { sessionId: dest.id }); }
      }
      await this.closeIfEmpty(small);
    }
    let started = 0;
    for (const t of forming()) { await this.dropAway(t, 5000); if (t.humans().length && await t.begin('host_all')) started++; else await this.closeIfEmpty(t); }
    this.emitRoom(room);
    return { ok: true, started };
  }

  async setAutoStart(code, byKey, value) {
    const room = await this.getRoom(code);
    if (!room || room.ownerKey !== byKey) return { error: 'Only the host can change this.' };
    room.autoStart = !!value;
    // turning it back on starts any table that is already full
    if (room.autoStart) for (const t of this.roomTables(room)) if (t.stage === 'forming' && t.humans().length >= t.target) await t.begin('full');
    for (const t of this.roomTables(room)) if (t.stage === 'forming') t.broadcast();
    this.emitRoom(room);
    return { ok: true };
  }

  // Every few seconds: people who closed the page while their table filled give up the seat,
  // and a table of 3 or more that nobody new has joined for a minute starts (when auto start is on).
  async sweep() {
    const now = Date.now();
    for (const room of this.rooms.values()) {
      if (room.kind !== 'class') continue;
      let changed = false;
      for (const t of this.roomTables(room)) {
        if (t.stage !== 'forming') continue;
        const before = t.humans().length;
        await this.dropAway(t, AWAY_LIMIT);
        if (t.humans().length !== before) changed = true;
        await this.closeIfEmpty(t);
        if (room.autoStart && t.stage === 'forming' && t.humans().length >= 3 && (now - t.lastSeatChange > IDLE_START || now - t.openedAt > MAX_FILL)) { await t.begin('idle'); changed = true; }
        // One or two people who have waited this long are not left waiting for more: they move to a table that can still
        // take them, or their table starts with labeled AI players. Nobody waits more than about 3 minutes in all.
        else if (room.autoStart && t.stage === 'forming' && t.humans().length && t.humans().length < 3 && now - Math.min(...t.humans().map((p) => p.seatedAt)) > MAX_FILL) {
          for (const p of [...t.humans()]) {
            const dest = this.roomTables(room).filter((x) => x !== t && x.humans().length >= 3 && x.canSeat()).sort((a, b) => a.humans().length - b.humans().length)[0];
            if (!dest) break;
            await t.unseat(p.key, 'moved');
            if (await dest.seat(p)) { this.playerTable.set(p.key, dest.id); this.io.to(`k:${p.key}`).emit('game:start', { sessionId: dest.id }); }
          }
          await this.closeIfEmpty(t);
          if (t.humans().length) await t.begin('waited');
          changed = true;
        }
      }
      if (changed) this.emitRoom(room);
    }
  }

  leave(code, key) {
    const room = this.rooms.get(String(code || '').toUpperCase());
    if (room?.waiting.delete(key)) this.emitRoom(room);
  }

  dropSocket(socketId, key) {
    if (key) this.lastSeen.set(key, Date.now()); // last moment this person had a connection
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
      autoStart: room.autoStart, joined: room.joined.size,
      tables: room.tableIds.map((id) => this.tables.get(id)).filter(Boolean).map((t) => ({ id: t.id, number: t.number, task: t.task.short, stage: t.stage, size: t.players.length, humans: t.humans().length, target: t.target, mode: t.mode }))
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
        if (await t.seat(w)) {
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
      const table = this.makeTableSync(room, group);
      group.forEach((w) => { this.playerTable.set(w.key, table.id); this.io.to(`k:${w.key}`).emit('game:start', { sessionId: table.id }); });
      table.start();
    }
    clearTimeout(room.gatherTimer); room.gatherTimer = null;
    this.emitRoom(room);
  }

  makeTableSync(room, humans) {
    const n = room.tablesMade; room.tablesMade++;
    const table = new Table({ io: this.io, room, humans, mode: room.aiMode === 'compare' ? (n % 2 === 0 ? 'listen' : 'ask') : room.aiMode, taskId: room.task === MIXED ? room.order[n % room.order.length] : room.task, number: n + 1, onDone: (t) => this.onDone(t) });
    this.tables.set(table.id, table);
    room.tableIds.push(table.id);
    return table;
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
