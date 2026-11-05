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
import { aiMode } from './ai.js';
import { TASKS, DEFAULT_TASK } from './tasks.js';

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
app.get('/api/health', (req, res) => res.json({ ok: true, ai: aiMode() }));
app.get('/api/tasks', (req, res) => res.json(Object.values(TASKS).map((t) => ({ id: t.id, title: t.title, prompt: t.prompt }))));

const needUser = (req, res) => { const id = identityFromReq(req); if (!id) res.status(401).json({ error: 'Please sign in first.' }); return id; };

app.post('/api/rooms', async (req, res) => {
  const id = needUser(req, res); if (!id) return;
  const kind = req.body.kind === 'class' ? 'class' : 'private';
  if (kind === 'class' && id.isGuest) return res.status(403).json({ error: 'Please sign in with an account to host a class session.' });
  let survey = String(req.body.surveyUrl || '').trim();
  if (survey && !/^https:\/\//.test(survey)) return res.status(400).json({ error: 'The feedback survey link must start with https://' });
  const task = TASKS[req.body.task] ? req.body.task : DEFAULT_TASK;
  const aiMode = ['listen', 'ask', 'compare'].includes(req.body.aiMode) ? req.body.aiMode : 'listen';
  if (aiMode === 'compare' && kind !== 'class') return res.status(400).json({ error: 'Comparing AI modes is only for class sessions.' });
  const room = await lobby.createRoom(kind, id, survey || null, task, aiMode);
  res.json({ code: room.code, kind: room.kind });
});

app.get('/api/rooms/:code', async (req, res) => {
  const room = await lobby.getRoom(req.params.code);
  if (!room) return res.status(404).json({ error: 'No room with that code.' });
  const id = identityFromReq(req);
  res.json({ code: room.code, kind: room.kind, task: room.task, aiMode: room.aiMode, isOwner: !!id && id.key === room.ownerKey });
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
  const helpful = Number(req.body.aiHelpful);
  const amount = ['too_much', 'about_right', 'too_little'].includes(req.body.aiAmount) ? req.body.aiAmount : null;
  await q(`insert into feedback (session_id, pcode, ai_helpful, ai_amount, play_again, comment) values ($1,$2,$3,$4,$5,$6)
           on conflict (session_id, pcode) do update set ai_helpful=excluded.ai_helpful, ai_amount=excluded.ai_amount, play_again=excluded.play_again, comment=excluded.comment`,
    [t.id, p.pcode, helpful >= 1 && helpful <= 5 ? helpful : null, amount, ['yes', 'maybe', 'no'].includes(req.body.playAgain) ? req.body.playAgain : null, String(req.body.comment || '').slice(0, 1000) || null]);
  t.log(p.pcode, 'feedback_submitted', { ai_helpful: helpful || null, ai_amount: amount, play_again: req.body.playAgain || null, ai_mode: t.mode });
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
  'feedback.csv': ["select f.session_id, split_part(s.scenario, ':', 2) as ai_mode, f.pcode, f.ai_helpful, f.ai_amount, f.play_again, f.comment, f.created_at from feedback f join sessions s on s.id=f.session_id where ($1::text is null or s.room_code=$1) order by f.created_at", ['session_id', 'ai_mode', 'pcode', 'ai_helpful', 'ai_amount', 'play_again', 'comment', 'created_at']]
};
app.get('/api/export/:scope/:file', async (req, res) => {
  const spec = EXPORTS[req.params.file]; if (!spec) return res.status(404).end();
  const all = req.params.scope === 'all';
  const room = all ? null : await lobby.getRoom(req.params.scope);
  if (!all && !room) return res.status(404).json({ error: 'No room with that code.' });
  if (!(await canExport(req, all ? null : room))) return res.status(403).json({ error: 'Only the room host or a research admin can export data.' });
  const r = await q(spec[0], [all ? null : room.code]);
  sendCsv(res, `${all ? 'all' : room.code}-${req.params.file}`, r.rows, spec[1]);
});

// ---------- realtime ----------
io.use((socket, next) => { socket.data.id = identityFromSocket(socket); next(); });
io.on('connection', (socket) => {
  const id = socket.data.id;
  if (!id) { socket.emit('auth:required'); return; }
  socket.join(`k:${id.key}`);
  const table = (sid) => { const t = lobby.tables.get(String(sid || '')); return t && t.player(id.key) ? t : null; };
  const ack = (cb, v) => typeof cb === 'function' && cb(v);

  socket.on('room:join', async ({ code }, cb) => ack(cb, await lobby.join(code, id, socket)));
  socket.on('room:leave', ({ code }) => lobby.leave(code, id.key));
  socket.on('room:start', async ({ code }, cb) => ack(cb, await lobby.start(code, id.key)));
  socket.on('quick:join', async (_, cb) => ack(cb, await lobby.join('QUICK', id, socket)));

  socket.on('game:join', ({ sessionId }, cb) => {
    const t = lobby.tables.get(String(sessionId || ''));
    if (!t || !t.player(id.key)) return ack(cb, { error: 'This session is not available.' });
    socket.emit('game:state', t.viewFor(id.key)); ack(cb, { ok: true });
  });
  socket.on('game:ready', ({ sessionId }) => table(sessionId)?.ready(id.key));
  socket.on('game:share', ({ sessionId }) => table(sessionId)?.shareLimit(id.key));
  socket.on('game:confirm-ready', ({ sessionId }) => table(sessionId)?.confirmReady(id.key));
  socket.on('game:pause-ai', ({ sessionId, paused }) => table(sessionId)?.pauseAI(id.key, paused));
  socket.on('game:set', ({ sessionId, field, option }) => table(sessionId)?.setField(id.key, String(field), String(option)));
  socket.on('game:chat', ({ sessionId, text }) => table(sessionId)?.say(id.key, text));
  socket.on('game:ask', ({ sessionId, text }) => table(sessionId)?.ask(id.key, text));
  socket.on('game:booking', ({ sessionId, bookingId, value }) => table(sessionId)?.bookingVote(id.key, String(bookingId), value));
  socket.on('game:accept', ({ sessionId, value }) => table(sessionId)?.accept(id.key, value));

  // Host console: watch tables, advance stages, pause the AI and speak for it (Wizard of Oz).
  const hostRoom = async (code) => { const room = await lobby.getRoom(code); return room && room.ownerKey === id.key ? room : null; };
  socket.on('host:watch', async ({ code }, cb) => {
    const room = await hostRoom(code); if (!room) return ack(cb, { error: 'Only the host can open this console.' });
    socket.join(`host:${room.code}`); socket.join(`room:${room.code}`);
    lobby.emitRoom(room);
    room.tableIds.forEach((tid) => { const t = lobby.tables.get(tid); if (t) socket.emit('host:table', t.hostView()); });
    ack(cb, { ok: true });
  });
  const hostTable = async (code, sid) => { const room = await hostRoom(code); const t = room && lobby.tables.get(sid); return t && t.room.code === room.code ? t : null; };
  socket.on('host:advance', async ({ code, sessionId }) => (await hostTable(code, sessionId))?.hostAdvance());
  socket.on('host:pause', async ({ code, sessionId, paused }) => (await hostTable(code, sessionId))?.hostPause(paused));
  socket.on('host:say', async ({ code, sessionId, text }) => (await hostTable(code, sessionId))?.hostSay(text));

  socket.on('disconnect', () => lobby.dropSocket(socket.id));
});

// ---------- web app ----------
const dist = path.join(__dirname, '..', 'client', 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist, { index: false }));
  app.get(/^(?!\/api|\/socket\.io).*/, (req, res) => res.sendFile(path.join(dist, 'index.html')));
}

server.listen(PORT, () => console.log(`Cabrillo running on http://localhost:${PORT} (AI mode: ${aiMode()}, time scale: ${process.env.TIME_SCALE || 1})`));
