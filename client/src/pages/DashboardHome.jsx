// The top of the dashboard: a greeting with today's three things to act on, today's figures beside
// yesterday's, and the everyday actions one click away.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Ic } from '../components/Icons.jsx';
import { subscribe } from '../realtime.js';

const inr = (n) => Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
const compact = (n) => { const v = Number(n) || 0; return v >= 1e7 ? `${(v / 1e7).toFixed(2)} Cr` : v >= 1e5 ? `${(v / 1e5).toFixed(2)} L` : inr(v); };
const greeting = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; };

export function DashHero({ data }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const first = String(user?.name || user?.username || '').split(' ')[0];
  const r = data?.renewal || {};
  const focus = [
    { key: 'ren', tone: 'rose', n: (r.counts?.d7 || 0) + (r.counts?.lapsed || 0), title: 'Renewals this week', sub: `${r.counts?.d7 || 0} due in 7 days${r.counts?.lapsed ? ` · ${r.counts.lapsed} lapsed` : ''}`, to: '/page/reports?tab=calendar' },
    { key: 'rfq', tone: 'sky', n: data?.totals?.rfqs?.open || 0, title: 'Open RFQs', sub: 'Quotes to chase and share', to: '/page/rfq' },
    { key: 'clm', tone: 'violet', n: data?.totals?.claims?.open || 0, title: 'Open claims', sub: 'Follow up documents and settlement', to: '/page/claim' },
  ];
  return (
    <div className="hero card">
      <div className="hero-txt">
        <h2>{greeting()}{first ? `, ${first}` : ''}</h2>
        <p>{new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })} — here is what needs you today.</p>
      </div>
      <div className="hero-focus">
        {focus.map((f, i) => (
          <button key={f.key} type="button" className={'focus-card ' + f.tone} onClick={() => navigate(f.to)}>
            <span className="focus-top"><b>{i + 1}. {f.title}</b><span className="focus-go">GO</span></span>
            <span className="focus-n">{inr(f.n)}</span>
            <span className="focus-sub">{f.sub}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

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
  useEffect(() => {
    let alive = true, timer;
    const load = () => api('/dashboard/today').then((x) => { if (alive) setD(x); }).catch(() => {});
    load();
    // New business shows up as it is entered.
    const offs = ['policy', 'lead', 'rfq', 'claim'].map((e) => subscribe(e, () => { clearTimeout(timer); timer = setTimeout(load, 600); }));
    return () => { alive = false; clearTimeout(timer); offs.forEach((o) => o()); };
  }, []);
  if (!d) return null;
  const v = (k) => d[k] || { today: 0, yesterday: 0 };
  return (
    <div className="card dash-block">
      <div className="dash-block-head"><h3>Today&apos;s data</h3><span className="sub">compared with yesterday</span></div>
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

const ACTIONS = [
  { label: 'New Lead', sub: 'Capture an enquiry', icon: 'target', tone: 'rose', to: '/page/lead?new=1' },
  { label: 'New RFQ', sub: 'Ask insurers for quotes', icon: 'clipboard', tone: 'sky', to: '/page/rfq?new=1' },
  { label: 'New Policy', sub: 'Book an issued policy', icon: 'file', tone: 'mint', to: '/page/policy?new=1' },
  { label: 'Add Client', sub: 'Create a client record', icon: 'userplus', tone: 'violet', to: '/page/client-master/new' },
  { label: 'Register Claim', sub: 'Intimate and track', icon: 'shieldcheck', tone: 'amber', to: '/page/claim' },
  { label: 'New Task', sub: 'Assign a follow-up', icon: 'checksquare', tone: 'sky', to: '/page/task?new=1' },
  { label: 'Schedule Meeting', sub: 'With a client or lead', icon: 'calendar', tone: 'rose', to: '/page/meeting?new=1' },
  { label: 'Reports', sub: 'Every number, clickable', icon: 'chart', tone: 'mint', to: '/page/reports' },
];

export function QuickActions() {
  const navigate = useNavigate();
  return (
    <div className="card dash-block">
      <div className="dash-block-head"><h3>Quick actions</h3><span className="sub">the everyday work, one click away</span></div>
      <div className="qa-grid">
        {ACTIONS.map((a) => (
          <button key={a.label} type="button" className="qa-tile" onClick={() => navigate(a.to)}>
            <span className={'qa-ic ' + a.tone}><Ic name={a.icon} size={19} /></span>
            <span className="qa-txt"><b>{a.label}</b><small>{a.sub}</small></span>
          </button>
        ))}
      </div>
    </div>
  );
}
