// Every claim field an import can fill, in the order the WCFW layout presents
// them. The mapping screen lists all of these — none is compulsory, so a
// spreadsheet carrying only a handful of columns imports perfectly well and
// the rest are simply left empty.
//
// `aliases` are the spreadsheet headings seen in the wild (Zoho exports, the
// WCFW layout, and the obvious shorthands). They drive the automatic guess so
// a well-named sheet needs no manual mapping at all.

export const CLAIM_IMPORT_FIELDS = [
  { key: 'claim_title', label: 'WCFW Claim / Title', type: 'text', aliases: ['wcfw claim', 'claim title', 'title', 'subject', 'claim name'] },
  { key: 'client_name', label: 'Insured Name', type: 'text', aliases: ['insured name', 'client name', 'customer name', 'insured'] },
  { key: 'claim_category', label: 'Claim Category', type: 'text', aliases: ['claim category', 'category'] },
  { key: 'policy_type', label: 'Policy Type', type: 'text', aliases: ['policy-type', 'policy type'] },
  { key: 'patient_name', label: 'Patient Name', type: 'text', aliases: ['patient name', 'patient'] },
  { key: 'company_name', label: 'Company Name', type: 'text', aliases: ['company name', 'insurer', 'insurance company'] },
  { key: 'policy_no', label: 'Policy No', type: 'text', aliases: ['policy no', 'policy number'] },
  { key: 'vehicle_no', label: 'Vehicle No', type: 'text', aliases: ['vehicle no', 'vehicle number', 'registration no', 'reg no'] },
  { key: 'admission_date', label: 'Date of Admitted', type: 'date', aliases: ['date of admitted', 'admission date', 'admit date', 'date of admission'] },
  { key: 'doctor_name', label: 'Doctor Name', type: 'text', aliases: ['doctor name', 'doctor'] },
  { key: 'hospital_name', label: 'Hospital Name', type: 'text', aliases: ['hospital name', 'hospital'] },
  { key: 'intimation_date', label: 'Claim Intimation Date', type: 'date', aliases: ['claim intimation date', 'intimation date'] },
  { key: 'intimation_no', label: 'Claim Intimation No', type: 'text', aliases: ['claim intimation no', 'intimation no', 'intimation number'] },
  { key: 'associates', label: 'Associates', type: 'text', aliases: ['associates', 'associate'] },
  { key: 'file_received_date', label: 'File Received Date', type: 'date', aliases: ['file recieved date', 'file received date', 'file date'] },
  { key: 'owner', label: 'Claim Owner', type: 'text', aliases: ['wcfw claim owner', 'claim owner', 'owner'] },
  { key: 'settlement_amount', label: 'Settlement Amount', type: 'number', aliases: ['settlement amount', 'settled amount'] },
  { key: 'deduction', label: 'Deduction', type: 'number', aliases: ['deduction', 'deductions'] },
  { key: 'process_date', label: 'Process Date', type: 'date', aliases: ['process date', 'processing date'] },
  { key: 'status', label: 'Status', type: 'text', aliases: ['status', 'claim status'] },
  { key: 'settlement_date', label: 'Settlement Date', type: 'date', aliases: ['settlement date', 'settled on'] },
  { key: 'claim_type', label: 'Claim Type', type: 'text', aliases: ['claim type', 'type'] },
  { key: 'claim_amount', label: 'Claim Amount', type: 'number', aliases: ['claim amount', 'claimed amount'] },
  { key: 'claim_date', label: 'Claim Date', type: 'date', aliases: ['claim date', 'date of loss', 'loss date'] },
  { key: 'discharge_date', label: 'Discharge Date', type: 'date', aliases: ['discharge date', 'date of discharge'] },
  { key: 'currency', label: 'Currency', type: 'text', aliases: ['currency'] },
  { key: 'exchange_rate', label: 'Exchange Rate', type: 'number', aliases: ['exchange rate', 'fx rate'] },
  { key: 'remarks', label: 'Note / Remarks', type: 'text', aliases: ['note', 'notes', 'remarks', 'description'] },
  { key: 'claim_no', label: 'Claim No', type: 'text', aliases: ['claim no', 'claim number'] },
  { key: 'survey_date', label: 'Survey Date', type: 'date', aliases: ['survey date'] },
  { key: 'approved_amount', label: 'Approved Amount', type: 'number', aliases: ['approved amount'] },
  { key: 'surveyor_name', label: 'Surveyor Name', type: 'text', aliases: ['surveyor name', 'surveyor'] },
  { key: 'approval_date', label: 'Approval Date', type: 'date', aliases: ['approval date', 'approved on'] },
  { key: 'pending_documents', label: 'Pending Documents List', type: 'text', aliases: ['pending documents list', 'pending documents', 'pending docs'] },
  { key: 'reinspection_date', label: 'Reinspection Date', type: 'date', aliases: ['reinspection date', 're-inspection date'] },
  { key: 'reinspection_reason', label: 'Reinspection Reason', type: 'text', aliases: ['reinspection reason', 're-inspection reason'] },
  { key: 'delivery_location', label: 'Delivery Location', type: 'text', aliases: ['delivery location'] },
  { key: 'delivery_date', label: 'Delivery Date', type: 'date', aliases: ['delivery date'] },
  { key: 'required_documents', label: 'Required Documents', type: 'text', aliases: ['required documents', 'documents required'] },
  { key: 'mode_of_transfer', label: 'Mode of Transfer', type: 'text', aliases: ['mode of transfer', 'transfer mode', 'payment mode'] },
];

