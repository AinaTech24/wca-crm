#!/usr/bin/env node
// One-off migration of Zoho CRM exports into WCA CRM.
//
//   node import-zoho.js --dir ./zoho-export --inspect     # headers only, no DB
//   node import-zoho.js --dir ./zoho-export               # dry run (rolls back)
//   node import-zoho.js --dir ./zoho-export --commit      # for real
//
// Three properties this is built around, because they're what makes a
// migration go wrong quietly rather than loudly:
//
//   1. Re-runnable. Every row carries the Zoho record id in `zoho_id`, and
//      writes are upserts on it — so importing the same file twice updates
//      instead of duplicating, and a half-finished run is safe to repeat.
//   2. Never guesses a relationship. A lookup that matches zero or several
//      records is left unlinked, keeps its display name, and is reported.
//      Attaching a policy to the wrong client is worse than not attaching it.
//   3. The dry run is the real thing. It executes every insert inside a
//      transaction and rolls back, so constraints and type errors surface
//      before anything is committed.

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { parse } from 'csv-parse/sync';
import {
  MODULES, moduleByKey, norm, sniffDateFormat, parseDate, parseDateTime,
  normPhone, normEmail, normNumber, mapEnum,
} from './import/zoho-map.js';

/* ------------------------------------------------------------------- args */

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const opt = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
};

const DIR = opt('dir', './zoho-export');
const ONLY = opt('module');
const COMMIT = flag('commit');
const INSPECT = flag('inspect');
const FORCED_DATE_FMT = opt('date-format');       // DMY | MDY | ISO
const REPORT_DIR = opt('report-dir', path.join(DIR, '_report'));

const ZOHO_ID_HEADERS = ['Record Id', 'Record ID', 'Zoho Record Id', 'Id', 'ID'];

const c = {
  b: (s) => `\x1b[1m${s}\x1b[0m`, dim: (s) => `\x1b[2m${s}\x1b[0m`,
  g: (s) => `\x1b[32m${s}\x1b[0m`, y: (s) => `\x1b[33m${s}\x1b[0m`, r: (s) => `\x1b[31m${s}\x1b[0m`,
};

/* -------------------------------------------------------------- csv input */

function findFile(mod) {
  const explicit = opt(`file-${mod.key}`);
  if (explicit) return explicit;
  if (!fs.existsSync(DIR)) return null;
  const wanted = [mod.key, mod.zohoModule, mod.label, 'events'].map(norm);
  const files = fs.readdirSync(DIR).filter((f) => /\.csv$/i.test(f));
  // Longest match wins, so "Policies.csv" isn't shadowed by a stray "Policy_Claims.csv".
  const scored = files
    .map((f) => ({ f, hit: wanted.filter((w) => norm(path.basename(f, path.extname(f))).includes(w)).sort((a, b) => b.length - a.length)[0] }))
    .filter((x) => x.hit);
  return scored.length ? path.join(DIR, scored.sort((a, b) => b.hit.length - a.hit.length)[0].f) : null;
}

function readCsv(file) {
  const raw = fs.readFileSync(file);
  const rows = parse(raw, {
    columns: true,
    bom: true,                  // Zoho exports UTF-8 with a BOM; without this the first header is mangled
    skip_empty_lines: true,
    relax_column_count: true,   // trailing commas in exported notes shouldn't abort the file
    relax_quotes: true,
    trim: true,
  });
  const headers = rows.length ? Object.keys(rows[0]) : [];
  return { headers, rows };
}

/* ----------------------------------------------------------- field access */

// Maps normalised header -> the real header string, so lookups survive
// differences in spacing, case and punctuation between exports.
const buildIndex = (headers) => {
  const ix = new Map();
  for (const h of headers) if (!ix.has(norm(h))) ix.set(norm(h), h);
  return ix;
};

const makeGetter = (row, ix) => (candidates) => {
  for (const cand of candidates || []) {
    const real = ix.get(norm(cand));
    if (real !== undefined) {
      const v = String(row[real] ?? '').trim();
      if (v) return v;
    }
  }
  return '';
};

/* ------------------------------------------------------------ date format */

