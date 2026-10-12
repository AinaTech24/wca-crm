// Dependency-free "PDF" generation: render a professionally styled A4 document
// into a hidden iframe and open the browser's print dialog (Save as PDF / print).
// Gives full CSS control for a clean, on-brand output with no external libraries.

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const inr = (v) => '₹ ' + Number(v || 0).toLocaleString('en-IN');
const parse = (v, fb) => { if (v == null) return fb; if (typeof v !== 'string') return v; try { return JSON.parse(v); } catch { return fb; } };

function company() {
  let p = {};
  try { p = JSON.parse(localStorage.getItem('wca_company_profile') || '{}'); } catch { p = {}; }
  return {
    name: p.name || 'WeCare Assurance',
    addr: [p.address1, p.address2].filter(Boolean).join(', '),
    place: [p.city, p.state, p.pincode].filter(Boolean).join(' '),
    email: p.email1 || 'support@wecareassurance.in',
    phone: p.phone1 || '',
    logo: p.logo || '',
  };
}

const PRINT_CSS = `
  @page { size: A4; margin: 14mm 14mm; }
  * { box-sizing: border-box; }
  body { font-family: 'Segoe UI', Arial, sans-serif; color: #1a2230; font-size: 12px; margin: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .doc { max-width: 190mm; margin: 0 auto; }
  .lh { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #1b6fb0; padding-bottom: 12px; }
  .lh-name { font-size: 20px; font-weight: 800; color: #1b6fb0; letter-spacing: -.3px; }
  .lh-sub { font-size: 10.5px; color: #5b6472; margin-top: 3px; max-width: 300px; line-height: 1.5; }
  .lh-right { text-align: right; font-size: 10.5px; color: #5b6472; line-height: 1.6; }
  .lh-logo { height: 52px; margin-bottom: 7px; display: block; }
  .lh-logo-svg { margin-bottom: 7px; display: block; }
  .title-band { background: #eef4fa; border-left: 4px solid #e9531e; padding: 9px 14px; margin: 16px 0 4px; display: flex; justify-content: space-between; align-items: center; }
  .title-band h1 { font-size: 15px; font-weight: 800; margin: 0; letter-spacing: .04em; text-transform: uppercase; color: #10161f; }
  .title-band .meta { font-size: 11px; color: #47536a; text-align: right; }
  .title-band .meta b { color: #10161f; }
  .sec { margin-top: 16px; }
  .sec-h { font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: .07em; color: #1b6fb0; border-bottom: 1px solid #dce3ec; padding-bottom: 5px; margin-bottom: 9px; }
  .kv { display: grid; grid-template-columns: repeat(3, 1fr); gap: 7px 22px; }
  .kv.two { grid-template-columns: repeat(2, 1fr); }
  .kv .k { font-size: 9.5px; text-transform: uppercase; letter-spacing: .04em; color: #8994a6; font-weight: 700; }
  .kv .v { font-size: 12px; font-weight: 600; color: #10161f; margin-top: 1px; }
  .chips-p { display: flex; flex-wrap: wrap; gap: 6px; }
  .chip-p { background: #eef4fa; border: 1px solid #cfe0f0; color: #124d80; font-size: 10.5px; font-weight: 600; padding: 3px 9px; border-radius: 4px; }
  table { width: 100%; border-collapse: collapse; margin-top: 6px; }
  th, td { border: 1px solid #dce3ec; padding: 7px 9px; font-size: 11px; text-align: left; }
  th { background: #f4f7fb; font-weight: 700; color: #47536a; text-transform: uppercase; font-size: 9.5px; letter-spacing: .03em; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  tr.best td { background: #e3f7ec; font-weight: 700; }
  .best-tag { background: #16874e; color: #fff; font-size: 8.5px; font-weight: 800; padding: 1px 6px; border-radius: 3px; margin-left: 6px; }
  .note { margin-top: 18px; font-size: 11px; color: #47536a; line-height: 1.6; background: #f7f9fc; border: 1px solid #e3e7ee; border-radius: 6px; padding: 11px 13px; }
  .foot { margin-top: 26px; padding-top: 10px; border-top: 1px solid #dce3ec; font-size: 10px; color: #8994a6; display: flex; justify-content: space-between; }
  .sign { margin-top: 34px; font-size: 11px; color: #10161f; }
  /* comparison matrix */
  .cmp-band { border: 1px solid #bcd3e6; background: #eef4fa; padding: 8px 12px; margin: 14px 0 0; }
  .cb-row { display: flex; justify-content: space-between; gap: 20px; font-size: 12px; padding: 2px 0; }
  .matrix { border-collapse: collapse; margin-top: 0; }
  .matrix td { border: 1px solid #b9c4d2; padding: 5px 8px; font-size: 11px; text-align: center; }
  .matrix td.lbl { text-align: left; font-weight: 700; }
  .matrix td.navy { background: #24344a; color: #fff; font-weight: 700; }
  .matrix td.ins { background: #1b6fb0; color: #fff; font-weight: 800; font-size: 11.5px; }
  .matrix td.tot { font-weight: 800; font-size: 12px; }
  .matrix tr.total td { font-size: 12.5px; }
  .matrix .yes { color: #16874e; font-weight: 800; }
  .matrix .no { color: #c0342a; font-weight: 800; }
  .matrix td.sel { background: #fff6c2; }
  .matrix td.ins.sel { background: #e9531e; }
  /* The client's approved column reads green so it can't be confused with our
     recommendation, and wins the header tint when it's a different insurer. */
  .matrix td.appr { background: #d9f2e4; }
  .matrix td.ins.appr { background: #16874e; }
  .tag-appr, .tag-rec { font-size: 7.5px; font-weight: 800; letter-spacing: .04em; margin-top: 2px; opacity: .95; }
  .appr-note { margin-top: 6px; border-left: 3px solid #16874e; }
  /* Motor insurance quotation (the client-facing comparison) */
  .mq-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; }
  .mq-title { font-size: 25px; font-weight: 800; color: #1f5fa8; letter-spacing: -.2px; margin: 6px 0 0; }
  .mq-logo { max-height: 62px; max-width: 200px; }
  .mq-hi { margin: 14px 0 10px; font-size: 12px; line-height: 1.55; }
  .mq-bar { background: #1f5fa8; color: #fff; font-weight: 800; font-size: 13px; letter-spacing: .02em; text-transform: uppercase; padding: 5px 9px; margin-top: 8px; }
  .mq-bar.orange { background: #e8531e; }
  table.mq { border-collapse: collapse; width: 100%; }
  table.mq td, table.mq th { border: 1px solid #c3d3e6; padding: 4px 8px; font-size: 11px; }
  table.mq td.k { background: #dce8f6; font-weight: 800; text-transform: uppercase; width: 34%; }
  table.mq td.v { background: #fff; }
  table.mq.cmp td.k { text-transform: none; }
  table.mq.cmp th { background: #dce8f6; font-weight: 800; text-align: center; text-transform: uppercase; }
  table.mq.cmp td { text-align: center; }
  table.mq.cmp td.k { text-align: left; }
  table.mq .yes { font-weight: 600; }
  table.mq .no { color: #e02424; font-weight: 600; }
  table.mq tr.tot td { background: #d9ecd9; font-weight: 800; font-size: 12.5px; }
  table.mq tr.tot td.best { background: #9fd49f; }
  table.mq th.appr { background: #bfe5cb; }
  .mq-tag { display: block; font-size: 7.5px; font-weight: 800; letter-spacing: .04em; margin-top: 1px; color: #16874e; }
  .mq-valid { background: #dcefd9; text-align: center; font-weight: 800; padding: 8px; margin-top: 8px; font-size: 12px; }
  .mq-gst { font-weight: 800; font-size: 10.5px; margin: 8px 0 0; }
  .mq-points { border: 1px solid #c3d3e6; border-top: 0; padding: 6px 9px; column-count: 2; column-gap: 24px; font-size: 10.5px; line-height: 1.7; }
  .mq-points div { break-inside: avoid; }
  .mq-team { display: grid; grid-template-columns: repeat(3, 1fr); border: 1px solid #c3d3e6; border-top: 0; }
  .mq-team > div { border-right: 1px solid #c3d3e6; border-bottom: 1px solid #c3d3e6; padding: 6px 9px; font-size: 10px; line-height: 1.45; min-height: 58px; }
  .mq-team > div:nth-child(3n) { border-right: 0; }
  .mq-team b { display: block; color: #1f5fa8; font-size: 11.5px; }
  .mq-foot { border: 1px solid #1f5fa8; background: #e6eef8; text-align: center; padding: 7px; margin-top: 8px; font-size: 10.5px; line-height: 1.5; }
  .valid-band { background: #fff6c2; border: 1px solid #e4d477; text-align: center; font-weight: 800; padding: 7px; margin-top: 14px; font-size: 11.5px; letter-spacing: .02em; }
`;

