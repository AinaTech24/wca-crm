import { useEffect, useState } from 'react';
import { api } from '../api.js';
import toast from '../components/toast.js';
import PageHeader from '../components/PageHeader.jsx';
import DataTable from '../components/DataTable.jsx';
import DateField from '../components/DateField.jsx';

// Update the "Follow-Up / Premium Due" date on life policies.
export default function FupUpdate({ title, mode }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [edits, setEdits] = useState({});
  const [savedId, setSavedId] = useState(null);

  useEffect(() => {
    setLoading(true);
    api('/policies?line=LI').then(setRows).finally(() => setLoading(false));
  }, []);

  async function save(id) {
    const period_to = edits[id];
    if (period_to === undefined) return;
    try {
      await api('/policies/' + id, { method: 'PUT', body: { period_to } });
      setRows((rs) => rs.map((r) => (r.id === id ? { ...r, period_to } : r)));
      setSavedId(id);
      toast.success('Date updated');
      setTimeout(() => setSavedId(null), 2000);
    } catch (e) {
      toast.error(e.message || 'Update failed');
    }
  }

  const columns = [
    { key: 'policy_number', label: 'Policy No' },
    { key: 'insured_name', label: 'Insured Name' },
    { key: 'company_name', label: 'Company' },
    { key: 'product_name', label: 'Product' },
    { key: 'final_premium', label: 'Premium', num: true, render: (r) => Number(r.final_premium || 0).toLocaleString('en-IN') },
    { key: 'fup', label: 'Next Due (FUP)', width: '170px', noFilter: true, render: (r) => (
      <DateField style={{ width: '100%' }}
        value={edits[r.id] ?? (r.period_to || '')}
        onChange={(e) => setEdits({ ...edits, [r.id]: e.target.value })} />
    ) },
  ];

  return (
    <div>
      <PageHeader title={title} subtitle={mode === 'pdf' ? 'Bulk-update FUP dates from a policy PDF schedule' : 'Update the next premium due (FUP) date for life policies'} />
      <div className="card">
        <DataTable
          title={<>Life Policies <span className="sub">({rows.length})</span></>}
          searchPlaceholder="Search policies…"
          index
          loading={loading}
          rows={rows}
          columns={columns}
          actions={(r) => (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <button className="btn blue" style={{ padding: '6px 12px', fontSize: 12.5 }} onClick={() => save(r.id)}>Save</button>
              {savedId === r.id && <span className="badge green">Updated</span>}
            </span>
          )}
          empty={{ icon: 'calendar', title: 'No life policies found', sub: 'Life policies with FUP dates appear here.' }}
        />
      </div>
    </div>
  );
}
