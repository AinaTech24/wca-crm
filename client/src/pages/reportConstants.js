// Shared bits for the Reports module.

// The reports, grouped as the Reports page shows them. A custom tab (targets, calendar) has its own view.
export const REPORT_GROUPS = ['Business', 'Sales pipeline', 'Service', 'Team'];
export const REPORT_TABS = [
  { key: 'business', group: 'Business', label: 'Business Report', icon: 'chart', blurb: 'Premium booked in the period, by user, product, insurer or month.' },
  { key: 'new-business', group: 'Business', label: 'New Business', icon: 'plus', blurb: 'Fresh business written in the period — policies that are new to us, product wise.' },
  { key: 'renewal-business', group: 'Business', label: 'Renewal Business', icon: 'refresh', blurb: 'Business renewed in the period — policies continuing an earlier one, product wise.' },
  { key: 'commissions', group: 'Business', label: 'Commission', icon: 'rupee', blurb: 'Commission earned from insurers and paid out to associates, received and outstanding.' },
  { key: 'targets', group: 'Business', label: 'Targets', icon: 'target', custom: true, blurb: 'Monthly premium and policy targets per person, and how far each has got.' },
  { key: 'leads', group: 'Sales pipeline', label: 'Lead Report', icon: 'target', blurb: 'Leads received in the period, and how many converted, by owner, source or product.' },
  { key: 'rfqs', group: 'Sales pipeline', label: 'RFQ Report', icon: 'clipboard', blurb: 'RFQs raised in the period, how many were quoted, approved, lost and paid.' },
  { key: 'quotations', group: 'Sales pipeline', label: 'Quotation Report', icon: 'doc', blurb: 'Quotations made in the period: shared, approved, rejected, expired and converted to policies — and which insurer clients chose.' },
  { key: 'insurer-response', group: 'Sales pipeline', label: 'Insurer Response', icon: 'clock', blurb: 'For each insurer: how many RFQs they were sent, how many they quoted or declined, how fast they replied, and how often the client chose them.' },
  { key: 'lost-business', group: 'Sales pipeline', label: 'Lost Business', icon: 'alert', blurb: 'RFQs lost and renewals lost or renewed elsewhere, and why.' },
  { key: 'renewals', group: 'Service', label: 'Renewal Report', icon: 'refresh', blurb: 'Renewable policies expiring in the period, and how many were renewed.' },
  { key: 'calendar', group: 'Service', label: 'Renewal Calendar', icon: 'calendar', custom: true, uses: 'renewals', blurb: 'Policies expiring each day of the month — click a day for its policies.' },
  { key: 'claims', group: 'Service', label: 'Claim Report', icon: 'shieldcheck', blurb: 'Claims registered in the period, what was claimed and what settled.' },
  { key: 'clients', group: 'Service', label: 'Client Report', icon: 'users', blurb: 'Clients onboarded in the period, and the business booked with them.' },
  { key: 'meetings', group: 'Team', label: 'Meetings Report', icon: 'calendar', blurb: 'Meetings held in the period, and how many were completed.' },
  { key: 'tasks', group: 'Team', label: 'Task Report', icon: 'checksquare', blurb: 'Tasks due in the period, how many are done and how many are overdue.' },
  { key: 'attendance', group: 'Team', label: 'Attendance', icon: 'clock', adminOnly: true, blurb: 'Days present, late, on leave and absent, and hours worked, per person.' },
  { key: 'leave', group: 'Team', label: 'Leave', icon: 'calendar', adminOnly: true, blurb: 'Leave asked for, approved and waiting, per person and type.' },
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
    case 'today': return { from: iso(now), to: iso(now) };
    case 'last-7': { const f = new Date(now); f.setDate(f.getDate() - 6); return { from: iso(f), to: iso(now) }; }
    case 'this-week': { const f = new Date(now); f.setDate(f.getDate() - ((now.getDay() + 6) % 7)); const t = new Date(f); t.setDate(t.getDate() + 6); return { from: iso(f), to: iso(t) }; }
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
  { key: 'today', label: 'Today' },
  { key: 'last-7', label: 'Last 7 Days' },
  { key: 'this-week', label: 'This Week' },
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
  if (value === null || value === undefined || value === '') return kind === 'days' || kind === 'hours' ? '—' : '0';
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  if (kind === 'money') return inr.format(Math.round(n));
  if (kind === 'days') return `${inr.format(Math.round(n))}d`;
  if (kind === 'hours') return `${(Math.round(n * 10) / 10).toLocaleString('en-IN')}h`;
  // 'share' is a percentage too: a group's slice of the report's total.
  if (kind === 'pct' || kind === 'share') return `${Math.round(n)}%`;
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