const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Best guess at which spreadsheet column feeds each field: an alias match
 * first, then the field's own label. Only exact normalised matches count —
 * a wrong guess silently loads the wrong column, which is worse than leaving
 * it unmapped for someone to set.
 */
export function guessMapping(headers) {
  const byNorm = new Map();
  for (const h of headers) if (h && !byNorm.has(norm(h))) byNorm.set(norm(h), h);
  const map = {};
  for (const f of CLAIM_IMPORT_FIELDS) {
    const candidates = [f.label, f.key.replace(/_/g, ' '), ...(f.aliases || [])];
    const hit = candidates.map(norm).find((c) => byNorm.has(c));
    if (hit) map[f.key] = byNorm.get(hit);
  }
  return map;
}

/** "Rs. 1,20,000" -> 120000; blank stays blank rather than becoming zero. */
export function toNumber(v) {
  if (v === null || v === undefined || v === '') return '';
  if (typeof v === 'number') return v;
  const m = String(v).match(/-?\d[\d,\s]*(?:\.\d+)?/);
  return m ? Number(m[0].replace(/[,\s]/g, '')) : '';
}

/**
 * Spreadsheet dates arrive three ways: a real Date (SheetJS parses cells typed
 * as dates), an Excel serial number, or text. All three end up as YYYY-MM-DD,
 * and anything unrecognised is returned blank rather than guessed at.
 */
export function toDate(v) {
  if (v === null || v === undefined || v === '') return '';
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  if (v instanceof Date && !isNaN(v)) return iso(v);
  // Excel serial: days since 1899-12-30, which is the epoch its own bug implies.
  if (typeof v === 'number' && v > 0 && v < 100000) return iso(new Date(Date.UTC(1899, 11, 30 + Math.floor(v))));
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${String(+m[2]).padStart(2, '0')}-${String(+m[3]).padStart(2, '0')}`;
  // DD/MM/YYYY — the format the WCFW layout shows and Indian exports use.
  m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
  if (m) {
    let y = +m[3]; if (y < 100) y += y < 70 ? 2000 : 1900;
    const d = +m[1], mo = +m[2];
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  return '';
}

/** Applies the mapping to one spreadsheet row, coercing by field type. */
export function rowToClaim(row, mapping) {
  const out = {};
  for (const f of CLAIM_IMPORT_FIELDS) {
    const col = mapping[f.key];
    if (!col) continue;
    const raw = row[col];
    if (raw === undefined || raw === null || raw === '') continue;
    out[f.key] = f.type === 'number' ? toNumber(raw) : f.type === 'date' ? toDate(raw) : String(raw).trim();
  }
  return out;
}
