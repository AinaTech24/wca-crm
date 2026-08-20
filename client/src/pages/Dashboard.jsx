import { useEffect, useState, Fragment } from 'react';
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

// Reporting-period filter for the dashboard overview.
const PERIODS = ['Weekly', 'Monthly', 'Quarterly', 'Semi-Quarterly', 'Semi-Annually', 'Annually'];

function niceMax(m) {
  const steps = [5, 10, 15, 20, 25, 30, 40, 50, 75, 100, 150, 200, 300, 500, 1000, 2000, 5000, 10000, 30000, 50000, 100000];
  for (const s of steps) if (m <= s) return s;
  return Math.ceil(m / 100000) * 100000;
}

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

function BarChart({ data }) {
  if (!data || data.length === 0 || data.every((d) => !d.value)) return <div className="no-data">No data available</div>;
  const W = 340, H = 224, padL = 34, padB = 48, padT = 18, padR = 10;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const max = niceMax(Math.max(...data.map((d) => d.value || 0)));
  const ticks = 4;
  const slot = plotW / data.length;
  const barW = Math.min(slot * 0.5, 46);
  const y = (v) => padT + plotH - (v / max) * plotH;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="svg-chart" preserveAspectRatio="xMidYMid meet">
      {Array.from({ length: ticks + 1 }).map((_, i) => {
        const v = (max / ticks) * i;
        const yy = y(v);
        return (
          <g key={i}>
            <line className="grid-line" x1={padL} y1={yy} x2={W - padR} y2={yy} />
            <text className="axis-label" x={padL - 6} y={yy + 3} textAnchor="end">{v}</text>
          </g>
        );
      })}
      {data.map((d, i) => {
        const cx = padL + slot * i + slot / 2;
        const bh = ((d.value || 0) / max) * plotH;
        const color = CHART_COLORS[i % CHART_COLORS.length];
        return (
          <g key={i}>
            <rect x={cx - barW / 2} y={padT + plotH - bh} width={barW} height={Math.max(bh, 1)} rx={3} fill={color} />
            <text className="val-label" x={cx} y={padT + plotH - bh - 5} textAnchor="middle">{d.value}</text>
            <text className="cat-label" x={cx + 2} y={H - padB + 14} textAnchor="end" transform={`rotate(-32 ${cx + 2} ${H - padB + 14})`}>
              <title>{d.label || '—'}</title>{(d.label || '—').slice(0, 14)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function Donut({ data }) {
  const segs = (data || []).filter((d) => d.value > 0);
  if (segs.length === 0) return <div className="no-data">No data available</div>;
  const total = segs.reduce((s, d) => s + d.value, 0) || 1;
  const cx = 90, cy = 90, rMid = 60, sw = 24;
  const C = 2 * Math.PI * rMid;
  let acc = 0;
  const center = segs.length === 1 ? segs[0].label : 'Total';
  const centerVal = segs.length === 1 ? segs[0].value : total;

  return (
    <div className="donut-wrap">
      <svg viewBox="0 0 180 180" width="180" height="180">
        <circle cx={cx} cy={cy} r={rMid} fill="none" stroke="var(--surface-3)" strokeWidth={sw} />
        {segs.map((s, i) => {
          const dash = (s.value / total) * C;
          const el = (
            <circle key={i} cx={cx} cy={cy} r={rMid} fill="none" stroke={CHART_COLORS[i % CHART_COLORS.length]} strokeWidth={sw}
              strokeDasharray={`${dash} ${C - dash}`} strokeDashoffset={-acc} transform={`rotate(-90 ${cx} ${cy})`} strokeLinecap="butt" />
          );
          acc += dash;
          return el;
        })}
        <text x={cx} y={cy - 4} textAnchor="middle" style={{ fontWeight: 700, fontSize: 15, fill: 'var(--text-2)' }}>{center}</text>
        <text x={cx} y={cy + 18} textAnchor="middle" style={{ fontWeight: 750, fontSize: 18, fill: 'var(--text)' }}>{Number(centerVal).toLocaleString('en-IN')}</text>
      </svg>
      <div className="donut-legend">
        {segs.map((s, i) => (
          <div className="li" key={i}><span className="sw" style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} /> {s.label} · <b>{Number(s.value).toLocaleString('en-IN')}</b></div>
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
  const [renewFilter, setRenewFilter] = useState('Today');
  const [period, setPeriod] = useState('Monthly');
  const [weekOpen, setWeekOpen] = useState(false);
  const [weekRows, setWeekRows] = useState([]);
  const [weekLoading, setWeekLoading] = useState(false);
  const navigate = useNavigate();

  function openWeekRenewals() {
    setWeekOpen(true); setWeekLoading(true);
    api('/renewals').then((d) => setWeekRows((d.rows || []).filter((r) => r.bucket === 'd7'))).catch(() => setWeekRows([])).finally(() => setWeekLoading(false));
  }

  useEffect(() => { api('/dashboard').then(setData).catch(() => setData({ error: true })); }, []);

  // Live metrics: when policies/claims change anywhere, quietly re-sync the
  // (small) summary in the background — no loading state, no layout shift.
  useEffect(() => {
    let timer, alive = true;
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        api('/dashboard').then((d) => alive && setData(d)).catch(() => {});
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
  const upcomingRenewals = (data.giRenewals?.length || 0) + (data.liRenewals?.length || 0);

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle="Overview of your policies, claims and renewals"
        action={
          <div className="dash-filter">
            <span className="dash-filter-ic"><Ic name="filter" size={15} /></span>
            <Select className="dash-filter-select" value={period} onChange={(e) => setPeriod(e.target.value)}>
              {PERIODS.map((p) => <option key={p} value={p}>{p}</option>)}
            </Select>
          </div>
        }
      />

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
          <div className="card-head">Company Wise <span className="sub">Policies by insurer</span></div>
          <div className="card-pad"><BarChart data={data.charts?.companyWise} /></div>
        </div>
        <div className="card">
          <div className="card-head">Type Wise <span className="sub">Policies by product</span></div>
          <div className="card-pad"><BarChart data={data.charts?.typeWise} /></div>
        </div>
        <div className="card">
          <div className="card-head">Business <span className="sub">Premium split</span></div>
          <div className="card-pad"><Donut data={data.charts?.businessWise} /></div>
        </div>
      </div>

      <div className="summary-grid" style={{ marginBottom: 22 }}>
        <div className="card">
          <div className="card-head">Policy Summary</div>
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
          <div className="card-head">Claim Summary</div>
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

      <RenewalTable title="Renewal List — General Insurance" rows={data.giRenewals} filter={renewFilter} setFilter={setRenewFilter} />
      <div style={{ height: 22 }} />
      <RenewalTable title="Renewal List — Life Insurance" rows={data.liRenewals} filter={renewFilter} setFilter={setRenewFilter} />

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

function RenewalTable({ title, rows, filter, setFilter }) {
  const [q, setQ] = useState('');
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
          <option>Today</option><option>This Week</option><option>This Month</option><option>All</option>
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
              {filtered.length === 0 && <tr><td colSpan={10} style={{ textAlign: 'center', color: 'var(--text-3)', padding: 28 }}>No records found</td></tr>}
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
      </div>
    </div>
  );
}
