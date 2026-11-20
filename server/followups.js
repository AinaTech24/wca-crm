// Follow-ups the CRM does by itself, and suggestions it makes:
//   - claims: while documents are still pending, the client is reminded every few days (at most a few
//     times); a claim still open after 30 / 60 / 90 days raises a bell alert;
//   - cross-sell: for a client, what they already hold and what they are missing, to turn into a lead.

const CLOSED = ['Settled', 'Rejected', 'Withdrawn', 'Closed'];
const REMIND_EVERY_DAYS = 3;
const MAX_REMINDERS = 5;
const today = () => new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Kolkata' }).slice(0, 10);

// What a client could be offered, by whether they are a person or a business.
const PERSONAL = [
  { product: 'Health', covers: ['Health', 'Super Top Up', 'SISO', 'Critical Illness'], reason: 'No health cover on file' },
  { product: 'Life / Term', covers: ['Term', 'Endowment', 'ULIP', 'Money Back', 'Whole Life', 'Pension / Annuity', 'Child Plan'], reason: 'No life cover on file' },
  { product: 'Personal Accident', covers: ['Personal Accident'], reason: 'No personal accident cover' },
  { product: 'Super Top Up', covers: ['Super Top Up'], needs: ['Health'], reason: 'Has a base health policy — a super top-up raises the cover cheaply' },
  { product: 'Householder', covers: ['Householder', 'Fire & Property'], reason: 'Home and contents not insured' },
];
const BUSINESS = [
  { product: 'Workmen Compensation', covers: ['Workmen Compensation'], reason: 'Employees not covered under WC' },
  { product: 'Group Health Insurance', covers: ['Group Health', 'Group Health Insurance'], reason: 'No group health for employees' },
  { product: 'Group Personal Accident', covers: ['Group Personal Accident'], reason: 'No group PA for employees' },
  { product: 'Fire & Property', covers: ['Fire & Property'], reason: 'Premises / stock not insured' },
  { product: 'Liability', covers: ['Liability'], reason: 'No liability cover' },
  { product: 'Group Term Life', covers: ['Group Term Life'], reason: 'No group term life' },
];

export function registerFollowups(app, { db, auth, notifyOnce, sendAuto, denyRecordAccess }) {
  // ---- claims ----
  async function claimSweep() {
    try {
      const t = today();
      const open = await db.prepare(`SELECT c.*, cl.email AS client_email_row FROM claims c LEFT JOIN clients cl ON cl.id = c.client_id
        WHERE COALESCE(c.status, '') NOT IN (${CLOSED.map(() => '?').join(',')})`).all(...CLOSED);
      for (const c of open) {
        // Still open after 30 / 60 / 90 days: one alert at each mark.
        const start = /^\d{4}-\d{2}-\d{2}/.test(c.claim_date || '') ? c.claim_date.slice(0, 10) : (c.intimation_date || '').slice(0, 10);
        if (/^\d{4}-\d{2}-\d{2}$/.test(start)) {
          const days = Math.floor((Date.parse(t) - Date.parse(start)) / 86400000);
          for (const mark of [90, 60, 30]) {
            if (days >= mark) {
              await notifyOnce(`claim_open_${mark}`, 'claims', c.id, { entity: 'claim', icon: 'alert', tone: mark >= 60 ? 'danger' : 'warning', link: '/page/claim',
                title: `Claim open ${mark}+ days`, body: `${c.claim_no || 'Claim'} · ${c.client_name || ''} · ${c.company_name || ''} · ${c.status || 'Pending'}` });
              break;
            }
          }
        }
        // Documents still awaited: remind the client every few days, a few times.
        const pending = String(c.pending_documents || '').trim();
        const to = c.client_email_row || '';
        if (!pending || !to || (Number(c.docs_reminders) || 0) >= MAX_REMINDERS) continue;
        if (c.docs_reminder_at && (Date.parse(t) - Date.parse(c.docs_reminder_at.slice(0, 10))) / 86400000 < REMIND_EVERY_DAYS) continue;
        await db.prepare('UPDATE claims SET docs_reminder_at = ?, docs_reminders = COALESCE(docs_reminders, 0) + 1 WHERE id = ?').run(t, c.id);
        await sendAuto('claim-docs-pending', to, {
          client: c.client_name || 'Customer', claim_no: c.claim_no || c.intimation_no || '', company: c.company_name || '',
          documents: pending.split(/\r?\n|,|;/).map((x) => x.trim()).filter(Boolean).map((x) => '• ' + x).join('<br>'),
        }, { kind: 'claim', id: c.id }, [], c.owner ? { name: c.owner, logSkip: false } : null);
      }
    } catch (e) { console.error('claim sweep failed:', e.message); }
  }
  setTimeout(claimSweep, 45 * 1000);
  setInterval(claimSweep, 6 * 60 * 60 * 1000);

  // ---- cross-sell ----
  app.get('/api/clients/:id/cross-sell', auth, async (req, res) => {
    const c = await db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id);
    if (!c) return res.status(404).json({ error: 'Not found' });
    const pols = await db.prepare(`SELECT insurance_type FROM policies WHERE (client_id = ? OR (client_id IS NULL AND LOWER(TRIM(insured_name)) = LOWER(TRIM(?))))
      AND COALESCE(policy_status, '') NOT IN ('Lost', 'Cancelled') AND COALESCE(active_status, 'Active') <> 'Inactive'`).all(c.id, c.client_name || '');
    // What they hold: their policies here, plus what the client record says they have elsewhere
    // (the Yes / No product flags brought over from Zoho).
    const yes = (v) => /^(yes|y|true|1|done|active)$/i.test(String(v || '').trim());
    const FLAGS = { health_insurance: 'Health', siso: 'Health', super_top_up: 'Super Top Up', life_insurance: 'Term', ulip: 'ULIP', personal_accident: 'Personal Accident' };
    const held = [...new Set([...pols.map((p) => p.insurance_type), ...Object.entries(FLAGS).filter(([k]) => yes(c[k])).map(([, v]) => v)].filter(Boolean))];
    const business = yes(c.corporate_insurance) || !!String(c.company_name || '').trim() || !!String(c.gstin || '').trim()
      || /\b(pvt|private|ltd|limited|llp|industries|enterprises|corporation|traders|company)\b/i.test(c.client_name || '');
    const has = (list) => list.some((x) => held.includes(x));
    const leads = await db.prepare("SELECT id, expected_business_type, status FROM leads WHERE (client_id = ? OR (client_id IS NULL AND LOWER(TRIM(lead_name)) = LOWER(TRIM(?)))) AND COALESCE(status, '') NOT IN ('Converted', 'Lost', 'Junk')").all(c.id, c.client_name || '');
    const suggestions = (business ? BUSINESS : PERSONAL)
      .filter((s) => !has(s.covers) && (!s.needs || has(s.needs)))
      .map((s) => ({ product: s.product, reason: s.reason, lead: leads.find((l) => l.expected_business_type === s.product) || null }));
    res.json({ held, business, suggestions });
  });
}
