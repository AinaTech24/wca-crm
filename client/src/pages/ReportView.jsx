import { useEffect, useState } from 'react';
import { api } from '../api.js';
import PageHeader from '../components/PageHeader.jsx';
import DataTable from '../components/DataTable.jsx';
import { Ic } from '../components/Icons.jsx';
import Select from '../components/Select.jsx';
import DateField from '../components/DateField.jsx';

// Column registry per data source.
const SOURCES = {
  policies: {
    path: '/policies', dateField: 'period_to', agencyField: 'agency_name', totalField: 'final_premium',
    cols: [
      { k: 'policy_number', l: 'Policy No' }, { k: 'insured_name', l: 'Insured Name' }, { k: 'company_name', l: 'Company' },
      { k: 'product_name', l: 'Product' }, { k: 'insurance_type', l: 'Type' }, { k: 'policy_status', l: 'Status', badge: true },
      { k: 'period_to', l: 'Period To' }, { k: 'sum_assured', l: 'Sum Assured', num: true }, { k: 'final_premium', l: 'Premium', num: true },
    ],
  },
  claims: {
    path: '/claims', dateField: 'claim_date', totalField: 'claim_amount',
    cols: [
      { k: 'claim_no', l: 'Claim No' }, { k: 'client_name', l: 'Client' }, { k: 'company_name', l: 'Company' },
      { k: 'claim_date', l: 'Date' }, { k: 'claim_amount', l: 'Amount', num: true }, { k: 'status', l: 'Status', badge: true },
    ],
  },
  endorsements: {
    path: '/endorsements', dateField: 'endorsement_date', totalField: 'premium_effect',
    cols: [
      { k: 'endorsement_no', l: 'Endo No' }, { k: 'policy_number', l: 'Policy No' }, { k: 'insured_name', l: 'Insured' },
      { k: 'company_name', l: 'Company' }, { k: 'endorsement_type', l: 'Type', badge: true }, { k: 'endorsement_date', l: 'Date' },
      { k: 'premium_effect', l: 'Premium Effect', num: true },
    ],
  },
  commissions: {
    path: '/commissions', dateField: 'entry_date', agencyField: 'agency_name', totalField: 'amount',
    cols: [
      { k: 'policy_number', l: 'Policy No' }, { k: 'insured_name', l: 'Insured' }, { k: 'company_name', l: 'Company' },
      { k: 'agency_name', l: 'Agency' }, { k: 'base_premium', l: 'Base Premium', num: true }, { k: 'rate', l: 'Rate %', num: true },
      { k: 'amount', l: 'Amount', num: true }, { k: 'status', l: 'Status', badge: true },
    ],
  },
  fd: {
    path: '/fd-transactions', dateField: 'maturity_date', totalField: 'amount',
    cols: [
      { k: 'fd_number', l: 'FD No' }, { k: 'client_name', l: 'Client' }, { k: 'scheme_name', l: 'Scheme' },
      { k: 'company_name', l: 'Bank' }, { k: 'amount', l: 'Amount', num: true }, { k: 'interest_rate', l: 'Rate %', num: true },
      { k: 'maturity_date', l: 'Maturity' }, { k: 'maturity_amount', l: 'Maturity Amt', num: true }, { k: 'status', l: 'Status', badge: true },
    ],
  },
  clients: {
    path: '/clients',
    cols: [
      { k: 'client_name', l: 'Client Name' }, { k: 'group_head_name', l: 'Group Head' }, { k: 'group_code', l: 'Group Code' },
      { k: 'mobile', l: 'Mobile' }, { k: 'email', l: 'Email' }, { k: 'city', l: 'City' },
    ],
  },
  agencies: {
    path: '/masters/agencies',
    cols: [
      { k: 'agency_name', l: 'Agency Name' }, { k: 'type', l: 'Type', badge: true }, { k: 'contact_person', l: 'Contact Person' },
      { k: 'mobile', l: 'Mobile' }, { k: 'city', l: 'City' },
    ],
  },
};

