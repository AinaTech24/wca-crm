// PostgreSQL adapter that mimics the tiny slice of the better-sqlite3 API this
// app actually uses (db.prepare(sql).get/all/run(...)), so db.js/index.js keep
// their existing SQL strings and call sites unchanged — the only edits needed
// elsewhere are `async`/`await` around each call, since node-postgres is async
// where better-sqlite3 was synchronous.
//
// Supports both bind styles already used in this codebase:
//   db.prepare('... WHERE id = ?').get(id)                 -- positional
//   db.prepare('... VALUES (@a, @b)').run({ a: 1, b: 2 })   -- named (single object arg)
// and converts either to Postgres's `$1, $2, ...` placeholders.
import pg from 'pg';

const { Pool, types } = pg;

// node-postgres returns BIGINT (COUNT(*) results, etc.) as JS strings by
// default, to avoid silently losing precision above Number.MAX_SAFE_INTEGER.
// Every COUNT(*) in this app is a UI stat well under that ceiling, and the
// call sites (`.get().c`) expect a number the way better-sqlite3 gave them
// one — so parse BIGINT (OID 20) as a plain number app-wide instead of
// hunting down every count call site individually.
types.setTypeParser(20, (val) => parseInt(val, 10));

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set — see server/.env.example');
}

// Managed Postgres (Hostinger, Render, etc.) generally requires TLS with a
// self-signed/unverified chain; local Postgres on the same box doesn't.
// PGSSLMODE=disable opts out explicitly (e.g. for local dev against a
// container). Set PGSSLMODE=require (or leave DATABASE_URL pointing at a
// remote host) to turn it on.
const useSSL = process.env.PGSSLMODE === 'disable'
  ? false
  : /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL) ? false : { rejectUnauthorized: false };

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: useSSL,
});

// Tables whose primary key isn't called `id` — skip the auto RETURNING-id
// below for inserts targeting these, so we don't ask Postgres to return a
// column that doesn't exist.
const NO_ID_TABLES = ['integration_settings'];

function compile(sql, args) {
  const named = args.length === 1 && args[0] !== null && typeof args[0] === 'object' && !Array.isArray(args[0]);
  if (named) {
    const obj = args[0];
    const values = [];
    const text = sql.replace(/@(\w+)/g, (_, name) => {
      values.push(obj[name] ?? null);
      return `$${values.length}`;
    });
    return { text, values };
  }
  let i = 0;
  const text = sql.replace(/\?/g, () => `$${++i}`);
  return { text, values: args };
}

class Statement {
  constructor(sql) { this.sql = sql; }

  async get(...args) {
    const { text, values } = compile(this.sql, args);
    const r = await pool.query(text, values);
    return r.rows[0];
  }

  async all(...args) {
    const { text, values } = compile(this.sql, args);
    const r = await pool.query(text, values);
    return r.rows;
  }

  async run(...args) {
    let { text, values } = compile(this.sql, args);
    // better-sqlite3's .run() hands back lastInsertRowid for free; Postgres
    // only does if asked, so auto-append RETURNING id to bare inserts.
    if (/^\s*insert\s+into\s+(\S+)/i.test(text) && !/\breturning\b/i.test(text)) {
      const table = text.match(/^\s*insert\s+into\s+"?(\w+)"?/i)?.[1];
      if (!NO_ID_TABLES.includes(table)) text += ' RETURNING id';
    }
    const r = await pool.query(text, values);
    return { changes: r.rowCount, lastInsertRowid: r.rows?.[0]?.id };
  }
}

const db = {
  prepare(sql) { return new Statement(sql); },
  async exec(sql) { await pool.query(sql); },
  // WAL/journal-mode pragma is SQLite-only housekeeping — no Postgres equivalent needed.
  pragma() {},
};

export default db;
