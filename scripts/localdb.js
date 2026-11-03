// Starts a local Postgres for development and tests (no Docker needed).
// On a normal laptop it uses the embedded-postgres package. When running as root
// (some cloud sandboxes), Postgres refuses to run as root, so we start it as the postgres user.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export async function startLocalDb({ dir = '.localdb', port = 5433, fresh = false } = {}) {
  const dataDir = path.resolve(dir);
  if (fresh && fs.existsSync(dataDir)) fs.rmSync(dataDir, { recursive: true, force: true });
  const url = `postgres://postgres:password@localhost:${port}/cabrillo`;

  if (process.getuid?.() === 0) {
    const bin = path.join(path.resolve('node_modules/@embedded-postgres/linux-x64'), 'native', 'bin');
    const asPg = (cmd) => execFileSync('su', ['postgres', '-s', '/bin/bash', '-c', cmd], { stdio: 'pipe' }).toString();
    if (!fs.existsSync(path.join(dataDir, 'PG_VERSION'))) {
      fs.mkdirSync(dataDir, { recursive: true });
      execFileSync('chown', ['postgres:postgres', dataDir]);
      asPg(`${bin}/initdb -D ${dataDir} -U postgres --auth=trust`);
    }
    asPg(`${bin}/pg_ctl -D ${dataDir} -o "-p ${port} -k /tmp" -l ${dataDir}/server.log -w start`);
    const { default: pgmod } = await import('pg');
    const c = new pgmod.Client({ connectionString: `postgres://postgres@localhost:${port}/postgres` });
    await c.connect();
    try { await c.query('create database cabrillo'); } catch { /* exists */ }
    await c.end();
    return { url, pg: { stop: async () => { try { asPg(`${bin}/pg_ctl -D ${dataDir} -m fast -w stop`); } catch { /* already stopped */ } } } };
  }

  const { default: EmbeddedPostgres } = await import('embedded-postgres');
  const pg = new EmbeddedPostgres({ databaseDir: dataDir, user: 'postgres', password: 'password', port, persistent: !fresh, onLog: () => {} });
  if (!fs.existsSync(path.join(dataDir, 'PG_VERSION'))) await pg.initialise();
  await pg.start();
  try { await pg.createDatabase('cabrillo'); } catch { /* exists */ }
  return { pg, url };
}