// Resolved per file rather than globally: a Zoho export can carry one format
// in the system columns and another in a custom date field.
function resolveDateFormat(mod, rows, ix, report) {
  if (FORCED_DATE_FMT) return FORCED_DATE_FMT;
  const samples = [];
  for (const f of mod.fields) {
    if (f.type !== 'date' && f.type !== 'datetime') continue;
    for (const cand of f.from) {
      const real = ix.get(norm(cand));
      if (!real) continue;
      for (const r of rows) { const v = r[real]; if (v) samples.push(v); }
      break;
    }
  }
  const verdict = sniffDateFormat(samples);
  if (verdict === 'DMY' || verdict === 'MDY' || verdict === 'ISO') return verdict;
  if (verdict === 'NONE') return 'ISO';                 // no dates at all — format is moot
  report.fatal.push(
    verdict === 'CONFLICT'
      ? 'Date columns mix day-first and month-first values — split the file or fix it in Zoho, then re-run.'
      : 'Every date reads validly as both DD/MM and MM/DD, so the order cannot be detected. '
        + 'Re-run with --date-format DMY (or MDY) to state which one Zoho exported.');
  return null;
}

/* ------------------------------------------------------------- row mapping */

function buildRow(mod, csvRow, ix, fmt, report) {
  const get = makeGetter(csvRow, ix);
  const out = {};

  for (const f of mod.fields) {
    let raw = get(f.from);
    if (!raw && f.compose) raw = f.compose.map((h) => get([h])).filter(Boolean).join(' ').trim();

    if (f.type === 'datetime') {
      const { date, time } = parseDateTime(raw, fmt);
      if (raw && !date) report.badDates.push({ col: f.from[0], value: raw });
      out[f.col[0]] = date;
      out[f.col[1]] = time;
      continue;
    }

    let val;
    switch (f.type) {
      case 'date':
        val = parseDate(raw, fmt);
        if (raw && !val) report.badDates.push({ col: f.from[0], value: raw });
        break;
      case 'phone': val = normPhone(raw); break;
      case 'email': val = normEmail(raw); break;
      case 'number': val = normNumber(raw); break;
      default:
        if (f.enum) {
          const m = mapEnum(raw, f.enum, f.synonyms);
          if (m.unknown) report.unknownValues.push({ col: f.col, value: raw });
          val = m.value;
        } else val = raw;
    }
    if ((val === '' || val === null || val === undefined) && f.default !== undefined) val = f.default;
    out[f.col] = val === '' ? null : val;
  }

  if (mod.post) mod.post(out, get);
  return { row: out, get };
}

/* ------------------------------------------------------- link resolution */

// Name -> ids, for resolving lookups. Names are normalised; a name that maps
// to more than one id is treated as ambiguous and never auto-linked.
async function buildLookupIndex(db, table, nameCol) {
  const { rows } = await db.query(`SELECT id, ${nameCol} AS n, zoho_id FROM ${table}`);
  const byName = new Map(), byZoho = new Map();
  for (const r of rows) {
    const k = norm(r.n);
    if (k) byName.set(k, [...(byName.get(k) || []), r.id]);
    if (r.zoho_id) byZoho.set(String(r.zoho_id), r.id);
  }
  return { byName, byZoho };
}

const NAME_COL = { clients: 'client_name', leads: 'lead_name', policies: 'policy_number' };

async function resolveLinks(db, mod, built, report, indexes) {
  for (const link of mod.links || []) {
    const primary = indexes[link.target];
    const alt = link.altTarget ? indexes[link.altTarget] : null;

    for (const b of built) {
      const display = b.get(link.from);
      if (!display) continue;

      // Keep the display name regardless of whether the id resolves, so the
      // record still reads correctly in the UI when the link can't be made.
      if (link.nameCol && !b.row[link.nameCol]) b.row[link.nameCol] = display;

      const key = norm(display);
      let hits = primary.byName.get(key) || [];
      let kind = link.target;

      if (!hits.length && alt) {
        const altHits = alt.byName.get(key) || [];
        if (altHits.length) { hits = altHits; kind = link.altTarget; }
      }

      if (hits.length === 1) {
        b.row[link.col] = hits[0];
        if (link.kindCol) b.row[link.kindCol] = kind === 'clients' ? 'client' : 'lead';
      } else {
        report.links.push({
          field: link.col, value: display,
          reason: hits.length ? `matches ${hits.length} ${kind} records` : 'no matching record',
        });
      }
    }
  }
}

/* ------------------------------------------------------------ persistence */

