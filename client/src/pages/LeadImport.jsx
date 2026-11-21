import SheetImport from '../components/SheetImport.jsx';

// Lead import — the shared sheet importer, pointed at the lead fields. A row whose mobile or email already
// belongs to an open lead is skipped and listed.
const FIELDS = [
  { key: 'lead_name', label: 'Lead Name', type: 'text', aliases: ['lead name', 'name', 'client name', 'customer name', 'full name'] },
  { key: 'mobile', label: 'Mobile', type: 'text', aliases: ['mobile', 'phone', 'mobile no', 'contact', 'contact no'] },
  { key: 'email', label: 'Email', type: 'text', aliases: ['email', 'email id', 'e-mail'] },
  { key: 'company_name', label: 'Company', type: 'text', aliases: ['company', 'company name', 'organisation', 'organization'] },
  { key: 'expected_business_type', label: 'Business Type', type: 'text', aliases: ['business type', 'product', 'interested in', 'line', 'insurance type'] },
  { key: 'source', label: 'Source', type: 'text', aliases: ['source', 'lead source', 'campaign'] },
  { key: 'lead_owner', label: 'Lead Owner', type: 'text', aliases: ['owner', 'lead owner', 'assigned to'] },
  { key: 'lead_date', label: 'Lead Date', type: 'date', aliases: ['date', 'lead date', 'created'] },
  { key: 'followup_date', label: 'Follow-up Date', type: 'date', aliases: ['follow up', 'follow-up date', 'followup', 'next follow up'] },
  { key: 'status', label: 'Status', type: 'text', aliases: ['status', 'lead status'] },
  { key: 'remarks', label: 'Remarks', type: 'text', aliases: ['remarks', 'notes', 'requirement', 'comments'] },
  { key: 'do_not_contact', label: 'Do not contact (Yes/No)', type: 'text', aliases: ['do not contact', 'dnd', 'opt out'] },
];
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const guess = (headers) => Object.fromEntries(FIELDS.map((f) => [f.key, headers.find((h) => [f.label, ...f.aliases].some((a) => norm(a) === norm(h))) || '']));
const toRecord = (row, mapping) => Object.fromEntries(FIELDS.map((f) => [f.key, mapping[f.key] ? row[mapping[f.key]] ?? '' : '']).filter(([, v]) => v !== ''));

export default function LeadImport({ open, onClose, onDone }) {
  return <SheetImport open={open} onClose={onClose} onDone={onDone} title="Import Leads" noun="lead" fields={FIELDS} guess={guess} toRecord={toRecord} endpoint="/leads/import" />;
}
