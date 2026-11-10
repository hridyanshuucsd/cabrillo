import pg from 'pg';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set. Run "npm run dev" for a local database, or set it to your Postgres URL.');
  process.exit(1);
}
const local = /localhost|127\.0\.0\.1/.test(url);
const pool = new pg.Pool({ connectionString: url, ssl: local ? false : { rejectUnauthorized: false }, max: 10 });

export const q = (text, params) => pool.query(text, params);

export async function migrate() {
  await q(`
    create table if not exists users (
      id serial primary key,
      email text unique not null,
      name text not null,
      pass_hash text not null,
      consent boolean not null default false,
      created_at timestamptz not null default now()
    );
    create table if not exists rooms (
      code text primary key,
      owner_key text,
      kind text not null,
      survey_url text,
      created_at timestamptz not null default now()
    );
    create table if not exists sessions (
      id text primary key,
      room_code text,
      kind text,
      scenario text,
      started_at timestamptz not null default now(),
      ended_at timestamptz,
      outcome text,
      final_plan jsonb
    );
    create table if not exists session_players (
      session_id text not null,
      pcode text not null,
      user_id int,
      display_name text,
      role_id text,
      is_ai boolean not null default false,
      is_guest boolean not null default false,
      primary key (session_id, pcode)
    );
    create table if not exists logs (
      id bigserial primary key,
      session_id text not null,
      t_ms int not null,
      actor text not null,
      actor_type text not null,
      type text not null,
      payload jsonb,
      created_at timestamptz not null default now()
    );
    create index if not exists logs_session on logs (session_id, id);
    create table if not exists feedback (
      session_id text not null,
      pcode text not null,
      ai_helpful int,
      play_again text,
      comment text,
      created_at timestamptz not null default now(),
      primary key (session_id, pcode)
    );
    alter table rooms add column if not exists task text;
    alter table rooms add column if not exists ai_mode text;
    alter table feedback add column if not exists ai_amount text;
    alter table rooms add column if not exists group_size int;
    alter table feedback add column if not exists plan_ok int;
    alter table feedback add column if not exists comfort int;
    alter table feedback add column if not exists in_charge int;
    create index if not exists sessions_room on sessions (room_code);
  `);
}

// Fire-and-forget event logging. A failed write never interrupts a game.
export function logEvent(sessionId, tMs, actor, actorType, type, payload) {
  q('insert into logs (session_id, t_ms, actor, actor_type, type, payload) values ($1,$2,$3,$4,$5,$6)',
    [sessionId, Math.max(0, Math.round(tMs)), actor, actorType, type, payload ? JSON.stringify(payload) : null])
    .catch((e) => console.error('log write failed', e.message));
}
