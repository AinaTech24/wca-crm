import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import toast from '../components/toast.js';
import PageHeader from '../components/PageHeader.jsx';
import DataTable from '../components/DataTable.jsx';
import Select from '../components/Select.jsx';
import SearchSelect from '../components/SearchSelect.jsx';
import DateField from '../components/DateField.jsx';
import { Ic } from '../components/Icons.jsx';
import { useRealtime } from '../realtime.js';

const badge = (s) => (s === 'Settled' ? 'green' : s === 'Pending' ? 'orange' : 'red');
const inr = (n) => Number(n || 0).toLocaleString('en-IN');
const CLAIM_EMPTY = { claim_no: '', claim_date: '', claim_amount: '', status: 'Pending', loss_type: '' };
const ENDO_EMPTY = { endorsement_no: '', endorsement_type: 'Nominee Change', endorsement_date: '', premium_effect: '', remarks: '' };
const ENDO_TYPES = ['Nominee Change', 'Address Change', 'Vehicle Transfer', 'Hypothecation Addition', 'Hypothecation Removal', 'Sum Insured Change', 'NCB Correction', 'Registration No Update', 'Nil Endorsement', 'Cancellation'];
const WC_CLAIM_EMPTY = { claim_no: '', employee_name: '', designation: '', monthly_wages: '', age: '', accident_date: '', injury_nature: '', body_part: '', disability_type: 'Temporary Total (TTD)', loss_pct: '', medical_expenses: '', status: 'Pending' };
const WC_DISABILITIES = ['Death', 'Permanent Total (PTD)', 'Permanent Partial (PPD)', 'Temporary Total (TTD)'];
const GPA_CLAIM_EMPTY = { claim_no: '', member_name: '', designation: '', csi: '', age: '', accident_date: '', injury_nature: '', disability_type: 'Accidental Death', loss_pct: '', weeks: '', medical_expenses: '', status: 'Pending' };
const GPA_DISABILITIES = ['Accidental Death', 'Permanent Total (PTD)', 'Permanent Partial (PPD)', 'Temporary Total (Weekly)'];
const GHI_CLAIM_EMPTY = { claim_no: '', patient_name: '', relationship: 'Self', hospital: '', ailment: '', admit_date: '', discharge_date: '', room_category: '', claim_mode: 'Cashless', tpa: '', claimed_amount: '', approved_amount: '', status: 'Pending' };
const GHI_RELATIONS = ['Self', 'Spouse', 'Son', 'Daughter', 'Father', 'Mother', 'Father-in-law', 'Mother-in-law'];
const FIRE_CLAIM_EMPTY = { claim_no: '', peril: 'Fire', loss_date: '', cause: '', affected_asset: '', estimated_loss: '', salvage: '', assessed_amount: '', surveyor: '', status: 'Pending' };
const FIRE_PERILS = ['Fire', 'Lightning', 'Explosion', 'Flood / Inundation (STFI)', 'Storm / Cyclone', 'Earthquake', 'Burglary / Theft', 'Riot & Strike', 'Impact Damage', 'Electrical / Machinery Breakdown'];
const MARINE_CLAIM_EMPTY = { claim_no: '', loss_type: 'Partial Loss', loss_date: '', place: '', cause: '', survey_ref: '', claimed_amount: '', assessed_amount: '', status: 'Pending' };
const MARINE_LOSS = ['Total Loss', 'Partial Loss', 'General Average', 'Shortage / Non-delivery', 'Damage in Transit'];
const LIAB_CLAIM_EMPTY = { claim_no: '', claimant: '', claim_nature: '', incident_date: '', alleged_amount: '', defense_costs: '', assessed_amount: '', status: 'Pending' };
const GTL_CLAIM_EMPTY = { claim_no: '', member_name: '', age: '', death_date: '', cause: 'Natural', nominee: '', sa: '', adb: 'No', status: 'Pending' };
const GTL_CAUSES = ['Natural', 'Illness', 'Accidental'];

// --- Claim Information + Claim Flow (the fields that apply to every claim,
// whatever the policy line). Category drives which claim-flow half applies:
// Corporate gets survey/reinspection/delivery, Personal gets mode of transfer
// and the required-documents list.
const CLAIM_CATEGORIES = ['Corporate', 'Personal'];
const CLAIM_STATUSES = ['Pending', 'Intimated', 'Documents Pending', 'Under Process',
  'Surveyor Appointed', 'Approved', 'Settled', 'Rejected', 'Closed'];
const CLAIM_POLICY_TYPES = ['Individual', 'Family Floater', 'Group', 'Corporate', 'Package (Comprehensive)',
  'Own Damage Only', 'Third Party Only', 'Other'];
const CLAIM_CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'AED'];
const TRANSFER_MODES = ['NEFT / RTGS', 'Cheque', 'UPI', 'Cash', 'Direct to Hospital'];
const EXTRA_EMPTY = {
  claim_title: '', claim_category: 'Corporate', policy_type: '', policy_no: '', vehicle_no: '',
  patient_name: '', doctor_name: '', hospital_name: '', admission_date: '', discharge_date: '',
  associates: '', owner: '', intimation_no: '', file_received_date: '', process_date: '', settlement_date: '',
  settlement_amount: '', deduction: '', currency: 'INR', exchange_rate: 1,
  approved_amount: '', approval_date: '', survey_date: '', surveyor_name: '',
  reinspection_date: '', reinspection_reason: '', delivery_location: '', delivery_date: '',
  pending_documents: '', required_documents: '', mode_of_transfer: '',
};

// Policy line detectors (order matters — checked WC → GPA → GHI → Fire → Marine → Liability → GTL → Motor).
const lineText = (p) => `${p.insurance_type || ''} ${p.product_name || ''}`;
const isWCpolicy = (p) => !!p && /workmen|compensation|\bw\.?c\.?\b/i.test(lineText(p));
const isGPApolicy = (p) => !!p && /personal accident|\bgpa\b|group personal/i.test(lineText(p));
const isGHIpolicy = (p) => !!p && /group health|mediclaim|\bghi\b/i.test(lineText(p));
const isHealthRpolicy = (p) => !!p && /health|mediclaim|floater|optima/i.test(lineText(p));
const isHomepolicy = (p) => !!p && /household|home|dwelling/i.test(lineText(p));
const isEngpolicy = (p) => !!p && /engineering|contractor|erection|\bcar\b|\bear\b|\bcpm\b|machinery breakdown|boiler/i.test(lineText(p));
const isFirepolicy = (p) => !!p && /\bfire\b|special peril|sfsp|standard fire|property/i.test(lineText(p));
const isMarinepolicy = (p) => !!p && /marine|cargo|transit/i.test(lineText(p));
const isLiabpolicy = (p) => !!p && /liabilit|indemnity|d&o|directors/i.test(lineText(p));
const isGTLpolicy = (p) => !!p && /group term|\bgtl\b/i.test(lineText(p));

// Group Term Life death benefit — SA, doubled for accidental death if ADB rider taken.
function gtlBenefit({ sa, cause, adb }) {
  const s = Number(sa) || 0;
  if (adb === 'Yes' && cause === 'Accidental') return { amount: s * 2, basis: 'Sum Assured + Accidental Death Benefit (2× SA)' };
  return { amount: s, basis: 'Sum Assured (death benefit)' };
}

