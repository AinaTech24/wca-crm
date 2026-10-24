// Shared bits for the Reports module.

export const REPORT_TABS = [
  { key: 'business', label: 'Business Report', icon: 'chart',
    blurb: 'Premium booked in the period, by user, product, insurer or month.' },
  { key: 'meetings', label: 'Meetings Report', icon: 'calendar',
    blurb: 'Meetings held in the period, and how many were completed.' },
  { key: 'claims', label: 'Claim Report', icon: 'shieldcheck',
    blurb: 'Claims registered in the period, what was claimed and what settled.' },
  { key: 'leads', label: 'Lead Report', icon: 'target',
    blurb: 'Leads received in the period, and how many converted, by owner, source or product.' },
  { key: 'rfqs', label: 'RFQ Report', icon: 'clipboard',
    blurb: 'RFQs raised in the period, how many were quoted, approved, lost and paid.' },
  { key: 'renewals', label: 'Renewal Report', icon: 'refresh',
    blurb: 'Renewable policies expiring in the period, and how many were renewed.' },
  { key: 'tasks', label: 'Task Report', icon: 'checksquare',
    blurb: 'Tasks due in the period, how many are done and how many are overdue.' },
  { key: 'clients', label: 'Client Report', icon: 'users',
    blurb: 'Clients onboarded in the period, and the business booked with them.' },
];

const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// The Indian financial year runs April to March, so "this year" in an
// insurance office almost never means the calendar year.
export function financialYear(offset = 0) {
  const now = new Date();
  const startYear = (now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1) + offset;
  return { from: `${startYear}-04-01`, to: `${startYear + 1}-03-31`, label: `FY ${startYear}-${String(startYear + 1).slice(2)}` };
}

const monthRange = (offset) => {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  const to = new Date(now.getFullYear(), now.getMonth() + offset + 1, 0);
  return { from: iso(from), to: iso(to) };
};

export function presetRange(key) {
  const now = new Date();
  switch (key) {
    case 'this-month': return monthRange(0);
    case 'last-month': return monthRange(-1);
    case 'this-quarter': {
      const q = Math.floor(now.getMonth() / 3);
      return { from: iso(new Date(now.getFullYear(), q * 3, 1)), to: iso(new Date(now.getFullYear(), q * 3 + 3, 0)) };
    }
    case 'this-fy': { const f = financialYear(0); return { from: f.from, to: f.to }; }
    case 'last-fy': { const f = financialYear(-1); return { from: f.from, to: f.to }; }
    case 'last-12': return { from: iso(new Date(now.getFullYear(), now.getMonth() - 11, 1)), to: iso(now) };
    default: return null;
  }
}

export const PRESETS = [
  { key: 'this-month', label: 'This Month' },
  { key: 'last-month', label: 'Last Month' },
  { key: 'this-quarter', label: 'This Quarter' },
  { key: 'this-fy', label: financialYear(0).label },
  { key: 'last-fy', label: financialYear(-1).label },
  { key: 'last-12', label: 'Last 12 Months' },
];

export const DEFAULT_PRESET = 'this-fy';

// Indian grouping — 12,50,000 rather than 1,250,000, since that's how the
// figures are read and quoted here.
const inr = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });

export function formatMetric(value, kind) {
  if (value === null || value === undefined || value === '') return kind === 'days' ? '—' : '0';
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  if (kind === 'money') return inr.format(Math.round(n));
  if (kind === 'days') return `${inr.format(Math.round(n))}d`;
  if (kind === 'pct') return `${Math.round(n)}%`;
  return inr.format(n);
}

// Compact form for the summary cards, where a crore of premium shouldn't
// wrap onto two lines.
export function compactMoney(value) {
  const n = Number(value) || 0;
  if (Math.abs(n) >= 1e7) return `${(n / 1e7).toFixed(2)} Cr`;
  if (Math.abs(n) >= 1e5) return `${(n / 1e5).toFixed(2)} L`;
  return inr.format(Math.round(n));
}

export function toCsv(columns, rows, totals, groupLabel) {
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const head = [groupLabel, ...columns.map((c) => c.label)].map(esc).join(',');
  const body = rows.map((r) => [r.label, ...columns.map((c) => r[c.key] ?? 0)].map(esc).join(','));
  const foot = totals ? [['Total', ...columns.map((c) => totals[c.key] ?? 0)].map(esc).join(',')] : [];
  return [head, ...body, ...foot].join('\n');
}

export function downloadCsv(filename, csv) {
  // ﻿ so Excel opens it as UTF-8 rather than mangling names.
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
