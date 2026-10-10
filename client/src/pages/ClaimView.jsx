import { useEffect, useState } from 'react';
import { api } from '../api.js';
import toast from '../components/toast.js';
import confirm from '../components/confirm.js';
import Modal from '../components/Modal.jsx';
import Select from '../components/Select.jsx';
import SearchSelect from '../components/SearchSelect.jsx';
import DateField, { fmt as fmtDate } from '../components/DateField.jsx';
import { Ic } from '../components/Icons.jsx';

// View, edit and delete one claim.
//
// Opens read-only, because most visits are to look something up and an edit
// form that is already live invites an accidental change. Edit switches the
// same fields to inputs. Every claim field is shown whatever the claim type:
// imported claims carry whatever their sheet held, and hiding a populated
// field because it doesn't suit the type would make it look lost.

const STATUSES = ['Pending', 'Intimated', 'Documents Pending', 'Under Process', 'Surveyor Appointed',
  'Under Investigation', 'Under Assessment', 'Under Defense', 'Approved', 'Settled', 'Rejected', 'Withdrawn', 'Closed'];
const CATEGORIES = ['Corporate', 'Personal'];
const POLICY_TYPES = ['Individual', 'Family Floater', 'Group', 'Corporate', 'Package (Comprehensive)', 'Own Damage Only', 'Third Party Only', 'Other'];
const CLAIM_TYPES = ['Motor', 'Health', 'GHI', 'Personal', 'WC', 'Workmen Compensation', 'GPA', 'Fire', 'Home', 'Engineering', 'Marine Cargo', 'Liability', 'GTL', 'Other'];
const CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'AED'];
const DEPARTMENTS = ['Personal Lines', 'Commercial Lines'];
const TRANSFER_MODES = ['NEFT / RTGS', 'Cheque', 'UPI', 'Cash', 'Direct to Hospital'];

const inr = (n) => Number(n || 0).toLocaleString('en-IN');

// kind: text | date | money | area | pick:<options>
const SECTIONS = [
  { title: 'Claim Information', fields: [
    { k: 'claim_title', l: 'Claim Title' }, { k: 'claim_no', l: 'Claim No' },
    { k: 'claim_category', l: 'Claim Category', pick: CATEGORIES }, { k: 'claim_type', l: 'Claim Type', pick: CLAIM_TYPES, add: true },
    { k: 'client_name', l: 'Insured Name' }, { k: 'policy_no', l: 'Policy No' },
    { k: 'policy_type', l: 'Policy Type', pick: POLICY_TYPES }, { k: 'company_name', l: 'Company Name' },
    { k: 'intimation_no', l: 'Claim Intimation No' }, { k: 'intimation_date', l: 'Claim Intimation Date', date: true },
    { k: 'associates', l: 'Associates' }, { k: 'owner', l: 'Claim Owner' },
    { k: 'status', l: 'Status', pick: STATUSES, add: true }, { k: 'department', l: 'Department', pick: DEPARTMENTS },
  ] },
  { title: 'Vehicle / Patient', fields: [
    { k: 'vehicle_no', l: 'Vehicle No' }, { k: 'patient_name', l: 'Patient Name' },
    { k: 'doctor_name', l: 'Doctor Name' }, { k: 'hospital_name', l: 'Hospital Name' },
    { k: 'admission_date', l: 'Date of Admitted', date: true }, { k: 'discharge_date', l: 'Discharge Date', date: true },
  ] },
  { title: 'Dates & Amounts', fields: [
    { k: 'claim_date', l: 'Claim Date', date: true }, { k: 'file_received_date', l: 'File Received Date', date: true },
    { k: 'process_date', l: 'Process Date', date: true }, { k: 'settlement_date', l: 'Settlement Date', date: true },
    { k: 'claim_amount', l: 'Claim Amount', money: true }, { k: 'settlement_amount', l: 'Settlement Amount', money: true },
    { k: 'approved_amount', l: 'Approved Amount', money: true }, { k: 'deduction', l: 'Deduction', money: true },
    { k: 'currency', l: 'Currency', pick: CURRENCIES }, { k: 'exchange_rate', l: 'Exchange Rate', num: true },
  ] },
  { title: 'Claim Flow', fields: [
    { k: 'approval_date', l: 'Approval Date', date: true }, { k: 'survey_date', l: 'Survey Date', date: true },
    { k: 'surveyor_name', l: 'Surveyor Name' }, { k: 'reinspection_date', l: 'Reinspection Date', date: true },
    { k: 'reinspection_reason', l: 'Reinspection Reason', area: true }, { k: 'pending_documents', l: 'Pending Documents', area: true },
    { k: 'delivery_location', l: 'Delivery Location' }, { k: 'delivery_date', l: 'Delivery Date', date: true },
    { k: 'required_documents', l: 'Required Documents', area: true }, { k: 'mode_of_transfer', l: 'Mode of Transfer', pick: TRANSFER_MODES, add: true },
  ] },
  { title: 'Notes', fields: [{ k: 'remarks', l: 'Note / Remarks', area: true, wide: true }] },
];

