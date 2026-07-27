import { useEffect, useState } from 'react';
import { api } from '../api.js';
import PageHeader from '../components/PageHeader.jsx';
import DataTable from '../components/DataTable.jsx';

const badge = (s) => (s === 'Received' || s === 'Paid' ? 'green' : 'orange');
const inr = (v, d = 0) => Number(v || 0).toLocaleString('en-IN', d ? { minimumFractionDigits: d } : undefined);

export default function CommissionList({ kind }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const isPayin = kind === 'payin';

  useEffect(() => {
    setLoading(true);
    api('/commissions?kind=' + kind).then(setRows).finally(() => setLoading(false));
  }, [kind]);

  const total = rows.reduce((s, r) => s + Number(r.amount || 0), 0);

  const columns = [
    { key: 'policy_number', label: 'Policy No' },
    { key: 'insured_name', label: 'Insured Name' },
    { key: 'company_name', label: 'Company' },
    { key: 'agency_name', label: isPayin ? 'Company / Agency' : 'BA / Agency' },
    { key: 'base_premium', label: 'Base Premium', num: true, render: (r) => inr(r.base_premium) },
    { key: 'rate', label: 'Rate %', num: true },
    { key: 'amount', label: 'Amount', num: true, render: (r) => inr(r.amount, 2) },
    { key: 'status', label: 'Status', render: (r) => <span className={'badge ' + badge(r.status)}>{r.status}</span> },
    { key: 'entry_date', label: 'Date' },
  ];

  return (
    <div>
      <PageHeader
        title={`Commission ${isPayin ? 'Payin' : 'Payout'}`}
        subtitle={isPayin ? 'Commission receivable from insurers' : 'Commission payable to agents / BAs'}
      />
      <div className="card">
          <DataTable
            title={isPayin ? 'Commission Receivable' : 'Commission Payable'}
            count={rows.length}
            total={<>Total: ₹ {inr(total, 2)}</>}
            index
            loading={loading}
            rows={rows}
            columns={columns}
            searchPlaceholder="Search commission…"
            empty={{ icon: 'dollar', title: 'No commission entries', sub: 'Records appear here as policies are booked.' }}
          />
      </div>
    </div>
  );
}
