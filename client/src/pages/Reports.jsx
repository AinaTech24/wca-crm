import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import PageHeader from '../components/PageHeader.jsx';
import DataTable from '../components/DataTable.jsx';
import Select from '../components/Select.jsx';
import DateField from '../components/DateField.jsx';
import { Ic } from '../components/Icons.jsx';
import toast from '../components/toast.js';
import {
  REPORT_TABS, PRESETS, DEFAULT_PRESET, presetRange,
  formatMetric, compactMoney, toCsv, downloadCsv,
} from './reportConstants.js';

const CHART_COLORS = ['#1b6fb0', '#e9531e', '#16874e', '#8bb6dc', '#d98324', '#5b6472'];

// Horizontal bars — a report groups by name (user, product, insurer), and
// names need room to be readable, which vertical bars don't give them.
function RankChart({ rows, metric, kind }) {
  const top = rows.slice(0, 8);
  const max = Math.max(...top.map((r) => Number(r[metric]) || 0), 0);
  if (!top.length || !max) return <div className="no-data">Nothing to chart for this period</div>;

  return (
    <div className="rank-chart">
      {top.map((r, i) => (
        <div className="rank-row" key={r.label}>
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

export default function Reports() {
  const [tab, setTab] = useState('business');
  const [preset, setPreset] = useState(DEFAULT_PRESET);
  const [range, setRange] = useState(() => presetRange(DEFAULT_PRESET));
  const [groupBy, setGroupBy] = useState({});   // remembered per report
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const spec = REPORT_TABS.find((t) => t.key === tab);

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
            <Select value={data?.groupBy || ''} onChange={(e) => setGroupBy((g) => ({ ...g, [tab]: e.target.value }))}>
              {(data?.dims || []).map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
            </Select>
          </div>
        </div>
        <div className="report-note">
          {spec?.blurb} Counted on <strong>{data?.dateLabel || 'date'}</strong>.
          {data?.scope?.applied && <> Limited to <strong>{data.scope.department}</strong>.</>}
        </div>
      </div>

      {/* Undated rows can't be placed in any period, so they're excluded. Saying
          so stops a partial report from being read as a complete one. */}
      {!loading && data?.undated > 0 && (
        <div className="report-warning">
          <Ic name="alert" size={16} />
          <span>
            {data.undated} {data.undated === 1 ? 'record has' : 'records have'} no {String(data.dateLabel).toLowerCase()} and
            {' '}{data.undated === 1 ? 'is' : 'are'} not counted in any period.
          </span>
        </div>
      )}

      <div className="report-kpis">
        {/* A share of the total is always 100% over the whole report, so it has no card. */}
        {(data?.columns || []).filter((c) => c.kind !== 'share').map((c) => (
          <div className="kpi-card" key={c.key} data-tone="neutral">
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
            {loading ? <div className="no-data">Loading…</div> : <RankChart rows={data?.rows || []} metric={chartMetric.key} kind={chartMetric.kind} />}
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
        search={false}
        onExport={exportCsv}
        empty={{ icon: 'chart', title: 'Nothing in this period', sub: 'Try a wider date range.' }}
      />
    </div>
  );
}
