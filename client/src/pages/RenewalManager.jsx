import { useEffect, useState, useMemo } from 'react';
import { api } from '../api.js';
import toast from '../components/toast.js';
import PageHeader from '../components/PageHeader.jsx';
import DataTable from '../components/DataTable.jsx';
import Select from '../components/Select.jsx';
import { Ic } from '../components/Icons.jsx';
import { useRealtime } from '../realtime.js';

const inr = (v) => Number(v || 0).toLocaleString('en-IN');

// Pipeline buckets, most-urgent first. `match` maps a row's server bucket.
const BUCKETS = [
  { key: 'all', label: 'All Due', tone: 'neutral' },
  { key: 'lapsed', label: 'Overdue / Lapsed', tone: 'danger' },
  { key: 'd7', label: '0–7 days', tone: 'danger' },
  { key: 'd15', label: '8–15 days', tone: 'warning' },
  { key: 'd30', label: '16–30 days', tone: 'warning' },
  { key: 'd60', label: '31–60 days', tone: 'neutral' },
  { key: 'd90', label: '61–90 days', tone: 'neutral' },
  { key: 'done', label: 'Actioned', tone: 'success' },
];
const STATUSES = ['Pending', 'In-Process', 'Renewed', 'Renewed Elsewhere', 'Lost'];

function DaysCell({ d }) {
  if (d === null || d === undefined) return <span style={{ color: 'var(--text-3)' }}>—</span>;
  if (d < 0) return <span className="badge red">Overdue {Math.abs(d)}d</span>;
  if (d <= 7) return <span className="badge red">{d}d left</span>;
  if (d <= 15) return <span className="badge orange">{d}d left</span>;
  if (d <= 30) return <span className="badge orange">{d}d</span>;
  return <span style={{ color: 'var(--text-2)', fontWeight: 600 }}>{d}d</span>;
}

export default function RenewalManager() {
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [bucket, setBucket] = useState('all');
  const [flash, setFlash] = useState(() => new Set());

  function load() {
    setLoading(true);
    api('/renewals').then((d) => { setRows(d.rows || []); setSummary(d.summary || null); }).finally(() => setLoading(false));
  }
  useEffect(() => { load(); }, []);

  function markFlash(id) {
    if (id == null) return;
    setFlash((s) => new Set(s).add(id));
    setTimeout(() => setFlash((s) => { const n = new Set(s); n.delete(id); return n; }), 1600);
  }
  // Live: when any policy changes elsewhere, refresh the pipeline quietly.
  useRealtime('policy', () => load());

  const counts = useMemo(() => {
    const b = { all: 0, lapsed: 0, d7: 0, d15: 0, d30: 0, d60: 0, d90: 0, done: 0 };
    for (const r of rows) {
      if (r.bucket === 'done') b.done++;
      else { b.all++; if (b[r.bucket] !== undefined) b[r.bucket]++; }
    }
    return b;
  }, [rows]);

  const filtered = useMemo(() => {
    if (bucket === 'all') return rows.filter((r) => r.bucket !== 'done');
    return rows.filter((r) => r.bucket === bucket);
  }, [rows, bucket]);

  async function setStatus(row, status) {
    const prev = rows;
    setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, renewal_status: status, bucket: ['Renewed', 'Renewed Elsewhere', 'Lost'].includes(status) ? 'done' : r.bucket } : r)));
    markFlash(row.id);
    try {
      await api('/policies/' + row.id, { method: 'PUT', body: { renewal_status: status } });
      toast.success(`${row.insured_name} → ${status}`);
      load();
    } catch (e) {
      setRows(prev);
      toast.error(e.message || 'Could not update');
    }
  }
  function remind(row) {
    toast.success(`Renewal reminder queued for ${row.insured_name}`);
  }

  const s = summary || {};
  const kpis = [
    { label: 'Due in 30 days', num: s.dueSoon || 0, icon: 'calendar', tone: 'warning', hint: `${s.lapsed || 0} overdue / lapsed` },
    { label: 'Premium at risk', num: '₹ ' + inr(s.atRisk || 0), icon: 'rupee', tone: 'warning', hint: 'expiring within 30 days' },
    { label: 'Renewed', num: s.renewed || 0, icon: 'check', tone: 'success', hint: `${s.lost || 0} lost · ${s.elsewhere || 0} elsewhere` },
    { label: 'Conversion', num: (s.conversion || 0) + '%', icon: 'target', tone: (s.conversion || 0) >= 60 ? 'success' : 'info', hint: `${s.actioned || 0} renewals actioned` },
  ];

  return (
    <div>
      <PageHeader title="Renewal Manager" action={<button className="btn ghost" onClick={load}><Ic name="refresh" size={15} /> Refresh</button>} />

      <div className="kpi-grid" style={{ marginBottom: 18 }}>
        {kpis.map((it) => (
          <div className="kpi-card" data-tone={it.tone} key={it.label}>
            <div className="kpi-card-top">
              <span className="kpi-card-ic"><Ic name={it.icon} size={16} /></span>
              <span className="kpi-card-label">{it.label}</span>
            </div>
            <div className="kpi-card-num">{it.num}</div>
            <div className="kpi-card-hint">{it.hint}</div>
          </div>
        ))}
      </div>

      <div className="bucket-chips">
        {BUCKETS.map((b) => (
          <button key={b.key} className={'bucket-chip' + (bucket === b.key ? ' active' : '')} data-tone={b.tone} onClick={() => setBucket(b.key)}>
            {b.label}
            <span className="bucket-count">{counts[b.key] ?? 0}</span>
          </button>
        ))}
      </div>

      <div className="card">
        <DataTable
          title="Renewal Pipeline"
          count={filtered.length}
          loading={loading}
          rows={filtered}
          flash={flash}
          maxBodyHeight={520}
          searchPlaceholder="Search client or policy…"
          columns={[
            { key: 'insured_name', label: 'Client' },
            { key: 'insurance_line', label: 'Line', render: (r) => <span className="badge blue">{r.insurance_line}</span> },
            { key: 'company_name', label: 'Company' },
            { key: 'product_name', label: 'Product' },
            { key: 'policy_number', label: 'Policy No', render: (r) => r.policy_number || '—' },
            { key: 'period_to', label: 'Expiry', render: (r) => <b>{r.period_to || '—'}</b> },
            { key: 'days_to_expiry', label: 'Due In', noFilter: true, render: (r) => <DaysCell d={r.days_to_expiry} /> },
            { key: 'final_premium', label: 'Premium', num: true, render: (r) => inr(r.final_premium) },
            { key: 'renewal_status', label: 'Renewal Status', width: '170px', render: (r) => (
              <Select value={r.renewal_status} onChange={(e) => setStatus(r, e.target.value)}>
                {STATUSES.map((st) => <option key={st} value={st}>{st}</option>)}
              </Select>
            ) },
          ]}
          actions={(r) => (
            <>
              <button className="action-btn" title="Send renewal reminder" onClick={() => remind(r)}><Ic name="send" size={15} /></button>
              <button className="action-btn" title="Mark renewed" onClick={() => setStatus(r, 'Renewed')}><Ic name="check" size={15} /></button>
            </>
          )}
          empty={{ icon: 'refresh', title: 'Nothing in this bucket', sub: 'Renewals appear here as policies approach their expiry date.' }}
        />
      </div>
    </div>
  );
}