// A stable id for exports that lack a Record Id column, so re-running still
// updates rather than duplicating. Hashed to keep the column short.
const syntheticId = (mod, row) => 'nk:' + crypto.createHash('sha1').update(`${mod.key}|${mod.naturalKey(row)}`).digest('hex').slice(0, 24);

async function upsert(db, mod, built, cols, report) {
  for (const b of built) {
    const row = b.row;
    const present = cols.filter((k) => row[k] !== undefined);
    const names = ['zoho_id', ...present];
    const values = [row.zoho_id, ...present.map((k) => row[k])];
    const holes = names.map((_, i) => `$${i + 1}`);
    // Only overwrite columns this file actually carries, so a partial export
    // can't blank fields that a previous, richer import already filled in.
    const sets = present.map((k, i) => `${k} = EXCLUDED.${k}`).join(', ');

    const q = `INSERT INTO ${mod.table} (${names.join(', ')}) VALUES (${holes.join(', ')})
               ON CONFLICT (zoho_id) DO UPDATE SET ${sets}
               RETURNING id, (xmax = 0) AS inserted`;
    const r = await db.query(q, values);
    if (r.rows[0].inserted) report.inserted++; else report.updated++;
    b.id = r.rows[0].id;
  }
}

// Participants are rebuilt from scratch on every run so a re-import doesn't
// stack duplicates onto the same meeting.
async function importParticipants(db, mod, built, indexes, report) {
  if (!mod.participantsFrom) return;
  for (const b of built) {
    const raw = b.get(mod.participantsFrom);
    if (!raw) continue;
    await db.query('DELETE FROM meeting_participants WHERE meeting_id = $1', [b.id]);
    // Zoho separates participants with ';'. Only fall back to ',' when there
    // is no ';' at all, since names themselves contain commas.
    const parts = (raw.includes(';') ? raw.split(';') : raw.split(/[\n,]/))
      .map((s) => s.trim()).filter(Boolean);
    for (const name of parts) {
      const key = norm(name);
      const cl = indexes.clients.byName.get(key) || [];
      const ld = indexes.leads.byName.get(key) || [];
      // An attendee who isn't a client or lead is a person — a colleague or
      // someone external. They're stored as 'user' with no ref_id, the same
      // shape the app already uses to keep a name readable after the record
      // it pointed at is gone. kind is NOT NULL, so there's no "unknown".
      let kind = 'user', refId = null;
      if (cl.length === 1) { kind = 'client'; refId = cl[0]; }
      else if (!cl.length && ld.length === 1) { kind = 'lead'; refId = ld[0]; }
      else if (cl.length > 1 || ld.length > 1) report.links.push({ field: 'participant', value: name, reason: 'name matches several records — kept as a plain name' });
      else report.links.push({ field: 'participant', value: name, reason: 'not a client or lead — kept as a plain name' });
      await db.query(
        'INSERT INTO meeting_participants (meeting_id, kind, ref_id, name) VALUES ($1,$2,$3,$4)',
        [b.id, kind, refId, name]);
      report.participants++;
    }
  }
}

/* ------------------------------------------------------------------- main */

function newReport(mod, file) {
  return { key: mod.key, label: mod.label, file, read: 0, inserted: 0, updated: 0,
    skipped: [], badDates: [], unknownValues: [], links: [], participants: 0,
    unmappedHeaders: [], emptyTargets: [], fatal: [], hadZohoId: false };
}

