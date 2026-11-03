import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { parse as parseCookie } from 'cookie';
import { q } from './db.js';

const SECRET = process.env.JWT_SECRET || (() => {
  console.warn('JWT_SECRET is not set; using a temporary secret. Everyone is signed out when the server restarts.');
  return crypto.randomBytes(32).toString('hex');
})();
const COOKIE = 'cab';
const cookieOpts = {
  httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 30 * 24 * 3600 * 1000, path: '/'
};

export function identityFromToken(token) {
  if (!token) return null;
  try {
    const p = jwt.verify(token, SECRET);
    return { key: p.uid ? `u${p.uid}` : `g${p.gid}`, userId: p.uid || null, name: p.name, isGuest: !p.uid, consent: !!p.consent };
  } catch { return null; }
}
export const identityFromReq = (req) => identityFromToken(req.cookies?.[COOKIE]);
export const identityFromSocket = (socket) => identityFromToken(parseCookie(socket.handshake.headers.cookie || '')[COOKIE]);

function setToken(res, payload) {
  res.cookie(COOKIE, jwt.sign(payload, SECRET, { expiresIn: '30d' }), cookieOpts);
}
const cleanName = (s) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 24);

export function authRoutes(app) {
  app.post('/api/signup', async (req, res) => {
    const email = String(req.body.email || '').trim().toLowerCase();
    const name = cleanName(req.body.name);
    const password = String(req.body.password || '');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'Please enter a valid email address.' });
    if (name.length < 2) return res.status(400).json({ error: 'Please enter a display name of at least 2 characters.' });
    if (password.length < 8) return res.status(400).json({ error: 'Please use a password of at least 8 characters.' });
    if (!req.body.consent) return res.status(400).json({ error: 'Please agree to the research logging notice to continue.' });
    try {
      const hash = await bcrypt.hash(password, 10);
      const r = await q('insert into users (email, name, pass_hash, consent) values ($1,$2,$3,true) returning id', [email, name, hash]);
      setToken(res, { uid: r.rows[0].id, name, consent: true });
      res.json({ ok: true });
    } catch (e) {
      if (e.code === '23505') return res.status(409).json({ error: 'An account with this email already exists. Please sign in.' });
      console.error(e); res.status(500).json({ error: 'Something went wrong. Please try again.' });
    }
  });

  app.post('/api/login', async (req, res) => {
    const email = String(req.body.email || '').trim().toLowerCase();
    const r = await q('select id, name, pass_hash, consent from users where email=$1', [email]);
    const u = r.rows[0];
    if (!u || !(await bcrypt.compare(String(req.body.password || ''), u.pass_hash))) {
      return res.status(401).json({ error: 'That email and password do not match.' });
    }
    setToken(res, { uid: u.id, name: u.name, consent: u.consent });
    res.json({ ok: true });
  });

  app.post('/api/guest', (req, res) => {
    const name = cleanName(req.body.name);
    if (name.length < 2) return res.status(400).json({ error: 'Please enter a name of at least 2 characters.' });
    if (!req.body.consent) return res.status(400).json({ error: 'Please agree to the research logging notice to continue.' });
    setToken(res, { gid: crypto.randomBytes(8).toString('hex'), name, consent: true });
    res.json({ ok: true });
  });

  app.post('/api/logout', (req, res) => { res.clearCookie(COOKIE, { path: '/' }); res.json({ ok: true }); });

  app.get('/api/me', (req, res) => {
    const id = identityFromReq(req);
    res.json(id ? { name: id.name, isGuest: id.isGuest, key: id.key } : null);
  });
}
