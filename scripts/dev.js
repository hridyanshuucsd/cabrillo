// npm run dev: local database + server on :3000 + Vite dev server on :5173 with live reload.
import { spawn } from 'node:child_process';
import { startLocalDb } from './localdb.js';

const { pg, url } = await startLocalDb();
const env = { ...process.env, DATABASE_URL: process.env.DATABASE_URL || url };
const server = spawn(process.execPath, ['--watch', 'server/index.js'], { stdio: 'inherit', env });
const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js'], { stdio: 'inherit', env });
console.log('\nOpen http://localhost:5173 (the API runs on :3000)\n');
const stop = async () => { server.kill(); vite.kill(); await pg.stop(); process.exit(0); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
