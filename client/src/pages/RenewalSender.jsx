import { useEffect, useState } from 'react';
import { api } from '../api.js';
import toast from '../components/toast.js';
import PageHeader from '../components/PageHeader.jsx';
import DataTable from '../components/DataTable.jsx';
import { Ic } from '../components/Icons.jsx';

// Powers SMS/Mail Management renewal screens (GI/LI WA & Mail Renewal, Birthday/Anniversary).
export default function RenewalSender({ title, channel, line }) {
  const [rows, setRows] = useState([]);
  const [sel, setSel] = useState(() => new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true); setSel(new Set());
    const qs = line ? '?line=' + line : '';
    api('/policies' + qs).then(setRows).finally(() => setLoading(false));
  }, [title, line]);

  function toggle(id) { setSel((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; }); }
  function toggleAll() { setSel((prev) => prev.size === rows.length ? new Set() : new Set(rows.map((r) => r.id))); }
  function send() {
    if (sel.size === 0) { toast.error('Select at least one recipient.'); return; }
    const n = sel.size;
    setSel(new Set());
    toast.success(`${channel === 'wa' ? 'WhatsApp' : 'Email'} reminders queued for ${n} recipient(s)`);
  }

  const columns = [
    { key: 'insured_name', label: 'Insured Name' },
    { key: 'company_name', label: 'Company' },
    { key: 'product_name', label: 'Product' },
    { key: 'policy_number', label: 'Policy No' },
    { key: 'period_to', label: 'Expiry' },
    { key: 'final_premium', label: 'Premium', num: true, render: (r) => Number(r.final_premium || 0).toLocaleString('en-IN') },
  ];

  return (
    <div>
      <PageHeader
        title={title}
        subtitle={`Select recipients and send ${channel === 'wa' ? 'WhatsApp' : 'email'} reminders`}
        action={<button className="btn blue" onClick={send}><Ic name={channel === 'wa' ? 'phone' : 'mail'} size={15} /> {channel === 'wa' ? 'Send WhatsApp' : 'Send Mail'} ({sel.size})</button>}
      />
      <div className="card">
        <DataTable
          title={<>Recipients <span className="sub">({rows.length} · {sel.size} selected)</span></>}
          searchPlaceholder="Search recipients…"
          index
          loading={loading}
          rows={rows}
          columns={columns}
          selectable
          selected={sel}
          onToggleRow={toggle}
          onToggleAll={toggleAll}
          empty={{ icon: 'mail', title: 'No recipients', sub: 'Policies due for renewal appear here to notify.' }}
        />
      </div>
    </div>
  );
}
