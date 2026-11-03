import { io } from 'socket.io-client';
import { useEffect, useState } from 'react';

export async function api(path, body, method) {
  const r = await fetch(path, {
    method: method || (body ? 'POST' : 'GET'), credentials: 'same-origin',
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || 'Something went wrong. Please try again.');
  return data;
}

let socket = null;
export function getSocket() {
  if (!socket) socket = io({ transports: ['websocket', 'polling'] });
  return socket;
}
// After signing in or out, the socket must reconnect so the server sees the new identity.
export function resetSocket() { if (socket) { socket.disconnect(); socket = null; } }

export function emit(event, payload) {
  return new Promise((resolve) => getSocket().emit(event, payload, (res) => resolve(res || {})));
}

export function useSocketEvent(event, handler) {
  useEffect(() => {
    const s = getSocket();
    s.on(event, handler);
    return () => { s.off(event, handler); };
  }, [event, handler]);
}

// Counts down to the end of the current stage, corrected for clock differences with the server.
export function useCountdown(endsAt, serverNow) {
  const [now, setNow] = useState(Date.now());
  const [offset, setOffset] = useState(0);
  useEffect(() => { if (serverNow) setOffset(serverNow - Date.now()); }, [serverNow]);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 250); return () => clearInterval(t); }, []);
  if (!endsAt) return 0;
  return Math.max(0, Math.ceil((endsAt - (now + offset)) / 1000));
}

export const mmss = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
export const msToClock = (ms) => mmss(Math.round((ms || 0) / 1000));
