import { useEffect, useState } from 'react';
import { api } from '../api.js';
import PageHeader from '../components/PageHeader.jsx';
import DataTable from '../components/DataTable.jsx';
import { Ic } from '../components/Icons.jsx';
import { useRealtime } from '../realtime.js';

const inr = (v) => Number(v || 0).toLocaleString('en-IN');

export default function RenewalView({ line }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [flash, setFlash] = useState(() => new Set());

  useEffect(() => {
    setLoading(true);
    const qs = line ? '?line=' + line : '';
    api('/policies' + qs).then(setRows).finally(() => setLoading(false));
  }, [line]);

  function markFlash(id) {
    if (id == null) return;
    setFlash((s) => new Set(s).add(id));
    setTimeout(() => setFlash((s) => { const n = new Set(s); n.delete(id); return n; }), 1600);
  }
  useRealtime('policy', (evt) => {
    const p = evt.data;
    if (line && p && p.insurance_line !== line) return;
    setRows((prev) => {
      if (evt.action === 'created') return prev.some((x) => x.id === p.id) ? prev : [p, ...prev];
      if (evt.action === 'updated') return prev.map((x) => (x.id === p.id ? p : x));
      return prev;
    });
    markFlash(p?.id);
  });

  const columns = [
    { key: 'period_to', label: 'Policy Expiry', render: (r) => <b>{r.period_to || '—'}</b> },
    { key: 'insured_name', label: 'Insured Name' },
    { key: 'company_name', label: 'Company' },
    { key: 'product_name', label: 'Product' },
    { key: 'policy_number', label: 'Policy No' },
    { key: 'reg_no', label: 'Reg No', render: (r) => r.reg_no || '—' },
    { key: 'sum_assured', label: 'Sum Assured', num: true, render: (r) => inr(r.sum_assured) },
    { key: 'final_premium', label: 'Premium', num: true, render: (r) => inr(r.final_premium) },
  ];

  return (
    <div>
      <PageHeader title="Renewal View" subtitle="Policies coming up for renewal" />
      <div className="card">
          <DataTable
            title="Upcoming Renewals"
            count={rows.length}
            index
            loading={loading}
            rows={rows}
            flash={flash}
            columns={columns}
            searchPlaceholder="Search insured or policy no…"
            actions={() => <button className="action-btn" title="Renew"><Ic name="refresh" size={15} /></button>}
            empty={{ icon: 'refresh', title: 'No renewals', sub: 'Policies appear here as their renewal date approaches.' }}
          />
      </div>
    </div>
  );
}