// --- Employees' Compensation Act 1923 (Schedule IV relevant-factor + benefit rules) ---
const EC_FACTORS = [[16, 228.54], [20, 224.06], [25, 216.91], [30, 207.98], [35, 197.06], [40, 183.85], [45, 168.13], [50, 149.73], [55, 128.65], [60, 105.84], [65, 78.15]];
function ecFactor(age) {
  const a = Number(age) || 0;
  if (!a) return 207.98;
  if (a <= 16) return 228.54;
  if (a >= 65) return 78.15;
  for (let i = 0; i < EC_FACTORS.length - 1; i++) {
    const [a1, f1] = EC_FACTORS[i]; const [a2, f2] = EC_FACTORS[i + 1];
    if (a >= a1 && a <= a2) return f1 + (f2 - f1) * (a - a1) / (a2 - a1);
  }
  return 207.98;
}
function ecCompensation({ disability, monthlyWages, age, lossPct }) {
  const w = Number(monthlyWages) || 0;
  const capped = Math.min(w, 15000);
  const factor = ecFactor(age);
  if (disability.startsWith('Death')) { const amt = Math.max(0.5 * capped * factor, 120000); return { amount: Math.round(amt), basis: `50% × ₹${inr(capped)} (capped) × ${factor.toFixed(2)} age factor, min ₹1,20,000` }; }
  if (disability.startsWith('Permanent Total')) { const amt = Math.max(0.6 * capped * factor, 140000); return { amount: Math.round(amt), basis: `60% × ₹${inr(capped)} (capped) × ${factor.toFixed(2)} age factor, min ₹1,40,000` }; }
  if (disability.startsWith('Permanent Partial')) { const ptd = Math.max(0.6 * capped * factor, 140000); const amt = ptd * (Number(lossPct) || 0) / 100; return { amount: Math.round(amt), basis: `${Number(lossPct) || 0}% of PTD entitlement (₹${inr(ptd)})` }; }
  const fort = Math.round(0.25 * w); return { amount: fort, basis: '25% of monthly wage, payable per fortnight during the disablement' };
}

// --- Group Personal Accident benefit (as % of member's Capital Sum Insured) ---
function gpaBenefit({ disability, csi, lossPct, weeks }) {
  const c = Number(csi) || 0;
  if (disability.startsWith('Accidental Death')) return { amount: c, basis: '100% of Capital Sum Insured' };
  if (disability.startsWith('Permanent Total')) return { amount: c, basis: '100% of CSI (Permanent Total Disablement)' };
  if (disability.startsWith('Permanent Partial')) { const a = c * (Number(lossPct) || 0) / 100; return { amount: Math.round(a), basis: `${Number(lossPct) || 0}% of CSI per disability scale` }; }
  const wk = Number(weeks) || 0; const wb = Math.min(Math.round(0.01 * c), 5000);
  return { amount: wk * wb, basis: `1% of CSI capped ₹${inr(wb)}/week × ${wk} weeks (max 100 wk)` };
}

