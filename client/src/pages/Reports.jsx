import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import PageHeader from '../components/PageHeader.jsx';
import Select from '../components/Select.jsx';
import DateField, { fmt as fmtDate } from '../components/DateField.jsx';
import { Ic } from '../components/Icons.jsx';
import toast from '../components/toast.js';
import { REPORT_TABS, REPORT_GROUPS, PRESETS, DEFAULT_PRESET, presetRange, formatMetric, compactMoney } from './reportConstants.js';
import TargetsView from './reports/TargetsView.jsx';
import RenewalCalendar from './reports/RenewalCalendar.jsx';
import AccessModal from './reports/AccessModal.jsx';
import { useAuth } from '../auth.jsx';
import { BarChart, PieChart, TrendChart, FunnelChart } from './reports/ReportCharts.jsx';
import { SummaryTable, MatrixTable, Delta } from './reports/ReportTable.jsx';
import ReportRecords, { ExportMenu } from './reports/ReportRecords.jsx';
import ReportFilters from './reports/ReportFilters.jsx';
import { LibraryModal, SaveModal, ScheduleModal } from './reports/SavedReports.jsx';
import { reportGrid, exportExcel, exportCsv, exportPdf } from './reports/reportExport.js';

// Everything that makes up what's on screen. It is written into the address, so the browser's Back
// (from a record), a copied link, and a saved report all bring back exactly this view.
const BLANK = { tab: 'business', preset: DEFAULT_PRESET, from: '', to: '', g: '', g2: '', mode: 'summary', f: {}, cmp: '', chart: 'bar', cm: '', mm: '' };
const CHARTS = [['bar', 'Bars', 'chart'], ['pie', 'Pie', 'dot'], ['trend', 'Trend', 'arrowup'], ['funnel', 'Funnel', 'funnel']];

function fromUrl() {
  const q = new URLSearchParams(window.location.search);
  const v = { ...BLANK };
  if (REPORT_TABS.some((t) => t.key === q.get('tab'))) v.tab = q.get('tab');
  const iso = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
  if (q.get('p')) v.preset = q.get('p');
  if (iso(q.get('from')) && iso(q.get('to'))) { v.from = q.get('from'); v.to = q.get('to'); if (!q.get('p')) v.preset = 'custom'; }
  for (const k of ['g', 'g2', 'cmp', 'cm', 'mm']) v[k] = q.get(k) || '';
  if (q.get('mode') === 'matrix') v.mode = 'matrix';
  if (CHARTS.some(([k]) => k === q.get('chart'))) v.chart = q.get('chart');
  try { v.f = JSON.parse(q.get('f') || '{}') || {}; } catch { v.f = {}; }
  let drill = null;
  try { drill = q.get('d') ? JSON.parse(q.get('d')) : null; } catch { drill = null; }
  return { view: v, drill, saved: Number(q.get('saved')) || null, onlySaved: !!q.get('saved') && !q.get('tab') };
}

