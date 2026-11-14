// The records behind a number: what was clicked (group, sub-group, metric) and the report's filters
// as a breadcrumb, then the records — sortable, with a choice of columns, totals, and downloads. A
// record opens on its own page; the browser's Back comes straight back here.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api.js';
import DataTable from '../../components/DataTable.jsx';
import Select from '../../components/Select.jsx';
import { fmt as fmtDate } from '../../components/DateField.jsx';
import { Ic } from '../../components/Icons.jsx';
import toast from '../../components/toast.js';
import { formatMetric } from '../reportConstants.js';
import { recordsGrid, exportExcel, exportCsv, exportPdf } from './reportExport.js';

const show = (v, k) => {
  if (v === null || v === undefined || v === '') return '—';
  if (k === 'money') return formatMetric(v, 'money');
  if (k === 'date') return /^\d{4}-\d{2}-\d{2}/.test(String(v)) ? fmtDate(String(v).slice(0, 10)) : String(v);
  return String(v);
};
const colsKey = (kind) => `wca_report_cols_${kind}`;

export function ExportMenu({ onPick, label = 'Export' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  return (
    <div className="rep-menu" ref={ref}>
      <button type="button" className="btn ghost" onClick={() => setOpen((o) => !o)} aria-expanded={open}><Ic name="file-export" size={15} /> {label}</button>
      {open && (
        <div className="rep-menu-panel">
          {[['xlsx', 'Excel (.xlsx)'], ['pdf', 'PDF'], ['csv', 'CSV']].map(([k, l]) => (
            <button key={k} type="button" onClick={() => { setOpen(false); onPick(k); }}>{l}</button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ReportRecords({ kind, query, drill, onBack, dims, canExport = true }) {
  const navigate = useNavigate();
  const [d, setD] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState({ key: '', dir: 'asc' });
  const [hidden, setHidden] = useState(() => { try { return JSON.parse(localStorage.getItem(colsKey(kind)) || '[]'); } catch { return []; } });
  const [colsOpen, setColsOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const q = new URLSearchParams(query);
    for (const k of ['g', 'v', 'g2', 'v2', 'metric']) if (drill[k] !== undefined && drill[k] !== '') q.set(k, drill[k]);
    api(`/reports/${kind}/records?${q}`)
      .then((x) => { if (!cancelled) setD(x); })
      .catch((e) => { if (!cancelled) toast.error(e.message || 'Could not list the records'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [kind, JSON.stringify(query), drill.g, drill.v, drill.g2, drill.v2, drill.metric]);   // eslint-disable-line react-hooks/exhaustive-deps

  const allCols = d?.columns || [];
  const cols = allCols.filter((c) => !hidden.includes(c.key));
  const setHide = (key, off) => setHidden((h) => {
    const n = off ? [...h, key] : h.filter((x) => x !== key);
    try { localStorage.setItem(colsKey(kind), JSON.stringify(n)); } catch { /* private mode */ }
    return n;
  });

  const rows = useMemo(() => {
    const list = [...(d?.rows || [])];
    if (!sort.key) return list;
    const c = allCols.find((x) => x.key === sort.key);
    const m = sort.dir === 'asc' ? 1 : -1;
    return list.sort((a, b) => {
      const x = a[sort.key], y = b[sort.key];
      if (x === null || x === undefined || x === '') return 1;
      if (y === null || y === undefined || y === '') return -1;
      return (c?.kind === 'money' ? Number(x) - Number(y) : String(x).localeCompare(String(y), 'en', { numeric: true })) * m;
    });
  }, [d, sort]);   // eslint-disable-line react-hooks/exhaustive-deps

  const title = d ? [d.label, ...(d.crumbs || []).map((c) => `${c.by}: ${c.label}`), ...(d.metric?.narrowed ? [d.metric.label] : [])].join(' — ') : 'Records';
  const money = cols.filter((c) => c.kind === 'money');
  const dimLabel = (k) => dims?.find((x) => x.key === k)?.label || k;

  function download(fmt) {
    if (!rows.length) { toast.info('Nothing to export'); return; }
    const grid = recordsGrid({ ...d, rows, title: `${title} · ${fmtDate(d.from)} to ${fmtDate(d.to)}` }, cols);
    const name = `${kind}-records-${d.from}-to-${d.to}`;
    if (fmt === 'xlsx') exportExcel(grid, name); else if (fmt === 'csv') exportCsv(grid, name); else exportPdf(grid, title);
  }

  return (
    <>
      <div className="drill-bar">
        <button className="btn ghost" onClick={onBack}><Ic name="arrowleft" size={15} /> Back to the report</button>
        <div className="drill-crumbs">
          {(d?.crumbs || []).map((c) => <span key={c.by} className="drill-chip"><b>{c.by}:</b> {c.label}</span>)}
          {d?.metric?.narrowed && <span className="drill-chip metric"><b>Only:</b> {d.metric.label}</span>}
          {Object.entries(d?.filters || {}).map(([k, v]) => <span key={k} className="drill-chip filter"><Ic name="funnel" size={11} /> {dimLabel(k)}: {v.join(', ')}</span>)}
        </div>
        <span className="drill-note">
          {d ? <>{d.total.toLocaleString('en-IN')} record{d.total === 1 ? '' : 's'} · {fmtDate(d.from)} to {fmtDate(d.to)}{d.total > d.rows.length ? ` · showing the first ${d.rows.length.toLocaleString('en-IN')}` : ''}</> : 'Loading…'}
        </span>
      </div>
      <div className="card">
        <DataTable
          title={title}
          count={d?.total || 0}
          columns={cols.map((c) => ({
            key: c.key, label: c.label, ...(c.kind === 'money' ? { num: true } : {}),
            render: (r) => show(r[c.key], c.kind),
          }))}
          rows={rows}
          loading={loading && !d}
          onRowClick={(r) => navigate(`${r._page || d.page}?open=${r.id}`)}
          searchPlaceholder="Search these records…"
          searchKeys={allCols.map((c) => c.key)}
          footer={money.length ? (vis) => ({
            label: `Total · ${vis.length.toLocaleString('en-IN')}`,
            ...Object.fromEntries(money.map((c) => [c.key, formatMetric(vis.reduce((s, r) => s + (Number(r[c.key]) || 0), 0), 'money')])),
          }) : undefined}
          headerExtra={(
            <>
              <div className="rep-sort">
                <Select value={sort.key} onChange={(e) => setSort((s) => ({ ...s, key: e.target.value }))} aria-label="Sort by">
                  <option value="">Sort: report order</option>
                  {allCols.map((c) => <option key={c.key} value={c.key}>Sort: {c.label}</option>)}
                </Select>
                {sort.key && (
                  <button type="button" className="dt-icon-btn" title={sort.dir === 'asc' ? 'Ascending — click for descending' : 'Descending — click for ascending'}
                    onClick={() => setSort((s) => ({ ...s, dir: s.dir === 'asc' ? 'desc' : 'asc' }))}>
                    <Ic name="arrowup" size={15} style={{ transform: sort.dir === 'desc' ? 'rotate(180deg)' : undefined }} />
                  </button>
                )}
              </div>
              <div className="rep-menu">
                <button type="button" className="btn ghost" onClick={() => setColsOpen((o) => !o)}><Ic name="sliders" size={15} /> Columns</button>
                {colsOpen && (
                  <div className="rep-menu-panel cols" onMouseLeave={() => setColsOpen(false)}>
                    {allCols.map((c) => (
                      <label key={c.key} className="rep-col-opt">
                        <input type="checkbox" checked={!hidden.includes(c.key)} disabled={!hidden.includes(c.key) && cols.length === 1}
                          onChange={(e) => setHide(c.key, !e.target.checked)} /> {c.label}
                      </label>
                    ))}
                  </div>
                )}
              </div>
              {canExport && <ExportMenu onPick={download} />}
            </>
          )}
          empty={{ icon: 'clipboard', title: 'No records here', sub: 'Nothing matches for the period.' }}
        />
      </div>
    </>
  );
}