export default function Claims() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [show, setShow] = useState(false);
  const [flash, setFlash] = useState(() => new Set());

  const [reg, setReg] = useState('');
  const [fetching, setFetching] = useState(false);
  const [matches, setMatches] = useState([]);
  const [policy, setPolicy] = useState(null);
  const [mode, setMode] = useState('claim');
  const [claim, setClaim] = useState(CLAIM_EMPTY);
  const [wc, setWc] = useState(WC_CLAIM_EMPTY);
  const [gpa, setGpa] = useState(GPA_CLAIM_EMPTY);
  const [ghi, setGhi] = useState(GHI_CLAIM_EMPTY);
  const [fire, setFire] = useState(FIRE_CLAIM_EMPTY);
  const [marine, setMarine] = useState(MARINE_CLAIM_EMPTY);
  const [liab, setLiab] = useState(LIAB_CLAIM_EMPTY);
  const [gtl, setGtl] = useState(GTL_CLAIM_EMPTY);
  const [endo, setEndo] = useState(ENDO_EMPTY);
  const [extra, setExtra] = useState(EXTRA_EMPTY);
  const [users, setUsers] = useState([]);
  const [docs, setDocs] = useState([]);
  const [saving, setSaving] = useState(false);
  const [lossTypeOpts, setLossTypeOpts] = useState([]);
  const docRef = useRef(null);

  const isWC = isWCpolicy(policy);
  const isGPA = !isWC && isGPApolicy(policy);
  const isGHI = !isWC && !isGPA && isGHIpolicy(policy);
  const isHealthR = !isWC && !isGPA && !isGHI && isHealthRpolicy(policy);
  const isHome = !isWC && !isGPA && !isGHI && !isHealthR && isHomepolicy(policy);
  const isEng = !isWC && !isGPA && !isGHI && !isHealthR && !isHome && isEngpolicy(policy);
  const isFire = !isWC && !isGPA && !isGHI && !isHealthR && !isHome && !isEng && isFirepolicy(policy);
  const isMarine = !isWC && !isGPA && !isGHI && !isHealthR && !isHome && !isEng && !isFire && isMarinepolicy(policy);
  const isLiab = !isWC && !isGPA && !isGHI && !isHealthR && !isHome && !isEng && !isFire && !isMarine && isLiabpolicy(policy);
  const isGTL = !isWC && !isGPA && !isGHI && !isHealthR && !isHome && !isEng && !isFire && !isMarine && !isLiab && isGTLpolicy(policy);

  // Which conditional blocks the Claim Information section shows.
  const isPersonalClaim = extra.claim_category === 'Personal';
  const claimIsHealth = isPersonalClaim || isGHI || isHealthR;
  const claimIsMotor = !isPersonalClaim && !isWC && !isGPA && !isGHI && !isHealthR && !isHome && !isEng && !isFire && !isMarine && !isLiab && !isGTL;

  const comp = ecCompensation({ disability: wc.disability_type, monthlyWages: wc.monthly_wages, age: wc.age, lossPct: wc.loss_pct });
  const wcTotal = comp.amount + (Number(wc.medical_expenses) || 0);
  const gpaBen = gpaBenefit({ disability: gpa.disability_type, csi: gpa.csi, lossPct: gpa.loss_pct, weeks: gpa.weeks });
  const gpaTotal = gpaBen.amount + (Number(gpa.medical_expenses) || 0);
  const ghiTotal = Number(ghi.approved_amount) || Number(ghi.claimed_amount) || 0;
  const fireTotal = Number(fire.assessed_amount) || Math.max((Number(fire.estimated_loss) || 0) - (Number(fire.salvage) || 0), 0);
  const marineTotal = Number(marine.assessed_amount) || Number(marine.claimed_amount) || 0;
  const liabTotal = Number(liab.assessed_amount) || Number(liab.alleged_amount) || 0;
  const gtlBen = gtlBenefit({ sa: gtl.sa, cause: gtl.cause, adb: gtl.adb });

  function load() { setLoading(true); api('/claims').then(setRows).finally(() => setLoading(false)); }
  useEffect(() => {
    load();
    api('/lookups/claim-loss-type').then((l) => setLossTypeOpts(l.map((x) => x.name))).catch(() => {});
    api('/users').then((u) => setUsers(u.map((x) => x.full_name || x.username).filter(Boolean))).catch(() => {});
  }, []);
  async function addLossType(name) {
    await api('/lookups/claim-loss-type', { method: 'POST', body: { name } });
    setLossTypeOpts((o) => (o.includes(name) ? o : [...o, name].sort()));
  }

  function markFlash(id) {
    if (id == null) return;
    setFlash((s) => new Set(s).add(id));
    setTimeout(() => setFlash((s) => { const n = new Set(s); n.delete(id); return n; }), 1600);
  }
  useRealtime('claim', (evt) => {
    if (evt.action !== 'created') return;
    const c = evt.data;
    setRows((prev) => (prev.some((r) => r.id === c.id) ? prev.map((r) => (r.id === c.id ? c : r)) : [c, ...prev]));
    markFlash(c.id);
  });

  function onDoc(ev) {
    const files = Array.from(ev.target.files || []);
    if (!files.length) return;
    files.forEach((file) => {
      if (file.type !== 'application/pdf' && !file.type.startsWith('image/')) { toast.error(`${file.name}: upload a PDF or image`); return; }
      if (file.size > 5 * 1024 * 1024) { toast.error(`${file.name}: too large (max 5 MB)`); return; }
      const r = new FileReader();
      r.onload = () => setDocs((d) => [...d, { name: file.name, doc: r.result }]);
      r.readAsDataURL(file);
    });
    toast.success(files.length > 1 ? `${files.length} documents attached` : 'Document attached');
    if (docRef.current) docRef.current.value = '';
  }
  const removeDoc = (idx) => setDocs((d) => d.filter((_, j) => j !== idx));
  function viewDoc(uri) { if (!uri) return; fetch(uri).then((r) => r.blob()).then((b) => { const u = URL.createObjectURL(b); window.open(u, '_blank'); setTimeout(() => URL.revokeObjectURL(u), 60000); }).catch(() => toast.error('Could not open file')); }

  async function fetchPolicy() {
    const q = reg.trim();
    if (!q) { toast.error('Enter a registration or policy number'); return; }
    setFetching(true); setPolicy(null); setMatches([]);
    try {
      const [byReg, byPol, byName] = await Promise.all([
        api('/policies?reg=' + encodeURIComponent(q)).catch(() => []),
        api('/policies?policyNo=' + encodeURIComponent(q)).catch(() => []),
        api('/policies?name=' + encodeURIComponent(q)).catch(() => []),
      ]);
      const seen = new Set(); const list = [];
      for (const p of [...byReg, ...byPol, ...byName]) { if (!seen.has(p.id)) { seen.add(p.id); list.push(p); } }
      if (!list.length) { toast.error(`No policy found for “${q}”`); return; }
      list.sort((a, b) => String(b.period_to || '').localeCompare(String(a.period_to || '')));
      setMatches(list);
      setPolicy(list[0]);
      toast.success(list.length > 1 ? `${list.length} policies found` : `Policy found — ${list[0].insured_name}`);
    } catch (e) { toast.error(e.message || 'Lookup failed'); }
    finally { setFetching(false); }
  }

  function resetForm() { setReg(''); setMatches([]); setPolicy(null); setClaim(CLAIM_EMPTY); setWc(WC_CLAIM_EMPTY); setGpa(GPA_CLAIM_EMPTY); setGhi(GHI_CLAIM_EMPTY); setFire(FIRE_CLAIM_EMPTY); setMarine(MARINE_CLAIM_EMPTY); setLiab(LIAB_CLAIM_EMPTY); setGtl(GTL_CLAIM_EMPTY); setEndo(ENDO_EMPTY); setExtra(EXTRA_EMPTY); setDocs([]); setMode('claim'); setShow(false); }

  async function save() {
    if (!policy) { toast.error('Fetch a policy first'); return; }
    if (mode === 'claim' && !extra.claim_title.trim()) { toast.error('Claim Title is required'); return; }
    setSaving(true);
    try {
      const common = {
        client_name: policy.insured_name, company_name: policy.company_name,
        policy_id: policy.id, client_id: policy.client_id || null,
        documents: docs,
        // Shared Claim Information / Claim Flow fields ride along with every
        // line-specific branch below, so they're captured once here.
        ...extra,
        policy_no: extra.policy_no || policy.policy_number || '',
      };
      let body = null;
      if (mode === 'endorsement') {
        body = { policy_number: policy.policy_number, insured_name: policy.insured_name, company_name: policy.company_name, ...endo, premium_effect: Number(endo.premium_effect) || 0 };
        await api('/endorsements', { method: 'POST', body });
        toast.success('Endorsement recorded'); resetForm(); return;
      }
      if (isWC) {
        if (!wc.employee_name.trim()) { toast.error('Injured employee name is required'); setSaving(false); return; }
        const details = { employee_name: wc.employee_name, designation: wc.designation, monthly_wages: Number(wc.monthly_wages) || 0, age: Number(wc.age) || 0, accident_date: wc.accident_date, injury_nature: wc.injury_nature, body_part: wc.body_part, disability_type: wc.disability_type, loss_pct: Number(wc.loss_pct) || 0, medical_expenses: Number(wc.medical_expenses) || 0, compensation: comp.amount };
        body = { ...common, claim_no: wc.claim_no, claim_date: wc.accident_date, claim_amount: wcTotal, status: wc.status, claim_type: 'WC', details };
      } else if (isGPA) {
        if (!gpa.member_name.trim()) { toast.error('Member name is required'); setSaving(false); return; }
        const details = { member_name: gpa.member_name, designation: gpa.designation, csi: Number(gpa.csi) || 0, age: Number(gpa.age) || 0, accident_date: gpa.accident_date, injury_nature: gpa.injury_nature, disability_type: gpa.disability_type, loss_pct: Number(gpa.loss_pct) || 0, weeks: Number(gpa.weeks) || 0, medical_expenses: Number(gpa.medical_expenses) || 0, benefit: gpaBen.amount };
        body = { ...common, claim_no: gpa.claim_no, claim_date: gpa.accident_date, claim_amount: gpaTotal, status: gpa.status, claim_type: 'GPA', details };
      } else if (isGHI || isHealthR) {
        if (!ghi.patient_name.trim()) { toast.error('Patient name is required'); setSaving(false); return; }
        const details = { patient_name: ghi.patient_name, relationship: ghi.relationship, hospital: ghi.hospital, ailment: ghi.ailment, admit_date: ghi.admit_date, discharge_date: ghi.discharge_date, room_category: ghi.room_category, claim_mode: ghi.claim_mode, tpa: ghi.tpa, claimed_amount: Number(ghi.claimed_amount) || 0, approved_amount: Number(ghi.approved_amount) || 0 };
        body = { ...common, claim_no: ghi.claim_no, claim_date: ghi.admit_date, claim_amount: ghiTotal, status: ghi.status, claim_type: isHealthR ? 'Health' : 'GHI', details };
      } else if (isFire || isHome || isEng) {
        const details = { peril: fire.peril, cause: fire.cause, affected_asset: fire.affected_asset, estimated_loss: Number(fire.estimated_loss) || 0, salvage: Number(fire.salvage) || 0, assessed_amount: Number(fire.assessed_amount) || 0, surveyor: fire.surveyor };
        body = { ...common, claim_no: fire.claim_no, claim_date: fire.loss_date, claim_amount: fireTotal, status: fire.status, claim_type: isHome ? 'Home' : isEng ? 'Engineering' : 'Fire', details };
      } else if (isMarine) {
        const details = { loss_type: marine.loss_type, place: marine.place, cause: marine.cause, survey_ref: marine.survey_ref, claimed_amount: Number(marine.claimed_amount) || 0, assessed_amount: Number(marine.assessed_amount) || 0 };
        body = { ...common, claim_no: marine.claim_no, claim_date: marine.loss_date, claim_amount: marineTotal, status: marine.status, claim_type: 'Marine', details };
      } else if (isLiab) {
        if (!liab.claimant.trim()) { toast.error('Claimant name is required'); setSaving(false); return; }
        const details = { claimant: liab.claimant, claim_nature: liab.claim_nature, incident_date: liab.incident_date, alleged_amount: Number(liab.alleged_amount) || 0, defense_costs: Number(liab.defense_costs) || 0, assessed_amount: Number(liab.assessed_amount) || 0 };
        body = { ...common, claim_no: liab.claim_no, claim_date: liab.incident_date, claim_amount: liabTotal, status: liab.status, claim_type: 'Liability', details };
      } else if (isGTL) {
        if (!gtl.member_name.trim()) { toast.error('Member name is required'); setSaving(false); return; }
        const details = { member_name: gtl.member_name, age: Number(gtl.age) || 0, death_date: gtl.death_date, cause: gtl.cause, nominee: gtl.nominee, sa: Number(gtl.sa) || 0, adb: gtl.adb, benefit: gtlBen.amount };
        body = { ...common, claim_no: gtl.claim_no, claim_date: gtl.death_date, claim_amount: gtlBen.amount, status: gtl.status, claim_type: 'GTL', details };
      } else {
        body = { ...common, claim_no: claim.claim_no, claim_date: claim.claim_date, claim_amount: Number(claim.claim_amount) || 0, status: claim.status, claim_type: 'Motor', details: { loss_type: claim.loss_type } };
      }
      const { id } = await api('/claims', { method: 'POST', body });
      setRows((prev) => (prev.some((r) => r.id === id) ? prev : [{ id, ...body }, ...prev]));
      markFlash(id);
      toast.success('Claim registered');
      resetForm();
    } catch (e) { toast.error(e.message || 'Could not save'); }
    finally { setSaving(false); }
  }

  const setC = (k, v) => setClaim((c) => ({ ...c, [k]: v }));
  const setW = (k, v) => setWc((c) => ({ ...c, [k]: v }));
  const setG = (k, v) => setGpa((c) => ({ ...c, [k]: v }));
  const setH = (k, v) => setGhi((c) => ({ ...c, [k]: v }));
  const setFr = (k, v) => setFire((c) => ({ ...c, [k]: v }));
  const setMr = (k, v) => setMarine((c) => ({ ...c, [k]: v }));
  const setLb = (k, v) => setLiab((c) => ({ ...c, [k]: v }));
  const setGt = (k, v) => setGtl((c) => ({ ...c, [k]: v }));
  const setE = (k, v) => setEndo((c) => ({ ...c, [k]: v }));
  const setX = (k, v) => setExtra((c) => ({ ...c, [k]: v }));

  const lineBadge = isWC ? 'Workmen Compensation' : isGPA ? 'Group Personal Accident' : isGHI ? 'Group Health' : isHealthR ? 'Retail Health' : isHome ? 'Householder' : isEng ? 'Engineering' : isFire ? 'Fire & Property' : isMarine ? 'Marine Cargo' : isLiab ? 'Liability' : isGTL ? 'Group Term Life' : null;

  return (
    <div>
      <PageHeader
        title="Claim Register"
        action={<button className="btn blue" onClick={() => (show ? resetForm() : setShow(true))}>{show ? <><Ic name="x" size={15} /> Close</> : <><Ic name="plus" size={16} /> New Claim / Endorsement</>}</button>}
      />

      {show && (
        <div className="card card-pad" style={{ marginBottom: 22 }}>
          <div className="section-head">Fetch Policy</div>
          <div className="fetch-row">
            <div className="form-field" style={{ flex: 1, minWidth: 220 }}>
              <label>Registration / Policy Number <span className="req">*</span></label>
              <input value={reg} onChange={(e) => setReg(e.target.value.toUpperCase())} placeholder="e.g. GJ03NB2970 or GPA/2026/0450" onKeyDown={(e) => e.key === 'Enter' && fetchPolicy()} />
            </div>
            <button className="btn blue fetch-btn" onClick={fetchPolicy} disabled={fetching}>{fetching ? 'Fetching…' : <><Ic name="search" size={15} /> Fetch</>}</button>
          </div>

          {policy && (
            <>
              <div className="policy-found">
                <div className="pf-head"><Ic name="check" size={16} /> Policy found{matches.length > 1 ? ` — ${matches.length} policies` : ''}{lineBadge ? <span className="badge blue" style={{ marginLeft: 8 }}>{lineBadge}</span> : null}</div>
                {matches.length > 1 && (
                  <div className="form-field" style={{ marginBottom: 12 }}>
                    <label>Select policy</label>
                    <Select value={String(policy.id)} onChange={(e) => setPolicy(matches.find((m) => String(m.id) === e.target.value) || matches[0])}>
                      {matches.map((m) => <option key={m.id} value={String(m.id)}>{[m.company_name, m.product_name, m.policy_number].filter(Boolean).join(' · ')}</option>)}
                    </Select>
                  </div>
                )}
                <div className="pf-grid">
                  <div><span className="pf-k">Insured Name</span><span className="pf-v">{policy.insured_name}</span></div>
                  <div><span className="pf-k">Insurance Company</span><span className="pf-v">{policy.company_name || '—'}</span></div>
                  <div><span className="pf-k">Product</span><span className="pf-v">{policy.product_name || '—'}</span></div>
                  <div><span className="pf-k">Policy No</span><span className="pf-v">{policy.policy_number || '—'}</span></div>
                  <div><span className="pf-k">Type</span><span className="pf-v">{policy.insurance_type || policy.insurance_line}</span></div>
                  <div><span className="pf-k">Expiry</span><span className="pf-v">{policy.period_to || '—'}</span></div>
                  <div><span className="pf-k">Add-on Covers</span><span className="pf-v">{policy.addon_name || '—'}</span></div>
                </div>
              </div>

              <div className="tabs" style={{ marginTop: 18 }}>
                <button className={'tab' + (mode === 'claim' ? ' active' : '')} onClick={() => setMode('claim')}><Ic name="shieldcheck" size={15} /> Register Claim</button>
                <button className={'tab' + (mode === 'endorsement' ? ' active' : '')} onClick={() => setMode('endorsement')}><Ic name="edit" size={15} /> Add Endorsement</button>
              </div>

              {/* ---- Claim Information: applies to every claim, whatever the line ---- */}
              {mode === 'claim' && (
                <div style={{ marginTop: 18 }}>
                  <div className="section-head">Claim Information</div>
                  <div className="form-grid">
                    <div className="form-field"><label>Claim Title <span className="req">*</span></label>
                      <input value={extra.claim_title} onChange={(e) => setX('claim_title', e.target.value)} placeholder="Short description of the claim" /></div>
                    <div className="form-field"><label>Claim Category</label>
                      <Select value={extra.claim_category} onChange={(e) => setX('claim_category', e.target.value)}>
                        {CLAIM_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                      </Select></div>
                    <div className="form-field"><label>Policy Type</label>
                      <Select value={extra.policy_type} onChange={(e) => setX('policy_type', e.target.value)}>
                        <option value="">Select...</option>
                        {CLAIM_POLICY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                      </Select></div>

                    <div className="form-field"><label>Insured Name</label>
                      <input value={policy.insured_name || ''} readOnly /></div>
                    <div className="form-field"><label>Policy No</label>
                      <input value={extra.policy_no || policy.policy_number || ''} onChange={(e) => setX('policy_no', e.target.value)} /></div>
                    <div className="form-field"><label>Company Name</label>
                      <input value={policy.company_name || ''} readOnly /></div>

                    <div className="form-field"><label>Claim Intimation No</label>
                      <input value={extra.intimation_no} onChange={(e) => setX('intimation_no', e.target.value)} /></div>
                    <div className="form-field"><label>Associates</label>
                      <input value={extra.associates} onChange={(e) => setX('associates', e.target.value)} /></div>
                    <div className="form-field"><label>Claim Owner</label>
                      <Select value={extra.owner} onChange={(e) => setX('owner', e.target.value)}>
                        <option value="">Me</option>
                        {users.map((u) => <option key={u} value={u}>{u}</option>)}
                      </Select></div>

                    {/* Vehicle only matters on a motor claim. */}
                    {claimIsMotor && (
                      <div className="form-field"><label>Vehicle No</label>
                        <input value={extra.vehicle_no} onChange={(e) => setX('vehicle_no', e.target.value.toUpperCase())} placeholder={policy.reg_no || 'GJ01 AB 1234'} /></div>
                    )}

                    {/* Patient / hospital block for health-shaped claims. */}
                    {claimIsHealth && (
                      <>
                        <div className="form-field"><label>Patient Name</label>
                          <input value={extra.patient_name} onChange={(e) => setX('patient_name', e.target.value)} /></div>
                        <div className="form-field"><label>Doctor Name</label>
                          <input value={extra.doctor_name} onChange={(e) => setX('doctor_name', e.target.value)} /></div>
                        <div className="form-field"><label>Hospital Name</label>
                          <input value={extra.hospital_name} onChange={(e) => setX('hospital_name', e.target.value)} /></div>
                        <div className="form-field"><label>Date of Admission</label>
                          <DateField value={extra.admission_date} onChange={(e) => setX('admission_date', e.target.value)} /></div>
                        <div className="form-field"><label>Discharge Date</label>
                          <DateField value={extra.discharge_date} onChange={(e) => setX('discharge_date', e.target.value)} /></div>
                        <div className="form-field" />
                      </>
                    )}
                  </div>

                  <div className="section-head" style={{ marginTop: 18 }}>Dates &amp; Amounts</div>
                  <div className="form-grid">
                    <div className="form-field"><label>File Received Date</label>
                      <DateField value={extra.file_received_date} onChange={(e) => setX('file_received_date', e.target.value)} /></div>
                    <div className="form-field"><label>Process Date</label>
                      <DateField value={extra.process_date} onChange={(e) => setX('process_date', e.target.value)} /></div>
                    <div className="form-field"><label>Settlement Date</label>
                      <DateField value={extra.settlement_date} onChange={(e) => setX('settlement_date', e.target.value)} /></div>

                    <div className="form-field"><label>Settlement Amount</label>
                      <input type="number" value={extra.settlement_amount} onChange={(e) => setX('settlement_amount', e.target.value)} placeholder="0" /></div>
                    <div className="form-field"><label>Deduction</label>
                      <input type="number" value={extra.deduction} onChange={(e) => setX('deduction', e.target.value)} placeholder="0" /></div>
                    <div className="form-field" />

                    <div className="form-field"><label>Currency</label>
                      <Select value={extra.currency} onChange={(e) => setX('currency', e.target.value)}>
                        {CLAIM_CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
                      </Select></div>
                    <div className="form-field"><label>Exchange Rate</label>
                      <input type="number" step="0.0001" value={extra.currency === 'INR' ? 1 : extra.exchange_rate}
                        onChange={(e) => setX('exchange_rate', e.target.value)} disabled={extra.currency === 'INR'} />
                      {extra.currency === 'INR' && <div className="hint-line">Fixed at 1 for INR.</div>}
                    </div>
                    <div className="form-field" />
                  </div>

                  <div className="section-head" style={{ marginTop: 18 }}>Claim Flow Required Details</div>
                  <div className="form-grid">
                    <div className="form-field"><label>Approved Amount</label>
                      <input type="number" value={extra.approved_amount} onChange={(e) => setX('approved_amount', e.target.value)} placeholder="0" /></div>
                    <div className="form-field"><label>Approval Date</label>
                      <DateField value={extra.approval_date} onChange={(e) => setX('approval_date', e.target.value)} /></div>
                    <div className="form-field" />

                    {/* Survey / reinspection / delivery is the corporate flow. */}
                    {!isPersonalClaim && (
                      <>
                        <div className="form-field"><label>Survey Date</label>
                          <DateField value={extra.survey_date} onChange={(e) => setX('survey_date', e.target.value)} /></div>
                        <div className="form-field"><label>Surveyor Name</label>
                          <input value={extra.surveyor_name} onChange={(e) => setX('surveyor_name', e.target.value)} /></div>
                        <div className="form-field"><label>Reinspection Date</label>
                          <DateField value={extra.reinspection_date} onChange={(e) => setX('reinspection_date', e.target.value)} /></div>
                        <div className="form-field"><label>Delivery Location</label>
                          <input value={extra.delivery_location} onChange={(e) => setX('delivery_location', e.target.value)} /></div>
                        <div className="form-field"><label>Delivery Date</label>
                          <DateField value={extra.delivery_date} onChange={(e) => setX('delivery_date', e.target.value)} /></div>
                        <div className="form-field" />
                      </>
                    )}

                    {/* Payout routing is the personal flow. */}
                    {isPersonalClaim && (
                      <div className="form-field"><label>Mode of Transfer</label>
                        <Select value={extra.mode_of_transfer} onChange={(e) => setX('mode_of_transfer', e.target.value)}>
                          <option value="">Select...</option>
                          {TRANSFER_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
                        </Select></div>
                    )}
                  </div>

                  <div className="form-grid" style={{ marginTop: 12 }}>
                    <div className="form-field" style={{ gridColumn: 'span 2' }}><label>Pending Documents List</label>
                      <textarea rows={2} value={extra.pending_documents} onChange={(e) => setX('pending_documents', e.target.value)} placeholder="Still awaited from the client or insurer" /></div>
                    {!isPersonalClaim ? (
                      <div className="form-field"><label>Reinspection Reason</label>
                        <textarea rows={2} value={extra.reinspection_reason} onChange={(e) => setX('reinspection_reason', e.target.value)} /></div>
                    ) : (
                      <div className="form-field"><label>Required Claim Documents</label>
                        <textarea rows={2} value={extra.required_documents} onChange={(e) => setX('required_documents', e.target.value)} /></div>
                    )}
                  </div>
                </div>
              )}

              {mode === 'claim' && isWC ? (
                <>
                  <div className="section-head">Injured Employee</div>
                  <div className="form-grid">
                    <div className="form-field"><label>Employee Name <span className="req">*</span></label><input value={wc.employee_name} onChange={(e) => setW('employee_name', e.target.value)} /></div>
                    <div className="form-field"><label>Designation / Category</label><input value={wc.designation} onChange={(e) => setW('designation', e.target.value)} placeholder="e.g. Welder (Skilled)" /></div>
                    <div className="form-field"><label>Monthly Wages (₹)</label><input type="number" value={wc.monthly_wages} onChange={(e) => setW('monthly_wages', e.target.value)} /></div>
                    <div className="form-field"><label>Age (years)</label><input type="number" value={wc.age} onChange={(e) => setW('age', e.target.value)} /></div>
                    <div className="form-field"><label>Claim No</label><input value={wc.claim_no} onChange={(e) => setW('claim_no', e.target.value)} /></div>
                  </div>
                  <div className="section-head">Accident &amp; Injury</div>
                  <div className="form-grid">
                    <div className="form-field"><label>Date of Accident</label><DateField value={wc.accident_date} onChange={(e) => setW('accident_date', e.target.value)} /></div>
                    <div className="form-field"><label>Nature of Injury</label><input value={wc.injury_nature} onChange={(e) => setW('injury_nature', e.target.value)} placeholder="e.g. Fracture, burn, amputation" /></div>
                    <div className="form-field"><label>Part of Body</label><input value={wc.body_part} onChange={(e) => setW('body_part', e.target.value)} /></div>
                    <div className="form-field"><label>Disability Type</label><Select value={wc.disability_type} onChange={(e) => setW('disability_type', e.target.value)}>{WC_DISABILITIES.map((t) => <option key={t} value={t}>{t}</option>)}</Select></div>
                    {wc.disability_type.startsWith('Permanent Partial') && (
                      <div className="form-field"><label>% Loss of Earning Capacity</label><input type="number" value={wc.loss_pct} onChange={(e) => setW('loss_pct', e.target.value)} placeholder="e.g. 40" /></div>
                    )}
                    <div className="form-field"><label>Medical Expenses (₹)</label><input type="number" value={wc.medical_expenses} onChange={(e) => setW('medical_expenses', e.target.value)} /></div>
                    <div className="form-field"><label>Status</label><Select value={wc.status} onChange={(e) => setW('status', e.target.value)}><option>Pending</option><option>Under Investigation</option><option>Filed with Commissioner</option><option>Settled</option><option>Rejected</option></Select></div>
                  </div>
                  <div className="ec-calc">
                    <div className="ec-head"><Ic name="rupee" size={15} /> Estimated Compensation — Employees' Compensation Act, 1923</div>
                    <div className="ec-grid">
                      <div><span className="ec-k">Statutory Compensation</span><span className="ec-v">₹ {inr(comp.amount)}</span></div>
                      <div><span className="ec-k">+ Medical Expenses</span><span className="ec-v">₹ {inr(wc.medical_expenses)}</span></div>
                      <div><span className="ec-k">Total Claim Value</span><span className="ec-v ec-total">₹ {inr(wcTotal)}</span></div>
                    </div>
                    <div className="ec-basis"><Ic name="alert" size={12} /> {comp.basis}. Indicative estimate — final award is determined by the Commissioner for Employees' Compensation.</div>
                  </div>
                </>
              ) : mode === 'claim' && isGPA ? (
                <>
                  <div className="section-head">Insured Member</div>
                  <div className="form-grid">
                    <div className="form-field"><label>Member Name <span className="req">*</span></label><input value={gpa.member_name} onChange={(e) => setG('member_name', e.target.value)} /></div>
                    <div className="form-field"><label>Designation / Cadre</label><input value={gpa.designation} onChange={(e) => setG('designation', e.target.value)} /></div>
                    <div className="form-field"><label>Member CSI (₹)</label><input type="number" value={gpa.csi} onChange={(e) => setG('csi', e.target.value)} placeholder="Capital Sum Insured" /></div>
                    <div className="form-field"><label>Age (years)</label><input type="number" value={gpa.age} onChange={(e) => setG('age', e.target.value)} /></div>
                    <div className="form-field"><label>Claim No</label><input value={gpa.claim_no} onChange={(e) => setG('claim_no', e.target.value)} /></div>
                  </div>
                  <div className="section-head">Accident &amp; Injury</div>
                  <div className="form-grid">
                    <div className="form-field"><label>Date of Accident</label><DateField value={gpa.accident_date} onChange={(e) => setG('accident_date', e.target.value)} /></div>
                    <div className="form-field"><label>Nature of Injury</label><input value={gpa.injury_nature} onChange={(e) => setG('injury_nature', e.target.value)} placeholder="e.g. Road accident, fall" /></div>
                    <div className="form-field"><label>Disablement Type</label><Select value={gpa.disability_type} onChange={(e) => setG('disability_type', e.target.value)}>{GPA_DISABILITIES.map((t) => <option key={t} value={t}>{t}</option>)}</Select></div>
                    {gpa.disability_type.startsWith('Permanent Partial') && (
                      <div className="form-field"><label>% as per Disability Scale</label><input type="number" value={gpa.loss_pct} onChange={(e) => setG('loss_pct', e.target.value)} placeholder="e.g. 30" /></div>
                    )}
                    {gpa.disability_type.startsWith('Temporary Total') && (
                      <div className="form-field"><label>No. of Weeks</label><input type="number" value={gpa.weeks} onChange={(e) => setG('weeks', e.target.value)} placeholder="max 100" /></div>
                    )}
                    <div className="form-field"><label>Medical Expenses (₹)</label><input type="number" value={gpa.medical_expenses} onChange={(e) => setG('medical_expenses', e.target.value)} /></div>
                    <div className="form-field"><label>Status</label><Select value={gpa.status} onChange={(e) => setG('status', e.target.value)}><option>Pending</option><option>Under Investigation</option><option>Approved</option><option>Settled</option><option>Rejected</option></Select></div>
                  </div>
                  <div className="ec-calc">
                    <div className="ec-head"><Ic name="rupee" size={15} /> Estimated Benefit — Group Personal Accident</div>
                    <div className="ec-grid">
                      <div><span className="ec-k">Benefit Payable</span><span className="ec-v">₹ {inr(gpaBen.amount)}</span></div>
                      <div><span className="ec-k">+ Medical Expenses</span><span className="ec-v">₹ {inr(gpa.medical_expenses)}</span></div>
                      <div><span className="ec-k">Total Claim Value</span><span className="ec-v ec-total">₹ {inr(gpaTotal)}</span></div>
                    </div>
                    <div className="ec-basis"><Ic name="alert" size={12} /> {gpaBen.basis}. Subject to policy terms, capital sum insured and disability scale.</div>
                  </div>
                </>
              ) : mode === 'claim' && (isGHI || isHealthR) ? (
                <>
                  <div className="section-head">Patient</div>
                  <div className="form-grid">
                    <div className="form-field"><label>Patient Name <span className="req">*</span></label><input value={ghi.patient_name} onChange={(e) => setH('patient_name', e.target.value)} /></div>
                    <div className="form-field"><label>Relationship</label><Select value={ghi.relationship} onChange={(e) => setH('relationship', e.target.value)}>{GHI_RELATIONS.map((t) => <option key={t} value={t}>{t}</option>)}</Select></div>
                    <div className="form-field"><label>Claim No</label><input value={ghi.claim_no} onChange={(e) => setH('claim_no', e.target.value)} /></div>
                  </div>
                  <div className="section-head">Hospitalisation</div>
                  <div className="form-grid">
                    <div className="form-field"><label>Hospital</label><input value={ghi.hospital} onChange={(e) => setH('hospital', e.target.value)} /></div>
                    <div className="form-field"><label>Ailment / Diagnosis</label><input value={ghi.ailment} onChange={(e) => setH('ailment', e.target.value)} /></div>
                    <div className="form-field"><label>Room Category</label><input value={ghi.room_category} onChange={(e) => setH('room_category', e.target.value)} placeholder="e.g. Single Private AC" /></div>
                    <div className="form-field"><label>Admission Date</label><DateField value={ghi.admit_date} onChange={(e) => setH('admit_date', e.target.value)} /></div>
                    <div className="form-field"><label>Discharge Date</label><DateField value={ghi.discharge_date} onChange={(e) => setH('discharge_date', e.target.value)} /></div>
                    <div className="form-field"><label>Claim Mode</label><Select value={ghi.claim_mode} onChange={(e) => setH('claim_mode', e.target.value)}><option>Cashless</option><option>Reimbursement</option></Select></div>
                    <div className="form-field"><label>TPA</label><input value={ghi.tpa} onChange={(e) => setH('tpa', e.target.value)} placeholder="e.g. MDIndia, Medi Assist" /></div>
                  </div>
                  <div className="section-head">Amounts</div>
                  <div className="form-grid">
                    <div className="form-field"><label>Claimed Amount (₹)</label><input type="number" value={ghi.claimed_amount} onChange={(e) => setH('claimed_amount', e.target.value)} /></div>
                    <div className="form-field"><label>Approved Amount (₹)</label><input type="number" value={ghi.approved_amount} onChange={(e) => setH('approved_amount', e.target.value)} placeholder="after co-pay / deductions" /></div>
                    <div className="form-field"><label>Status</label><Select value={ghi.status} onChange={(e) => setH('status', e.target.value)}><option>Pending</option><option>Under Query</option><option>Approved</option><option>Settled</option><option>Rejected</option></Select></div>
                  </div>
                  <div className="ec-calc">
                    <div className="ec-head"><Ic name="rupee" size={15} /> Claim Value — {isHealthR ? 'Retail Health' : 'Group Mediclaim'}</div>
                    <div className="ec-grid">
                      <div><span className="ec-k">Claimed</span><span className="ec-v">₹ {inr(ghi.claimed_amount)}</span></div>
                      <div><span className="ec-k">Approved</span><span className="ec-v">₹ {inr(ghi.approved_amount)}</span></div>
                      <div><span className="ec-k">Payable</span><span className="ec-v ec-total">₹ {inr(ghiTotal)}</span></div>
                    </div>
                    <div className="ec-basis"><Ic name="alert" size={12} /> Payable = approved amount (net of co-pay / room-rent deductions), else claimed amount pending assessment.</div>
                  </div>
                </>
              ) : mode === 'claim' && (isFire || isHome || isEng) ? (
                <>
                  <div className="section-head">Loss Details</div>
                  <div className="form-grid">
                    <div className="form-field"><label>Peril</label><Select value={fire.peril} onChange={(e) => setFr('peril', e.target.value)}>{FIRE_PERILS.map((t) => <option key={t} value={t}>{t}</option>)}</Select></div>
                    <div className="form-field"><label>Date of Loss</label><DateField value={fire.loss_date} onChange={(e) => setFr('loss_date', e.target.value)} /></div>
                    <div className="form-field"><label>Affected Asset</label><input value={fire.affected_asset} onChange={(e) => setFr('affected_asset', e.target.value)} placeholder="e.g. Stock in godown" /></div>
                    <div className="form-field" style={{ gridColumn: 'span 2' }}><label>Cause / Circumstances</label><input value={fire.cause} onChange={(e) => setFr('cause', e.target.value)} /></div>
                    <div className="form-field"><label>Claim No</label><input value={fire.claim_no} onChange={(e) => setFr('claim_no', e.target.value)} /></div>
                  </div>
                  <div className="section-head">Assessment</div>
                  <div className="form-grid">
                    <div className="form-field"><label>Estimated Loss (₹)</label><input type="number" value={fire.estimated_loss} onChange={(e) => setFr('estimated_loss', e.target.value)} /></div>
                    <div className="form-field"><label>Salvage Value (₹)</label><input type="number" value={fire.salvage} onChange={(e) => setFr('salvage', e.target.value)} /></div>
                    <div className="form-field"><label>Assessed / Approved (₹)</label><input type="number" value={fire.assessed_amount} onChange={(e) => setFr('assessed_amount', e.target.value)} placeholder="surveyor assessed" /></div>
                    <div className="form-field"><label>Surveyor</label><input value={fire.surveyor} onChange={(e) => setFr('surveyor', e.target.value)} /></div>
                    <div className="form-field"><label>Status</label><Select value={fire.status} onChange={(e) => setFr('status', e.target.value)}><option>Pending</option><option>Surveyor Appointed</option><option>Under Assessment</option><option>Approved</option><option>Settled</option><option>Rejected</option></Select></div>
                  </div>
                  <div className="ec-calc">
                    <div className="ec-head"><Ic name="rupee" size={15} /> Claim Value — {isHome ? "Householder's" : isEng ? 'Engineering' : 'Fire & Property'}</div>
                    <div className="ec-grid">
                      <div><span className="ec-k">Estimated less Salvage</span><span className="ec-v">₹ {inr(Math.max((Number(fire.estimated_loss) || 0) - (Number(fire.salvage) || 0), 0))}</span></div>
                      <div><span className="ec-k">Surveyor Assessed</span><span className="ec-v">₹ {inr(fire.assessed_amount)}</span></div>
                      <div><span className="ec-k">Payable</span><span className="ec-v ec-total">₹ {inr(fireTotal)}</span></div>
                    </div>
                    <div className="ec-basis"><Ic name="alert" size={12} /> Payable = surveyor-assessed amount, else estimated loss net of salvage. Subject to sum insured &amp; policy terms.</div>
                  </div>
                </>
              ) : mode === 'claim' && isMarine ? (
                <>
                  <div className="section-head">Loss Details</div>
                  <div className="form-grid">
                    <div className="form-field"><label>Loss Type</label><Select value={marine.loss_type} onChange={(e) => setMr('loss_type', e.target.value)}>{MARINE_LOSS.map((t) => <option key={t} value={t}>{t}</option>)}</Select></div>
                    <div className="form-field"><label>Date of Loss</label><DateField value={marine.loss_date} onChange={(e) => setMr('loss_date', e.target.value)} /></div>
                    <div className="form-field"><label>Place of Loss</label><input value={marine.place} onChange={(e) => setMr('place', e.target.value)} /></div>
                    <div className="form-field" style={{ gridColumn: 'span 2' }}><label>Cause</label><input value={marine.cause} onChange={(e) => setMr('cause', e.target.value)} placeholder="e.g. Breakage / water damage in transit" /></div>
                    <div className="form-field"><label>Survey Reference</label><input value={marine.survey_ref} onChange={(e) => setMr('survey_ref', e.target.value)} /></div>
                    <div className="form-field"><label>Claim No</label><input value={marine.claim_no} onChange={(e) => setMr('claim_no', e.target.value)} /></div>
                  </div>
                  <div className="section-head">Amounts</div>
                  <div className="form-grid">
                    <div className="form-field"><label>Claimed Amount (₹)</label><input type="number" value={marine.claimed_amount} onChange={(e) => setMr('claimed_amount', e.target.value)} /></div>
                    <div className="form-field"><label>Assessed Amount (₹)</label><input type="number" value={marine.assessed_amount} onChange={(e) => setMr('assessed_amount', e.target.value)} /></div>
                    <div className="form-field"><label>Status</label><Select value={marine.status} onChange={(e) => setMr('status', e.target.value)}><option>Pending</option><option>Survey Done</option><option>Under Assessment</option><option>Approved</option><option>Settled</option><option>Rejected</option></Select></div>
                  </div>
                  <div className="ec-calc">
                    <div className="ec-head"><Ic name="rupee" size={15} /> Claim Value — Marine Cargo</div>
                    <div className="ec-grid">
                      <div><span className="ec-k">Claimed</span><span className="ec-v">₹ {inr(marine.claimed_amount)}</span></div>
                      <div><span className="ec-k">Assessed</span><span className="ec-v">₹ {inr(marine.assessed_amount)}</span></div>
                      <div><span className="ec-k">Payable</span><span className="ec-v ec-total">₹ {inr(marineTotal)}</span></div>
                    </div>
                    <div className="ec-basis"><Ic name="alert" size={12} /> Payable = surveyor-assessed amount, else claimed amount pending assessment. Subject to sum insured &amp; cover basis.</div>
                  </div>
                </>
              ) : mode === 'claim' && isLiab ? (
                <>
                  <div className="section-head">Third-Party Claim</div>
                  <div className="form-grid">
                    <div className="form-field"><label>Claimant (Third Party) <span className="req">*</span></label><input value={liab.claimant} onChange={(e) => setLb('claimant', e.target.value)} /></div>
                    <div className="form-field" style={{ gridColumn: 'span 2' }}><label>Nature of Claim</label><input value={liab.claim_nature} onChange={(e) => setLb('claim_nature', e.target.value)} placeholder="e.g. Bodily injury, property damage, negligence" /></div>
                    <div className="form-field"><label>Date of Incident</label><DateField value={liab.incident_date} onChange={(e) => setLb('incident_date', e.target.value)} /></div>
                    <div className="form-field"><label>Claim No</label><input value={liab.claim_no} onChange={(e) => setLb('claim_no', e.target.value)} /></div>
                  </div>
                  <div className="section-head">Amounts</div>
                  <div className="form-grid">
                    <div className="form-field"><label>Alleged / Claimed Amount (₹)</label><input type="number" value={liab.alleged_amount} onChange={(e) => setLb('alleged_amount', e.target.value)} /></div>
                    <div className="form-field"><label>Defense Costs (₹)</label><input type="number" value={liab.defense_costs} onChange={(e) => setLb('defense_costs', e.target.value)} /></div>
                    <div className="form-field"><label>Assessed / Reserve (₹)</label><input type="number" value={liab.assessed_amount} onChange={(e) => setLb('assessed_amount', e.target.value)} /></div>
                    <div className="form-field"><label>Status</label><Select value={liab.status} onChange={(e) => setLb('status', e.target.value)}><option>Pending</option><option>Notified to Insurer</option><option>Under Defense</option><option>Reserved</option><option>Settled</option><option>Rejected</option></Select></div>
                  </div>
                  <div className="ec-calc">
                    <div className="ec-head"><Ic name="rupee" size={15} /> Claim Value — Liability</div>
                    <div className="ec-grid">
                      <div><span className="ec-k">Alleged / Claimed</span><span className="ec-v">₹ {inr(liab.alleged_amount)}</span></div>
                      <div><span className="ec-k">Assessed / Reserve</span><span className="ec-v">₹ {inr(liab.assessed_amount)}</span></div>
                      <div><span className="ec-k">Payable</span><span className="ec-v ec-total">₹ {inr(liabTotal)}</span></div>
                    </div>
                    <div className="ec-basis"><Ic name="alert" size={12} /> Payable = assessed / reserved amount, else alleged claim pending defense. Capped at the limit of indemnity (AOA / AOY).</div>
                  </div>
                </>
              ) : mode === 'claim' && isGTL ? (
                <>
                  <div className="section-head">Deceased Member</div>
                  <div className="form-grid">
                    <div className="form-field"><label>Member Name <span className="req">*</span></label><input value={gtl.member_name} onChange={(e) => setGt('member_name', e.target.value)} /></div>
                    <div className="form-field"><label>Age (years)</label><input type="number" value={gtl.age} onChange={(e) => setGt('age', e.target.value)} /></div>
                    <div className="form-field"><label>Sum Assured (₹)</label><input type="number" value={gtl.sa} onChange={(e) => setGt('sa', e.target.value)} /></div>
                    <div className="form-field"><label>Nominee</label><input value={gtl.nominee} onChange={(e) => setGt('nominee', e.target.value)} /></div>
                    <div className="form-field"><label>Claim No</label><input value={gtl.claim_no} onChange={(e) => setGt('claim_no', e.target.value)} /></div>
                  </div>
                  <div className="section-head">Death Details</div>
                  <div className="form-grid">
                    <div className="form-field"><label>Date of Death</label><DateField value={gtl.death_date} onChange={(e) => setGt('death_date', e.target.value)} /></div>
                    <div className="form-field"><label>Cause of Death</label><Select value={gtl.cause} onChange={(e) => setGt('cause', e.target.value)}>{GTL_CAUSES.map((t) => <option key={t} value={t}>{t}</option>)}</Select></div>
                    <div className="form-field"><label>ADB Rider Taken</label><Select value={gtl.adb} onChange={(e) => setGt('adb', e.target.value)}><option>No</option><option>Yes</option></Select></div>
                    <div className="form-field"><label>Status</label><Select value={gtl.status} onChange={(e) => setGt('status', e.target.value)}><option>Pending</option><option>Documents Awaited</option><option>Under Assessment</option><option>Approved</option><option>Settled</option><option>Rejected</option></Select></div>
                  </div>
                  <div className="ec-calc">
                    <div className="ec-head"><Ic name="rupee" size={15} /> Death Benefit — Group Term Life</div>
                    <div className="ec-grid">
                      <div><span className="ec-k">Sum Assured</span><span className="ec-v">₹ {inr(gtl.sa)}</span></div>
                      <div><span className="ec-k">Accidental Bonus (ADB)</span><span className="ec-v">₹ {inr(gtlBen.amount - (Number(gtl.sa) || 0))}</span></div>
                      <div><span className="ec-k">Benefit Payable</span><span className="ec-v ec-total">₹ {inr(gtlBen.amount)}</span></div>
                    </div>
                    <div className="ec-basis"><Ic name="alert" size={12} /> {gtlBen.basis}. Subject to free cover limit &amp; policy terms.</div>
                  </div>
                </>
              ) : mode === 'claim' ? (
                <>
                  <div className="section-head">Loss Details</div>
                  <div className="form-grid">
                    <div className="form-field"><label>Loss Type</label>
                      <SearchSelect value={claim.loss_type} onChange={(v) => setC('loss_type', v)} options={lossTypeOpts.length ? lossTypeOpts : ['Motor', 'Non-Motor']} onAdd={addLossType} placeholder="Select loss type" />
                    </div>
                  </div>
                  <div className="form-grid">
                    <div className="form-field"><label>Claim No</label><input value={claim.claim_no} onChange={(e) => setC('claim_no', e.target.value)} /></div>
                    <div className="form-field"><label>Claim Date</label><DateField value={claim.claim_date} onChange={(e) => setC('claim_date', e.target.value)} /></div>
                    <div className="form-field"><label>Claim Amount (₹)</label><input type="number" value={claim.claim_amount} onChange={(e) => setC('claim_amount', e.target.value)} /></div>
                    <div className="form-field"><label>Status</label><Select value={claim.status} onChange={(e) => setC('status', e.target.value)}><option>Pending</option><option>Settled</option><option>Rejected</option><option>Withdrawn</option></Select></div>
                  </div>
                </>
              ) : (
                <div className="form-grid">
                  <div className="form-field"><label>Endorsement No</label><input value={endo.endorsement_no} onChange={(e) => setE('endorsement_no', e.target.value)} /></div>
                  <div className="form-field"><label>Endorsement Type</label><Select value={endo.endorsement_type} onChange={(e) => setE('endorsement_type', e.target.value)}>{ENDO_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</Select></div>
                  <div className="form-field"><label>Endorsement Date</label><DateField value={endo.endorsement_date} onChange={(e) => setE('endorsement_date', e.target.value)} /></div>
                  <div className="form-field"><label>Premium Effect (₹)</label><input type="number" value={endo.premium_effect} onChange={(e) => setE('premium_effect', e.target.value)} /></div>
                  <div className="form-field" style={{ gridColumn: 'span 2' }}><label>Remarks</label><input value={endo.remarks} onChange={(e) => setE('remarks', e.target.value)} /></div>
                </div>
              )}

              {mode === 'claim' && (
                <div className="other-docs" style={{ marginTop: 16 }}>
                  <div className="od-head">
                    <span className="da-label">Claim Documents <span className="od-sub">{isWC ? '(FIR, medical report, wage proof, disability certificate…)' : isGPA ? '(FIR, medical report, disability certificate, ID proof…)' : (isGHI || isHealthR) ? '(discharge summary, bills, investigation reports, ID…)' : isHome ? '(surveyor report, photos, FIR (theft), bills…)' : isEng ? '(surveyor report, photos, incident report, estimates…)' : isFire ? '(surveyor report, photos, fire brigade report, bills…)' : isMarine ? '(survey report, invoice, LR / BL, packing list…)' : isLiab ? '(legal notice, correspondence, court papers…)' : isGTL ? '(death certificate, nominee KYC, claim form…)' : '(FIR, estimate, photos, bills, discharge voucher…)'}</span></span>
                    <button type="button" className="btn ghost da-btn" onClick={() => docRef.current && docRef.current.click()}><Ic name="upload" size={14} /> Add documents</button>
                  </div>
                  {docs.length > 0 && (
                    <div className="od-list">
                      {docs.map((d, k) => (
                        <span className="da-file" key={k}><Ic name="file" size={14} /><button type="button" className="dt-link" onClick={() => viewDoc(d.doc)}>{d.name}</button><button type="button" className="action-btn danger" title="Remove" onClick={() => removeDoc(k)}><Ic name="x" size={12} /></button></span>
                      ))}
                    </div>
                  )}
                  <input ref={docRef} type="file" accept="application/pdf,image/*" multiple hidden onChange={onDoc} />
                </div>
              )}

              <div className="btn-row">
                <button className="btn blue" onClick={save} disabled={saving}>{saving ? 'Saving…' : mode === 'claim' ? 'Save Claim' : 'Save Endorsement'}</button>
                <button className="btn ghost" onClick={resetForm}>Cancel</button>
              </div>
            </>
          )}
        </div>
      )}

      <div className="card">
        <DataTable
          title={<>Claims <span className="sub">({rows.length})</span></>}
          searchPlaceholder="Search claims…"
          index
          pageSize={8}
          maxBodyHeight={460}
          loading={loading}
          rows={rows}
          flash={flash}
          columns={[
            { key: 'claim_no', label: 'Claim No', render: (r) => r.claim_no || '—' },
            { key: 'client_name', label: 'Client / Insured' },
            { key: 'claim_type', label: 'Type', render: (r) => <span className={'badge ' + (r.claim_type && r.claim_type !== 'Motor' ? 'blue' : '')}>{r.claim_type || 'Motor'}</span> },
            { key: 'company_name', label: 'Company Name' },
            { key: 'claim_date', label: 'Claim Date' },
            { key: 'claim_amount', label: 'Claim Amount', num: true, render: (r) => inr(r.claim_amount) },
            { key: 'status', label: 'Status', render: (r) => <span className={'badge ' + badge(r.status)}>{r.status}</span> },
          ]}
          empty={{ icon: 'shieldcheck', title: 'No claims found', sub: 'Register a claim with “New Claim / Endorsement”.' }}
        />
      </div>
    </div>
  );
}
