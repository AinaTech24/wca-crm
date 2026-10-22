import { useEffect, useMemo, useRef, useState, Fragment } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { Ic } from '../components/Icons.jsx';
import PageHeader from '../components/PageHeader.jsx';
import Select from '../components/Select.jsx';
import Modal from '../components/Modal.jsx';
import { subscribe } from '../realtime.js';

const BIZ_RANGES = ['Today', 'Yesterday', 'This Week', 'This Month'];
function bizDateRange(rangeLabel) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  if (rangeLabel === 'Yesterday') { const y = new Date(today); y.setDate(y.getDate() - 1); return { from: iso(y), to: iso(y) }; }
  if (rangeLabel === 'This Week') { const s = new Date(today); s.setDate(s.getDate() - s.getDay()); return { from: iso(s), to: iso(today) }; }
  if (rangeLabel === 'This Month') { const s = new Date(today.getFullYear(), today.getMonth(), 1); return { from: iso(s), to: iso(today) }; }
  return { from: iso(today), to: iso(today) };
}

// "Daily Business" — policies logged & premium booked in the selected range.
function DailyBusiness() {
  const [range, setRange] = useState('Today');
  const [biz, setBiz] = useState(null);
  useEffect(() => {
    const { from, to } = bizDateRange(range);
    api(`/dashboard/business?from=${from}&to=${to}`).then(setBiz).catch(() => setBiz(null));
  }, [range]);
  return (
    <div className="card" style={{ marginBottom: 22 }}>
      <div className="card-head">Daily Business
        <Select value={range} onChange={(e) => setRange(e.target.value)} className="field-inline" style={{ marginLeft: 'auto' }}>
          {BIZ_RANGES.map((r) => <option key={r}>{r}</option>)}
        </Select>
      </div>
      <div className="card-pad">
        <div className="metric-grid">
          <Metric label="Policies Logged" num={biz?.policies ?? '—'} color="#1b6fb0" pct={100} />
          <Metric label="Premium Booked" num={'₹ ' + Number(biz?.premium || 0).toLocaleString('en-IN')} color="#16874e" pct={100} />
          <Metric label="Claims Reported" num={biz?.claims ?? '—'} color="#e9531e" pct={100} />
        </div>
      </div>
    </div>
  );
}

const STEPS = [
  { label: 'Add Proposal', icon: 'userplus', to: '/page/policy' },
  { label: 'Send to Company', icon: 'send', to: '/page/policy' },
  { label: 'Issue / Decline', icon: 'shieldcheck', to: '/page/policy' },
  { label: 'Dispatch Docs', icon: 'dispatch', to: '/page/policy' },
  { label: 'Dispatch Status', icon: 'clipboard', to: '/page/policy' },
];

const CHART_COLORS = ['#1b6fb0', '#e9531e', '#5b6472', '#8bb6dc'];

// Reporting-period filter for the dashboard overview: rolling windows ending today.
const PERIODS = [
  { value: 'all', label: 'All time', days: null },
  { value: 'weekly', label: 'Weekly · last 7 days', days: 7 },
  { value: 'monthly', label: 'Monthly · last 30 days', days: 30 },
  { value: 'quarterly', label: 'Quarterly · last 90 days', days: 90 },
  { value: 'semi-quarterly', label: 'Semi-Quarterly · last 45 days', days: 45 },
  { value: 'semi-annually', label: 'Semi-Annually · last 180 days', days: 180 },
  { value: 'annually', label: 'Annually · last 365 days', days: 365 },
];

// ₹ amounts the way a broker reads them: 1.5 Cr, 45.3 L, 12.5 K.
function compactInr(n) {
  n = Number(n) || 0;
  const trim = (x, d) => x.toFixed(d).replace(/\.?0+$/, '');
  if (n >= 1e7) return '₹ ' + trim(n / 1e7, 2) + ' Cr';
  if (n >= 1e5) return '₹ ' + trim(n / 1e5, 2) + ' L';
  if (n >= 1e3) return '₹ ' + trim(n / 1e3, 1) + ' K';
  return '₹ ' + Math.round(n).toLocaleString('en-IN');
}
const pctText = (p) => (p > 0 && p < 1 ? '<1' : p < 10 ? p.toFixed(1).replace(/\.0$/, '') : String(Math.round(p))) + '%';

