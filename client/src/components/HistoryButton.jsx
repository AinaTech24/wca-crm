// "History" on a record: who changed which field, from what to what, and when — newest first, grouped by
// each save. The server records it for every change (server/audit.js).
import { useState } from 'react';
import { api } from '../api.js';
import Modal from './Modal.jsx';
import { Ic } from './Icons.jsx';

const LABELS = {
  insured_name: 'Policy holder', policy_number: 'Policy no', company_name: 'Insurer', insurance_type: 'Policy (product)', product_name: 'Product / plan',
  final_premium: 'Gross premium', net_premium: 'Net premium', gst_amount: 'GST', sum_assured: 'Sum assured', period_from: 'Start date', period_to: 'Expiry date',
  policy_status: 'Status', renewal_status: 'Renewal status', assigned_to: 'Owner', client_id: 'Client', rfq_no: 'RFQ no', client_name: 'Client',
  insurers: 'Insurer quotes', details: 'Details', status: 'Status', not_approved_reason: 'Lost reason', lead_owner: 'Lead owner', policy_doc: 'Policy document',
  claim_amount: 'Claimed', settlement_amount: 'Settled amount', approved_amount: 'Approved amount', due_date: 'Due date', business_type: 'New / Renewal',
};
const label = (k) => LABELS[k] || k.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
const when = (s) => (s ? `${s.slice(8, 10)}-${s.slice(5, 7)}-${s.slice(0, 4)} ${s.slice(11, 16)}` : '');

export default function HistoryButton({ table, id, className = 'btn ghost', label: text = 'History' }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState(null);
  function show() {
    setOpen(true); setRows(null);
    api(`/history/${table}/${id}`).then((d) => setRows(d.rows || [])).catch(() => setRows([]));
  }
  // One group per save: same person, same minute.
  const groups = [];
  for (const r of rows || []) {
    const key = `${r.user_name}|${String(r.at).slice(0, 16)}|${r.action}`;
    const g = groups[groups.length - 1];
    if (g && g.key === key) g.items.push(r); else groups.push({ key, at: r.at, user: r.user_name, action: r.action, items: [r] });
  }
  if (!id) return null;
  return (
    <>
      <button type="button" className={className} onClick={show} title="Who changed what, and when"><Ic name="clock" size={15} /> {text}</button>
      <Modal open={open} onClose={() => setOpen(false)} title="Change history" subtitle="Every change to this record, newest first" icon="clock" size="md" top
        footer={<button className="btn ghost" onClick={() => setOpen(false)}>Close</button>}>
        {!rows && <div className="no-data">Loading…</div>}
        {rows && !rows.length && <div className="no-data">No changes recorded yet. Changes are recorded from now on.</div>}
        <div className="hist">
          {groups.map((g) => (
            <div key={g.key + g.items[0].id} className="hist-g">
              <div className="hist-h"><b>{g.user || 'Someone'}</b> {g.action === 'created' ? 'created it' : g.action === 'deleted' ? 'deleted it' : `changed ${g.items.length} field${g.items.length === 1 ? '' : 's'}`} <span>{when(g.at)}</span></div>
              {g.action === 'updated' && g.items.map((r) => (
                <div key={r.id} className="hist-row">
                  <span className="hist-f">{label(r.field)}</span>
                  <span className="hist-old" title={r.old_value}>{r.old_value || '—'}</span>
                  <Ic name="arrowright" size={12} />
                  <span className="hist-new" title={r.new_value}>{r.new_value || '—'}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </Modal>
    </>
  );
}
