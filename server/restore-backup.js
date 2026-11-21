// Restores a nightly backup (wca-backup-….jsonl.gz) into an EMPTY database.
//
//   1. Point DATABASE_URL (in .env or the environment) at a new, empty database.
//   2. Start the CRM once against it (pm2 start / node index.js) so every table is created, then stop it.
//   3. node restore-backup.js /path/to/wca-backup-2026-11-21-0200.jsonl.gz
//
// The CRM's own start-up code creates every table first (exactly as the app does), then the rows are loaded
// table by table and the id counters are moved past the highest id, so new records carry on numbering.
// It refuses to touch a database that already has clients or policies in it — pass --force only if you
// really mean to load the backup on top of existing data.
//
// For a native dump (wca-dump-….dump) use PostgreSQL's own tool instead:
//   pg_restore --no-owner -d "$DATABASE_URL" /path/to/wca-dump-2026-11-21-0200.dump

import 'dotenv/config';
import fs from 'fs';
import zlib from 'zlib';
import readline from 'readline';
import db, { initDb } from './db.js';

const file = process.argv[2];
const force = process.argv.includes('--force');
if (!file || !fs.existsSync(file)) { console.error('Usage: node restore-backup.js <wca-backup-….jsonl.gz> [--force]'); process.exit(1); }

await initDb();
const busy = Number((await db.prepare('SELECT (SELECT COUNT(*) FROM clients) + (SELECT COUNT(*) FROM policies) AS n').get()).n);
const people = Number((await db.prepare('SELECT COUNT(*) AS n FROM users').get()).n);
// A freshly started CRM has one user (the admin) and a few demo rows; anything more means real data is there.
if ((busy > 50 || people > 1) && !force) { console.error(`This database already holds data (${people} users, ${busy} clients/policies). Use an empty database, or pass --force.`); process.exit(1); }

const cols = new Map();
async function columnsOf(t) {
  if (!cols.has(t)) cols.set(t, new Set((await db.prepare("SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ?").all(t)).map((c) => c.column_name)));
  return cols.get(t);
}

// First pass: every table in the backup must exist here, or nothing is loaded.
const wanted = [];
for await (const line of readline.createInterface({ input: fs.createReadStream(file).pipe(zlib.createGunzip()), crlfDelay: Infinity })) {
  if (line.startsWith('{"table"')) wanted.push(JSON.parse(line).table);
}
const missing = [];
for (const t of wanted) if (!(await columnsOf(t)).size) missing.push(t);
if (missing.length) {
  console.error(`These tables are not in this database yet: ${missing.join(', ')}.
Start the CRM once against this database (it creates them), stop it, then run this again.`);
  process.exit(1);
}

const lines = readline.createInterface({ input: fs.createReadStream(file).pipe(zlib.createGunzip()), crlfDelay: Infinity });
let table = null, have = null, rows = 0, skipped = 0;
const counts = {};
for await (const line of lines) {
  if (!line.trim()) continue;
  const rec = JSON.parse(line);
  if (rec.table) {
    table = rec.table;
    have = await columnsOf(table);
    if (!have.size) { console.warn(`  table ${table} does not exist in this version — its rows are skipped`); }
    else if (!force) await db.prepare(`DELETE FROM "${table}"`).run();   // the demo rows a fresh database starts with (never with --force)
    continue;
  }
  if (!table || !have?.size) { skipped++; continue; }
  const keys = Object.keys(rec.row).filter((k) => have.has(k));
  const vals = keys.map((k) => { const v = rec.row[k]; return v !== null && typeof v === 'object' ? JSON.stringify(v) : v; });
  await db.prepare(`INSERT INTO "${table}" (${keys.map((k) => `"${k}"`).join(',')}) VALUES (${keys.map(() => '?').join(',')}) ON CONFLICT DO NOTHING`).run(...vals);
  rows++; counts[table] = (counts[table] || 0) + 1;
}
// Move every id counter past the highest id restored.
for (const t of Object.keys(counts)) {
  if ((await columnsOf(t)).has('id')) {
    await db.prepare(`SELECT setval(pg_get_serial_sequence('"${t}"', 'id'), GREATEST(COALESCE((SELECT MAX(id) FROM "${t}"), 0), 1))`).get().catch(() => {});
  }
}
console.log(`Restored ${rows} rows into ${Object.keys(counts).length} tables${skipped ? ` (${skipped} rows skipped)` : ''}.`);
for (const [t, n] of Object.entries(counts).sort()) console.log(`  ${t}: ${n}`);
process.exit(0);