export default function Reports() {
  const navigate = useNavigate();
  const [init] = useState(fromUrl);
  const [v, setV] = useState(() => {
    const x = { ...init.view };
    if (x.preset !== 'custom') { const r = presetRange(x.preset) || presetRange(DEFAULT_PRESET); x.from = r.from; x.to = r.to; }
    return x;
  });
  const [drill, setDrill] = useState(init.drill);   // what was clicked: { g, v, g2, v2, metric } — {} for every record
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [library, setLibrary] = useState(null);
  const [savedId, setSavedId] = useState(init.saved);
  const [libOpen, setLibOpen] = useState(false);
  const [saveOpen, setSaveOpen] = useState(null);   // null | { initial }
  const [scheduling, setScheduling] = useState(null);
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  // Which reports this person may open, and whether they may download / email them.
  const [access, setAccess] = useState({ hidden: [], canExport: true });
  const [accessOpen, setAccessOpen] = useState(false);
  const loadAccess = useCallback(() => api('/report-access').then((d) => setAccess(d.mine || { hidden: [], canExport: true })).catch(() => {}), []);
  useEffect(() => { loadAccess(); }, [loadAccess]);
  const visibleTabs = REPORT_TABS.filter((t) => !access.hidden.includes(t.uses || t.key) && (!t.adminOnly || isAdmin));
  useEffect(() => {
    if (visibleTabs.length && !visibleTabs.some((t) => t.key === v.tab)) setV((p) => ({ ...p, tab: visibleTabs[0].key }));
  }, [access]);   // eslint-disable-line react-hooks/exhaustive-deps

  const spec = REPORT_TABS.find((t) => t.key === v.tab);
  const set = (patch) => setV((p) => ({ ...p, ...patch }));
  const saved = library?.reports.find((r) => r.id === savedId) || null;

  const loadLibrary = useCallback(() => api('/report-library').then(setLibrary).catch(() => setLibrary({ reports: [], folders: [] })), []);
  useEffect(() => { loadLibrary(); }, [loadLibrary]);

  // A link to a saved report (?saved=12, e.g. from a scheduled email) opens it as it was saved.
  function applySaved(r) {
    const c = r.config || {};
    const x = { ...BLANK, ...c, tab: r.kind, f: c.f || {} };
    if (x.preset && x.preset !== 'custom') { const rr = presetRange(x.preset); if (rr) { x.from = rr.from; x.to = rr.to; } }
    if (!x.from || !x.to) { const rr = presetRange(DEFAULT_PRESET); x.from = rr.from; x.to = rr.to; x.preset = DEFAULT_PRESET; }
    setV(x); setDrill(null); setSavedId(r.id);
  }
  useEffect(() => {
    if (!init.onlySaved || !library) return;
    const r = library.reports.find((x) => x.id === init.saved);
    if (r) applySaved(r); else toast.info('That saved report is not available to you');
  }, [library]);   // eslint-disable-line react-hooks/exhaustive-deps

  // The query the server is asked — also what the record lists and filter values use.
  const query = useMemo(() => {
    const q = { from: v.from, to: v.to };
    if (v.g) q.g = v.g;
    if (v.g2) q.g2 = v.g2;
    if (Object.keys(v.f).length) q.f = JSON.stringify(v.f);
    return q;
  }, [v.from, v.to, v.g, v.g2, v.f]);

  useEffect(() => {
    if (!v.from || !v.to) return undefined;
    // The targets and calendar tabs load their own figures.
    if (REPORT_TABS.find((t) => t.key === v.tab)?.custom) { setLoading(false); return undefined; }
    let cancelled = false;
    setLoading(true);
    const q = new URLSearchParams(query);
    if (v.cmp) q.set('cmp', v.cmp);
    if (v.chart === 'trend') q.set('trend', '1');
    if (v.chart === 'funnel') q.set('funnel', '1');
    api(`/reports/${v.tab}?${q}`)
      .then((d) => { if (!cancelled) { setData(d); setLoading(false); } })
      .catch((e) => { if (!cancelled) { setLoading(false); toast.error(e.message || 'Could not load the report'); } });
    return () => { cancelled = true; };
  }, [v.tab, query, v.cmp, v.chart]);   // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the address in step, without a history entry per click.
  useEffect(() => {
    const q = new URLSearchParams({ tab: v.tab, from: v.from, to: v.to });
    if (v.preset && v.preset !== 'custom') q.set('p', v.preset);
    for (const k of ['g', 'g2', 'cmp', 'cm', 'mm']) if (v[k]) q.set(k, v[k]);
    if (v.mode === 'matrix') q.set('mode', 'matrix');
    if (v.chart !== 'bar') q.set('chart', v.chart);
    if (Object.keys(v.f).length) q.set('f', JSON.stringify(v.f));
    if (drill) q.set('d', JSON.stringify(drill));
    if (savedId) q.set('saved', String(savedId));
    window.history.replaceState(window.history.state, '', `${window.location.pathname}?${q}`);
  }, [v, drill, savedId]);

  const switchTab = (tab) => { setV((p) => ({ ...BLANK, tab, preset: p.preset, from: p.from, to: p.to, cmp: p.cmp })); setDrill(null); setSavedId(null); };
  const applyPreset = (key) => { const r = presetRange(key); if (r) set({ preset: key, ...r }); };
  const openDrill = (d) => { setDrill(Object.fromEntries(Object.entries(d).filter(([, x]) => x !== undefined && x !== ''))); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  const openRecord = (rec, page) => navigate(`${page}?open=${rec.id}`);

  const cols = data?.columns || [];
  const chartMetric = cols.find((c) => c.key === v.cm) || cols.find((c) => c.kind === 'money' && Number(data?.totals?.[c.key]) > 0) || cols[0];
  const matrixMetric = cols.find((c) => c.key === v.mm) || cols[0];
  const dims = data?.dims || [];
  const funnelOk = !!data?.funnel;
  const chart = v.chart === 'funnel' && !funnelOk ? 'bar' : v.chart;
  const cmpTotals = data?.compare?.totals;

  // ---- saving ----
  const config = () => ({ preset: v.preset, from: v.from, to: v.to, g: v.g, g2: v.g2, mode: v.mode, f: v.f, cmp: v.cmp, chart: v.chart, cm: v.cm, mm: v.mm });
  async function saveNew(form) {
    const r = await api('/report-library', { method: 'POST', body: { ...form, kind: v.tab, config: config() } });
    toast.success(`Saved “${r.name}”`); setSavedId(r.id); await loadLibrary();
  }
  async function saveEdit(r, form) {
    await api(`/report-library/${r.id}`, { method: 'PUT', body: form });
    toast.success('Saved'); await loadLibrary();
  }
  async function saveChanges() {
    try { await api(`/report-library/${saved.id}`, { method: 'PUT', body: { kind: v.tab, config: config() } }); toast.success(`“${saved.name}” updated`); loadLibrary(); }
    catch (e) { toast.error(e.message || 'Could not save'); }
  }

  function exportReport(fmt) {
    if (!data?.rows?.length) { toast.info('Nothing to export for this period'); return; }
    const grid = reportGrid(data, { mode: v.mode, metric: matrixMetric?.key });
    const name = `${saved?.name || spec?.label || v.tab}-${data.from}-to-${data.to}`;
    if (fmt === 'xlsx') exportExcel(grid, name); else if (fmt === 'csv') exportCsv(grid, name); else exportPdf(grid, saved?.name || spec?.label);
  }

  return (
    <div>
      <PageHeader
        title={saved ? <>Reports <span className="rep-saved-name">· {saved.name}</span></> : 'Reports'}
        action={(
          <div className="rep-head-acts">
            {isAdmin && <button className="btn ghost" onClick={() => setAccessOpen(true)} title="Who may see which report"><Ic name="lock" size={15} /> Access</button>}
            <button className="btn ghost" onClick={() => setLibOpen(true)}><Ic name="star" size={15} /> Saved reports{library?.reports?.length ? ` (${library.reports.length})` : ''}</button>
            {saved?.can_edit && saved.kind === v.tab && <button className="btn ghost" onClick={saveChanges} title={`Save the current view into “${saved.name}”`}><Ic name="check" size={15} /> Save changes</button>}
            <button className="btn ghost" onClick={() => setSaveOpen({ initial: null })}><Ic name="plus" size={15} /> {saved ? 'Save as new' : 'Save'}</button>
            {saved?.can_edit && access.canExport && <button className="btn ghost" onClick={() => setScheduling(saved)}><Ic name="mail" size={15} /> Schedule email</button>}
            {access.canExport && !spec?.custom && <ExportMenu onPick={exportReport} />}
          </div>
        )}
      />

      <div className="report-tabs grouped">
        {REPORT_GROUPS.map((g) => {
          const tabs = visibleTabs.filter((t) => t.group === g);
          if (!tabs.length) return null;
          return (
            <div key={g} className="rt-group">
              <span className="rt-label">{g}</span>
              {tabs.map((t) => (
                <button key={t.key} className={'report-tab' + (v.tab === t.key ? ' active' : '')} onClick={() => switchTab(t.key)}>
                  <Ic name={t.icon} size={16} /><span>{t.label}</span>
                </button>
              ))}
            </div>
          );
        })}
      </div>

      {spec?.key === 'targets' ? (
        <TargetsView onOpenPolicies={(from, to, who) => { setV({ ...BLANK, tab: 'business', preset: 'custom', from, to, f: who ? { owner: [who] } : {} }); setDrill({}); }} />
      ) : spec?.key === 'calendar' ? (
        <RenewalCalendar filters={v.f} onOpenDay={(day) => { setV((p) => ({ ...BLANK, tab: 'renewals', preset: 'custom', from: day, to: day, f: p.f })); setDrill({}); }} />
      ) : (<>

      <div className="card card-pad report-controls">
        <div className="report-presets">
          {PRESETS.map((p) => (
            <button key={p.key} className={'chip-btn' + (v.preset === p.key ? ' active' : '')} onClick={() => applyPreset(p.key)}>{p.label}</button>
          ))}
        </div>
        <div className="report-range">
          <div className="form-field"><label>From</label><DateField value={v.from} onChange={(e) => set({ preset: 'custom', from: e.target.value })} /></div>
          <div className="form-field"><label>To</label><DateField value={v.to} onChange={(e) => set({ preset: 'custom', to: e.target.value })} /></div>
          <div className="form-field">
            <label>Compare with</label>
            <Select value={v.cmp} onChange={(e) => set({ cmp: e.target.value })}>
              <option value="">No comparison</option>
              <option value="prev">The period before</option>
              <option value="yoy">Same period last year</option>
            </Select>
          </div>
        </div>
        {data && <ReportFilters kind={v.tab} dims={dims} filters={v.f} query={{ from: v.from, to: v.to }} onChange={(f) => set({ f })} />}
        <div className="report-note">
          {spec?.blurb} Counted on <strong>{data?.dateLabel || 'date'}</strong>.
          {data?.compare && <> Compared with <strong>{fmtDate(data.compare.from)} to {fmtDate(data.compare.to)}</strong>.</>}
          {data?.scope?.applied && <> Limited to <strong>{data.scope.department}</strong>.</>}
          {' '}Every number below opens the records behind it.
        </div>
      </div>

      {drill && <ReportRecords kind={v.tab} query={query} drill={drill} dims={dims} canExport={access.canExport} onBack={() => setDrill(null)} />}

      {!drill && (
        <>
          {!loading && data?.undated > 0 && (
            <div className="report-warning">
              <Ic name="alert" size={16} />
              <span>{data.undated} {data.undated === 1 ? 'record has' : 'records have'} no {String(data.dateLabel).toLowerCase()} and {data.undated === 1 ? 'is' : 'are'} not counted in any period.</span>
            </div>
          )}

          <div className="report-kpis">
            {/* A share of the total is always 100% over the whole report, so it has no card. */}
            {cols.filter((c) => c.kind !== 'share').map((c) => (
              <div className="kpi-card kpi-link" key={c.key} data-tone="neutral" role="button" tabIndex={0}
                title={c.drill ? `Show the records counted as ${c.label}` : 'Show every record in this report'}
                onClick={() => openDrill({ metric: c.drill ? c.key : undefined })}
                onKeyDown={(e) => { if (e.key === 'Enter') openDrill({ metric: c.drill ? c.key : undefined }); }}>
                <div className="kpi-card-head"><span className="kpi-card-label">{c.label}</span></div>
                <div className="kpi-card-num">{c.kind === 'money' ? compactMoney(data?.totals?.[c.key]) : formatMetric(data?.totals?.[c.key], c.kind)}</div>
                {cmpTotals && (
                  <div className="kpi-card-hint rep-kpi-cmp">
                    <Delta cur={data.totals?.[c.key]} prev={cmpTotals[c.key] ?? 0} kind={c.kind} />
                    <span>earlier {c.kind === 'money' ? compactMoney(cmpTotals[c.key]) : formatMetric(cmpTotals[c.key], c.kind)}</span>
                  </div>
                )}
              </div>
            ))}
          </div>

          {chartMetric && (
            <div className="card" style={{ marginBottom: 18 }}>
              <div className="card-head rep-chart-head">
                <span>
                  {chartMetric.label} {chart === 'trend' ? 'by month' : chart === 'funnel' ? 'by stage' : `by ${data?.groupLabel}`}
                  {chart === 'bar' && data?.rows?.length > 10 && <span className="sub">top 10 of {data.rows.length}</span>}
                </span>
                <span className="rep-chart-tools">
                  <span className="seg">
                    {CHARTS.filter(([k]) => k !== 'funnel' || funnelOk).map(([k, l, ic]) => (
                      <button key={k} type="button" className={chart === k ? 'on' : ''} onClick={() => set({ chart: k })}><Ic name={ic} size={13} /> {l}</button>
                    ))}
                  </span>
                  {chart !== 'funnel' && (
                    <Select value={chartMetric.key} onChange={(e) => set({ cm: e.target.value })}>
                      {cols.filter((c) => (chart === 'pie' ? !['pct', 'share', 'days'].includes(c.kind) : c.kind !== 'share')).map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                    </Select>
                  )}
                </span>
              </div>
              <div className="card-pad">
                {loading && !data ? <div className="no-data">Loading…</div>
                  : chart === 'pie' ? <PieChart rows={data.rows} metric={chartMetric.key} kind={chartMetric.kind} onPick={(label) => openDrill({ g: data.groupBy, v: label })} />
                  : chart === 'trend' ? <TrendChart rows={data.trend} metric={chartMetric.key} kind={chartMetric.kind} onPick={(label) => openDrill({ g: 'month', v: label })} />
                  : chart === 'funnel' ? <FunnelChart rows={data.funnelRows} order={data.funnel.order} metric={cols[0].key} kind={cols[0].kind} onPick={(label) => openDrill({ g: data.funnel.dim, v: label })} />
                  : <BarChart rows={data.rows} metric={chartMetric.key} kind={chartMetric.kind} onPick={(label) => openDrill({ g: data.groupBy, v: label })} />}
              </div>
            </div>
          )}

          <div className="card">
            <div className="card-head rep-table-head">
              <span className="seg">
                <button type="button" className={v.mode === 'summary' ? 'on' : ''} onClick={() => set({ mode: 'summary' })}><Ic name="grid" size={13} /> Summary</button>
                <button type="button" className={v.mode === 'matrix' ? 'on' : ''}
                  onClick={() => set({ mode: 'matrix', g2: v.g2 || (dims.some((d) => d.key === 'month' && d.key !== data?.groupBy) ? 'month' : dims.find((d) => d.key !== data?.groupBy)?.key || '') })}>
                  <Ic name="sliders" size={13} /> Matrix
                </button>
              </span>
              <label className="rep-inline-f">{v.mode === 'matrix' ? 'Rows' : 'Group by'}
                <Select value={data?.groupBy || ''} onChange={(e) => set({ g: e.target.value, g2: v.g2 === e.target.value ? '' : v.g2 })}>
                  {dims.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
                </Select>
              </label>
              <label className="rep-inline-f">{v.mode === 'matrix' ? 'Columns' : 'Then by'}
                <Select value={v.g2 || ''} onChange={(e) => set({ g2: e.target.value })}>
                  {v.mode !== 'matrix' && <option value="">— none —</option>}
                  {dims.filter((d) => d.key !== data?.groupBy).map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
                </Select>
              </label>
              {v.mode === 'matrix' && (
                <label className="rep-inline-f">Showing
                  <Select value={matrixMetric?.key || ''} onChange={(e) => set({ mm: e.target.value })}>
                    {cols.filter((c) => c.kind !== 'share').map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                  </Select>
                </label>
              )}
              <span className="sub" style={{ marginLeft: 'auto' }}>{data ? `${data.rows.length} ${data.groupLabel.toLowerCase()}${data.rows.length === 1 ? '' : 's'}` : ''}</span>
            </div>
            {loading && !data ? <div className="no-data" style={{ padding: 28 }}>Loading…</div>
              : v.mode === 'matrix' ? <MatrixTable data={data} metric={matrixMetric?.key} onDrill={openDrill} />
              : <SummaryTable data={data} kind={v.tab} query={query} onDrill={openDrill} onOpenRecord={openRecord} />}
          </div>
        </>
      )}

      </>)}

      <AccessModal open={accessOpen} onClose={() => setAccessOpen(false)} onSaved={loadAccess} />
      <LibraryModal open={libOpen} onClose={() => setLibOpen(false)} library={library} currentId={savedId}
        onOpenReport={applySaved} onEdit={(r) => setSaveOpen({ initial: r })} onSchedule={access.canExport ? (r) => setScheduling(r) : null} onChanged={loadLibrary} />
      <SaveModal open={!!saveOpen} onClose={() => setSaveOpen(null)} initial={saveOpen?.initial} folders={library?.folders || []}
        onSave={(form) => (saveOpen?.initial?.id ? saveEdit(saveOpen.initial, form) : saveNew(form))} />
      <ScheduleModal report={scheduling} onClose={() => setScheduling(null)} onChanged={loadLibrary} />
    </div>
  );
}