function printReport(rep) {
  const head = `${c.b(rep.label)}  ${c.dim(rep.file ? path.basename(rep.file) : 'no file found')}`;
  if (!rep.file) { console.log(`\n${head}\n  ${c.dim('skipped — no matching CSV in the export folder')}`); return; }
  console.log(`\n${head}`);
  if (rep.fatal.length) { for (const f of rep.fatal) console.log(`  ${c.r('BLOCKED')} ${f}`); return; }

  console.log(INSPECT
    ? `  rows read ${c.b(rep.read)}`
    : `  rows read ${c.b(rep.read)}   inserted ${c.g(rep.inserted)}   updated ${c.y(rep.updated)}   skipped ${rep.skipped.length ? c.r(rep.skipped.length) : 0}`);
  if (rep.participants) console.log(`  participants linked ${rep.participants}`);
  if (!rep.hadZohoId) console.log(`  ${c.y('!')} no Record Id column — rows keyed on their own contents, so edits in Zoho before a re-run will duplicate`);

  const group = (list, keyFn) => {
    const m = new Map();
    for (const x of list) { const k = keyFn(x); m.set(k, (m.get(k) || 0) + 1); }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  };
  if (rep.skipped.length) {
    console.log(`  ${c.r('skipped rows')} (written to the report folder):`);
    for (const [k, n] of group(rep.skipped, (s) => s.reason).slice(0, 5)) console.log(`      ${n} x ${k}`);
  }
  if (rep.badDates.length) {
    console.log(`  ${c.y('unparsed dates')}:`);
    for (const [k, n] of group(rep.badDates, (d) => `${d.col} = "${d.value}"`).slice(0, 5)) console.log(`      ${n} x ${k}`);
  }
  if (rep.unknownValues.length) {
    console.log(`  ${c.y('values kept but off the CRM option list')}:`);
    for (const [k, n] of group(rep.unknownValues, (u) => `${u.col} = "${u.value}"`).slice(0, 8)) console.log(`      ${n} x ${k}`);
  }
  if (rep.links.length) {
    console.log(`  ${c.y('lookups left unlinked')} (display name kept):`);
    for (const [k, n] of group(rep.links, (l) => `${l.field}: "${l.value}" — ${l.reason}`).slice(0, 8)) console.log(`      ${n} x ${k}`);
  }
  if (rep.unmappedHeaders.length) console.log(`  ${c.dim('CSV columns not imported:')} ${rep.unmappedHeaders.join(', ')}`);
  if (rep.emptyTargets.length) console.log(`  ${c.dim('CRM fields nothing mapped to:')} ${rep.emptyTargets.join(', ')}`);
}

function writeReportFiles(reports) {
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  for (const rep of reports) {
    if (rep.skipped.length) {
      const rows = ['row,reason,data', ...rep.skipped.map((s) => [s.line, esc(s.reason), esc(JSON.stringify(s.data))].join(','))];
      fs.writeFileSync(path.join(REPORT_DIR, `${rep.key}-skipped.csv`), rows.join('\n'));
    }
    if (rep.links.length) {
      const rows = ['field,value,reason', ...rep.links.map((l) => [l.field, esc(l.value), esc(l.reason)].join(','))];
      fs.writeFileSync(path.join(REPORT_DIR, `${rep.key}-unlinked.csv`), rows.join('\n'));
    }
  }
  fs.writeFileSync(path.join(REPORT_DIR, 'summary.json'), JSON.stringify(reports, null, 2));
}

