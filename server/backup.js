// Nightly backups of the whole database, kept on the server for a week, and downloadable by an admin.
//
// Each backup is one gzipped file of JSON lines — {"table": …} then one line per row — written table by
// table in pages, so a large table never has to sit in memory at once. Restoring is a deliberate, manual
// job, not a button: `node restore-backup.js <file>` reads it back into an empty database.
//
// Where the server has PostgreSQL's own pg_dump, a native dump (.dump) is taken alongside — the fastest and
// most faithful restore (pg_restore). If BACKUP_COPY_CMD is set in the server .env, it is run after each backup
// with {file} replaced by the backup's path, e.g.  BACKUP_COPY_CMD=rclone copy {file} gdrive:wca-backups
// — that is how a copy leaves the server. A failed backup tells the admins (bell notification).

import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';
import { execFile, exec } from 'child_process';

const DIR = process.env.BACKUP_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'backups');
const KEEP = 7;
const PAGE = 300;
const NAME_RE = /^wca-(backup|dump)-\d{4}-\d{2}-\d{2}-\d{4}\.(jsonl\.gz|dump)$/;
const istStamp = () => new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Kolkata' }).replace(' ', '-').replace(/:/g, '').slice(0, 15);

export function registerBackups(app, { db, auth, notify }) {
  const isAdmin = async (req) => (await db.prepare('SELECT role FROM users WHERE id = ?').get(req.user.id))?.role === 'admin';
  let running = null;

  async function run() {
    if (running) return running;
    running = (async () => {
      fs.mkdirSync(DIR, { recursive: true });
      const file = path.join(DIR, `wca-backup-${istStamp().slice(0, 10)}-${istStamp().slice(11, 15)}.jsonl.gz`);
      const tmp = file + '.part';
      const gz = zlib.createGzip();
      const out = fs.createWriteStream(tmp);
      gz.pipe(out);
      const write = (obj) => new Promise((resolve) => { if (gz.write(JSON.stringify(obj) + '\n')) resolve(); else gz.once('drain', resolve); });
      const tables = (await db.prepare("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name").all()).map((t) => t.table_name);
      let rows = 0;
      for (const t of tables) {
        await write({ table: t });
        const hasId = await db.prepare("SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ? AND column_name = 'id'").get(t);
        if (hasId) {
          let last = 0;
          for (;;) {
            const page = await db.prepare(`SELECT * FROM "${t}" WHERE id > ? ORDER BY id LIMIT ${PAGE}`).all(last);
            for (const r of page) { await write({ row: r }); rows++; }
            if (page.length < PAGE) break;
            last = page[page.length - 1].id;
          }
        } else {
          for (const r of await db.prepare(`SELECT * FROM "${t}"`).all()) { await write({ row: r }); rows++; }
        }
      }
      await new Promise((resolve, reject) => { out.on('finish', resolve); out.on('error', reject); gz.end(); });
      fs.renameSync(tmp, file);
      // A native PostgreSQL dump as well, where pg_dump is installed (it is on the VPS, next to Postgres).
      const dump = file.replace('wca-backup-', 'wca-dump-').replace('.jsonl.gz', '.dump');
      const dumped = await new Promise((resolve) => {
        if (!process.env.DATABASE_URL) return resolve(false);
        execFile('pg_dump', ['-Fc', '-f', dump, process.env.DATABASE_URL], { timeout: 20 * 60 * 1000 }, (err) => {
          if (err) { try { fs.unlinkSync(dump); } catch {} resolve(false); } else resolve(true);
        });
      });
      // Keep the newest few of each kind.
      for (const kind of ['wca-backup-', 'wca-dump-']) {
        const all = fs.readdirSync(DIR).filter((n) => NAME_RE.test(n) && n.startsWith(kind)).sort().reverse();
        for (const old of all.slice(KEEP)) fs.unlinkSync(path.join(DIR, old));
      }
      // Off the server, if a copy command is set up.
      let copied = null;
      if (process.env.BACKUP_COPY_CMD) {
        for (const f of [file, dumped ? dump : null].filter(Boolean)) {
          copied = await new Promise((resolve) => exec(process.env.BACKUP_COPY_CMD.split('{file}').join(JSON.stringify(f)), { timeout: 30 * 60 * 1000 }, (err, _o, se) => resolve(err ? 'failed: ' + String(se || err.message).slice(0, 200) : 'copied')));
          if (copied !== 'copied') throw new Error('the off-server copy ' + copied);
        }
      }
      console.log(`backup written: ${path.basename(file)} (${tables.length} tables, ${rows} rows)${dumped ? ' + pg_dump' : ''}${copied ? ' · ' + copied : ''}`);
      return { file: path.basename(file), tables: tables.length, rows, dump: dumped ? path.basename(dump) : null, copied };
    })().finally(() => { running = null; });
    return running;
  }

  // Once a night, a little after 2 AM in India.
  let lastDay = '';
  setInterval(() => {
    const now = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Kolkata' });
    if (now.slice(11, 13) === '02' && lastDay !== now.slice(0, 10)) {
      lastDay = now.slice(0, 10);
      run().catch(async (e) => {
        console.error('backup failed:', e.message);
        // Admins hear about it — a backup that silently stops is the worst kind.
        try { await notify?.({ entity: 'backup', kind: 'backup-failed', icon: 'alert', tone: 'danger', title: 'Tonight’s backup failed', body: e.message.slice(0, 200), link: '/page/team' }); } catch {}
      });
    }
  }, 5 * 60 * 1000);

  app.get('/api/backups', auth, async (req, res) => {
    if (!(await isAdmin(req))) return res.status(403).json({ error: 'Only an admin can see backups' });
    let list = [];
    try { list = fs.readdirSync(DIR).filter((n) => NAME_RE.test(n)).sort().reverse().map((n) => ({ name: n, size: fs.statSync(path.join(DIR, n)).size })); } catch { list = []; }
    res.json({ backups: list, keep: KEEP, running: !!running, offsite: !!process.env.BACKUP_COPY_CMD });
  });
  app.post('/api/backups/run', auth, async (req, res) => {
    if (!(await isAdmin(req))) return res.status(403).json({ error: 'Only an admin can run a backup' });
    try { res.json(await run()); } catch (e) { console.error('backup failed:', e.message); res.status(500).json({ error: 'The backup failed: ' + e.message }); }
  });
  app.get('/api/backups/:name', auth, async (req, res) => {
    if (!(await isAdmin(req))) return res.status(403).json({ error: 'Only an admin can download backups' });
    if (!NAME_RE.test(req.params.name)) return res.status(400).json({ error: 'Not a backup' });
    const file = path.join(DIR, req.params.name);
    if (!fs.existsSync(file)) return res.status(404).json({ error: 'Not found' });
    res.download(file);
  });
}
