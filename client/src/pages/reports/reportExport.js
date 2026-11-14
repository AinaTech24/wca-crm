// Downloads of a report (as it is shown — summary, two levels or matrix) and of a list of records,
// as Excel, CSV or PDF (through the print dialog's "Save as PDF").
import * as XLSX from 'xlsx';
import { printHTML } from '../../components/printDoc.js';
import { formatMetric, downloadCsv } from '../reportConstants.js';
import { fmt as fmtDate } from '../../components/DateField.jsx';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const safeName = (s) => String(s || 'report').replace(/[^\w -]+/g, '').trim().replace(/\s+/g, '-');

/** The report as a grid of cells: a header row and data rows, plus a line about what it covers. */
export function reportGrid(data, { mode, metric }) {
  const cols = data.columns;
  const about = [`${data.label}`, `${fmtDate(data.from)} to ${fmtDate(data.to)}`,
    ...Object.entries(data.filters || {}).map(([k, v]) => `${data.dims.find((d) => d.key === k)?.label || k}: ${v.join(', ')}`),
    ...(data.scope?.applied ? [data.scope.department] : [])].join(' · ');
  if (mode === 'matrix' && data.groupBy2) {
    const col = cols.find((c) => c.key === metric) || cols[0];
    const across = data.cols || [];
    const cell = {};
    for (const p of data.pairs || []) cell[p.label + '\u0000' + p.label2] = p;
    const head = [`${data.groupLabel} / ${data.groupLabel2}`, ...across.map((c) => c.label2), 'Total'];
    const rows = data.rows.map((r) => [r.label, ...across.map((c) => Number(cell[r.label + '\u0000' + c.label2]?.[col.key]) || 0), Number(r[col.key]) || 0]);
    rows.push(['Total', ...across.map((c) => Number(c[col.key]) || 0), Number(data.totals?.[col.key]) || 0]);
    return { about: `${about} · ${col.label}`, head, rows, kinds: ['text', ...across.map(() => col.kind), col.kind] };
  }
  const two = !!data.groupBy2;
  const cmp = data.compare;
  const prevBy = Object.fromEntries((cmp?.rows || []).map((r) => [r.label, r]));
  const head = [data.groupLabel, ...(two ? [data.groupLabel2] : []), ...cols.flatMap((c) => (cmp ? [c.label, `${c.label} (earlier)`] : [c.label]))];
  const line = (labels, src, prev) => [...labels, ...cols.flatMap((c) => (cmp ? [Number(src[c.key]) || 0, Number(prev?.[c.key]) || 0] : [Number(src[c.key]) || 0]))];
  const rows = [];
  for (const r of data.rows) {
    rows.push(line([r.label, ...(two ? ['All'] : [])], r, prevBy[r.label]));
    if (two) for (const p of (data.pairs || []).filter((x) => x.label === r.label)) rows.push(line([r.label, p.label2], p, null));
  }
  rows.push(line(['Total', ...(two ? [''] : [])], data.totals || {}, cmp?.totals));
  const kinds = ['text', ...(two ? ['text'] : []), ...cols.flatMap((c) => (cmp ? [c.kind, c.kind] : [c.kind]))];
  return { about: cmp ? `${about} · compared with ${fmtDate(cmp.from)} to ${fmtDate(cmp.to)}` : about, head, rows, kinds };
}

/** A list of records as a grid. */
export function recordsGrid(d, columns) {
  const cols = columns || d.columns;
  return {
    about: d.title || d.label,
    head: cols.map((c) => c.label),
    rows: d.rows.map((r) => cols.map((c) => (c.kind === 'money' ? Number(r[c.key]) || 0 : c.kind === 'date' ? (r[c.key] ? fmtDate(String(r[c.key]).slice(0, 10)) : '') : r[c.key] ?? ''))),
    kinds: cols.map((c) => (c.kind === 'money' ? 'money' : 'text')),
  };
}

export function exportExcel(grid, name) {
  const sheet = XLSX.utils.aoa_to_sheet([[grid.about], [], grid.head, ...grid.rows]);
  sheet['!cols'] = grid.head.map((h, i) => ({ wch: Math.min(40, Math.max(String(h).length + 2, ...grid.rows.slice(0, 200).map((r) => String(r[i] ?? '').length + 2), 8)) }));
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, 'Report');
  XLSX.writeFile(book, `${safeName(name)}.xlsx`);
}

export function exportCsv(grid, name) {
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  downloadCsv(`${safeName(name)}.csv`, [grid.head.map(q).join(','), ...grid.rows.map((r) => r.map(q).join(','))].join('\n'));
}

export function exportPdf(grid, title) {
  const cell = (v, k) => (k === 'text' || typeof v !== 'number' ? esc(v) : esc(formatMetric(v, k)));
  const body = `
    <h2 style="margin:0 0 4px;font-size:18px">${esc(title)}</h2>
    <div style="color:#6b7a90;font-size:11px;margin-bottom:12px">${esc(grid.about)}</div>
    <table style="width:100%;border-collapse:collapse;font-size:10.5px">
      <thead><tr>${grid.head.map((h, i) => `<th style="text-align:${grid.kinds[i] === 'text' ? 'left' : 'right'};padding:6px 7px;background:#f1f5fa;border-bottom:1px solid #cfd8e3">${esc(h)}</th>`).join('')}</tr></thead>
      <tbody>${grid.rows.map((r, ri) => `<tr style="${ri === grid.rows.length - 1 && r[0] === 'Total' ? 'font-weight:700;border-top:2px solid #cfd8e3' : ''}">${r.map((v, i) => `<td style="text-align:${grid.kinds[i] === 'text' ? 'left' : 'right'};padding:5px 7px;border-bottom:1px solid #edf1f6">${cell(v, grid.kinds[i])}</td>`).join('')}</tr>`).join('')}</tbody>
    </table>`;
  printHTML(title, body);
}