// Vector wordmark used when no raster logo is uploaded — prints crisply.
const BRAND_SVG = `<svg class="lh-logo-svg" width="210" height="56" viewBox="0 0 300 84" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="WeCare Assurance">
  <text x="0" y="44" font-family="Arial, Helvetica, sans-serif" font-weight="800" font-size="47" letter-spacing="-2"><tspan fill="#1b6fb0">WE</tspan><tspan fill="#e9531e">CARE</tspan></text>
  <path d="M104 20 L117 32 L136 3" fill="none" stroke="#1b6fb0" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>
  <text x="2" y="74" font-family="Arial, Helvetica, sans-serif" font-weight="800" font-size="20" letter-spacing="5" fill="#9aa4b2">ASSURANCE</text>
</svg>`;

function letterhead(c) {
  const brand = c.logo ? `<img class="lh-logo" src="${esc(c.logo)}" alt="${esc(c.name)}">` : BRAND_SVG;
  return `<div class="lh">
    <div>
      ${brand}
      <div class="lh-sub">${esc(c.addr)}${c.place ? '<br>' + esc(c.place) : ''}</div>
    </div>
    <div class="lh-right">${c.email ? esc(c.email) + '<br>' : ''}${c.phone ? esc(c.phone) : ''}</div>
  </div>`;
}

// Policy tenure as the printed RFQ states it: months, or the custom from – to dates.
const dmy = (iso) => (iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(8, 10) + '-' + iso.slice(5, 7) + '-' + iso.slice(0, 4) : iso || '');
function tenureText(d) {
  if (d.tenure_months === 'custom') {
    if (!d.tenure_from || !d.tenure_to) return 'Custom';
    const days = Math.round((new Date(d.tenure_to + 'T00:00:00') - new Date(d.tenure_from + 'T00:00:00')) / 86400000) + 1;
    return 'Custom — ' + dmy(d.tenure_from) + ' to ' + dmy(d.tenure_to) + (days > 0 ? ' (' + days + ' days)' : '');
  }
  const m = d.tenure_months;
  return m ? m + ' month' + (String(m) === '1' ? '' : 's') : '';
}

function kvRow(pairs) {
  return pairs.filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => `<div><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div></div>`).join('');
}

// Short code per line of business, used in document filenames.
const CATEGORY_CODE = {
  'Motor': 'MOT', 'Workmen Compensation': 'WC', 'Group Personal Accident': 'GPA',
  'Group Health Insurance': 'GHI', 'Retail Health': 'RH', 'Fire & Property': 'FIRE',
  'Householder': 'HH', 'Marine Cargo': 'MAR', 'Liability': 'LIAB',
  'Group Term Life': 'GTL', 'Engineering': 'ENG', 'Travel': 'TRV',
};

/**
 * Filename for a generated document: client, vehicle registration where there
 * is one, then the line code — so a folder of saved PDFs sorts and reads
 * sensibly instead of being a wall of "RFQ-2001".
 *
 * The browser's print dialog takes its suggested filename from the document
 * title, which is why this is a title rather than a download attribute.
 * Characters a filesystem would reject are stripped rather than escaped.
 */