const show = (f, v) => {
  if (v === null || v === undefined || v === '' || (f.money && Number(v) === 0)) return '—';
  if (f.date) return fmtDate(v) || v;
  if (f.money) return '₹ ' + inr(v);
  return String(v);
};

export default function ClaimView({ claim, onClose, onChanged }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);

  // Fresh each time a different claim is opened, and always back to read-only.
  useEffect(() => {
    setEditing(false);
    setForm(claim ? { ...claim } : {});
  }, [claim?.id]);

  if (!claim) return null;
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  async function save() {
    setSaving(true);
    try {
      // Only the editable fields go back. Everything else — the link to a
      // policy or client, attached documents, line-specific details — is left
      // exactly as it was.
      const body = {};
      for (const s of SECTIONS) for (const f of s.fields) body[f.k] = form[f.k] ?? '';
      await api('/claims/' + claim.id, { method: 'PUT', body });
      toast.success('Claim updated');
      setEditing(false);
      onChanged?.();
    } catch (e) {
      toast.error(e.message || 'Could not save the claim');
    } finally { setSaving(false); }
  }

  async function remove() {
    const ok = await confirm({
      title: 'Delete this claim?',
      message: `${claim.claim_title || claim.claim_no || 'This claim'}${claim.client_name ? ' for ' + claim.client_name : ''} will be permanently removed. This cannot be undone.`,
      tone: 'danger', confirmText: 'Delete', icon: 'trash',
    });
    if (!ok) return;
    try {
      await api('/claims/' + claim.id, { method: 'DELETE' });
      toast.success('Claim deleted');
      onChanged?.();
      onClose?.();
    } catch (e) { toast.error(e.message || 'Could not delete the claim'); }
  }

  const control = (f) => {
    const v = form[f.k] ?? '';
    if (f.pick) {
      return f.add
        ? <SearchSelect value={v} onChange={(x) => set(f.k, x)} options={f.pick.includes(v) || !v ? f.pick : [...f.pick, v]} onAdd={async () => {}} placeholder="Select or type" />
        : <Select value={v} onChange={(e) => set(f.k, e.target.value)} placeholder="Select">{f.pick.map((o) => <option key={o} value={o}>{o}</option>)}</Select>;
    }
    if (f.date) return <DateField value={v} onChange={(e) => set(f.k, e.target.value)} />;
    if (f.area) return <textarea rows={2} value={v} onChange={(e) => set(f.k, e.target.value)} />;
    if (f.money || f.num) return <input type="number" step="any" value={v} onChange={(e) => set(f.k, e.target.value)} />;
    return <input value={v} onChange={(e) => set(f.k, e.target.value)} />;
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={claim.claim_title || claim.claim_no || 'Claim'}
      subtitle={[claim.client_name, claim.claim_type].filter(Boolean).join(' · ') || 'Claim details'}
      icon="shieldcheck"
      size="lg"
      footer={editing ? (
        <>
          <button className="btn ghost" onClick={() => { setForm({ ...claim }); setEditing(false); }} disabled={saving}>Cancel</button>
          <button className="btn blue" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</button>
        </>
      ) : (
        <>
          <button className="btn ghost danger" onClick={remove}><Ic name="trash" size={15} /> Delete</button>
          <button className="btn ghost" onClick={onClose}>Close</button>
          <button className="btn blue" onClick={() => setEditing(true)}><Ic name="edit" size={15} /> Edit</button>
        </>
      )}
    >
      {SECTIONS.map((s) => (
        <div key={s.title} className="cv-section">
          <div className="section-head">{s.title}</div>
          {editing ? (
            <div className="form-grid">
              {s.fields.map((f) => (
                <div className="form-field" key={f.k} style={f.wide ? { gridColumn: '1 / -1' } : undefined}>
                  <label>{f.l}</label>{control(f)}
                </div>
              ))}
            </div>
          ) : (
            <div className="cv-grid">
              {s.fields.map((f) => (
                <div className={'cv-item' + (f.wide ? ' wide' : '')} key={f.k}>
                  <span className="cv-k">{f.l}</span>
                  <span className="cv-v">{show(f, claim[f.k])}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </Modal>
  );
}
