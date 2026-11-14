import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import PageHeader from '../components/PageHeader.jsx';
import DataTable from '../components/DataTable.jsx';
import Select from '../components/Select.jsx';
import DateField, { fmt as fmtDate } from '../components/DateField.jsx';
import { Ic } from '../components/Icons.jsx';
import toast from '../components/toast.js';
import {
  REPORT_TABS, PRESETS, DEFAULT_PRESET, presetRange,
  formatMetric, compactMoney, toCsv, downloadCsv,
} from './reportConstants.js';

const CHART_COLORS = ['#1b6fb0', '#e9531e', '#16874e', '#8bb6dc', '#d98324', '#5b6472'];

// Horizontal bars — a report groups by name (user, product, insurer), and
// names need room to be readable, which vertical bars don't give them.
function RankChart({ rows, metric, kind, onPick }) {
  const top = rows.slice(0, 8);
  const max = Math.max(...top.map((r) => Number(r[metric]) || 0), 0);
  if (!top.length || !max) return <div className="no-data">Nothing to chart for this period</div>;

  return (
    <div className="rank-chart">
      {top.map((r, i) => (
        <div className="rank-row rank-link" key={r.label} role="button" tabIndex={0} title={`Show the records for ${r.label}`}
          onClick={() => onPick(r.label)} onKeyDown={(e) => { if (e.key === 'Enter') onPick(r.label); }}>
          <div className="rank-label" title={r.label}>{r.label}</div>
          <div className="rank-track">
            <div
              className="rank-bar"
              style={{ width: `${Math.max(((Number(r[metric]) || 0) / max) * 100, 1.5)}%`, background: CHART_COLORS[i % CHART_COLORS.length] }}
            />
          </div>
          <div className="rank-value">{formatMetric(r[metric], kind)}</div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// The records behind a number: a row, bar or card in a report opens this list, and a record in
// it opens on its own page. Everything about it lives in the address, so the browser's Back from
// a record comes straight back to this list.
// ---------------------------------------------------------------------------------------------
function RecordList({ kind, range, drill, onBack }) {
  const navigate = useNavigate();
  const [d, setD] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const q = new URLSearchParams({ from: range.from, to: range.to });
    if (drill.label !== undefined) { q.set('groupBy', drill.groupBy); q.set('label', drill.label); }
    api(`/reports/${kind}/records?${q}`)
      .then((x) => { if (!cancelled) setD(x); })
      .catch((e) => { if (!cancelled) toast.error(e.message || 'Could not list the records'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [kind, range.from, range.to, drill.groupBy, drill.label]);

  const show = (v, k) => {
    if (v === null || v === undefined || v === '') return '—';
    if (k === 'money') return formatMetric(v, 'money');
    if (k === 'date') return /^\d{4}-\d{2}-\d{2}/.test(String(v)) ? fmtDate(String(v).slice(0, 10)) : String(v);
    return String(v);
  };
  const columns = (d?.columns || []).map((c) => ({
    key: c.key, label: c.label, ...(c.kind === 'money' ? { align: 'right', num: true } : {}),
    render: (r) => show(r[c.key], c.kind),
  }));
  const title = d ? (d.group ? `${d.label} — ${d.group.by}: ${d.group.label}` : `${d.label} — all records`) : 'Records';

  function exportCsv() {
    if (!d?.rows?.length) { toast.info('Nothing to export'); return; }
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = [d.columns.map((c) => esc(c.label)).join(','),
      ...d.rows.map((r) => d.columns.map((c) => esc(c.kind === 'date' ? show(r[c.key], 'date') : r[c.key])).join(','))].join('\n');
    downloadCsv(`${kind}-${(d.group?.label || 'all').replace(/[^\w-]+/g, '-')}-${d.from}-to-${d.to}.csv`, csv);
  }

  return (
    <>
      <div className="drill-bar">
        <button className="btn ghost" onClick={onBack}><Ic name="arrowleft" size={15} /> Back to the report</button>
        <span className="drill-note">
          {d ? <>{d.total.toLocaleString('en-IN')} record{d.total === 1 ? '' : 's'} · {fmtDate(d.from)} to {fmtDate(d.to)}{d.total > d.rows.length ? ` · showing the first ${d.rows.length.toLocaleString('en-IN')}` : ''} · click a record to open it</> : 'Loading…'}
        </span>
      </div>
      <DataTable
        title={title}
        count={d?.total || 0}
        columns={columns}
        rows={d?.rows || []}
        loading={loading && !d}
        onRowClick={(r) => navigate(`${d.page}?open=${r.id}`)}
        searchPlaceholder="Search these records…"
        searchKeys={(d?.columns || []).map((c) => c.key)}
        onExport={exportCsv}
        empty={{ icon: 'clipboard', title: 'No records here', sub: 'Nothing in this group for the period.' }}
      />
    </>
  );
}

// The report's state as it is written in the address (see RecordList).
function fromUrl() {
  const q = new URLSearchParams(window.location.search);
  const tab = REPORT_TABS.some((t) => t.key === q.get('tab')) ? q.get('tab') : 'business';
  const range = /^\d{4}-\d{2}-\d{2}$/.test(q.get('from') || '') && /^\d{4}-\d{2}-\d{2}$/.test(q.get('to') || '') ? { from: q.get('from'), to: q.get('to') } : null;
  const drill = q.has('dl') ? { groupBy: q.get('dg') || '', label: q.get('dl') } : q.get('dall') === '1' ? {} : null;
  return { tab, range, groupBy: q.get('g') || '', drill };
}

export default function Reports() {
  // ?tab=renewals (from a dashboard card) opens that report first; a drill-down list is in the address too.
  const [init] = useState(fromUrl);
  const [tab, setTabRaw] = useState(init.tab);
  const [preset, setPreset] = useState(init.range ? 'custom' : DEFAULT_PRESET);
  const [range, setRange] = useState(() => init.range || presetRange(DEFAULT_PRESET));
  const [groupBy, setGroupBy] = useState(init.groupBy ? { [init.tab]: init.groupBy } : {});   // remembered per report
  const [drill, setDrill] = useState(init.drill);   // { groupBy, label } for one group, {} for every record, null for the report
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const spec = REPORT_TABS.find((t) => t.key === tab);
  const setTab = (t) => { setTabRaw(t); setDrill(null); };

  // Keep the address in step, without adding history entries for every click.
  useEffect(() => {
    const q = new URLSearchParams({ tab, from: range.from || '', to: range.to || '' });
    if (groupBy[tab]) q.set('g', groupBy[tab]);
    if (drill && drill.label !== undefined) { q.set('dg', drill.groupBy); q.set('dl', drill.label); }
    else if (drill) q.set('dall', '1');
    window.history.replaceState(window.history.state, '', `${window.location.pathname}?${q}`);
  }, [tab, range.from, range.to, groupBy, drill]);
  const openGroup = (label) => { setDrill({ groupBy: data?.groupBy || '', label }); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  const openAll = () => { setDrill({}); window.scrollTo({ top: 0, behavior: 'smooth' }); };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const q = new URLSearchParams({ from: range.from, to: range.to });
    if (groupBy[tab]) q.set('groupBy', groupBy[tab]);
    api(`/reports/${tab}?${q}`)
      .then((d) => { if (!cancelled) { setData(d); setLoading(false); } })
      .catch((e) => { if (!cancelled) { setLoading(false); toast.error(e.message || 'Could not load the report'); } });
    return () => { cancelled = true; };
  }, [tab, range.from, range.to, groupBy[tab]]);

  function applyPreset(key) {
    setPreset(key);
    const r = presetRange(key);
    if (r) setRange(r);
  }
  function setCustom(field, value) {
    setPreset('custom');
    setRange((prev) => ({ ...prev, [field]: value }));
  }

  const columns = useMemo(() => {
    if (!data) return [];
    return [
      { key: 'label', label: data.groupLabel, width: '26%' },
      ...data.columns.map((c) => ({
        key: c.key, label: c.label, align: 'right', num: true,
        render: (row) => formatMetric(row[c.key], c.kind),
      })),
    ];
  }, [data]);

  // The chart ranks by the first money metric where there is one, so Business
  // charts premium rather than policy count; otherwise the leading count. A
  // money column nobody fills in (RFQ expected premium) would chart nothing.
  const chartMetric = data?.columns.find((c) => c.kind === 'money' && Number(data.totals?.[c.key]) > 0) || data?.columns[0];

  function exportCsv() {
    if (!data?.rows?.length) { toast.info('Nothing to export for this period'); return; }
    downloadCsv(`${tab}-report-${data.from}-to-${data.to}.csv`,
      toCsv(data.columns, data.rows, data.totals, data.groupLabel));
  }

  return (
    <div>
      <PageHeader
        title="Reports"
        action={<button className="btn ghost" onClick={exportCsv} disabled={!data?.rows?.length}><Ic name="file-export" size={16} /> Export CSV</button>}
      />

      <div className="report-tabs">
        {REPORT_TABS.map((t) => (
          <button key={t.key} className={'report-tab' + (tab === t.key ? ' active' : '')} onClick={() => setTab(t.key)}>
            <Ic name={t.icon} size={17} />
            <span>{t.label}</span>
          </button>
        ))}
      </div>

      <div className="card card-pad report-controls">
        <div className="report-presets">
          {PRESETS.map((p) => (
            <button key={p.key} className={'chip-btn' + (preset === p.key ? ' active' : '')} onClick={() => applyPreset(p.key)}>{p.label}</button>
          ))}
        </div>
        <div className="report-range">
          <div className="form-field"><label>From</label><DateField value={range.from} onChange={(e) => setCustom('from', e.target.value)} /></div>
          <div className="form-field"><label>To</label><DateField value={range.to} onChange={(e) => setCustom('to', e.target.value)} /></div>
          <div className="form-field">
            <label>Group by</label>
            <Select value={data?.groupBy || ''} disabled={!!drill} onChange={(e) => setGroupBy((g) => ({ ...g, [tab]: e.target.value }))}>
              {(data?.dims || []).map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
            </Select>
          </div>
        </div>
        <div className="report-note">
          {spec?.blurb} Counted on <strong>{data?.dateLabel || 'date'}</strong>.
          {data?.scope?.applied && <> Limited to <strong>{data.scope.department}</strong>.</>}
        </div>
      </div>

      {drill && <RecordList kind={tab} range={range} drill={drill} onBack={() => setDrill(null)} />}

      {/* Undated rows can't be placed in any period, so they're excluded. Saying
          so stops a partial report from being read as a complete one. */}
      {!drill && !loading && data?.undated > 0 && (
        <div className="report-warning">
          <Ic name="alert" size={16} />
          <span>
            {data.undated} {data.undated === 1 ? 'record has' : 'records have'} no {String(data.dateLabel).toLowerCase()} and
            {' '}{data.undated === 1 ? 'is' : 'are'} not counted in any period.
          </span>
        </div>
      )}

      {!drill && <>
      <div className="report-kpis">
        {/* A share of the total is always 100% over the whole report, so it has no card. */}
        {(data?.columns || []).filter((c) => c.kind !== 'share').map((c) => (
          <div className="kpi-card kpi-link" key={c.key} data-tone="neutral" role="button" tabIndex={0}
            title="Show every record in this report" onClick={openAll} onKeyDown={(e) => { if (e.key === 'Enter') openAll(); }}>
            <div className="kpi-card-head"><span className="kpi-card-label">{c.label}</span></div>
            <div className="kpi-card-num">
              {c.kind === 'money' ? compactMoney(data?.totals?.[c.key]) : formatMetric(data?.totals?.[c.key], c.kind)}
            </div>
          </div>
        ))}
      </div>

      {chartMetric && (
        <div className="card" style={{ marginBottom: 18 }}>
          <div className="card-head">
            {chartMetric.label} by {data?.groupLabel}
            {data?.rows?.length > 8 && <span className="sub">top 8 of {data.rows.length}</span>}
          </div>
          <div className="card-pad">
            {loading ? <div className="no-data">Loading…</div> : <RankChart rows={data?.rows || []} metric={chartMetric.key} kind={chartMetric.kind} onPick={openGroup} />}
          </div>
        </div>
      )}

      <DataTable
        title={`${spec?.label} — by ${data?.groupLabel || ''}`}
        count={data?.rows?.length || 0}
        columns={columns}
        rows={data?.rows || []}
        loading={loading}
        rowKey={(r) => r.label}
        onRowClick={(r) => openGroup(r.label)}
        search={false}
        onExport={exportCsv}
        empty={{ icon: 'chart', title: 'Nothing in this period', sub: 'Try a wider date range.' }}
      />
      </>}
    </div>
  );
}
