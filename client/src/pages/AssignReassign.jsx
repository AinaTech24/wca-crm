import { useEffect, useState } from 'react';
import { api } from '../api.js';
import toast from '../components/toast.js';
import PageHeader from '../components/PageHeader.jsx';
import DataTable from '../components/DataTable.jsx';
import Select from '../components/Select.jsx';

const AGENTS = ['Admin User', 'Rakesh Shah', 'Nita Mehta', 'Priya Sharma', 'Unassigned'];

// Bulk assign renewals or leads to a team member.
export default function AssignReassign({ mode }) {
  const isRenewals = mode === 'renewals';
  const [rows, setRows] = useState([]);
  const [sel, setSel] = useState(() => new Set());
  const [assignee, setAssignee] = useState(AGENTS[0]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true); setSel(new Set());
    api(isRenewals ? '/policies' : '/leads').then(setRows).finally(() => setLoading(false));
  }, [mode]);

  function toggle(id) { setSel((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; }); }
  function toggleAll() { setSel((p) => p.size === rows.length ? new Set() : new Set(rows.map((r) => r.id))); }
  async function assign() {
    if (sel.size === 0) { toast.error('Select at least one row.'); return; }
    const ids = [...sel];
    const path = isRenewals ? '/policies/' : '/leads/';
    const count = sel.size;
    try {
      await Promise.all(ids.map((id) => api(path + id, { method: 'PUT', body: { assigned_to: assignee } })));
      setRows((rs) => rs.map((r) => (sel.has(r.id) ? { ...r, assigned_to: assignee } : r)));
      setSel(new Set());
      toast.success(`${count} ${isRenewals ? 'renewal(s)' : 'lead(s)'} assigned to ${assignee}`);
    } catch (e) {
      toast.error(e.message || 'Assignment failed');
    }
  }

  const columns = isRenewals ? [
    { key: 'insured_name', label: 'Insured Name' },
    { key: 'company_name', label: 'Company' },
    { key: 'policy_number', label: 'Policy No' },
    { key: 'period_to', label: 'Expiry' },
    { key: 'final_premium', label: 'Premium', num: true, render: (r) => Number(r.final_premium || 0).toLocaleString('en-IN') },
    { key: 'assigned_to', label: 'Assigned To', render: (r) => sel.has(r.id) ? <span className="badge orange">{assignee}</span> : (r.assigned_to || 'Unassigned') },
  ] : [
    { key: 'lead_name', label: 'Lead Name' },
    { key: 'mobile', label: 'Mobile' },
    { key: 'product_interest', label: 'Product Interest' },
    { key: 'status', label: 'Status', render: (r) => <span className="badge blue">{r.status}</span> },
    { key: 'assigned_to', label: 'Assigned To', render: (r) => sel.has(r.id) ? <span className="badge orange">{assignee}</span> : (r.assigned_to || 'Unassigned') },
  ];

  return (
    <div>
      <PageHeader
        title={isRenewals ? 'Assign / Reassign Renewals' : 'Assign / Reassign Lead'}
        subtitle={`Distribute ${isRenewals ? 'renewals' : 'leads'} across your team`}
        action={
          <div className="page-actions">
            <Select className="field-inline" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
              {AGENTS.map((a) => <option key={a}>{a}</option>)}
            </Select>
            <button className="btn blue" onClick={assign}>Assign ({sel.size})</button>
          </div>
        }
      />
      <div className="card">
        <DataTable
          title={<>{isRenewals ? 'Renewals' : 'Leads'} <span className="sub">({rows.length} · {sel.size} selected)</span></>}
          searchPlaceholder={isRenewals ? 'Search renewals…' : 'Search leads…'}
          index
          loading={loading}
          rows={rows}
          columns={columns}
          selectable
          selected={sel}
          onToggleRow={toggle}
          onToggleAll={toggleAll}
          empty={{ icon: isRenewals ? 'refresh' : 'target', title: 'No records', sub: `No ${isRenewals ? 'renewals' : 'leads'} to assign right now.` }}
        />
      </div>
    </div>
  );
}
