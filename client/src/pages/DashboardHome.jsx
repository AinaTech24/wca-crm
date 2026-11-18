// The top of the dashboard: the overview cards, the person's target, premium by day / week / month, their
// schedule, the team leaderboard, the everyday actions and today's figures beside yesterday's.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { Ic } from '../components/Icons.jsx';
import { subscribe } from '../realtime.js';

const inr = (n) => Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
const compact = (n) => { const v = Number(n) || 0; return v >= 1e7 ? `${(v / 1e7).toFixed(2)} Cr` : v >= 1e5 ? `${(v / 1e5).toFixed(2)} L` : inr(v); };
export const greeting = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; };
const istToday = () => new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Kolkata' }).slice(0, 10);
const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const dmy = (iso) => (iso ? new Date(iso + 'T00:00:00Z').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' }) : '');

// Reload a panel when records it counts change anywhere.
function useLive(load, entities, deps = []) {
  useEffect(() => {
    let timer;
    load();
    const offs = entities.map((e) => subscribe(e, () => { clearTimeout(timer); timer = setTimeout(load, 600); }));
    return () => { clearTimeout(timer); offs.forEach((o) => o()); };
  }, deps);   // eslint-disable-line react-hooks/exhaustive-deps
}

/* ---------- Overview: three gradient cards ---------- */
export function Overview({ data }) {
  const navigate = useNavigate();
  const [o, setO] = useState(null);
  useLive(() => api('/dashboard/overview').then(setO).catch(() => {}), ['rfq', 'claim', 'task']);
  const r = data?.renewal || {};
  const cards = [
    { key: 'ren', tone: 'orange', icon: 'refresh', label: 'Renewals this week', n: (r.counts?.d7 || 0) + (r.counts?.lapsed || 0), unit: r.counts?.lapsed ? `policies · ${r.counts.lapsed} lapsed` : 'policies due in 7 days', to: '/page/reports?tab=calendar' },
    { key: 'rfq', tone: 'green', icon: 'clipboard', label: 'Open RFQs', n: o?.rfqs ?? 0, unit: o?.rfqsMine ? `quotes to chase · ${o.rfqsMine} yours` : 'quotes to chase and share', to: '/page/rfq' },
    { key: 'clm', tone: 'blue', icon: 'shieldcheck', label: 'Open claims', n: o?.claims ?? 0, unit: 'documents and settlement to follow', to: '/page/claim' },
  ];
  return (
    <div className="ov-grid">
      {cards.map((c) => (
        <button key={c.key} type="button" className={'ov-card ' + c.tone} onClick={() => navigate(c.to)}>
          <span className="ov-top"><span className="ov-ic"><Ic name={c.icon} size={15} /></span>{c.label}</span>
          <span className="ov-n">{inr(c.n)}</span>
          <span className="ov-unit">{c.unit}</span>
        </button>
      ))}
    </div>
  );
}

/* ---------- Ring: the person's target, or renewal conversion when no target is set ---------- */
function Ring({ pct, color }) {
  const R = 46, C = 2 * Math.PI * R, p = Math.max(0, Math.min(Number(pct) || 0, 100));
  return (
    <svg className="ring" viewBox="0 0 120 120" aria-hidden="true">
      <circle cx="60" cy="60" r={R} fill="none" stroke="#e8eef5" strokeWidth="12" />
      <circle cx="60" cy="60" r={R} fill="none" stroke={color} strokeWidth="12" strokeLinecap="round"
        strokeDasharray={`${(p / 100) * C} ${C}`} transform="rotate(-90 60 60)" />
      <text x="60" y="66" textAnchor="middle" className="ring-txt">{Math.round(Number(pct) || 0)}%</text>
    </svg>
  );
}

export function TargetRing({ data }) {
  const navigate = useNavigate();
  const [t, setT] = useState(undefined);
  useLive(() => api('/targets/me').then((d) => setT(d?.row || null)).catch(() => setT(null)), ['policy']);
  if (t === undefined) return <div className="card dash-mini" />;
  if (t) {
    const pct = t.premium_target ? t.premium_pct : t.policies_pct;
    const color = pct >= 100 ? '#15925f' : pct >= 60 ? '#1b6fb0' : '#e9531e';
    return (
      <button type="button" className="card dash-mini ring-card" onClick={() => navigate('/page/reports?tab=targets')}>
        <span className="mini-head"><b>My target</b><small>This month</small></span>
        <span className="ring-row">
          <Ring pct={pct} color={color} />
          <span className="ring-legend">
            {t.premium_target ? <span><i style={{ background: '#e9531e' }} />Premium<b>₹ {compact(t.premium_done)} / {compact(t.premium_target)}</b></span> : null}
            {t.policies_target ? <span><i style={{ background: '#1b6fb0' }} />Policies<b>{t.policies_done} / {t.policies_target}</b></span> : null}
          </span>
        </span>
      </button>
    );
  }
  const r = data?.renewal || {};
  const conv = Number(r.conversion) || 0;
  return (
    <button type="button" className="card dash-mini ring-card" onClick={() => navigate('/page/reports?tab=renewals')}>
      <span className="mini-head"><b>Renewal conversion</b><small>Policies renewed with us</small></span>
      <span className="ring-row">
        <Ring pct={conv} color={conv >= 60 ? '#1b6fb0' : '#e9531e'} />
        <span className="ring-legend">
          <span><i style={{ background: '#e9531e' }} />Due in 30 days<b>{inr(r.dueSoon)}</b></span>
          <span><i style={{ background: '#1b6fb0' }} />Due this week<b>{inr(r.counts?.d7)}</b></span>
        </span>
      </span>
    </button>
  );
}

/* ---------- Premium by day / week / month ---------- */
const TREND_BY = [['day', 'Day'], ['week', 'Weekly'], ['month', 'Monthly']];
const barLabel = (by, s) => {
  const d = new Date(s + 'T00:00:00Z');
  if (by === 'day') return d.toLocaleDateString('en-IN', { weekday: 'short', timeZone: 'UTC' }).slice(0, 2);
  if (by === 'month') return d.toLocaleDateString('en-IN', { month: 'short', timeZone: 'UTC' });
  return `${d.getUTCDate()}/${d.getUTCMonth() + 1}`;
};
const NOUN = { day: 'yesterday', week: 'last week', month: 'last month' };

export function PremiumTrend() {
  const navigate = useNavigate();
  const [by, setBy] = useState('week');
  const [d, setD] = useState(null);
  useLive(() => api('/dashboard/trend?by=' + by).then(setD).catch(() => {}), ['policy'], [by]);
  const rows = d?.by === by ? d.rows : [];
  const cur = rows[rows.length - 1], prev = rows[rows.length - 2];
  const max = Math.max(...rows.map((r) => r.premium), 1);
  const change = prev && prev.premium ? Math.round(((cur.premium - prev.premium) / prev.premium) * 100) : null;
  const open = (r) => navigate(`/page/reports?tab=business&from=${r.start}&to=${r.end}`);
  return (
    <div className="card dash-mini trend-card">
      <div className="mini-head">
        <b>Premium booked</b>
        <span className="seg-tabs">{TREND_BY.map(([k, l]) => <button key={k} type="button" className={by === k ? 'on' : ''} onClick={() => setBy(k)}>{l}</button>)}</span>
      </div>
      <div className="trend-body">
        <div className="trend-sum">
          <span className="trend-n">₹ {compact(cur?.premium)}</span>
          <span className="trend-s">{inr(cur?.policies)} {cur?.policies === 1 ? 'policy' : 'policies'}</span>
          {change !== null && <span className={'trend-chg ' + (change >= 0 ? 'up' : 'down')}>{change >= 0 ? '+' : ''}{change}% vs {NOUN[by]}</span>}
        </div>
        <div className="trend-bars">
          {rows.map((r, i) => (
            <button key={r.start} type="button" className={'tb' + (i === rows.length - 1 ? ' cur' : '')} onClick={() => open(r)}
              title={`${dmy(r.start)}${r.end !== r.start ? ' – ' + dmy(r.end) : ''}: ₹ ${inr(r.premium)} · ${r.policies} policies`}>
              <span className="tb-col"><span className="tb-bar" style={{ height: `${Math.max((r.premium / max) * 100, r.premium ? 6 : 3)}%` }} /></span>
              <span className="tb-l">{barLabel(by, r.start)}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ---------- My schedule ---------- */
const KIND = { task: { icon: 'checksquare', tone: 'amber' }, meeting: { icon: 'calendar', tone: 'sky' }, renewal: { icon: 'refresh', tone: 'rose' }, quote: { icon: 'doc', tone: 'green' } };
function whenLabel(it) {
  if (!it.date) return 'No date';
  const t = istToday();
  const day = it.date === t ? 'Today' : it.date === addDays(t, 1) ? 'Tomorrow' : dmy(it.date);
  return (it.overdue ? 'Overdue · ' : '') + day + (it.time ? ' · ' + it.time : '');
}

export function MySchedule() {
  const navigate = useNavigate();
  const [d, setD] = useState(null);
  useLive(() => api('/dashboard/schedule').then(setD).catch(() => setD({ items: [] })), ['task', 'meeting', 'policy', 'quotation']);
  return (
    <div className="card sched-card">
      <div className="mini-head">
        <b>My schedule</b>
        <button type="button" className="icon-btn" title="All tasks" onClick={() => navigate('/page/task')}><Ic name="more" size={18} /></button>
      </div>
      {!d ? <div className="no-data">Loading…</div> : d.items.length === 0 ? (
        <div className="sched-empty">
          <Ic name="calendar" size={26} />
          <span>Nothing scheduled for you.</span>
          <button type="button" className="btn sm" onClick={() => navigate('/page/task?new=1')}>Add a task</button>
        </div>
      ) : (
        <div className="sched-list">
          {d.items.map((it) => (
            <button key={it.kind + it.id} type="button" className="sched-item" onClick={() => navigate(it.to)}>
              <span className={'sched-ic ' + KIND[it.kind].tone}><Ic name={KIND[it.kind].icon} size={20} /></span>
              <span className="sched-txt">
                <b>{it.title}</b>
                <small className={it.overdue ? 'late' : ''}><Ic name="calendar" size={12} /> {whenLabel(it)}</small>
                <small className="muted">{it.note}</small>
              </span>
            </button>
          ))}
          {d.more > 0 && <button type="button" className="sched-more" onClick={() => navigate('/page/task')}>+ {d.more} more</button>}
        </div>
      )}
    </div>
  );
}

/* ---------- Team leaderboard ---------- */
const PERIODS = [['month', 'This month'], ['quarter', 'This quarter'], ['year', 'This year']];
const AV = ['#1b6fb0', '#e9531e', '#0e3a5f', '#2f8fd8', '#f4844f', '#64748b'];
const initials = (n) => String(n || '?').split(' ').map((s) => s[0]).slice(0, 2).join('').toUpperCase();

export function Leaderboard() {
  const navigate = useNavigate();
  const [period, setPeriod] = useState('month');
  const [dept, setDept] = useState('');
  const [d, setD] = useState(null);
  useLive(() => api(`/dashboard/leaderboard?period=${period}&dept=${encodeURIComponent(dept)}`).then(setD).catch(() => {}), ['policy'], [period, dept]);
  const open = () => d && navigate(`/page/reports?tab=business&from=${d.from}&to=${d.to}&g=owner${d.dept ? '&f=' + encodeURIComponent(JSON.stringify({ department: [d.dept] })) : ''}`);
  return (
    <div className="card lb-card">
      <div className="mini-head">
        <b><Ic name="trophy" size={17} /> Team leaderboard</b>
        <span className="lb-pills">
          {!d?.locked && (
            <select className="pill-select" value={dept} onChange={(e) => setDept(e.target.value)} aria-label="Department">
              <option value="">All lines</option><option>Personal Lines</option><option>Commercial Lines</option>
            </select>
          )}
          <select className="pill-select" value={period} onChange={(e) => setPeriod(e.target.value)} aria-label="Period">
            {PERIODS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </span>
      </div>
      {!d ? <div className="no-data">Loading…</div> : d.rows.length === 0 ? <div className="no-data">No business booked yet in this period.</div> : (
        <div className="table-wrap">
          <table className="lb-table">
            <thead><tr><th>Rank</th><th>Member</th><th className="hide-sm">Department</th><th className="num hide-sm">Policies</th><th className="num">Premium</th></tr></thead>
            <tbody>
              {d.rows.map((r, i) => {
                const move = r.prev ? r.prev - r.rank : 0;
                return (
                  <tr key={r.name} className={(r.rank === 1 ? 'first ' : '') + (r.me ? 'me' : '')} onClick={open} title="Open the Business Report by user">
                    <td><span className="lb-rank">{r.rank}{move > 0 ? <span className="mv up"><Ic name="arrowup" size={12} /></span> : move < 0 ? <span className="mv down"><Ic name="arrowdown" size={12} /></span> : null}</span></td>
                    <td><span className="lb-user"><span className="lb-av" style={{ background: AV[i % AV.length] }}>{initials(r.name)}</span>{r.name}{r.me ? <em>you</em> : null}</span></td>
                    <td className="hide-sm muted">{r.department || '—'}</td>
                    <td className="num hide-sm">{inr(r.policies)}</td>
                    <td className="num"><b>₹ {compact(r.premium)}</b></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ---------- Quick actions ---------- */
const ACTIONS = [
  { label: 'New Lead', icon: 'target', tone: 'rose', to: '/page/lead?new=1' },
  { label: 'New RFQ', icon: 'clipboard', tone: 'sky', to: '/page/rfq?new=1' },
  { label: 'New Policy', icon: 'file', tone: 'mint', to: '/page/policy?new=1' },
  { label: 'Add Client', icon: 'userplus', tone: 'violet', to: '/page/client-master/new' },
  { label: 'Register Claim', icon: 'shieldcheck', tone: 'amber', to: '/page/claim' },
  { label: 'New Task', icon: 'checksquare', tone: 'sky', to: '/page/task?new=1' },
  { label: 'Meeting', icon: 'calendar', tone: 'rose', to: '/page/meeting?new=1' },
  { label: 'Reports', icon: 'chart', tone: 'mint', to: '/page/reports' },
];

export function QuickActions() {
  const navigate = useNavigate();
  return (
    <div className="card qa-card">
      <div className="mini-head"><b>Quick actions</b></div>
      <div className="qa-grid">
        {ACTIONS.map((a) => (
          <button key={a.label} type="button" className="qa-tile" onClick={() => navigate(a.to)}>
            <span className={'qa-ic ' + a.tone}><Ic name={a.icon} size={19} /></span>
            <b>{a.label}</b>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ---------- Today's data ---------- */
function Tile({ label, now, before, money, icon, tone, to }) {
  const navigate = useNavigate();
  return (
    <button type="button" className={'today-tile' + (tone ? ' ' + tone : '')} onClick={() => to && navigate(to)}>
      <span className="today-l">{label}</span>
      <span className="today-n">{money ? '₹ ' + compact(now) : inr(now)}</span>
      <span className="today-y">Yesterday {money ? '₹ ' + compact(before) : inr(before)}</span>
      {icon && <span className="today-ic"><Ic name={icon} size={20} /></span>}
    </button>
  );
}

export function TodayData() {
  const [d, setD] = useState(null);
  useLive(() => api('/dashboard/today').then(setD).catch(() => {}), ['policy', 'lead', 'rfq', 'claim']);
  if (!d) return null;
  const v = (k) => d[k] || { today: 0, yesterday: 0 };
  return (
    <div className="card dash-block">
      <div className="mini-head"><b>Today&apos;s data</b><small>compared with yesterday</small></div>
      <div className="today-grid">
        <Tile label="Premium booked" now={v('premium').today} before={v('premium').yesterday} money icon="rupee" tone="rose" to="/page/policy" />
        <Tile label="Policies added" now={v('policies').today} before={v('policies').yesterday} icon="file" tone="sky" to="/page/policy" />
        <Tile label="New leads" now={v('leads').today} before={v('leads').yesterday} icon="target" tone="violet" to="/page/lead" />
        <Tile label="RFQs raised" now={v('rfqs').today} before={v('rfqs').yesterday} icon="clipboard" tone="mint" to="/page/rfq" />
        <Tile label="Payments received" now={v('payments').today} before={v('payments').yesterday} to="/page/rfq" />
        <Tile label="Claims registered" now={v('claims').today} before={v('claims').yesterday} to="/page/claim" />
        <Tile label="Meetings" now={v('meetings').today} before={v('meetings').yesterday} to="/page/meeting" />
        <Tile label="Renewals expiring" now={v('renewals').today} before={v('renewals').yesterday} to="/page/reports?tab=calendar" />
      </div>
    </div>
  );
}

/* ---------- The whole top section ---------- */
export default function DashHome({ data }) {
  return (
    <>
      <div className="dh-grid">
        <div className="dh-main">
          <div className="dh-title">Overview</div>
          <Overview data={data} />
          <div className="dh-pair">
            <TargetRing data={data} />
            <PremiumTrend />
          </div>
        </div>
        <div className="dh-side">
          <div className="dh-title">Coming up</div>
          <MySchedule />
        </div>
      </div>
      <div className="dh-grid">
        <div className="dh-main"><Leaderboard /></div>
        <div className="dh-side"><QuickActions /></div>
      </div>
      <TodayData />
    </>
  );
}
