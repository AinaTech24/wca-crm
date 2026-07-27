import { useEffect, useState } from 'react';
import { api } from '../api.js';
import PageHeader from '../components/PageHeader.jsx';
import DataTable from '../components/DataTable.jsx';
import { useRealtime } from '../realtime.js';

const badge = (s) => (s === 'New' ? 'blue' : s === 'Contacted' || s === 'Converted' ? 'green' : s === 'Lost' ? 'red' : 'orange');

export default function LeadFollowup() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => { api('/leads').then(setRows).finally(() => setLoading(false)); }, []);

  useRealtime('lead', (evt) => {
    const r = evt.data;
    setRows((prev) => {
      if (evt.action === 'created') return prev.some((x) => x.id === r.id) ? prev.map((x) => (x.id === r.id ? r : x)) : [...prev, r];
      if (evt.action === 'updated') return prev.map((x) => (x.id === r.id ? r : x));
      return prev;
    });
  });

  const sorted = [...rows].sort((a, b) => (a.followup_date || '').localeCompare(b.followup_date || ''));

  const columns = [
    { key: 'followup_date', label: 'Follow Up Date', render: (r) => <b>{r.followup_date || '—'}</b> },
    { key: 'lead_name', label: 'Lead Name' },
    { key: 'mobile', label: 'Mobile' },
    { key: 'product_interest', label: 'Product Interest' },
    { key: 'source', label: 'Source' },
    { key: 'assigned_to', label: 'Assigned To' },
    { key: 'status', label: 'Status', render: (r) => <span className={'badge ' + badge(r.status)}>{r.status}</span> },
  ];

  return (
    <div>
      <PageHeader title="Lead Followup" subtitle="Scheduled follow-ups with prospects" />
      <div className="card">
        <DataTable
          title={<>Followups Due <span className="sub">({sorted.length})</span></>}
          searchPlaceholder="Search followups…"
          index
          loading={loading}
          rows={sorted}
          columns={columns}
          empty={{ icon: 'refresh', title: 'No follow-ups scheduled', sub: 'Set follow-up dates on leads to see them here.' }}
        />
      </div>
    </div>
  );
}
