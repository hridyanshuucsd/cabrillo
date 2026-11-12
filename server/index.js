import './env.js'; // must stay first: later imports read settings when they load
import express from 'express';
import cookieParser from 'cookie-parser';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import { q, migrate } from './db.js';
import { authRoutes, identityFromReq, identityFromSocket } from './auth.js';
import { Lobby } from './lobby.js';
import { aiMode, aiInfo, warmUp } from './ai.js';
import { TASKS, DEFAULT_TASK, MIXED } from './tasks.js';
import { computeAnalytics, transcript, TABLE_COLS, PARTICIPANT_COLS } from './analytics.js';

// A crash would end every table at once, so log unexpected errors instead of exiting.
process.on('unhandledRejection', (e) => console.error('unhandled rejection', e));
process.on('uncaughtException', (e) => console.error('uncaught exception', e));

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

await migrate();
const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '50kb' }));
app.use(cookieParser());
const server = http.createServer(app);
const io = new Server(server);
const lobby = new Lobby(io);

authRoutes(app);
// ai: which provider answers; model: the model that last answered (null until the first call works). No keys are shown.
// build: the commit that is running (set by Render), to check that a deploy went live.
app.get('/api/health', (req, res) => res.json({ ok: true, build: (process.env.RENDER_GIT_COMMIT || '').slice(0, 7) || null, ...aiInfo() }));
// Public settings for the browser. A Mapbox public token is meant to be visible; restrict it to this site's URL in Mapbox.
app.get('/api/config', (req, res) => res.json({ mapboxToken: process.env.MAPBOX_TOKEN || null }));
app.get('/api/tasks', (req, res) => res.json(Object.values(TASKS).map((t) => ({ id: t.id, title: t.title, short: t.short, prompt: t.prompt }))));

const needUser = (req, res) => { const id = identityFromReq(req); if (!id) res.status(401).json({ error: 'Please sign in first.' }); return id; };