const badgeClass = (v) => {
  const s = String(v).toLowerCase();
  if (/settled|paid|received|active|issued|policy/.test(s)) return 'green';
  if (/pending|proposal|open|follow/.test(s)) return 'orange';
  if (/reject|withdraw|cancel|decline|lapse/.test(s)) return 'red';
  return 'blue';
};

// Generic report: filter panel (Agency, From/To date) -> Show Report -> results table.
export default function ReportView({ title, source = 'policies', line, kind }) {
  const cfg = SOURCES[source] || SOURCES.policies;
  const [agencies, setAgencies] = useState([]);
  const [filter, setFilter] = useState({ agency: '', from: '', to: '' });
  const [rows, setRows] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api('/masters/agencies').then(setAgencies).catch(() => {});
    setRows(null); setFilter({ agency: '', from: '', to: '' });
  }, [title, source]);

  async function run() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (line) params.set('line', line);
      if (kind) params.set('kind', kind);
      const qs = params.toString();
      let data = await api(cfg.path + (qs ? '?' + qs : ''));
      // client-side agency + date filtering
      if (filter.agency && cfg.agencyField) data = data.filter((r) => r[cfg.agencyField] === filter.agency);
      if (cfg.dateField && (filter.from || filter.to)) {
        data = data.filter((r) => {
          const d = r[cfg.dateField];
          if (!d) return false;
          if (filter.from && d < filter.from) return false;
          if (filter.to && d > filter.to) return false;
          return true;
        });
      }
      setRows(data);
    } finally {
      setLoading(false);
    }
  }

  const total = cfg.totalField && rows ? rows.reduce((s, r) => s + Number(r[cfg.totalField] || 0), 0) : null;

  const columns = cfg.cols.map((c) => ({
    key: c.k, label: c.l, num: c.num,
    render: c.badge ? (r) => <span className={'badge ' + badgeClass(r[c.k])}>{r[c.k] || '—'}</span>
      : c.num ? (r) => Number(r[c.k] || 0).toLocaleString('en-IN')
      : (r) => r[c.k] || '—',
  }));

  function exportCsv() {
    if (!rows || rows.length === 0) return;
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const head = ['#', ...cfg.cols.map((c) => c.l)];
    const lines = rows.map((r, i) => [i + 1, ...cfg.cols.map((c) => r[c.k] ?? '')].map(esc).join(','));
    const csv = [head.map(esc).join(','), ...lines].join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = title.replace(/[^a-z0-9]+/gi, '_').toLowerCase() + '.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <PageHeader title={title} subtitle="Filter and generate the report" />

      <div className="card card-pad" style={{ marginBottom: 22 }}>
        <div className="section-head">Report Filters</div>
        <div className="form-grid">
          {cfg.agencyField && (
            <div className="form-field"><label>Agency Name</label>
              <Select value={filter.agency} onChange={(e) => setFilter({ ...filter, agency: e.target.value })}>
                <option value="">- All Agencies -</option>
                {agencies.map((a) => <option key={a.id}>{a.agency_name}</option>)}
              </Select>
            </div>
          )}
          {cfg.dateField && <>
            <div className="form-field"><label>From Date</label><DateField value={filter.from} onChange={(e) => setFilter({ ...filter, from: e.target.value })} /></div>
            <div className="form-field"><label>To Date</label><DateField value={filter.to} onChange={(e) => setFilter({ ...filter, to: e.target.value })} /></div>
          </>}
        </div>
        <div className="btn-row" style={{ justifyContent: 'center' }}>
          <button className="btn blue" onClick={run}><Ic name="filter" size={15} /> Show Report</button>
        </div>
      </div>

      {(loading || rows) && (
        <div className="card">
            <DataTable
              title="Results"
              count={rows?.length ?? 0}
              onExport={rows && rows.length ? exportCsv : undefined}
              total={total !== null ? <>Total: ₹ {total.toLocaleString('en-IN')}</> : undefined}
              index
              loading={loading}
              rows={rows || []}
              columns={columns}
              searchPlaceholder="Search results…"
              empty={{ icon: 'chart', title: 'No records match the filters', sub: 'Adjust the agency or date range and run the report again.' }}
            />
        </div>
      )}
    </div>
  );
}