// Individual KPI cards — label sits on its own line so it never wraps; the
// number and a muted icon share the next row, with one line of context below.
function KpiGrid({ items }) {
  return (
    <div className="kpi-grid">
      {items.map((it) => (
        <div className="kpi-card" data-tone={it.tone || 'neutral'} key={it.label}>
          <div className="kpi-card-head">
            <span className="kpi-card-label">{it.label}</span>
            <span className="kpi-card-ic"><Ic name={it.icon} size={17} /></span>
          </div>
          <div className="kpi-card-num">{it.num}</div>
          {it.hint && <div className="kpi-card-hint">{it.hint}</div>}
        </div>
      ))}
    </div>
  );
}

function Metric({ label, num, color, pct }) {
  const p = Math.min(Math.max(pct || 0, 0), 100);
  return (
    <div className="metric">
      <div className="top">
        <div className="ic" style={{ background: color + '1a', color }}>●</div>
        <div>
          <div className="label">{label}</div>
          <div className="num">{num}</div>
        </div>
      </div>
      <div className="bar-row">
        <div className="bar"><span style={{ width: p + '%', background: color }} /></div>
        <span className="pct">{Math.round(p)}%</span>
      </div>
    </div>
  );
}

// Ranked list for "policies by insurer / product". Hundreds of names do not fit a column chart,
// so the biggest few are shown as bars, the long tail is folded into "Others", and the whole list
// is one click away.
const TOP_N = 8;
function RankedBars({ items, metric, noun }) {
  const [expanded, setExpanded] = useState(false);
  const { list, total } = useMemo(() => {
    const key = metric === 'premium' ? 'premium' : 'value';
    const list = (items || []).map((i) => ({ label: i.label, n: Number(i[key]) || 0 })).filter((i) => i.n > 0).sort((a, b) => b.n - a.n);
    return { list, total: list.reduce((s, i) => s + i.n, 0) };
  }, [items, metric]);
  if (!list.length) return <div className="no-data">No policies in this period</div>;

  const fmt = (n) => (metric === 'premium' ? compactInr(n) : n.toLocaleString('en-IN'));
  const shown = expanded ? list : list.slice(0, TOP_N);
  const rest = expanded ? [] : list.slice(TOP_N);
  const rows = rest.length ? [...shown, { label: `Others (${rest.length} ${noun}${rest.length === 1 ? '' : 's'})`, n: rest.reduce((s, i) => s + i.n, 0), other: true }] : shown;
  const max = list[0].n;

  return (
    <div className="rk">
      <div className={'rk-list' + (expanded ? ' rk-scroll' : '')}>
        {rows.map((r, i) => (
          <div className="rk-row" key={r.label + i} title={`${r.label} — ${fmt(r.n)} (${pctText((r.n / total) * 100)})`}>
            <div className="rk-top">
              <span className="rk-name">{r.label}</span>
              <span className="rk-val">{fmt(r.n)}<em>{pctText((r.n / total) * 100)}</em></span>
            </div>
            <div className="rk-track"><span className={r.other ? 'other' : ''} style={{ width: Math.max((r.n / max) * 100, 1.5) + '%' }} /></div>
          </div>
        ))}
      </div>
      <div className="rk-foot">
        <span>{list.length} {noun}{list.length === 1 ? '' : 's'} · {fmt(total)} {metric === 'premium' ? 'premium' : 'policies'}</span>
        {list.length > TOP_N && (
          <button type="button" className="rk-more" onClick={() => setExpanded((e) => !e)}>{expanded ? 'Show top ' + TOP_N : `Show all ${list.length}`}</button>
        )}
      </div>
    </div>
  );
}

function MetricToggle({ value, onChange }) {
  return (
    <div className="rk-seg" role="tablist" aria-label="Show by">
      {[['count', 'Policies'], ['premium', 'Premium']].map(([k, label]) => (
        <button key={k} type="button" role="tab" aria-selected={value === k} className={value === k ? 'on' : ''} onClick={() => onChange(k)}>{label}</button>
      ))}
    </div>
  );
}