app.post('/api/rooms', async (req, res) => {
  const id = needUser(req, res); if (!id) return;
  const kind = req.body.kind === 'class' ? 'class' : 'private';
  if (kind === 'class' && id.isGuest) return res.status(403).json({ error: 'Please sign in with an account to host a class session.' });
  let survey = String(req.body.surveyUrl || '').trim();
  if (survey && !/^https:\/\//.test(survey)) return res.status(400).json({ error: 'The feedback survey link must start with https://' });
  const task = TASKS[req.body.task] ? req.body.task : (req.body.task === MIXED && kind === 'class' ? MIXED : DEFAULT_TASK);
  const groupSize = [3, 4, 5].includes(Number(req.body.groupSize)) ? Number(req.body.groupSize) : 4;
  const aiMode = ['listen', 'ask', 'compare'].includes(req.body.aiMode) ? req.body.aiMode : 'listen';
  if (aiMode === 'compare' && kind !== 'class') return res.status(400).json({ error: 'Comparing AI modes is only for class sessions.' });
  const room = await lobby.createRoom(kind, id, survey || null, task, aiMode, groupSize);
  res.json({ code: room.code, kind: room.kind });
});

app.get('/api/rooms/:code', async (req, res) => {
  const room = await lobby.getRoom(req.params.code);
  if (!room) return res.status(404).json({ error: 'No room with that code.' });
  const id = identityFromReq(req);
  res.json({ code: room.code, kind: room.kind, task: room.task, aiMode: room.aiMode, groupSize: room.groupSize, isOwner: !!id && id.key === room.ownerKey });
});

app.get('/api/history', async (req, res) => {
  const id = needUser(req, res); if (!id) return;
  if (!id.userId) return res.json([]);
  const r = await q(`select s.id, s.started_at, s.outcome, s.kind, s.scenario, sp.role_id,
      (select count(*) from logs l where l.session_id = s.id and l.actor = sp.pcode and l.type in ('limit_shared', 'limit_mentioned')) as shared
    from session_players sp join sessions s on s.id = sp.session_id
    where sp.user_id = $1 order by s.started_at desc limit 50`, [id.userId]);
  res.json(r.rows);
});

app.post('/api/feedback', async (req, res) => {
  const id = needUser(req, res); if (!id) return;
  const t = lobby.tables.get(String(req.body.sessionId || ''));
  const p = t?.player(id.key);
  if (!p) return res.status(404).json({ error: 'This session has closed.' });
  const scale = (v) => { const n = Number(v); return n >= 1 && n <= 5 ? Math.round(n) : null; };
  const helpful = scale(req.body.aiHelpful), planOk = scale(req.body.planOk), comfort = scale(req.body.comfort), inCharge = scale(req.body.inCharge);
  const amount = ['too_much', 'about_right', 'too_little'].includes(req.body.aiAmount) ? req.body.aiAmount : null;
  const again = ['yes', 'maybe', 'no'].includes(req.body.playAgain) ? req.body.playAgain : null;
  await q(`insert into feedback (session_id, pcode, ai_helpful, ai_amount, play_again, comment, plan_ok, comfort, in_charge) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           on conflict (session_id, pcode) do update set ai_helpful=excluded.ai_helpful, ai_amount=excluded.ai_amount, play_again=excluded.play_again, comment=excluded.comment,
             plan_ok=excluded.plan_ok, comfort=excluded.comfort, in_charge=excluded.in_charge`,
    [t.id, p.pcode, helpful, amount, again, String(req.body.comment || '').slice(0, 1000) || null, planOk, comfort, inCharge]);
  t.log(p.pcode, 'feedback_submitted', { ai_helpful: helpful, ai_amount: amount, play_again: again, plan_ok: planOk, comfort, in_charge: inCharge, ai_mode: t.mode });
  res.json({ ok: true });
});

// ---------- CSV exports for the research team ----------
const csvCell = (v) => { if (v === null || v === undefined) return ''; const s = typeof v === 'object' ? JSON.stringify(v) : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const sendCsv = (res, name, rows, cols) => {
  res.setHeader('content-type', 'text/csv; charset=utf-8');
  res.setHeader('content-disposition', `attachment; filename="${name}"`);
  res.send([cols.join(','), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(','))].join('\n'));
};
async function canExport(req, room) {
  const id = identityFromReq(req); if (!id) return false;
  if (room && id.key === room.ownerKey) return true;
  if (!id.userId || !ADMIN_EMAILS.length) return false;
  const r = await q('select email from users where id=$1', [id.userId]);
  return ADMIN_EMAILS.includes(r.rows[0]?.email);
}
const EXPORTS = {
  'logs.csv': ['select l.session_id, l.t_ms, l.actor, l.actor_type, l.type, l.payload, l.created_at from logs l join sessions s on s.id=l.session_id where ($1::text is null or s.room_code=$1) order by l.session_id, l.id', ['session_id', 't_ms', 'actor', 'actor_type', 'type', 'payload', 'created_at']],
  'players.csv': ['select sp.session_id, sp.pcode, sp.role_id as limit_id, sp.is_ai, sp.is_guest, (sp.user_id is not null) as has_account from session_players sp join sessions s on s.id=sp.session_id where ($1::text is null or s.room_code=$1) order by sp.session_id, sp.pcode', ['session_id', 'pcode', 'limit_id', 'is_ai', 'is_guest', 'has_account']],
  'sessions.csv': ["select id as session_id, room_code, kind, split_part(scenario, ':', 1) as task, split_part(scenario, ':', 2) as ai_mode, started_at, ended_at, outcome, final_plan from sessions where ($1::text is null or room_code=$1) order by started_at", ['session_id', 'room_code', 'kind', 'task', 'ai_mode', 'started_at', 'ended_at', 'outcome', 'final_plan']],
  'feedback.csv': ["select f.session_id, split_part(s.scenario, ':', 2) as ai_mode, f.pcode, f.ai_helpful, f.ai_amount, f.plan_ok, f.comfort, f.in_charge, f.play_again, f.comment, f.created_at from feedback f join sessions s on s.id=f.session_id where ($1::text is null or s.room_code=$1) order by f.created_at", ['session_id', 'ai_mode', 'pcode', 'ai_helpful', 'ai_amount', 'plan_ok', 'comfort', 'in_charge', 'play_again', 'comment', 'created_at']]
};
// tables.csv and participants.csv are computed (one row per table, one row per person), ready for a stats tool.
const COMPUTED = { 'tables.csv': ['tables', TABLE_COLS], 'participants.csv': ['participants', PARTICIPANT_COLS] };
const route = (fn) => async (req, res) => { try { await fn(req, res); } catch (e) { console.error('request failed', req.path, e); if (!res.headersSent) res.status(500).json({ error: 'Something went wrong. Please try again.' }); } };
app.get('/api/export/:scope/:file', route(async (req, res) => {
  const spec = EXPORTS[req.params.file], computed = COMPUTED[req.params.file];
  if (!spec && !computed) return res.status(404).end();
  const all = req.params.scope === 'all';
  if (all && computed) return res.status(400).json({ error: 'This file is made per class session. Use the session code.' });
  const room = all ? null : await lobby.getRoom(req.params.scope);
  if (!all && !room) return res.status(404).json({ error: 'No room with that code.' });
  if (!(await canExport(req, all ? null : room))) return res.status(403).json({ error: 'Only the room host or a research admin can export data.' });
  if (computed) { const a = await computeAnalytics(room); return sendCsv(res, `${room.code}-${req.params.file}`, a[computed[0]], computed[1]); }
  const r = await q(spec[0], [all ? null : room.code]);
  sendCsv(res, `${all ? 'all' : room.code}-${req.params.file}`, r.rows, spec[1]);
}));

// ---------- analytics for a class session (host or research admin) ----------
const analyticsRoom = async (req, res) => {
  const room = await lobby.getRoom(req.params.code);
  if (!room) { res.status(404).json({ error: 'No session with that code.' }); return null; }
  if (!(await canExport(req, room))) { res.status(403).json({ error: 'Only the host of this session or a research admin can see its analytics.' }); return null; }
  return room;
};
app.get('/api/analytics/:code', route(async (req, res) => { const room = await analyticsRoom(req, res); if (room) res.json(await computeAnalytics(room)); }));
app.get('/api/analytics/:code/transcript/:sid', route(async (req, res) => {
  const room = await analyticsRoom(req, res); if (!room) return;
  const t = await transcript(room, String(req.params.sid));
  if (!t) return res.status(404).json({ error: 'No such table in this session.' });
  res.json(t);
}));
// Class sessions this person has hosted, newest first, for the "sessions I hosted" list.
app.get('/api/my-sessions', route(async (req, res) => {
  const id = needUser(req, res); if (!id) return;
  const r = await q(`select r.code, r.created_at, r.task, r.ai_mode,
      (select count(*) from sessions s where s.room_code = r.code and s.outcome is not null) as tables,
      (select count(*) from session_players sp join sessions s on s.id = sp.session_id where s.room_code = r.code and not sp.is_ai) as people
    from rooms r where r.owner_key = $1 and r.kind = 'class' order by r.created_at desc limit 40`, [id.key]);
  res.json(r.rows);
}));

// ---------- realtime ----------
io.use((socket, next) => { socket.data.id = identityFromSocket(socket); next(); });
io.on('connection', (socket) => {
  const id = socket.data.id;
  if (!id) { socket.emit('auth:required'); return; }
  socket.join(`k:${id.key}`);
  const table = (sid) => { const t = lobby.tables.get(String(sid || '')); return t && t.player(id.key) ? t : null; };
  const ack = (cb, v) => typeof cb === 'function' && cb(v);
  // Wrap async handlers so a database hiccup returns an error to one person instead of crashing the server.
  const safe = (fn) => async (payload, cb) => { try { await fn(payload || {}, cb); } catch (e) { console.error('socket handler failed', e); ack(cb, { error: 'Something went wrong. Please try again.' }); } };

  socket.on('room:join', safe(async ({ code }, cb) => ack(cb, await lobby.join(code, id, socket))));
  socket.on('room:leave', ({ code }) => lobby.leave(code, id.key));
  socket.on('table:leave', safe(async ({ sessionId }, cb) => ack(cb, await lobby.leaveTable(String(sessionId), id.key))));
  socket.on('host:start-table', safe(async ({ code, sessionId }, cb) => ack(cb, await lobby.startTable(code, String(sessionId), id.key))));
  socket.on('host:start-all', safe(async ({ code }, cb) => ack(cb, await lobby.startAll(code, id.key))));
  socket.on('host:auto-start', safe(async ({ code, value }, cb) => ack(cb, await lobby.setAutoStart(code, id.key, value))));
  socket.on('game:typing', ({ sessionId }) => table(sessionId)?.typing(id.key));
  socket.on('room:start', safe(async ({ code }, cb) => ack(cb, await lobby.start(code, id.key))));
  socket.on('quick:join', safe(async (_, cb) => ack(cb, await lobby.join('QUICK', id, socket))));

  socket.on('game:join', ({ sessionId }, cb) => {
    const t = lobby.tables.get(String(sessionId || ''));
    if (!t || !t.player(id.key)) return ack(cb, { error: 'This session is not available.' });
    socket.emit('game:state', t.viewFor(id.key)); ack(cb, { ok: true });
  });
  socket.on('game:ready', ({ sessionId }) => table(sessionId)?.ready(id.key));
  socket.on('game:limit', ({ sessionId, action, text }) => table(sessionId)?.changeLimit(id.key, String(action), text));
  socket.on('game:share', ({ sessionId, mode }) => table(sessionId)?.shareLimit(id.key, String(mode)));
  socket.on('game:pick', ({ sessionId, field, option }) => table(sessionId)?.pick(id.key, String(field), String(option)));
  socket.on('game:end-vote', ({ sessionId, value }) => table(sessionId)?.endVote(id.key, value));
  socket.on('game:pause-ai', ({ sessionId, paused }) => table(sessionId)?.pauseAI(id.key, paused));
  socket.on('game:chat', ({ sessionId, text, limit }) => table(sessionId)?.say(id.key, text, { limit: !!limit }));
  socket.on('game:ask', ({ sessionId, text, private: priv }) => table(sessionId)?.ask(id.key, text, { private: !!priv }));
  socket.on('game:booking-answer', ({ sessionId, bookingId, ok }) => table(sessionId)?.bookingAnswer(id.key, String(bookingId), ok));
  socket.on('game:bill-pay', ({ sessionId, billId, rowId, method }) => table(sessionId)?.payBill(id.key, String(billId), rowId, String(method)));
  // the plan board
  socket.on('game:add-option', ({ sessionId, field, name, geo }, cb) => ack(cb, table(sessionId)?.addOption(id.key, String(field), name, geo) || { error: 'Not available.' }));
  socket.on('game:places', safe(async ({ sessionId, query }, cb) => { const t = table(sessionId); ack(cb, t ? { results: await t.findPlaces(query) } : { results: [] }); }));
  socket.on('game:avail', ({ sessionId, field, option, value }) => table(sessionId)?.setAvail(id.key, String(field), String(option), value ? String(value) : null));
  socket.on('game:react', ({ sessionId, msgId, emoji }) => table(sessionId)?.react(id.key, msgId, String(emoji)));
  socket.on('game:todo', ({ sessionId, action, ...a }) => table(sessionId)?.todo(id.key, String(action), a));
  socket.on('game:agree', ({ sessionId, action, ...a }) => table(sessionId)?.agreement(id.key, String(action), a));
  socket.on('game:bring', ({ sessionId, action, ...a }) => table(sessionId)?.bringItem(id.key, String(action), a));
  socket.on('game:day', ({ sessionId, action, ...a }) => table(sessionId)?.itinerary(id.key, String(action), a));
  socket.on('game:weather', ({ sessionId }) => table(sessionId)?.wantWeather(id.key));
  socket.on('game:x', ({ sessionId, kind, action, ...a }) => table(sessionId)?.extra(id.key, String(kind), String(action), a));
  socket.on('game:menu', safe(async ({ sessionId, placeId }, cb) => ack(cb, (await table(sessionId)?.openMenu(id.key, String(placeId))) || { error: 'Not available.' })));
  socket.on('game:order', ({ sessionId, placeId, itemId, delta }) => table(sessionId)?.order(id.key, String(placeId), String(itemId), delta));
  socket.on('game:menu-bill', ({ sessionId, placeId }) => table(sessionId)?.menuBill(id.key, String(placeId)));
  socket.on('game:metoo', ({ sessionId, msgId }) => table(sessionId)?.metoo(id.key, msgId));
  socket.on('game:accept', ({ sessionId, value, fits }) => table(sessionId)?.accept(id.key, value, fits));

  // Host console: watch tables, advance stages, pause the AI and speak for it (Wizard of Oz).
  const hostRoom = async (code) => { const room = await lobby.getRoom(code); return room && room.ownerKey === id.key ? room : null; };
  socket.on('host:watch', safe(async ({ code }, cb) => {
    const room = await hostRoom(code); if (!room) return ack(cb, { error: 'Only the host can open this console.' });
    socket.join(`host:${room.code}`); socket.join(`room:${room.code}`);
    lobby.emitRoom(room);
    room.tableIds.forEach((tid) => { const t = lobby.tables.get(tid); if (t) socket.emit('host:table', t.hostView()); });
    ack(cb, { ok: true });
  }));
  const hostTable = async (code, sid) => { const room = await hostRoom(code); const t = room && lobby.tables.get(sid); return t && t.room.code === room.code ? t : null; };
  socket.on('host:advance', safe(async ({ code, sessionId }) => (await hostTable(code, sessionId))?.hostAdvance()));
  socket.on('host:pause', safe(async ({ code, sessionId, paused }) => (await hostTable(code, sessionId))?.hostPause(paused)));
  socket.on('host:end-all', safe(async ({ code }, cb) => {
    const room = await hostRoom(code); if (!room) return ack(cb, { error: 'Only the host can end tables.' });
    let n = 0;
    for (const tid of room.tableIds) { const t = lobby.tables.get(tid); if (t && ['setup', 'chat'].includes(t.stage)) { t.log('host', 'host_ended_all', {}, 'host'); t.endReason = 'host'; t.enter('done'); n++; } }
    ack(cb, { ok: true, ended: n });
  }));
  socket.on('host:say', safe(async ({ code, sessionId, text }) => (await hostTable(code, sessionId))?.hostSay(text)));
  // One note from the host to every table that is chatting, for example "about two minutes left".
  socket.on('host:announce', safe(async ({ code, text }, cb) => {
    const room = await hostRoom(code); if (!room) return ack(cb, { error: 'Only the host can send this.' });
    let n = 0;
    for (const tid of room.tableIds) { const t = lobby.tables.get(tid); if (t?.hostAnnounce(text)) n++; }
    ack(cb, { ok: true, tables: n });
  }));

  socket.on('disconnect', () => lobby.dropSocket(socket.id, id.key));
});

// ---------- web app ----------
const dist = path.join(__dirname, '..', 'client', 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist, { index: false }));
  app.get(/^(?!\/api|\/socket\.io).*/, (req, res) => res.sendFile(path.join(dist, 'index.html')));
}

warmUp(); // find the model that answers for this key before anyone asks
server.listen(PORT, () => console.log(`Cabrillo running on http://localhost:${PORT} (AI mode: ${aiMode()}, time scale: ${process.env.TIME_SCALE || 1})`));
