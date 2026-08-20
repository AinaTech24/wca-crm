import { useEffect, useState, useMemo } from 'react';
import { api } from '../api.js';
import toast from '../components/toast.js';
import confirm from '../components/confirm.js';
import PageHeader from '../components/PageHeader.jsx';
import DataTable from '../components/DataTable.jsx';
import Select from '../components/Select.jsx';
import DateField, { fmt as fmtDate } from '../components/DateField.jsx';
import { Ic } from '../components/Icons.jsx';
import { useRealtime } from '../realtime.js';
import { DEPARTMENTS, DeptBadge } from './departmentConstants.jsx';
import PolicyFormModal from './PolicyFormModal.jsx';
import {
  INSURANCE_LINES, PRODUCTS, POLICY_STATUSES, POLICY_STATUS_BADGE,
  emptyPolicy, todayISO, inr,
} from './policyConstants.js';

const BLANK_FILTERS = { line: '', product: '', status: '', withUs: '', company: '', department: '', from: '', to: '', q: '' };

export default function Policies() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [flash, setFlash] = useState(() => new Set());

  const [view, setView] = useState('list');
  const [filters, setFilters] = useState(BLANK_FILTERS);
  const [showFilters, setShowFilters] = useState(false);
  const [form, setForm] = useState(null);
  const [dragId, setDragId] = useState(null);
  const [overCol, setOverCol] = useState(null);

  useEffect(() => {
    setLoading(true);
    api('/policies').then(setRows).catch(() => {}).finally(() => setLoading(false));
  }, []);

  function markFlash(id) {
    if (id == null) return;
    setFlash((s) => new Set(s).add(id));
    setTimeout(() => setFlash((s) => { const n = new Set(s); n.delete(id); return n; }), 1600);
  }

  useRealtime('policy', (evt) => {
    setRows((prev) => {
      if (evt.action === 'deleted') return prev.filter((r) => r.id !== evt.data.id);
      const p = evt.data;
      if (evt.action === 'updated') return prev.map((r) => (r.id === p.id ? p : r));
      if (evt.action === 'created') return prev.some((r) => r.id === p.id) ? prev : [p, ...prev];
      return prev;
    });
    markFlash(evt.data?.id);
  });

  const companyNames = useMemo(
    () => [...new Set(rows.map((r) => r.company_name).filter(Boolean))].sort(), [rows]
  );

  const filtered = useMemo(() => {
    const q = filters.q.trim().toLowerCase();
    return rows.filter((r) => {
      if (filters.line && r.insurance_line !== filters.line) return false;
      if (filters.product && r.insurance_type !== filters.product) return false;
      if (filters.status && r.policy_status !== filters.status) return false;
      if (filters.withUs && r.policy_with_us !== filters.withUs) return false;
      if (filters.company && r.company_name !== filters.company) return false;
      if (filters.department && r.department !== filters.department) return false;
      if (filters.from && (!r.period_to || r.period_to < filters.from)) return false;
      if (filters.to && (!r.period_to || r.period_to > filters.to)) return false;
      if (q) {
        const hay = [r.product_name, r.insured_name, r.policy_number, r.company_name, r.insurance_type, r.reg_no]
          .map((v) => String(v || '').toLowerCase()).join(' ');
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, filters]);

  const activeFilterCount = useMemo(
    () => ['line', 'product', 'status', 'withUs', 'company', 'department', 'from', 'to'].filter((k) => filters[k]).length, [filters]
  );

  const stats = useMemo(() => {
    const today = todayISO();
    const in30 = new Date(); in30.setDate(in30.getDate() + 30);
    const in30s = in30.toISOString().slice(0, 10);
    return {
      active: filtered.filter((r) => ['Issued', 'Completed', 'Policy'].includes(r.policy_status) && r.active_status !== 'Inactive').length,
      premium: filtered.reduce((s, r) => s + (Number(r.final_premium) || 0), 0),
      dueSoon: filtered.filter((r) => r.period_to && r.period_to >= today && r.period_to <= in30s).length,
      lost: filtered.filter((r) => r.policy_with_us === 'No' || r.policy_status === 'Lost').length,
    };
  }, [filtered]);

  function openAdd() { setForm({ id: null, seed: emptyPolicy() }); }
  function openEdit(r) {
    setForm({ id: r.id, seed: { ...emptyPolicy(), ...r } });
  }
  function onSaved(row) {
    setRows((prev) => (prev.some((r) => r.id === row.id) ? prev.map((r) => (r.id === row.id ? row : r)) : [row, ...prev]));
  }

  async function changeStatus(p, status) {
    if (!status || status === p.policy_status) return;
    const snap = rows;
    setRows((prev) => prev.map((r) => (r.id === p.id ? { ...r, policy_status: status } : r)));
    try { await api('/policies/' + p.id, { method: 'PUT', body: { policy_status: status } }); }
    catch (e) { setRows(snap); toast.error(e.message || 'Could not update status'); }
  }

  async function del(r) {
    const ok = await confirm({
      title: 'Delete policy?', message: `“${r.product_name || r.policy_number || 'This policy'}” will be permanently removed.`,
      tone: 'danger', confirmText: 'Delete', icon: 'trash',
    });
    if (!ok) return;
    const snap = rows;
    setRows((prev) => prev.filter((x) => x.id !== r.id));
    try { await api('/policies/' + r.id, { method: 'DELETE' }); toast.success('Policy deleted'); }
    catch (e) { setRows(snap); toast.error(e.message || 'Could not delete policy'); }
  }

  function onDrop(status) {
    setOverCol(null);
    const p = rows.find((r) => r.id === dragId);
    setDragId(null);
    if (p) changeStatus(p, status);
  }

  const today = todayISO();
  const expiringSoon = (r) => r.period_to && r.period_to >= today;

  const kpis = [
    { label: 'Active Policies', num: stats.active, icon: 'file', tone: 'info' },
    { label: 'Premium Booked', num: '₹ ' + inr(Math.round(stats.premium)), icon: 'rupee', tone: 'success' },
    { label: 'Renewals ≤ 30d', num: stats.dueSoon, icon: 'refresh', tone: 'warning' },
    { label: 'Lost Business', num: stats.lost, icon: 'alert', tone: 'danger' },
  ];

  // Product options follow the line filter, the same way the form works.
  const productOptions = filters.line ? PRODUCTS[filters.line] : [...PRODUCTS.GI, ...PRODUCTS.LI];

  return (
    <div>
      <PageHeader
        title="Policies"
        subtitle="Log policies, track premium and drive the renewal pipeline"
        action={<button className="btn blue" onClick={openAdd}><Ic name="plus" size={16} /> New Policy</button>}
      />

      <div className="kpi-grid" style={{ marginBottom: 18 }}>
        {kpis.map((it) => (
          <div className="kpi-card" data-tone={it.tone} key={it.label}>
            <div className="kpi-card-top"><span className="kpi-card-ic"><Ic name={it.icon} size={16} /></span><span className="kpi-card-label">{it.label}</span></div>
            <div className="kpi-card-num">{it.num}</div>
          </div>
        ))}
      </div>

      <div className="lead-toolbar">
        <div className="tabs" style={{ marginBottom: 0 }}>
          <button className={'tab' + (view === 'list' ? ' active' : '')} onClick={() => setView('list')}><Ic name="grid" size={14} /> List</button>
          <button className={'tab' + (view === 'kanban' ? ' active' : '')} onClick={() => setView('kanban')}><Ic name="chart" size={14} /> Kanban</button>
        </div>
        <div className="dt-search" style={{ flex: 1, maxWidth: 340 }}>
          <span className="dt-search-ic"><Ic name="search" size={16} /></span>
          <input placeholder="Search plan, holder, policy no…" value={filters.q} onChange={(e) => setFilters((x) => ({ ...x, q: e.target.value }))} />
          {filters.q && <button className="dt-search-clear" onClick={() => setFilters((x) => ({ ...x, q: '' }))} aria-label="Clear search"><Ic name="x" size={14} /></button>}
        </div>
        <button className={'btn ghost' + (showFilters ? ' active' : '')} onClick={() => setShowFilters((s) => !s)}>
          <Ic name="filter" size={15} /> Filters{activeFilterCount ? ` (${activeFilterCount})` : ''}
        </button>
      </div>

      {showFilters && (
        <div className="card card-pad filter-panel">
          <div className="form-grid">
            <div className="form-field"><label>Type</label>
              <Select value={filters.line} onChange={(e) => setFilters((x) => ({ ...x, line: e.target.value, product: '' }))}>
                <option value="">All</option>{INSURANCE_LINES.map((l) => <option key={l.v} value={l.v}>{l.label}</option>)}
              </Select></div>
            <div className="form-field"><label>Policy</label>
              <Select value={filters.product} onChange={(e) => setFilters((x) => ({ ...x, product: e.target.value }))}>
                <option value="">All</option>{productOptions.map((p) => <option key={p} value={p}>{p}</option>)}
              </Select></div>
            <div className="form-field"><label>Status</label>
              <Select value={filters.status} onChange={(e) => setFilters((x) => ({ ...x, status: e.target.value }))}>
                <option value="">All</option>{POLICY_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </Select></div>
            <div className="form-field"><label>Policy with Us</label>
              <Select value={filters.withUs} onChange={(e) => setFilters((x) => ({ ...x, withUs: e.target.value }))}>
                <option value="">All</option><option value="Yes">Yes</option><option value="No">No</option>
              </Select></div>
            <div className="form-field"><label>Insurer</label>
              <Select value={filters.company} onChange={(e) => setFilters((x) => ({ ...x, company: e.target.value }))}>
                <option value="">All</option>{companyNames.map((c) => <option key={c} value={c}>{c}</option>)}
              </Select></div>
            <div className="form-field"><label>Department</label>
              <Select value={filters.department} onChange={(e) => setFilters((x) => ({ ...x, department: e.target.value }))}>
                <option value="">All</option>{DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
              </Select></div>
            <div className="form-field"><label>Renewal From</label>
              <DateField value={filters.from} onChange={(e) => setFilters((x) => ({ ...x, from: e.target.value }))} /></div>
            <div className="form-field"><label>Renewal To</label>
              <DateField value={filters.to} onChange={(e) => setFilters((x) => ({ ...x, to: e.target.value }))} /></div>
          </div>
          <div className="btn-row" style={{ marginTop: 12 }}>
            <button className="btn ghost" onClick={() => setFilters(BLANK_FILTERS)}><Ic name="x" size={15} /> Clear all</button>
            <span className="filter-count">{filtered.length} of {rows.length} policies</span>
          </div>
        </div>
      )}

      {view === 'list' ? (
        <div className="card">
          <DataTable
            title="Policies"
            count={filtered.length}
            loading={loading}
            rows={filtered}
            flash={flash}
            search={false}
            onRowClick={openEdit}
            columns={[
              { key: 'product_name', label: 'Plan' },
              { key: 'insured_name', label: 'Policy Holder', render: (r) => r.insured_name || '—' },
              { key: 'insurance_line', label: 'Type' },
              { key: 'insurance_type', label: 'Policy', render: (r) => r.insurance_type || '—' },
              { key: 'company_name', label: 'Insurer', render: (r) => r.company_name || '—' },
              { key: 'policy_number', label: 'Policy No', render: (r) => r.policy_number || '—' },
              { key: 'sum_assured', label: 'Sum Assured', num: true, render: (r) => inr(r.sum_assured) },
              { key: 'final_premium', label: 'Total Premium', num: true, render: (r) => inr(r.final_premium) },
              { key: 'period_to', label: 'Renewal', render: (r) => (r.period_to ? fmtDate(r.period_to) : '—') },
              { key: 'department', label: 'Dept', render: (r) => <DeptBadge value={r.department} /> },
              { key: 'policy_status', label: 'Status', render: (r) => <span className={'badge ' + (POLICY_STATUS_BADGE[r.policy_status] || '')}>{r.policy_status || 'Draft'}</span> },
            ]}
            actions={(r) => (
              <>
                <button className="action-btn" title="Edit" onClick={() => openEdit(r)}><Ic name="edit" size={15} /></button>
                <button className="action-btn danger" title="Delete" onClick={() => del(r)}><Ic name="trash" size={15} /></button>
              </>
            )}
            empty={{
              icon: 'file',
              title: rows.length ? 'No policies match these filters' : 'No policies yet',
              sub: rows.length ? 'Try clearing a filter or two.' : 'Log your first policy to start the renewal pipeline.',
            }}
          />
        </div>
      ) : (
        <div className="kanban">
          {POLICY_STATUSES.map((st) => {
            const cards = filtered.filter((r) => (r.policy_status || 'Draft') === st);
            return (
              <div
                key={st}
                className={'kanban-col' + (overCol === st ? ' over' : '')}
                onDragOver={(e) => { e.preventDefault(); setOverCol(st); }}
                onDragLeave={() => setOverCol((c) => (c === st ? null : c))}
                onDrop={() => onDrop(st)}
              >
                <div className="kanban-col-head">
                  <span><span className={'kanban-dot ' + (POLICY_STATUS_BADGE[st] || '')} /> {st}</span>
                  <span className="kanban-count">{cards.length}</span>
                </div>
                {cards.length === 0 && <div className="kanban-empty">Drop a policy here</div>}
                {cards.map((r) => (
                  <div
                    key={r.id}
                    className={'kanban-card' + (dragId === r.id ? ' dragging' : '') + (flash.has(r.id) ? ' flash' : '')}
                    draggable
                    onDragStart={() => setDragId(r.id)}
                    onDragEnd={() => { setDragId(null); setOverCol(null); }}
                    onClick={() => openEdit(r)}
                  >
                    <div className="kanban-name">{r.product_name}</div>
                    {r.insured_name && <div className="kanban-company">{r.insured_name}</div>}
                    <div className="kanban-meta">
                      <span className="badge blue">{r.insurance_line}</span>
                      {r.insurance_type && <span><Ic name="tag" size={11} /> {r.insurance_type}</span>}
                      {Number(r.final_premium) > 0 && <span><Ic name="rupee" size={11} /> {inr(r.final_premium)}</span>}
                      {r.period_to && <span className={expiringSoon(r) ? undefined : 'overdue-date'}><Ic name="refresh" size={11} /> {fmtDate(r.period_to)}</span>}
                    </div>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}

      <PolicyFormModal
        open={!!form}
        policyId={form?.id}
        seed={form?.seed}
        onClose={() => setForm(null)}
        onSaved={onSaved}
      />
    </div>
  );
}