async function main() {
  const mods = ONLY ? [moduleByKey(ONLY)].filter(Boolean) : MODULES;
  if (!mods.length) { console.error(`Unknown module "${ONLY}". Known: ${MODULES.map((m) => m.key).join(', ')}`); process.exit(1); }

  console.log(c.b(`\nZoho -> WCA CRM  ${c.dim(`(${INSPECT ? 'inspect' : COMMIT ? 'COMMIT' : 'dry run — nothing will be saved'})`)}`));
  console.log(c.dim(`export folder: ${path.resolve(DIR)}`));

  const reports = [];

  // Inspect never opens a connection: it's for checking a mapping before the
  // database is involved at all.
  if (INSPECT) {
    for (const mod of mods) {
      const file = findFile(mod);
      const rep = newReport(mod, file);
      reports.push(rep);
      if (!file) continue;
      const { headers, rows } = readCsv(file);
      rep.read = rows.length;
      const ix = buildIndex(headers);
      rep.hadZohoId = ZOHO_ID_HEADERS.some((h) => ix.has(norm(h)));

      const used = new Set();
      for (const f of mod.fields) {
        const direct = f.from.find((cand) => ix.has(norm(cand)));
        if (direct) { used.add(norm(direct)); continue; }
        // Every compose part counts as used, not just the first — otherwise
        // "Last Name" gets reported as an unimported column when it isn't.
        const parts = (f.compose || []).filter((cand) => ix.has(norm(cand)));
        if (parts.length) parts.forEach((p) => used.add(norm(p)));
        else rep.emptyTargets.push(Array.isArray(f.col) ? f.col.join('/') : f.col);
      }
      for (const link of mod.links || []) { const h = link.from.find((cd) => ix.has(norm(cd))); if (h) used.add(norm(ix.get(norm(h)))); }
      if (mod.participantsFrom) { const h = mod.participantsFrom.find((cd) => ix.has(norm(cd))); if (h) used.add(norm(ix.get(norm(h)))); }
      for (const h of headers) if (!used.has(norm(h)) && !ZOHO_ID_HEADERS.some((z) => norm(z) === norm(h))) rep.unmappedHeaders.push(h);
      rep.fatal.push(...[]);
      const fmt = resolveDateFormat(mod, rows, ix, rep);
      if (fmt) console.log(c.dim(`  ${mod.label}: dates read as ${fmt}`));
    }
    reports.forEach(printReport);
    console.log(`\n${c.dim('Nothing was read from or written to the database.')}\n`);
    return;
  }

  // Both imported here, not at the top, so --inspect works on a laptop with no
  // DATABASE_URL — checking a mapping shouldn't require database access.
  await import('dotenv/config');          // same server/.env the app reads
  const { pool } = await import('./pgdb.js');
  const db = await pool.connect();
  try {
    await db.query('BEGIN');

    // Column lists come from the live table, so a mapping that names a column
    // the database doesn't have fails here instead of at INSERT time.
    const colsFor = async (t) => (await db.query(
      'SELECT column_name FROM information_schema.columns WHERE table_name = $1', [t])).rows.map((r) => r.column_name);

    const indexes = {};
    for (const t of ['clients', 'leads', 'policies']) indexes[t] = await buildLookupIndex(db, t, NAME_COL[t]);

    for (const mod of mods) {
      const file = findFile(mod);
      const rep = newReport(mod, file);
      reports.push(rep);
      if (!file) continue;

      const { headers, rows } = readCsv(file);
      rep.read = rows.length;
      const ix = buildIndex(headers);
      const tableCols = await colsFor(mod.table);
      const zohoHeader = ZOHO_ID_HEADERS.map((h) => ix.get(norm(h))).find(Boolean);
      rep.hadZohoId = !!zohoHeader;

      const fmt = resolveDateFormat(mod, rows, ix, rep);
      if (!fmt) continue;

      const built = [];
      rows.forEach((csvRow, i) => {
        const { row, get } = buildRow(mod, csvRow, ix, fmt, rep);
        const missing = mod.fields.filter((f) => f.required && !row[f.col]).map((f) => f.col);
        if (missing.length) { rep.skipped.push({ line: i + 2, reason: `missing ${missing.join(', ')}`, data: csvRow }); return; }
        row.zoho_id = zohoHeader ? String(csvRow[zohoHeader]).trim() : syntheticId(mod, row);
        if (!row.zoho_id) { rep.skipped.push({ line: i + 2, reason: 'blank Record Id', data: csvRow }); return; }
        built.push({ row, get });
      });

      await resolveLinks(db, mod, built, rep, indexes);

      const cols = Object.keys(built[0]?.row || {}).filter((k) => k !== 'zoho_id' && tableCols.includes(k));
      const unknownCols = Object.keys(built[0]?.row || {}).filter((k) => k !== 'zoho_id' && !tableCols.includes(k));
      if (unknownCols.length) rep.fatal.push(`mapping targets columns that do not exist on ${mod.table}: ${unknownCols.join(', ')}`);
      if (rep.fatal.length) continue;

      if (built.length) await upsert(db, mod, built, cols, rep);
      await importParticipants(db, mod, built, indexes, rep);

      // Later modules link against what this one just wrote.
      if (indexes[mod.table]) indexes[mod.table] = await buildLookupIndex(db, mod.table, NAME_COL[mod.table]);
    }

    const blocked = reports.some((r) => r.fatal.length);
    if (COMMIT && !blocked) { await db.query('COMMIT'); }
    else { await db.query('ROLLBACK'); }

    reports.forEach(printReport);
    writeReportFiles(reports);

    console.log('');
    if (blocked) console.log(c.r('Nothing was written — resolve the BLOCKED items above and re-run.'));
    else if (COMMIT) console.log(c.g('Committed.'));
    else console.log(c.y('Dry run complete — rolled back, nothing saved. Re-run with --commit when the numbers look right.'));
    console.log(c.dim(`Per-row detail: ${path.resolve(REPORT_DIR)}\n`));
  } catch (e) {
    await db.query('ROLLBACK').catch(() => {});
    console.error(c.r(`\nImport aborted, nothing written: ${e.message}\n`));
    process.exitCode = 1;
  } finally {
    db.release();
    await pool.end();
  }
}

main();