export function docFileName(rfq, prefix = '') {
  const d = (() => { try { return typeof rfq.details === 'string' ? JSON.parse(rfq.details || '{}') : (rfq.details || {}); } catch { return {}; } })();
  const code = CATEGORY_CODE[rfq.category] || 'RFQ';
  const clean = (v) => String(v || '').replace(/[/:*?"<>|]+/g, '').split(String.fromCharCode(92)).join('').replace(/\s+/g, ' ').trim();
  const parts = [clean(rfq.client_name), clean(d.reg_no), code].filter(Boolean);
  return (prefix ? prefix + ' ' : '') + parts.join(' - ');
}

/**
 * Name of the RFQ document: Category_Policy Nature_Client Name — for example
 * "Motor_New_Ramesh Shah". It is what the print dialog suggests as the file name and
 * what the PDF is called when it is emailed to insurers.
 */
export function rfqDocName(rfq) {
  const clean = (v) => String(v || '').replace(/[/:*?"<>|]+/g, '').split(String.fromCharCode(92)).join('').replace(/\s+/g, ' ').trim();
  return [rfq.category || 'RFQ', rfq.policy_nature || 'New', rfq.client_name].map(clean).filter(Boolean).join('_');
}

export function printHTML(title, bodyHtml) {
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  document.body.appendChild(iframe);
  const doc = iframe.contentWindow.document;
  doc.open();
  doc.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${PRINT_CSS}</style></head><body><div class="doc">${bodyHtml}</div></body></html>`);
  doc.close();
  setTimeout(() => { try { iframe.contentWindow.focus(); iframe.contentWindow.print(); } catch (e) { /* ignore */ } setTimeout(() => iframe.remove(), 2000); }, 400);
}

// Renders the same document markup used for print/preview into a real PDF
// file (base64 data URI) entirely in-browser, so it can be attached to an
// email or WhatsApp message — the print dialog never hands a file back to
// the app, so this is the only way to get an actual PDF binary to send.
export async function htmlToPdfBase64(title, bodyHtml) {
  const html2pdf = (await import('html2pdf.js')).default;
  const container = document.createElement('div');
  container.style.cssText = 'position:fixed;left:-9999px;top:0;width:210mm;background:#fff;';
  const styleEl = document.createElement('style');
  styleEl.textContent = PRINT_CSS;
  const docDiv = document.createElement('div');
  docDiv.className = 'doc';
  docDiv.innerHTML = bodyHtml;
  container.append(styleEl, docDiv);
  document.body.appendChild(container);
  try {
    const dataUri = await html2pdf()
      .set({
        margin: 0,
        filename: title + '.pdf',
        image: { type: 'jpeg', quality: 0.95 },
        html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff' },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
        pagebreak: { mode: ['css', 'legacy'] },
      })
      .from(container)
      .outputPdf('datauristring');
    return dataUri; // "data:application/pdf;filename=...;base64,...."
  } finally {
    container.remove();
  }
}

const todayStr = () => new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

// ---- Document 1: the RFQ sent to insurers ----
export function buildRfqDoc(rfq) {
  const c = company();
  const d = parse(rfq.details, {});
  const addOns = parse(rfq.add_ons, []);
  const insurers = parse(rfq.insurers, []);
  const cat = rfq.category || '';
  const isMotor = cat === 'Motor';
  const isWC = cat === 'Workmen Compensation';
  const isGPA = cat === 'Group Personal Accident';
  const isGHI = cat === 'Group Health Insurance';
  const isFire = cat === 'Fire & Property';
  const isMarine = cat === 'Marine Cargo';
  const isLiab = cat === 'Liability';
  const isGTL = cat === 'Group Term Life';
  const isHealthR = cat === 'Retail Health';
  const isHome = cat === 'Householder';
  const isEng = cat === 'Engineering';
  const MAND = { 'Group Personal Accident': 'Member List', 'Group Health Insurance': 'Employee Census', 'Retail Health': 'Member / Age Details', 'Fire & Property': 'Property / Asset Statement', 'Householder': 'Property / Contents Statement', 'Engineering': 'Project / Plant Details', 'Marine Cargo': 'Invoice / Packing List', 'Liability': 'Proposal / Exposure Details', 'Group Term Life': 'Member Data Sheet' };
  const mandDoc = MAND[cat] || 'RC Book Copy';
  const ADDON_HEAD = { 'Workmen Compensation': 'Extensions Requested', 'Group Personal Accident': 'Extensions Requested', 'Fire & Property': 'Perils & Add-ons Requested', 'Householder': 'Covers & Add-ons Requested', 'Engineering': 'Extensions Requested', 'Marine Cargo': 'Extensions Requested', 'Liability': 'Extensions Requested', 'Group Term Life': 'Riders Requested' };
  const kvSec = (title, pairs) => `<div class="sec"><div class="sec-h">${title}</div><div class="kv">${kvRow(pairs)}</div></div>`;
  // Claim-by-claim history, which is what an underwriter prices on. Rendered
  // only when there is one, so the summary line still stands on its own.
  const claimHistSec = (() => {
    const list = Array.isArray(d.claim_history) ? d.claim_history.filter((c) => c && (c.year || c.insurer || c.claim_no || c.amount)) : [];
    if (!list.length) return '';
    const rows = list.map((c) => `<tr><td>${esc(c.year || '—')}</td><td>${esc(c.insurer || '—')}</td><td>${esc(c.claim_no || '—')}</td><td class="num">${c.amount ? inr(c.amount) : '—'}</td><td>${esc(c.status || '—')}</td></tr>`).join('');
    const total = list.reduce((sum, c) => sum + (Number(c.amount) || 0), 0);
    return `<div class="sec"><div class="sec-h">Claim History</div>
      <table><thead><tr><th>Year</th><th>Insurer</th><th>Claim No</th><th class="num">Amount</th><th>Status</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><td colspan="3"><b>${list.length} claim${list.length > 1 ? 's' : ''}</b></td><td class="num"><b>${inr(total)}</b></td><td></td></tr></tfoot></table></div>`;
  })();

  const prevSec = (d.prev_insurer || d.prev_policy_no || d.claims_3yr) ? kvSec('Previous Policy & Claims', [['Previous Insurer', d.prev_insurer], ['Previous Policy No', d.prev_policy_no], ['Previous Expiry', d.prev_expiry], ['Claims (3 yr)', d.claims_3yr]]) : '';

  let healthR = '';
  if (isHealthR) {
    const mem = Array.isArray(d.health_members) ? d.health_members : [];
    healthR = `${kvSec('Policy & Sum Insured', [['Policy Type', d.rh_type], ['Sum Insured', d.si_per_family ? inr(d.si_per_family) : ''], ['Members', d.total_members], ['Eldest Age', d.eldest_age ? `${d.eldest_age} yr` : ''], ['Pre-existing', d.ped === 'Yes' ? `Yes — ${d.ped_details || ''}` : 'No'], ['Room Rent', d.room_rent], ['Co-pay', d.copay ? `${d.copay}%` : ''], ['Ported', d.ported]])}
    <div class="sec"><div class="sec-h">Members to Cover</div>
      <table><thead><tr><th>Relationship</th><th class="num">Age</th></tr></thead><tbody>
      ${mem.map((m) => `<tr><td>${esc(m.relation)}</td><td class="num">${esc(m.age)}</td></tr>`).join('') || '<tr><td colspan="2">—</td></tr>'}
      </tbody></table></div>${prevSec}${claimHistSec}`;
  }
  let home = '';
  if (isHome) {
    const secs = Array.isArray(d.home_schedule) ? d.home_schedule : [];
    home = `${kvSec('Property Details', [['Property', d.property_type], ['Building Type', d.building_type], ['Year Built', d.year_built], ['Location', d.location], ['PIN', d.pin]])}
    <div class="sec"><div class="sec-h">Sum Insured Sections</div>
      <table><thead><tr><th>Section</th><th class="num">Sum Insured (₹)</th></tr></thead><tbody>
      ${secs.map((s) => `<tr><td>${esc(s.section)}</td><td class="num">${Number(s.si || 0).toLocaleString('en-IN')}</td></tr>`).join('') || '<tr><td colspan="2">—</td></tr>'}
      <tr class="best"><td>Total Sum Insured</td><td class="num">${Number(d.total_si || 0).toLocaleString('en-IN')}</td></tr>
      </tbody></table></div>${prevSec}${claimHistSec}`;
  }
  let eng = '';
  if (isEng) {
    eng = `${kvSec('Project / Risk Details', [['Engineering Type', d.eng_type], ['Description', d.business], ['Project / Plant Value', d.project_value ? inr(d.project_value) : ''], ['Location', d.location], ['Commencement', d.commencement], ['Period (months)', d.period_months], ['Testing (weeks)', d.testing_period]])}${prevSec}${claimHistSec}`;
  }
  const showPrev = ['Renewal', 'Rollover'].includes(rfq.policy_nature);

  let fire = '';
  if (isFire) {
    const assets = Array.isArray(d.asset_schedule) ? d.asset_schedule : [];
    fire = `${kvSec('Risk / Occupancy Details', [['Nature of Business', d.business], ['Occupancy', d.occupancy], ['Construction', d.construction], ['Location', d.location], ['Bank / Financier', d.bank]])}
    <div class="sec"><div class="sec-h">Property / Asset Schedule</div>
      <table><thead><tr><th>Asset Type</th><th class="num">Sum Insured (₹)</th></tr></thead><tbody>
      ${assets.map((a) => `<tr><td>${esc(a.asset)}</td><td class="num">${Number(a.si || 0).toLocaleString('en-IN')}</td></tr>`).join('') || '<tr><td colspan="2">—</td></tr>'}
      <tr class="best"><td>Total Sum Insured</td><td class="num">${Number(d.total_si || 0).toLocaleString('en-IN')}</td></tr>
      </tbody></table></div>${prevSec}${claimHistSec}`;
  }
  let marine = '';
  if (isMarine) {
    marine = `${kvSec('Consignment Details', [['Nature of Goods', d.goods], ['Packing', d.packing], ['Sum Insured', d.consignment_si ? inr(d.consignment_si) : '']])}
    ${kvSec('Transit & Cover', [['From', d.from], ['To', d.to], ['Mode', d.mode], ['Policy Basis', d.marine_basis], ['Cover Basis', d.cover_basis], ['Transit Date', d.voyage_date]])}${prevSec}${claimHistSec}`;
  }
  let liab = '';
  if (isLiab) {
    liab = `${kvSec('Cover & Insured Details', [['Liability Type', d.liability_type], ['Business / Profession', d.business], ['Limit — AOA', d.limit_aoa ? inr(d.limit_aoa) : ''], ['Limit — AOY', d.limit_aoy ? inr(d.limit_aoy) : ''], ['Annual Turnover', d.turnover ? inr(d.turnover) : ''], ['Retroactive Date', d.retroactive_date], ['Jurisdiction', d.jurisdiction]])}${prevSec}${claimHistSec}`;
  }
  let gtl = '';
  if (isGTL) {
    const cats = Array.isArray(d.life_cats) ? d.life_cats : [];
    gtl = `${kvSec('Business / Insured Details', [['Nature of Business', d.business], ['SA Basis', d.sa_basis], ['Location', d.location], ['Free Cover Limit', d.fcl ? inr(d.fcl) : '']])}
    <div class="sec"><div class="sec-h">Member Schedule & Sum Assured</div>
      <table><thead><tr><th>Category / Grade</th><th class="num">Members</th><th class="num">SA / Member (₹)</th><th class="num">Category SA (₹)</th></tr></thead><tbody>
      ${cats.map((cc) => `<tr><td>${esc(cc.cat)}</td><td class="num">${esc(cc.count)}</td><td class="num">${Number(cc.sa || 0).toLocaleString('en-IN')}</td><td class="num">${((Number(cc.count) || 0) * (Number(cc.sa) || 0)).toLocaleString('en-IN')}</td></tr>`).join('') || '<tr><td colspan="4">—</td></tr>'}
      <tr class="best"><td>Total</td><td class="num">${esc(d.total_members || 0)}</td><td class="num"></td><td class="num">${Number(d.total_sa || 0).toLocaleString('en-IN')}</td></tr>
      </tbody></table></div>${prevSec}${claimHistSec}`;
  }

  let gpa = '';
  if (isGPA) {
    const cats = Array.isArray(d.member_cats) ? d.member_cats : [];
    gpa = `<div class="sec"><div class="sec-h">Business / Insured Details</div><div class="kv">${kvRow([
      ['Nature of Business', d.business], ['Risk Group', d.risk_group], ['Location', d.location], ['GSTIN', d.gst],
      ['CSI Basis', d.csi_basis], ['Medical Extension', d.medical_ext === 'Yes' ? `Yes (${inr(d.med_limit)}/member)` : 'No'], ['TTD Weekly', d.ttd_weekly ? `${inr(d.ttd_weekly)}/wk` : ''],
    ])}</div></div>
    <div class="sec"><div class="sec-h">Members & Capital Sum Insured</div>
      <table><thead><tr><th>Category / Cadre</th><th class="num">Members</th><th class="num">CSI / Member (₹)</th><th class="num">Category CSI (₹)</th></tr></thead><tbody>
      ${cats.map((cc) => `<tr><td>${esc(cc.cat)}</td><td class="num">${esc(cc.count)}</td><td class="num">${Number(cc.csi || 0).toLocaleString('en-IN')}</td><td class="num">${((Number(cc.count) || 0) * (Number(cc.csi) || 0)).toLocaleString('en-IN')}</td></tr>`).join('') || '<tr><td colspan="4">—</td></tr>'}
      <tr class="best"><td>Total</td><td class="num">${esc(d.total_members || 0)}</td><td class="num"></td><td class="num">${Number(d.total_csi || 0).toLocaleString('en-IN')}</td></tr>
      </tbody></table>
    </div>
    ${(d.prev_insurer || d.prev_policy_no || d.claims_3yr) ? `<div class="sec"><div class="sec-h">Previous Policy & Claims</div><div class="kv">${kvRow([
      ['Previous Insurer', d.prev_insurer], ['Previous Policy No', d.prev_policy_no], ['Previous Expiry', d.prev_expiry], ['Claims (3 yr)', d.claims_3yr],
    ])}</div></div>${claimHistSec}` : ''}`;
  }

  let ghi = '';
  if (isGHI) {
    ghi = `<div class="sec"><div class="sec-h">Business / Insured Details</div><div class="kv">${kvRow([
      ['Nature of Business', d.business], ['Location', d.location], ['GSTIN', d.gst],
    ])}</div></div>
    <div class="sec"><div class="sec-h">Group & Sum Insured</div><div class="kv">${kvRow([
      ['Family Definition', d.family_def], ['Sum Insured / Family', d.si_per_family ? inr(d.si_per_family) : ''], ['Employees / Families', d.total_employees],
      ['Spouses', d.fam_spouse], ['Kids', d.fam_kids], ['Dependents', d.fam_dependents], ['Parents', d.fam_parents],
      ['Total Lives', d.total_lives], ['Room Rent', d.room_rent], ['Co-pay', d.copay ? `${d.copay}%` : ''],
      ['PED Waiver Day-1', d.ped_waiver], ['Maternity Limit', d.maternity_limit ? inr(d.maternity_limit) : ''],
    ])}</div></div>
    ${(d.prev_insurer || d.prev_policy_no || d.claims_3yr) ? `<div class="sec"><div class="sec-h">Previous Policy & Claims</div><div class="kv">${kvRow([
      ['Previous Insurer', d.prev_insurer], ['Previous Policy No', d.prev_policy_no], ['Previous Expiry', d.prev_expiry], ['Claims Ratio', d.claims_3yr],
    ])}</div></div>${claimHistSec}` : ''}`;
  }

  let wc = '';
  if (isWC) {
    const cats = Array.isArray(d.wage_cats) ? d.wage_cats : [];
    wc = `<div class="sec"><div class="sec-h">Business / Insured Details</div><div class="kv">${kvRow([
      ['Nature of Business', d.business], ['Type of Work', d.work_type === 'Other' ? (d.work_type_other || 'Other') : d.work_type], ['Location', d.location], ['GSTIN', d.gst],
      ['Policy Basis', rfq.policy_type], ['Policy Tenure', tenureText({ ...d, tenure_months: d.tenure_months || '12' })], ['Medical Extension', d.medical_ext === 'Yes' ? `Yes (${inr(d.med_limit)}/employee)` : 'No'],
    ])}</div></div>
    <div class="sec"><div class="sec-h">Employees & Wage Roll</div>
      <table><thead><tr><th>Category</th><th class="num">Head-count</th><th class="num">Annual Wages (₹)</th></tr></thead><tbody>
      ${cats.map((cc) => `<tr><td>${esc(cc.cat)}</td><td class="num">${esc(cc.count)}</td><td class="num">${Number(cc.wages || 0).toLocaleString('en-IN')}</td></tr>`).join('') || '<tr><td colspan="3">—</td></tr>'}
      <tr class="best"><td>Total</td><td class="num">${esc(d.total_employees || 0)}</td><td class="num">${Number(d.wage_roll || 0).toLocaleString('en-IN')}</td></tr>
      </tbody></table>
    </div>
    ${(d.prev_insurer || d.prev_policy_no || d.claims_3yr) ? `<div class="sec"><div class="sec-h">Previous Policy & Claims</div><div class="kv">${kvRow([
      ['Previous Insurer', d.prev_insurer], ['Previous Policy No', d.prev_policy_no], ['Previous Expiry', d.prev_expiry], ['Claims (3 yr)', d.claims_3yr],
    ])}</div></div>${claimHistSec}` : ''}`;
  }

  let vehicle = '';
  if (isMotor) {
    vehicle = `<div class="sec"><div class="sec-h">Vehicle / RC Details</div><div class="kv">${kvRow([
      ['Vehicle Class', d.vehicle_class], ['Registration No', d.reg_no], ['Make', d.make], ['Model', d.model],
      ['Variant', d.variant], ['Mfg Year', d.mfg_year], ['Registration Date', d.reg_date], ['RTO', d.rto],
      ['Fuel', d.fuel || '—'], d.fuel === 'Electric' ? ['Power (kW)', d.kw] : ['Cubic Capacity', d.cc], ['Seating', d.seating], ['GVW (kg)', d.gvw], ['Engine No', d.engine_no], ['Chassis No', d.chassis_no],
    ])}</div></div>`;
  }
  let prev = '';
  if (isMotor && showPrev) {
    prev = `<div class="sec"><div class="sec-h">Previous Policy & NCB</div><div class="kv">${kvRow([
      ['Previous Insurer', d.prev_insurer], ['Previous Policy No', d.prev_policy_no], ['Previous Expiry', d.prev_expiry],
      ['Claim Taken', d.claim_taken], ['NCB %', d.ncb_pct ? d.ncb_pct + '%' : ''],
    ])}</div></div>${claimHistSec}`;
  }

  return `
    ${letterhead(c)}
    <div class="title-band"><h1>Request for Quotation</h1><div class="meta"><b>${esc(rfq.rfq_no)}</b><br>${todayStr()}</div></div>
    <div class="sec"><div class="sec-h">Client & Requirement</div><div class="kv">${kvRow([
      ['Client', rfq.client_name], ['Mobile', rfq.mobile], ['Email', rfq.email],
      ['Category', rfq.category], ['Policy Nature', rfq.policy_nature], ['Policy Type', rfq.policy_type],
      ['Product / Risk', rfq.product], ['Requested IDV', rfq.requested_idv ? inr(rfq.requested_idv) : ''], ['Sum Assured', rfq.sum_assured ? inr(rfq.sum_assured) : ''],
    ])}</div></div>
    ${vehicle}
    ${wc}
    ${gpa}
    ${ghi}
    ${fire}
    ${marine}
    ${liab}
    ${gtl}
    ${healthR}
    ${home}
    ${eng}
    ${prev}
    ${addOns.length ? `<div class="sec"><div class="sec-h">${ADDON_HEAD[cat] || 'Add-on Covers Requested'}</div><div class="chips-p">${addOns.map((a) => `<span class="chip-p">${esc(a)}</span>`).join('')}</div></div>${claimHistSec}` : ''}
    ${rfq.requirement ? `<div class="sec"><div class="sec-h">Additional Notes</div><div class="v" style="font-weight:500">${esc(rfq.requirement)}</div></div>${claimHistSec}` : ''}
    ${rfq.remarks ? `<div class="sec"><div class="sec-h">Notes</div><div class="v" style="font-weight:800">${esc(rfq.remarks)}</div></div>${claimHistSec}` : ''}
    ${d.include_quotes_pdf ? `<div class="sec"><div class="sec-h">Addressed To (Insurers)</div>
      <table><thead><tr><th>#</th><th>Insurer</th><th>Email</th></tr></thead><tbody>
      ${insurers.map((i, n) => `<tr><td>${n + 1}</td><td>${esc(i.insurer)}</td><td>${esc(i.email || '—')}</td></tr>`).join('') || '<tr><td colspan="3">—</td></tr>'}
      </tbody></table>
    </div>` : ''}
    ${(d.rc_name || d.prev_name || (Array.isArray(d.other_docs) && d.other_docs.length)) ? `<div class="sec"><div class="sec-h">Enclosures</div><div class="chips-p">${d.rc_name ? `<span class="chip-p">${mandDoc}</span>` : ''}${d.prev_name ? '<span class="chip-p">Previous Policy Copy</span>' : ''}${(Array.isArray(d.other_docs) ? d.other_docs : []).map((o) => `<span class="chip-p">${esc(o.name)}</span>`).join('')}</div></div>${claimHistSec}` : ''}
    <div class="note">${(() => {
      const by = rfq.due_date ? ` by <b>${esc(rfq.due_date)}</b>` : '';
      const NOTE = {
        'Workmen Compensation': `Kindly provide your most competitive rate per mille (‰) on the declared wage roll of <b>${inr(d.wage_roll)}</b> for <b>${esc(d.total_employees || 0)}</b> employees${by}, along with the medical extension premium and the requested extensions (ODC, sub-contractors, terrorism). Please quote your best terms.`,
        'Group Personal Accident': `Kindly provide your most competitive rate per mille (‰) on the total capital sum insured of <b>${inr(d.total_csi)}</b> for <b>${esc(d.total_members || 0)}</b> members${by}, covering Accidental Death, PTD & PPD, along with the requested TTD / medical extensions. Please quote your best terms.`,
        'Group Health Insurance': `Kindly provide your most competitive per-family premium for a sum insured of <b>${inr(d.si_per_family)}</b> (${esc(d.family_def || 'family floater')}) covering <b>${esc(d.total_lives || 0)}</b> lives${by}, along with maternity, PED-waiver and the requested add-ons. Please quote your best terms.`,
        'Fire & Property': `Kindly provide your most competitive rate per mille (‰) on the total sum insured of <b>${inr(d.total_si)}</b> across the asset schedule${by}, covering Fire & Special Perils along with the requested perils (STFI, earthquake, terrorism, BI). Please quote your best terms.`,
        'Marine Cargo': `Kindly provide your most competitive rate per mille (‰) on the consignment value of <b>${inr(d.consignment_si)}</b> for transit ${esc([d.from, d.to].filter(Boolean).join(' → ') || '—')} (${esc(d.cover_basis || 'ICC')})${by}, along with the requested extensions. Please quote your best terms.`,
        'Liability': `Kindly provide your most competitive premium for a limit of indemnity of <b>${inr(d.limit_aoy)}</b> (AOY) — ${esc(d.liability_type || 'Liability')}${by}, along with the requested extensions (retroactive cover, worldwide jurisdiction, legal costs). Please quote your best terms.`,
        'Group Term Life': `Kindly provide your most competitive rate per mille (‰) on the total sum assured of <b>${inr(d.total_sa)}</b> for <b>${esc(d.total_members || 0)}</b> members${by}, covering death benefit along with the requested riders (ADB, PTD, CI). Please quote your best terms.`,
        'Retail Health': `Kindly provide your most competitive premium for a sum insured of <b>${inr(d.si_per_family)}</b> (${esc(d.rh_type || 'floater')}) covering <b>${esc(d.total_members || 0)}</b> members (eldest ${esc(d.eldest_age || 0)} yr)${by}, along with the requested add-ons. Please quote your best terms.`,
        'Householder': `Kindly provide your most competitive rate per mille (‰) on the total sum insured of <b>${inr(d.total_si)}</b> (building + contents)${by}, covering fire & allied perils along with the requested sections (burglary, all-risk, liability). Please quote your best terms.`,
        'Engineering': `Kindly provide your most competitive rate per mille (‰) on the project / plant value of <b>${inr(d.project_value)}</b> — ${esc(d.eng_type || 'engineering')}${by}, along with the requested extensions (TPL, escalation, maintenance). Please quote your best terms.`,
      };
      return NOTE[cat] || `Kindly provide your most competitive quotation for the above risk${by}, including IDV, own-damage & third-party premium and the requested add-on covers. Please quote your best terms.`;
    })()}</div>
    <div class="sign">For <b>${esc(c.name)}</b><br><br>Authorised Signatory</div>
    <div class="foot"><span>${esc(c.name)}</span><span>Generated ${todayStr()}</span></div>
  `;
}

export function shortIns(n) {
  const s = (n || '').toLowerCase();
  const m = [['digit', 'DIGIT'], ['tata', 'TATA'], ['bajaj', 'BAJAJ'], ['hdfc', 'HDFC'], ['icici', 'ICICI'], ['reliance', 'RELIANCE'], ['future', 'FUTURE'], ['sbi', 'SBI'], ['new india', 'NEW INDIA'], ['national', 'NATIONAL'], ['oriental', 'ORIENTAL'], ['united', 'UNITED'], ['chola', 'CHOLA'], ['kotak', 'KOTAK'], ['liberty', 'LIBERTY'], ['royal', 'ROYAL'], ['iffco', 'IFFCO'], ['shriram', 'SHRIRAM'], ['zuno', 'ZUNO'], ['universal', 'USGI']];
  for (const [k, v] of m) if (s.includes(k)) return v;
  return (n || '').split(/\s+/)[0].toUpperCase();
}

// ---- Document 2: the comparison shared with the client (matrix format) ----
// Cover wording for the add-on matrix. In one place because it appears in
// every line's matrix and the three of them must agree.
const COVERED = '<span class="yes">COVER</span>';
const NOT_COVERED = '<span class="no">NOT COVER</span>';

// The people a client can call, and what to remind them of. Taken from the quotation
// the office already sends; kept together here so they are changed in one place.
const MQ_TEAM = [
  { name: 'Nishith Pandya', role: 'Head - Corporate & Industrial Insurance', phone: '96247 00771', email: 'nishith@wcfw.in' },
  { name: 'Pankaj Chavda', role: 'Sales Support', phone: '70160 91950', email: 'motor.support@wcfw.in' },
  { name: 'Prakash Macchi', role: 'Head - Health & Life Insurance', phone: '98796 13719', email: 'Prakash@wcfw.in' },
  { name: 'Urvashi Makwana', role: 'Sales Support', phone: '97232 25401', email: 'corporate.support@wcfw.in' },
  { name: 'Naiya Gohel', role: 'Back Office', phone: '99783 79879', email: '' },
];
const MQ_POINTS = [
  '24x7 claim assistance is available.', 'Please ensure NCB declaration is accurate.',
  'Claim must be reported within 3 days of the incident.', 'Kindly cross-check all details mentioned in the quotation.',
  'Cashless benefit is available at network garages.', 'In case of theft, FIR must be lodged within 48 hours.',
  'Third party liability is as per Government law.',
];
const MQ_ADDRESS = 'F-4/5, City Plaza Complex, Nr. Badiadev Crossing, Nr. Sardargunj, Anand - 388001';
const MQ_VALID_DAYS = 7;
const plainNum = (v) => Number(v || 0).toLocaleString('en-IN');

/**
 * The motor quotation a client receives: their details, the vehicle, every insurer's
 * quote side by side, and the office's standing notes and contacts.
 */
function buildMotorQuotation(rfq) {
  const c = company();
  const d = parse(rfq.details, {});
  const quoted = parse(rfq.insurers, []).filter((i) => Number(i.premium) > 0);
  const requested = parse(rfq.add_ons, []);
  const rows = requested.length ? [...requested] : [...new Set(quoted.flatMap((i) => parse(i.addons_incl, [])))];
  // Third-party liability is the legal minimum on every policy but an own-damage-only one.
  const odOnly = /own damage/i.test(rfq.policy_type || '');
  const covers = (i, a) => { const list = parse(i.addons_incl, null); return list ? list.includes(a) : true; };
  const yn = (v) => (v ? '<span class="yes">YES</span>' : '<span class="no">NO</span>');
  const recommended = quoted.find((i) => i.selected) || quoted.reduce((a, b) => (!a || Number(b.premium) < Number(a.premium) ? b : a), null);
  const approved = quoted.find((i) => i.client_approved) || null;
  const isRec = (i) => recommended && i.insurer === recommended.insurer;
  const isAppr = (i) => approved && i.insurer === approved.insurer;
  const renewalOf = (i) => (i.txn ? i.txn === 'Renewal' : ['Renewal', 'Rollover'].includes(rfq.policy_nature) && d.prev_insurer && shortIns(i.insurer) === shortIns(d.prev_insurer));
  const policyKind = (rfq.policy_type || 'Package').replace(/\s*\(.*?\)\s*/g, ' ').replace(/\s+only/i, '').trim().toUpperCase();
  const quoteDate = dmy(rfq.due_date) || dmy(new Date().toISOString().slice(0, 10));
  const kv = (pairs) => pairs.map(([k, v]) => '<tr><td class="k">' + esc(k) + '</td><td class="v">' + esc(v ?? '') + '</td></tr>').join('');
  const team = MQ_TEAM.map((p) => '<div><b>' + esc(p.name) + '</b>' + esc(p.role) + '<br>M: ' + esc(p.phone) + (p.email ? '<br>E: ' + esc(p.email) : '') + '</div>').join('');

  return `
    <div class="mq-head">
      <div class="mq-title">MOTOR INSURANCE QUOTATION</div>
      <div>${c.logo ? '<img class="mq-logo" src="' + esc(c.logo) + '">' : BRAND_SVG}</div>
    </div>
    <div class="mq-hi">Dear <b>${esc(rfq.client_name)}</b>,<br><br>Please find below the motor insurance quotation prepared for you.<br>Kindly review the details and feel free to contact us for any queries or clarifications.</div>

    <div class="mq-bar">Client Information</div>
    <table class="mq">${kv([['Insured Name', rfq.client_name], ['Mobile Number', rfq.mobile]])}</table>

    <div class="mq-bar">Vehicle Details</div>
    <table class="mq">${kv([
      ['Registration Number', d.reg_no], ['Make', d.make], ['Model', d.model], ['Year of Manufacture', d.mfg_year], ['Fuel Type', d.fuel],
      ['Any Claims During Policy Period', d.claims_3yr], ['Insurance Due Date', dmy(d.prev_expiry)], ['Renewal NCB', d.ncb_pct ? d.ncb_pct + '%' : ''],
    ])}</table>

    <div class="mq-bar orange">${esc(policyKind)} POLICY - Quote Comparison</div>
    <table class="mq cmp">
      <tr><th style="text-align:left">Insurer</th>${quoted.map((i) => '<th class="' + (isAppr(i) ? 'appr' : '') + '">' + esc(shortIns(i.insurer)) + (renewalOf(i) ? '<br>(RENEWAL)' : '') + (isAppr(i) ? '<span class="mq-tag">CLIENT APPROVED</span>' : isRec(i) ? '<span class="mq-tag">RECOMMENDED</span>' : '') + '</th>').join('')}</tr>
      <tr><td class="k">NCB</td>${quoted.map((i) => '<td>' + esc(i.ncb || d.ncb_pct || '0') + '%</td>').join('')}</tr>
      <tr><td class="k">IDV</td>${quoted.map((i) => '<td>' + plainNum(i.idv || rfq.requested_idv) + '</td>').join('')}</tr>
      ${rows.map((a) => '<tr><td class="k">' + esc(a) + '</td>' + quoted.map((i) => '<td>' + yn(covers(i, a)) + '</td>').join('') + '</tr>').join('')}
      <tr><td class="k">Third Party Liability</td>${quoted.map((i) => '<td>' + yn(!odOnly) + '</td>').join('')}</tr>
      <tr class="tot"><td class="k" style="text-transform:uppercase">Total Premium (Rs.)</td>${quoted.map((i) => '<td class="' + (isRec(i) ? 'best' : '') + '">' + plainNum(i.premium) + '</td>').join('')}</tr>
    </table>
    <div class="mq-valid">QUOTE DATE: ${esc(quoteDate)} &nbsp;|&nbsp; NOTE - QUOTE VALID FOR ${MQ_VALID_DAYS} DAYS</div>
    <div class="mq-gst">Please note that above mentioned premium is inclusive of 18% GST</div>
    ${approved ? '<div class="note appr-note" style="margin-top:8px"><b>Approved by client:</b> ' + esc(approved.insurer) + ' at <b>' + plainNum(approved.premium) + '</b>' + (approved.approved_by ? ' — confirmed by ' + esc(approved.approved_by) : '') + (approved.approved_at ? ' on ' + esc(approved.approved_at) : '') + '.</div>' : ''}

    <div class="mq-bar">Important Points</div>
    <div class="mq-points">${MQ_POINTS.map((p) => '<div>• ' + esc(p) + '</div>').join('')}</div>

    <div class="mq-bar">Our Team</div>
    <div class="mq-team">${team}</div>

    <div class="mq-foot"><b>${esc(c.name === 'WeCare Assurance' ? 'We Care Assurance' : c.name)}</b><br>${esc(c.addr || MQ_ADDRESS)}</div>
  `;
}

export function buildCompareDoc(rfq) {
  const c = company();
  const d = parse(rfq.details, {});
  const quoted = parse(rfq.insurers, []).filter((i) => Number(i.premium) > 0);
  const requestedAddons = parse(rfq.add_ons, []);
  const addonRows = requestedAddons.length ? requestedAddons
    : [...new Set(quoted.flatMap((i) => parse(i.addons_incl, [])))];
  const selected = quoted.find((i) => i.selected) || quoted.reduce((a, b) => (!a || Number(b.premium) < Number(a.premium) ? b : a), null);
  const isSel = (i) => selected && i.insurer === selected.insurer;
  // The client's own pick, which is not always our recommendation — the two are
  // tracked separately and a column can carry either mark, or both.
  const approved = quoted.find((i) => i.client_approved) || null;
  const isAppr = (i) => approved && i.insurer === approved.insurer;
  const cls = (i) => [isSel(i) ? 'sel' : '', isAppr(i) ? 'appr' : ''].filter(Boolean).join(' ');
  const covers = (i, a) => { const list = parse(i.addons_incl, null); return list ? list.includes(a) : true; };
  const txnOf = (i) => i.txn || (['Renewal', 'Rollover'].includes(rfq.policy_nature) && d.prev_insurer && shortIns(i.insurer) === shortIns(d.prev_insurer) ? 'RENEWAL' : 'QUOTE');
  const cat = (rfq.category || 'Motor').toUpperCase();
  const isWC = (rfq.category || '') === 'Workmen Compensation';
  const isGPA = (rfq.category || '') === 'Group Personal Accident';
  const isGHI = (rfq.category || '') === 'Group Health Insurance';
  const isFire = (rfq.category || '') === 'Fire & Property';
  const isMarine = (rfq.category || '') === 'Marine Cargo';
  const isLiab = (rfq.category || '') === 'Liability';
  const isGTL = (rfq.category || '') === 'Group Term Life';
  const isHealthR = (rfq.category || '') === 'Retail Health';
  const isHome = (rfq.category || '') === 'Householder';
  const isEng = (rfq.category || '') === 'Engineering';

  const th = quoted.map((i) => `<td class="ins ${cls(i)}">${esc(shortIns(i.insurer))}${isAppr(i) ? '<div class="tag-appr">CLIENT APPROVED</div>' : (isSel(i) ? '<div class="tag-rec">RECOMMENDED</div>' : '')}</td>`).join('');
  const txnRow = quoted.map((i) => `<td class="${cls(i)}">${esc(txnOf(i))}</td>`).join('');
  const ncbRow = quoted.map((i) => `<td class="${cls(i)}">${esc(i.ncb || d.ncb_pct || '0')}%</td>`).join('');
  const idvRow = quoted.map((i) => `<td class="${cls(i)}">${inr(i.idv || rfq.requested_idv || 0)}</td>`).join('');
  const totalRow = quoted.map((i) => `<td class="tot ${cls(i)}">${inr(i.premium)}</td>`).join('');
  const addonMatrix = addonRows.map((a) => `<tr><td class="lbl">${esc(a)}</td>${quoted.map((i) => `<td class="${cls(i)}">${covers(i, a) ? COVERED : NOT_COVERED}</td>`).join('')}</tr>`).join('');

  const header = `<div class="lh">
      <div>${c.logo ? `<img class="lh-logo" src="${esc(c.logo)}">` : BRAND_SVG}<div class="lh-sub">${esc(c.addr)}</div></div>
      <div class="lh-right"><div style="font-weight:800;color:#e9531e;font-size:12px">${cat} SUPPORT</div>${c.phone ? `<div>${esc(c.phone)}</div>` : ''}${c.email ? `<div>${esc(c.email)}</div>` : ''}</div>
    </div>`;
  const footer = `${selected ? `<div class="note" style="margin-top:12px"><b>Our recommendation:</b> ${esc(selected.insurer)} at <b>${inr(selected.premium)}</b>${selected.remark ? ` — ${esc(selected.remark)}` : ''}.</div>` : ''}
    ${approved ? `<div class="note appr-note"><b>Approved by client:</b> ${esc(approved.insurer)} at <b>${inr(approved.premium)}</b>${approved.approved_by ? ` — confirmed by ${esc(approved.approved_by)}` : ''}${approved.approved_at ? ` on ${esc(approved.approved_at)}` : ''}.</div>` : ''}
    ${quoted.some((i) => i.quote_name) ? `<div style="font-size:10px;color:#8994a6;margin-top:8px">Original insurer quotes on file: ${quoted.filter((i) => i.quote_name).map((i) => esc(shortIns(i.insurer))).join(', ')}.</div>` : ''}
    <div class="valid-band">QUOTE DATE : ${todayStr()} &nbsp;**&nbsp; NOTE — QUOTE VALID FOR 7 DAYS &nbsp;**</div>
    <div class="foot"><span>${esc(c.name)} · ${esc(c.email)}</span><span>Generated ${todayStr()}</span></div>`;

  if (isWC) {
    const empRow = quoted.map((i) => `<td class="${cls(i)}">${esc(d.total_employees || '—')}</td>`).join('');
    const rateRow = quoted.map((i) => `<td class="${cls(i)}">${esc(i.wc_rate || '—')}</td>`).join('');
    const basicRow = quoted.map((i) => `<td class="${cls(i)}">${inr(i.wc_basic)}</td>`).join('');
    const medRow = quoted.map((i) => `<td class="${cls(i)}">${Number(i.wc_medical) > 0 ? inr(i.wc_medical) : NOT_COVERED}</td>`).join('');
    const wcAddonMatrix = addonRows.filter((a) => a !== 'Medical Extension').map((a) => `<tr><td class="lbl">${esc(a)}</td>${quoted.map((i) => `<td class="${cls(i)}">${covers(i, a) ? COVERED : NOT_COVERED}</td>`).join('')}</tr>`).join('');
    return `
    ${header}
    <div class="cmp-band">
      <div class="cb-row"><span><b>NAME :</b> ${esc(rfq.client_name)}</span><span><b>DUE DATE :</b> ${esc(d.prev_expiry || rfq.due_date || '—')}</span></div>
      <div class="cb-row"><span><b>BUSINESS :</b> ${esc(d.business || rfq.product || 'Workmen Compensation')}</span><span><b>EMPLOYEES :</b> ${esc(d.total_employees || '—')}</span></div>
      <div class="cb-row"><span><b>WAGE ROLL :</b> ${inr(d.wage_roll)}</span><span><b>${esc((rfq.policy_type || 'WC ACT').toUpperCase())}</b></span></div>
    </div>
    <table class="matrix">
      <tr><td class="lbl navy">Wage Roll - ${inr(d.wage_roll)}</td>${th}</tr>
      <tr><td class="lbl navy">No. of Employees</td>${empRow}</tr>
      <tr><td class="lbl navy">Rate &permil; (per mille)</td>${rateRow}</tr>
      <tr><td class="lbl navy">Basic Premium</td>${basicRow}</tr>
      <tr><td class="lbl navy">Medical Extension</td>${medRow}</tr>
      ${wcAddonMatrix}
      <tr class="total"><td class="lbl navy">TOTAL PREMIUM</td>${totalRow}</tr>
    </table>
    ${footer}
  `;
  }

  if (isGPA) {
    const memRow = quoted.map((i) => `<td class="${cls(i)}">${esc(d.total_members || '—')}</td>`).join('');
    const rateRow = quoted.map((i) => `<td class="${cls(i)}">${esc(i.wc_rate || '—')}</td>`).join('');
    const basicRow = quoted.map((i) => `<td class="${cls(i)}">${inr(i.wc_basic)}</td>`).join('');
    const medRow = quoted.map((i) => `<td class="${cls(i)}">${Number(i.wc_medical) > 0 ? inr(i.wc_medical) : NOT_COVERED}</td>`).join('');
    const gpaAddonMatrix = addonRows.filter((a) => !['Medical Extension', 'Temporary Total Disablement (Weekly)'].includes(a)).map((a) => `<tr><td class="lbl">${esc(a)}</td>${quoted.map((i) => `<td class="${cls(i)}">${covers(i, a) ? COVERED : NOT_COVERED}</td>`).join('')}</tr>`).join('');
    return `
    ${header}
    <div class="cmp-band">
      <div class="cb-row"><span><b>NAME :</b> ${esc(rfq.client_name)}</span><span><b>DUE DATE :</b> ${esc(d.prev_expiry || rfq.due_date || '—')}</span></div>
      <div class="cb-row"><span><b>BUSINESS :</b> ${esc(d.business || rfq.product || 'Group Personal Accident')}</span><span><b>MEMBERS :</b> ${esc(d.total_members || '—')}</span></div>
      <div class="cb-row"><span><b>TOTAL CSI :</b> ${inr(d.total_csi)}</span><span><b>${esc((d.risk_group || 'GROUP PA').toUpperCase())}</b></span></div>
    </div>
    <table class="matrix">
      <tr><td class="lbl navy">Total CSI - ${inr(d.total_csi)}</td>${th}</tr>
      <tr><td class="lbl navy">No. of Members</td>${memRow}</tr>
      <tr><td class="lbl navy">Rate &permil; (per mille)</td>${rateRow}</tr>
      <tr><td class="lbl navy">Basic Premium</td>${basicRow}</tr>
      <tr><td class="lbl navy">TTD / Medical</td>${medRow}</tr>
      ${gpaAddonMatrix}
      <tr class="total"><td class="lbl navy">TOTAL PREMIUM</td>${totalRow}</tr>
    </table>
    ${footer}
  `;
  }

  if (isGHI) {
    const famRow = quoted.map((i) => `<td class="${cls(i)}" style="font-size:9px">${esc(d.family_def || '—')}</td>`).join('');
    const livesRow = quoted.map((i) => `<td class="${cls(i)}">${esc(d.total_lives || '—')}</td>`).join('');
    const perFamRow = quoted.map((i) => `<td class="${cls(i)}">${Number(i.wc_rate) > 0 ? inr(i.wc_rate) : '—'}</td>`).join('');
    const netRow = quoted.map((i) => `<td class="${cls(i)}">${inr(i.wc_basic)}</td>`).join('');
    return `
    ${header}
    <div class="cmp-band">
      <div class="cb-row"><span><b>NAME :</b> ${esc(rfq.client_name)}</span><span><b>DUE DATE :</b> ${esc(d.prev_expiry || rfq.due_date || '—')}</span></div>
      <div class="cb-row"><span><b>BUSINESS :</b> ${esc(d.business || rfq.product || 'Group Mediclaim')}</span><span><b>LIVES :</b> ${esc(d.total_lives || '—')}</span></div>
      <div class="cb-row"><span><b>SUM INSURED :</b> ${inr(d.si_per_family)} / family</span><span><b>${esc((d.family_def || 'FLOATER').toUpperCase())}</b></span></div>
    </div>
    <table class="matrix">
      <tr><td class="lbl navy">Sum Insured - ${inr(d.si_per_family)}</td>${th}</tr>
      <tr><td class="lbl navy">Family Definition</td>${famRow}</tr>
      <tr><td class="lbl navy">Lives Covered</td>${livesRow}</tr>
      <tr><td class="lbl navy">Per-Family Premium</td>${perFamRow}</tr>
      <tr><td class="lbl navy">Net Premium</td>${netRow}</tr>
      ${addonMatrix}
      <tr class="total"><td class="lbl navy">TOTAL PREMIUM</td>${totalRow}</tr>
    </table>
    ${footer}
  `;
  }

  if (isHealthR) {
    const memRow = quoted.map((i) => `<td class="${cls(i)}">${esc(d.total_members || '—')}</td>`).join('');
    const netRow = quoted.map((i) => `<td class="${cls(i)}">${inr(i.wc_basic)}</td>`).join('');
    return `
    ${header}
    <div class="cmp-band">
      <div class="cb-row"><span><b>NAME :</b> ${esc(rfq.client_name)}</span><span><b>DUE DATE :</b> ${esc(d.prev_expiry || rfq.due_date || '—')}</span></div>
      <div class="cb-row"><span><b>SUM INSURED :</b> ${inr(d.si_per_family)}</span><span><b>MEMBERS :</b> ${esc(d.total_members || '—')} (eldest ${esc(d.eldest_age || 0)} yr)</span></div>
      <div class="cb-row"><span><b>TYPE :</b> ${esc(d.rh_type || 'Family Floater')}</span><span><b>${esc((d.room_rent || 'HEALTH').toUpperCase())}</b></span></div>
    </div>
    <table class="matrix">
      <tr><td class="lbl navy">Sum Insured - ${inr(d.si_per_family)}</td>${th}</tr>
      <tr><td class="lbl navy">Members Covered</td>${memRow}</tr>
      <tr><td class="lbl navy">Net Premium</td>${netRow}</tr>
      ${addonMatrix}
      <tr class="total"><td class="lbl navy">TOTAL PREMIUM</td>${totalRow}</tr>
    </table>
    ${footer}
  `;
  }

  // Shared "sum insured × rate" comparison doc for Fire / Marine / Liability / GTL / Householder / Engineering.
  if (isFire || isMarine || isLiab || isGTL || isHome || isEng) {
    const rateRow = quoted.map((i) => `<td class="${cls(i)}">${esc(i.wc_rate || '—')}</td>`).join('');
    const basicRow = quoted.map((i) => `<td class="${cls(i)}">${inr(i.wc_basic)}</td>`).join('');
    const inforow = (label, val) => `<tr><td class="lbl navy">${esc(label)}</td>${quoted.map((i) => `<td class="${cls(i)}">${esc(val)}</td>`).join('')}</tr>`;
    let band, baseLabel, baseVal, infoRows;
    if (isFire) {
      band = `<div class="cb-row"><span><b>BUSINESS :</b> ${esc(d.business || 'Fire & Special Perils')}</span><span><b>OCCUPANCY :</b> ${esc(d.occupancy || '—')}</span></div>
      <div class="cb-row"><span><b>SUM INSURED :</b> ${inr(d.total_si)}</span><span><b>${esc((d.construction || 'SFSP').toUpperCase())}</b></span></div>`;
      baseLabel = 'Total Sum Insured'; baseVal = d.total_si; infoRows = inforow('Occupancy', d.occupancy || '—');
    } else if (isMarine) {
      band = `<div class="cb-row"><span><b>GOODS :</b> ${esc(d.goods || 'Marine Cargo')}</span><span><b>MODE :</b> ${esc(d.mode || '—')}</span></div>
      <div class="cb-row"><span><b>SUM INSURED :</b> ${inr(d.consignment_si)}</span><span><b>${esc((d.cover_basis || 'ICC').toUpperCase())}</b></span></div>`;
      baseLabel = 'Sum Insured'; baseVal = d.consignment_si; infoRows = inforow('Transit', [d.from, d.to].filter(Boolean).join(' → ') || '—') + inforow('Cover Basis', d.cover_basis || '—');
    } else if (isLiab) {
      band = `<div class="cb-row"><span><b>TYPE :</b> ${esc(d.liability_type || 'Liability')}</span><span><b>JURISDICTION :</b> ${esc(d.jurisdiction || '—')}</span></div>
      <div class="cb-row"><span><b>LIMIT (AOY) :</b> ${inr(d.limit_aoy)}</span><span><b>AOA : ${inr(d.limit_aoa)}</b></span></div>`;
      baseLabel = 'Limit of Indemnity (AOY)'; baseVal = d.limit_aoy; infoRows = inforow('Liability Type', d.liability_type || '—');
    } else if (isHome) {
      band = `<div class="cb-row"><span><b>PROPERTY :</b> ${esc(d.property_type || 'Householder')}</span><span><b>LOCATION :</b> ${esc(d.location || '—')}</span></div>
      <div class="cb-row"><span><b>SUM INSURED :</b> ${inr(d.total_si)}</span><span><b>${esc((d.building_type || 'HOME').toUpperCase())}</b></span></div>`;
      baseLabel = 'Total Sum Insured'; baseVal = d.total_si; infoRows = inforow('Property', d.property_type || '—');
    } else if (isEng) {
      band = `<div class="cb-row"><span><b>PROJECT :</b> ${esc(d.business || 'Engineering')}</span><span><b>LOCATION :</b> ${esc(d.location || '—')}</span></div>
      <div class="cb-row"><span><b>PROJECT VALUE :</b> ${inr(d.project_value)}</span><span><b>${esc((d.eng_type || 'ENGINEERING').toUpperCase())}</b></span></div>`;
      baseLabel = 'Project / Plant Value'; baseVal = d.project_value; infoRows = inforow('Type', (d.eng_type || '—').replace(/\s*\(.*\)/, ''));
    } else {
      band = `<div class="cb-row"><span><b>BUSINESS :</b> ${esc(d.business || 'Group Term Life')}</span><span><b>MEMBERS :</b> ${esc(d.total_members || '—')}</span></div>
      <div class="cb-row"><span><b>TOTAL SA :</b> ${inr(d.total_sa)}</span><span><b>${esc((d.sa_basis || 'GTL').toUpperCase())}</b></span></div>`;
      baseLabel = 'Total Sum Assured'; baseVal = d.total_sa; infoRows = inforow('No. of Members', d.total_members || '—');
    }
    return `
    ${header}
    <div class="cmp-band">
      <div class="cb-row"><span><b>NAME :</b> ${esc(rfq.client_name)}</span><span><b>DUE DATE :</b> ${esc(d.prev_expiry || rfq.due_date || '—')}</span></div>
      ${band}
    </div>
    <table class="matrix">
      <tr><td class="lbl navy">${esc(baseLabel)} - ${inr(baseVal)}</td>${th}</tr>
      ${infoRows}
      <tr><td class="lbl navy">Rate &permil; (per mille)</td>${rateRow}</tr>
      <tr><td class="lbl navy">Basic Premium</td>${basicRow}</tr>
      ${addonMatrix}
      <tr class="total"><td class="lbl navy">TOTAL PREMIUM</td>${totalRow}</tr>
    </table>
    ${footer}
  `;
  }

  if ((rfq.category || 'Motor') === 'Motor') return buildMotorQuotation(rfq);

  return `
    ${header}
    <div class="cmp-band">
      <div class="cb-row"><span><b>NAME :</b> ${esc(rfq.client_name)}</span><span><b>DUE DATE :</b> ${esc(d.prev_expiry || rfq.due_date || '—')}</span></div>
      <div class="cb-row"><span><b>MAKE :</b> ${esc([d.make, d.model].filter(Boolean).join(' / ') || rfq.product)}</span><span><b>REG NO :</b> ${esc(d.reg_no || '—')}</span></div>
      <div class="cb-row"><span><b>FUEL TYPE :</b> ${esc(d.fuel || '—')}</span><span><b>${esc((rfq.policy_type || 'POLICY').toUpperCase())}</b></span></div>
    </div>
    <table class="matrix">
      <tr><td class="lbl navy">Registration Year - ${esc(d.mfg_year || '—')}</td>${txnRow}</tr>
      <tr><td class="lbl navy">${esc([d.vehicle_class || 'Vehicle', d.cc, d.fuel].filter(Boolean).join(' · '))}</td>${th}</tr>
      <tr><td class="lbl navy">NCB</td>${ncbRow}</tr>
      <tr><td class="lbl navy">IDV</td>${idvRow}</tr>
      ${addonMatrix}
      <tr class="total"><td class="lbl navy">TOTAL</td>${totalRow}</tr>
    </table>
    ${footer}
  `;
}