// Premium split between General and Life: a ring with the total inside and one line per segment.
const LINE_META = {
  GI: { name: 'General Insurance', color: '#e9531e' },
  LI: { name: 'Life Insurance', color: '#1b6fb0' },
};
function BusinessSplit({ data }) {
  const segs = (data || []).map((d) => {
    const meta = LINE_META[d.label] || { name: d.label || 'Other', color: '#5b6472' };
    return { ...meta, premium: Number(d.value) || 0, count: Number(d.count) || 0 };
  }).filter((d) => d.premium > 0 || d.count > 0).sort((a, b) => b.premium - a.premium);
  const total = segs.reduce((s, d) => s + d.premium, 0);
  if (!segs.length) return <div className="no-data">No policies in this period</div>;
  const R = 72, SW = 20, C = 2 * Math.PI * R;
  let acc = 0;
  return (
    <div className="bs">
      <div className="bs-ring">
        <svg viewBox="0 0 200 200" role="img" aria-label={`Total premium ${compactInr(total)}`}>
          <circle cx="100" cy="100" r={R} fill="none" stroke="var(--surface-3)" strokeWidth={SW} />
          {total > 0 && segs.map((s) => {
            const dash = (s.premium / total) * C;
            const el = <circle key={s.name} cx="100" cy="100" r={R} fill="none" stroke={s.color} strokeWidth={SW}
              strokeDasharray={`${Math.max(dash - 2, 0)} ${C - Math.max(dash - 2, 0)}`} strokeDashoffset={-acc} transform="rotate(-90 100 100)" />;
            acc += dash;
            return el;
          })}
        </svg>
        <div className="bs-center"><span>Total premium</span><b>{compactInr(total)}</b></div>
      </div>
      <div className="bs-legend">
        {segs.map((s) => (
          <div className="bs-item" key={s.name}>
            <span className="sw" style={{ background: s.color }} />
            <div className="bs-txt">
              <span className="bs-name">{s.name}</span>
              <span className="bs-sub">{s.count.toLocaleString('en-IN')} {s.count === 1 ? 'policy' : 'policies'}</span>
            </div>
            <div className="bs-num"><b>{compactInr(s.premium)}</b><em>{total > 0 ? pctText((s.premium / total) * 100) : '—'}</em></div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Renewal pipeline snapshot — aging buckets, conversion and premium-at-risk,
// so the book's #1 revenue lever is visible on the home screen.
function RenewalWidget({ r, onManage, onWeekClick }) {
  if (!r) return null;
  const c = r.counts || {};
  const segs = [
    { key: 'lapsed', label: 'Overdue', val: c.lapsed || 0, color: '#c0342a' },
    { key: 'd7', label: '0–7d', val: c.d7 || 0, color: '#e9531e' },
    { key: 'd15', label: '8–15d', val: c.d15 || 0, color: '#d98324' },
    { key: 'd30', label: '16–30d', val: c.d30 || 0, color: '#c9a227' },
    { key: 'd60', label: '31–60d', val: c.d60 || 0, color: '#5b8fc7' },
    { key: 'd90', label: '61–90d', val: c.d90 || 0, color: '#9cc0e0' },
  ];
  const total = segs.reduce((s, x) => s + x.val, 0) || 1;
  return (
    <div className="card" style={{ marginBottom: 22 }}>
      <div className="card-head">Renewal Pipeline <span className="sub">next 90 days</span>
        <button className="btn ghost" style={{ padding: '6px 12px', marginLeft: 'auto' }} onClick={onManage}>Manage <Ic name="arrowright" size={14} /></button>
      </div>
      <div className="card-pad">
        <div className="rnw-bar">
          {segs.map((s) => s.val > 0 && <span key={s.key} className="rnw-seg" style={{ width: (s.val / total * 100) + '%', background: s.color }} title={`${s.label}: ${s.val}`} />)}
          {total === 1 && segs.every((s) => s.val === 0) && <span className="rnw-seg" style={{ width: '100%', background: 'var(--surface-3)' }} />}
        </div>
        <div className="rnw-legend">
          {segs.map((s) => s.key === 'd7' ? (
            <button key={s.key} type="button" className="rnw-leg rnw-leg-btn" onClick={onWeekClick} title="View renewals pending this week">
              <span className="dot" style={{ background: s.color }} /> {s.label} <b>{s.val}</b>
            </button>
          ) : (
            <span key={s.key} className="rnw-leg"><span className="dot" style={{ background: s.color }} /> {s.label} <b>{s.val}</b></span>
          ))}
        </div>
        <div className="rnw-stats">
          <div className="rnw-stat"><span className="l">Due in 30 days</span><span className="v">{r.dueSoon || 0}</span></div>
          <div className="rnw-stat"><span className="l">Renewal conversion</span><span className="v" style={{ color: 'var(--success)' }}>{r.conversion || 0}%</span></div>
          <div className="rnw-stat"><span className="l">Premium at risk</span><span className="v">₹ {Number(r.atRisk || 0).toLocaleString('en-IN')}</span></div>
        </div>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [renewFilter, setRenewFilter] = useState('today');
  const [period, setPeriod] = useState('all');
  const [busy, setBusy] = useState(false);
  const [companyMetric, setCompanyMetric] = useState('count');
  const [typeMetric, setTypeMetric] = useState('count');
  const periodDef = PERIODS.find((x) => x.value === period) || PERIODS[0];
  const periodRef = useRef(periodDef);
  periodRef.current = periodDef;
  const [weekOpen, setWeekOpen] = useState(false);
  const [weekRows, setWeekRows] = useState([]);
  const [weekLoading, setWeekLoading] = useState(false);
  const navigate = useNavigate();

  function openWeekRenewals() {
    setWeekOpen(true); setWeekLoading(true);
    api('/renewals').then((d) => setWeekRows((d.rows || []).filter((r) => r.bucket === 'd7'))).catch(() => setWeekRows([])).finally(() => setWeekLoading(false));
  }

  const dashPath = (def) => '/dashboard' + (def.days ? `?days=${def.days}` : '');
  // First load shows the page spinner; later period changes keep the old numbers on screen,
  // dimmed, until the new ones arrive.
  useEffect(() => {
    let alive = true;
    setBusy(true);
    api(dashPath(periodDef))
      .then((d) => alive && setData(d))
      .catch(() => alive && setData((cur) => cur || { error: true }))
      .finally(() => alive && setBusy(false));
    return () => { alive = false; };
  }, [period]);

  // Live metrics: when policies/claims change anywhere, quietly re-sync the
  // (small) summary in the background — no loading state, no layout shift.
  useEffect(() => {
    let timer, alive = true;
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        api(dashPath(periodRef.current)).then((d) => alive && setData(d)).catch(() => {});
      }, 400); // debounce bursts of events
    };
    const unsub = [
      subscribe('policy', refresh), subscribe('claim', refresh),
      subscribe('client', refresh), subscribe('fd', refresh),
    ];
    return () => { alive = false; clearTimeout(timer); unsub.forEach((u) => u()); };
  }, []);

  if (!data) return <div className="spinner">Loading dashboard…</div>;

  const ps = data.policySummary || {};
  const cs = data.claimSummary || {};
  const totalPolicies = Math.max((ps.currentYear || 0) + (ps.pending || 0) + (ps.issued || 0) + (ps.cancel || 0), 1);
  const totalClaims = Math.max(cs.total || 1, 1);
  const periodNote = periodDef.days ? `last ${periodDef.days} days` : 'all time';

  return (
    <div className={busy ? 'dash-busy' : ''}>
      <PageHeader
        title="Dashboard"
        subtitle="Overview of your policies, claims and renewals"
        action={
          <div className="dash-filter">
            <span className="dash-filter-ic"><Ic name="filter" size={15} /></span>
            <Select className="dash-filter-select" value={period} onChange={(e) => setPeriod(e.target.value)}>
              {PERIODS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </Select>
          </div>
        }
      />

      {data.totals && (
        <>
          <div className="dash-overview-title">Business at a glance <span className="dash-period">{periodNote}</span></div>
          <KpiGrid
            items={[
              { label: 'Leads', num: data.totals.leads.total, icon: 'target', tone: 'info', hint: `${data.totals.leads.open} open` },
              { label: 'RFQs', num: data.totals.rfqs.total, icon: 'clipboard', tone: 'info', hint: `${data.totals.rfqs.open} open` },
              { label: 'Clients', num: data.totals.clients.total, icon: 'user', tone: 'success', hint: `${data.totals.clients.active} active` },
              { label: 'Policies', num: data.totals.policies.total, icon: 'file', tone: 'success', hint: `${data.totals.policies.active} active` },
              { label: 'Claims', num: data.totals.claims.total, icon: 'shieldcheck', tone: 'warning', hint: `${data.totals.claims.open} open` },
              { label: 'Tasks', num: data.totals.tasks.total, icon: 'checksquare', tone: 'neutral', hint: `${data.totals.tasks.open} open` },
              { label: 'Meetings', num: data.totals.meetings.total, icon: 'calendar', tone: 'neutral', hint: `${data.totals.meetings.upcoming} upcoming` },
              { label: 'Team Members', num: data.totals.team.total, icon: 'users', tone: 'neutral', hint: `${data.totals.team.admins} admin${data.totals.team.admins === 1 ? '' : 's'} · always current` },
            ].map((it) => ({ ...it, num: Number(it.num).toLocaleString('en-IN') }))}
          />
        </>
      )}

      <KpiGrid
        items={[
          { label: 'Active Policies', num: ps.currentYear || 0, icon: 'file', tone: 'info', hint: `${ps.issued || 0} issued this year` },
          { label: 'Pending Proposals', num: ps.pending || 0, icon: 'clock', tone: 'warning', hint: `${ps.cancel || 0} cancelled / declined` },
          { label: 'Total Claims', num: cs.total || 0, icon: 'shieldcheck', tone: 'neutral', hint: `${cs.settled || 0} settled` },
          { label: 'Renewal Conversion', num: (data.renewal?.conversion || 0) + '%', icon: 'refresh', tone: (data.renewal?.conversion || 0) >= 60 ? 'success' : 'warning', hint: `${data.renewal?.dueSoon || 0} due in 30 days` },
        ]}
      />

      <div className="card" style={{ margin: '18px 0 22px' }}>
        <div className="card-head">Business Process <span className="sub">Proposal to dispatch</span></div>
        <div className="card-pad">
          <div className="stepper">
            {STEPS.map((s, i) => (
              <Fragment key={s.label}>
                <button className="step" onClick={() => navigate(s.to)} title={`Go to ${s.label}`}>
                  <span className="step-node">{i + 1}</span>
                  <span className="step-label">{s.label}</span>
                </button>
                {i < STEPS.length - 1 && <span className="step-sep" />}
              </Fragment>
            ))}
          </div>
        </div>
      </div>

      <DailyBusiness />

      <RenewalWidget r={data.renewal} onManage={() => navigate('/page/policy')} onWeekClick={openWeekRenewals} />

      <div className="chart-grid" style={{ marginBottom: 22 }}>
        <div className="card">
          <div className="card-head"><span>Company Wise <span className="sub">{periodNote}</span></span><MetricToggle value={companyMetric} onChange={setCompanyMetric} /></div>
          <div className="card-pad"><RankedBars items={data.charts?.companyWise} metric={companyMetric} noun="insurer" /></div>
        </div>
        <div className="card">
          <div className="card-head"><span>Type Wise <span className="sub">{periodNote}</span></span><MetricToggle value={typeMetric} onChange={setTypeMetric} /></div>
          <div className="card-pad"><RankedBars items={data.charts?.typeWise} metric={typeMetric} noun="product" /></div>
        </div>
        <div className="card">
          <div className="card-head"><span>Business <span className="sub">{periodNote}</span></span></div>
          <div className="card-pad"><BusinessSplit data={data.charts?.businessWise} /></div>
        </div>
      </div>

      <div className="summary-grid" style={{ marginBottom: 22 }}>
        <div className="card">
          <div className="card-head"><span>Policy Summary <span className="sub">{periodNote}</span></span></div>
          <div className="card-pad">
            <div className="metric-grid">
              <Metric label="Current Year" num={ps.currentYear || 0} color="#1b6fb0" pct={(ps.currentYear / totalPolicies) * 100} />
              <Metric label="Pending" num={ps.pending || 0} color="#e9531e" pct={(ps.pending / totalPolicies) * 100} />
              <Metric label="Issued" num={ps.issued || 0} color="#16874e" pct={(ps.issued / totalPolicies) * 100} />
              <Metric label="Cancel / Decline" num={ps.cancel || 0} color="#c0342a" pct={(ps.cancel / totalPolicies) * 100} />
            </div>
          </div>
        </div>
        <div className="card">
          <div className="card-head"><span>Claim Summary <span className="sub">{periodNote}</span></span></div>
          <div className="card-pad">
            <div className="metric-grid">
              <Metric label="Total Claim" num={cs.total || 0} color="#1b6fb0" pct={100} />
              <Metric label="Pending" num={cs.pending || 0} color="#e9531e" pct={(cs.pending / totalClaims) * 100} />
              <Metric label="Settled" num={cs.settled || 0} color="#16874e" pct={(cs.settled / totalClaims) * 100} />
              <Metric label="Rejected" num={cs.rejected || 0} color="#c0342a" pct={(cs.rejected / totalClaims) * 100} />
            </div>
          </div>
        </div>
      </div>

      <RenewalTable title="Renewal List — General Insurance" line="GI" filter={renewFilter} setFilter={setRenewFilter} />
      <div style={{ height: 22 }} />
      <RenewalTable title="Renewal List — Life Insurance" line="LI" filter={renewFilter} setFilter={setRenewFilter} />

      <Modal open={weekOpen} onClose={() => setWeekOpen(false)} title="Renewals Pending This Week" subtitle="Policies expiring within 0–7 days" icon="calendar" size="lg">
        {weekLoading ? (
          <div className="spinner">Loading…</div>
        ) : weekRows.length === 0 ? (
          <div className="no-data">No renewals due this week</div>
        ) : (
          <div className="table-wrap">
            <table className="grid">
              <thead><tr><th>Expiry</th><th>Client</th><th>Company</th><th>Product</th><th>Policy No</th><th className="num">Premium</th></tr></thead>
              <tbody>
                {weekRows.map((r) => (
                  <tr key={r.id}>
                    <td><b>{r.period_to || '—'}</b></td>
                    <td>{r.insured_name}</td>
                    <td>{r.company_name}</td>
                    <td>{r.product_name}</td>
                    <td>{r.policy_number || '—'}</td>
                    <td className="num">{Number(r.final_premium || 0).toLocaleString('en-IN')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Modal>
    </div>
  );
}

const RENEW_RANGES = [['today', 'Today'], ['week', 'Next 7 days'], ['month', 'This month'], ['all', 'All upcoming']];

// Policies expiring in the chosen range, fetched for that range rather than cut down from a fixed
// list, so "Today" really shows today's expiries.
function RenewalTable({ title, line, filter, setFilter }) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState(null);
  const [total, setTotal] = useState(0);
  useEffect(() => {
    let alive = true, timer;
    const load = () => api(`/dashboard/renewals?line=${line}&range=${filter}`)
      .then((d) => { if (alive) { setRows(d.rows || []); setTotal(d.total || 0); } })
      .catch(() => { if (alive) { setRows([]); setTotal(0); } });
    load();
    // A renewal done elsewhere drops off the list without a reload.
    const unsub = subscribe('policy', () => { clearTimeout(timer); timer = setTimeout(load, 400); });
    return () => { alive = false; clearTimeout(timer); unsub(); };
  }, [line, filter]);
  const filtered = (rows || []).filter((r) =>
    !q || (r.insured_name || '').toLowerCase().includes(q.toLowerCase()) || (r.policy_number || '').toLowerCase().includes(q.toLowerCase())
  );
  return (
    <div className="card">
      <div className="card-head renewal-head">
        <span className="renewal-title">{title}</span>
        <div className="renewal-search">
          <span className="rs-ic"><Ic name="search" size={15} /></span>
          <input placeholder="Search renewals…" value={q} onChange={(e) => setQ(e.target.value)} />
          {q && <button className="rs-clear" onClick={() => setQ('')} aria-label="Clear search"><Ic name="x" size={14} /></button>}
        </div>
        <Select value={filter} onChange={(e) => setFilter(e.target.value)} className="field-inline">
          {RENEW_RANGES.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </Select>
      </div>
      <div className="card-pad">
        <div className="table-wrap">
          <table className="grid">
            <thead>
              <tr>
                <th>#</th><th>Policy Expiry</th><th>Client Name</th><th>Company</th>
                <th>Product</th><th>Policy No</th><th className="num">Sum Assured</th><th className="num">Premium</th>
                <th>Reg No</th><th>Action</th>
              </tr>
            </thead>
            <tbody>
              {rows === null && <tr><td colSpan={10} style={{ textAlign: 'center', color: 'var(--text-3)', padding: 28 }}>Loading…</td></tr>}
              {rows !== null && filtered.length === 0 && <tr><td colSpan={10} style={{ textAlign: 'center', color: 'var(--text-3)', padding: 28 }}>No renewals {filter === 'today' ? 'due today' : filter === 'week' ? 'in the next 7 days' : filter === 'month' ? 'for the rest of this month' : 'upcoming'}</td></tr>}
              {filtered.map((r, i) => (
                <tr key={r.id}>
                  <td>{i + 1}</td>
                  <td><b>{r.period_to || '—'}</b></td>
                  <td>{r.insured_name}</td>
                  <td>{r.company_name}</td>
                  <td>{r.product_name}</td>
                  <td>{r.policy_number}</td>
                  <td className="num">{Number(r.sum_assured).toLocaleString('en-IN')}</td>
                  <td className="num">{Number(r.final_premium).toLocaleString('en-IN')}</td>
                  <td>{r.reg_no || '—'}</td>
                  <td><button className="action-btn" title="View"><Ic name="externallink" size={14} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rows && total > rows.length && <div className="rk-foot" style={{ marginTop: 10 }}><span>Showing the first {rows.length} of {total.toLocaleString('en-IN')}, soonest first</span></div>}
      </div>
    </div>
  );
}
