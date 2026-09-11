import { useEffect, useState, useMemo, useRef } from 'react';
import { api } from '../api.js';
import toast from '../components/toast.js';
import confirm from '../components/confirm.js';
import PageHeader from '../components/PageHeader.jsx';
import DataTable from '../components/DataTable.jsx';
import Modal from '../components/Modal.jsx';
import Select from '../components/Select.jsx';
import DateField, { fmt as fmtDate } from '../components/DateField.jsx';
import SearchSelect from '../components/SearchSelect.jsx';
import MultiChips from '../components/MultiChips.jsx';
import Toggle from '../components/Toggle.jsx';
import { Ic } from '../components/Icons.jsx';
import { useRealtime } from '../realtime.js';
import { printHTML, buildRfqDoc, buildCompareDoc, htmlToPdfBase64, shortIns } from '../components/printDoc.js';

// `selected` is OUR recommendation; `client_approved` is the client's own
// choice. They're separate on purpose — the client doesn't always take the
// recommendation, and the comparison document has to be able to show both.
const blankInsurer = () => ({ insurer: '', email: '', status: 'Awaited', txn: 'Quote', ncb: '', idv: '', od_premium: '', tp_premium: '', addon_premium: '', premium: '', wc_rate: '', wc_basic: '', wc_medical: '', addons_incl: null, selected: false, quote_doc: '', quote_name: '', remark: '', decline_reason: '', client_approved: false, approved_by: '', approved_at: '' });

const inr = (v) => Number(v || 0).toLocaleString('en-IN');
const parse = (v, fb) => { if (Array.isArray(v)) return v; if (v && typeof v === 'object') return v; try { return JSON.parse(v ?? (Array.isArray(fb) ? '[]' : '{}')); } catch { return fb; } };
const escHtml = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function companyProfile() {
  try { return JSON.parse(localStorage.getItem('wca_company_profile') || '{}'); } catch { return {}; }
}
// Branded HTML body — plain multi-line text plus the company logo/name header.
function emailHtmlBody(bodyText, profile) {
  const brand = profile.logo
    ? `<img src="${profile.logo}" alt="${escHtml(profile.name || 'WeCare Assurance')}" style="height:44px;display:block;margin-bottom:14px">`
    : `<div style="font-size:20px;font-weight:800;color:#1b6fb0;margin-bottom:14px">${escHtml(profile.name || 'WeCare Assurance')}</div>`;
  return `<div style="font-family:Arial,Helvetica,sans-serif;color:#1a2230;max-width:560px">${brand}<div style="white-space:pre-wrap;line-height:1.6;font-size:14px">${escHtml(bodyText)}</div></div>`;
}
// SMTP/WhatsApp credentials are never held or sent by the client — the
// server resolves them itself (per logged-in user) from the settings saved
// in My Profile. `profile` here is only the non-secret company profile
// (name/logo/email1), used for branding the message, not for auth.
async function sendEmail(to, subject, bodyText, pdfDataUri, pdfFilename, profile) {
  const attachments = pdfDataUri ? [{ filename: pdfFilename, contentBase64: pdfDataUri }] : [];
  return api('/send-email', { method: 'POST', body: { to, subject, html: emailHtmlBody(bodyText, profile), attachments } });
}
async function sendWhatsApp(to, message, pdfDataUri, pdfFilename) {
  return api('/send-whatsapp', { method: 'POST', body: { to, message, mediaBase64: pdfDataUri || undefined, filename: pdfFilename } });
}

// Engineering is deliberately absent: it's no longer offered for new RFQs.
// The Engineering handling further down (form fields, rating basis, the
// quote and comparison documents) stays, so an RFQ already saved under
// that category still opens and prints correctly.
const CATEGORIES = ['Motor', 'Workmen Compensation', 'Group Personal Accident', 'Group Health Insurance', 'Retail Health', 'Fire & Property', 'Householder', 'Marine Cargo', 'Liability', 'Group Term Life', 'Other'];
const NATURES = ['New', 'Renewal', 'Rollover', 'Endorsement'];
const MOTOR_TYPES = ['Package (Comprehensive)', 'Own Damage (OD) Only', 'Third Party (TP) Only', 'Bundled (1+3)', 'Bundled (1+5)'];
const VEHICLE_CLASSES = ['Private Car', 'Two Wheeler', 'GCV', 'PCV', 'Miscellaneous'];
const FUELS = ['Petrol', 'Diesel', 'CNG', 'LPG', 'Electric'];
const NCB_PCTS = ['0', '20', '25', '35', '45', '50'];
const MFG_YEARS = Array.from({ length: new Date().getFullYear() - 1900 + 1 }, (_, i) => new Date().getFullYear() - i);
const MOTOR_ADDONS = ['Zero Depreciation', 'Engine Protection', 'Roadside Assistance', 'Return to Invoice', 'NCB Protection', 'Consumables Cover', 'Key & Lock Replacement', 'Tyre Protection', 'Personal Accident (Owner)', 'Passenger Cover', 'PA Paid Driver', 'IMT 23', 'Towing', 'Cleaner'];
// Workmen's / Employees' Compensation
const WC_TABLES = ['Table A (WC Act only)', 'Table B (WC Act + Common Law)', 'Both (Table A & B)'];
const FIRE_POLICY_TYPES = ['Sookshma', 'Laghu', 'Standard Fire', 'Bharat Griha Raksha'];
const MARINE_POLICY_TYPES = ['Open Marine Inland', 'Open Marine Import', 'Open Marine Export', 'Single Marine Inland', 'Single Marine Import', 'Single Marine Export'];
const GHI_GPA_POLICY_TYPES = ['Deletion', 'Addition', 'Both'];
const WC_WORK_TYPES = ['Manufacturing', 'Construction', 'Trading', 'Services', 'Transport / Logistics', 'Hospitality', 'Other'];
const WC_EMP_CATS = ['Unskilled', 'Semi-skilled', 'Skilled', 'Clerical / Admin', 'Supervisor', 'Managerial', 'Driver', 'Contract Labour'];
const WC_ADDONS = ['Medical Extension', 'Occupational Disease', 'Sub-contractors', 'Terrorism', 'Act of God Perils', 'Cover for Trainees / Apprentices', 'Legal Liability (Common Law)', 'Transit / Off-premises'];
// Group Personal Accident — capital sum insured × rate per mille
const GPA_CSI_BASIS = ['Flat Sum Insured', '24× Monthly Salary', '60× Monthly Salary', 'Graded by Cadre'];
const GPA_RISK_GROUPS = ['Risk Group I (clerical / admin)', 'Risk Group II (supervisory / some manual)', 'Risk Group III (heavy manual)'];
const GPA_MEMBER_CATS = ['Directors / Management', 'Officers / Executives', 'Clerical / Admin', 'Field Staff', 'Skilled Workmen', 'Unskilled Workmen', 'Drivers', 'Contract Staff'];
const GPA_ADDONS = ['Temporary Total Disablement (Weekly)', 'Medical Extension', 'Ambulance Charges', 'Education Fund', 'Funeral Expenses', 'Hospital Cash', 'Broken Bones', 'Terrorism', 'Worldwide Cover', 'Adventure Sports'];
// Group Health Insurance (Group Mediclaim) — sum insured per family
const GHI_FAMILY_DEFS = ['Employee only', 'Employee + Spouse (1+1)', 'Employee + Spouse + 2 Kids (1+3)', 'Employee + Spouse + 3 Dependents (1+5)', '1+5 incl. Parents'];
const GHI_SI_OPTIONS = ['100000', '200000', '300000', '500000', '750000', '1000000'];
const GHI_ROOM = ['1% of SI / day', '2% of SI / day (ICU 4%)', 'Single Private AC Room', 'Capped ₹5,000 / day', 'No Room Rent Capping'];
const GHI_ADDONS = ['Maternity Cover', 'Baby Day-1 Cover', 'Parental Cover', 'Pre-existing Waiver Day-1', 'Room Rent Waiver', 'Corporate Buffer', 'OPD Cover', 'Ambulance', 'Day-care Procedures', 'Domiciliary Hospitalisation', 'Co-pay Waiver'];
// Fire & Property (Standard Fire & Special Perils) — sum insured on assets × rate per mille
const FIRE_OCCUPANCY = ['Dwelling', 'Shop / Retail', 'Office', 'Industrial / Factory', 'Warehouse / Godown', 'Hotel / Restaurant', 'Hospital / School'];
const FIRE_CONSTRUCTION = ['Pucca (RCC)', 'Semi-Pucca', 'Kutcha'];
const FIRE_ASSETS = ['Building', 'Plant & Machinery', 'Stock / Inventory', 'Furniture, Fixtures & Fittings', 'Electronic Equipment', 'Cash / Valuables'];
const FIRE_ADDONS = ['STFI (Storm, Tempest, Flood)', 'Earthquake', 'Terrorism', 'Burglary & Theft', 'Riot, Strike & Malicious Damage', 'Business Interruption (Loss of Profit)', 'Electrical / Machinery Breakdown', 'Escalation'];
// Marine Cargo / Transit — consignment value × rate per mille
const MARINE_MODES = ['Road', 'Rail', 'Sea', 'Air', 'Multimodal', 'Courier / Post'];
const MARINE_BASIS = ['Specific / Single Transit', 'Open Policy (Annual)', 'Sales Turnover Policy (STOP)'];
const MARINE_COVER = ['ICC (A) — All Risks', 'ICC (B)', 'ICC (C) — Basic', 'Inland Transit (Basic)', 'Inland Transit (All Risks)'];
const MARINE_ADDONS = ['War & SRCC', 'Warehouse-to-Warehouse', 'Customs Duty', 'Debris Removal', 'Loading / Unloading Risks'];
// Liability — limit of indemnity × rate
const LIABILITY_TYPES = ['Professional Indemnity', 'Public Liability', 'Product Liability', 'Directors & Officers (D&O)', 'Public + Product Liability'];
const LIABILITY_ADDONS = ['Retroactive Cover', 'Worldwide Jurisdiction', 'Legal Defense Costs', 'Pollution Liability', 'Cyber Liability', 'Employee Dishonesty'];
// Group Term Life — total sum assured × rate per mille
const GTL_SA_BASIS = ['Flat Sum Assured', '24× Annual Salary', '36× Annual Salary', 'Graded by Grade'];
const GTL_MEMBER_CATS = ['Directors / Management', 'Officers / Executives', 'Clerical / Admin', 'Field / Skilled Staff', 'Support / Unskilled'];
const GTL_ADDONS = ['Accidental Death Benefit (ADB)', 'Permanent Total Disability', 'Critical Illness', 'Terminal Illness', 'Terrorism', 'Waiver of Premium'];
// Retail Health (individual / family floater) — lump premium (age-banded)
const RH_TYPES = ['Individual', 'Family Floater'];
const RH_SI = ['300000', '500000', '1000000', '1500000', '2500000', '5000000'];
const RH_RELATIONS = ['Self', 'Spouse', 'Son', 'Daughter', 'Father', 'Mother', 'Father-in-law', 'Mother-in-law'];
const RH_ADDONS = ['Maternity Cover', 'OPD Cover', 'No Room Rent Capping', 'Restoration of SI', 'Unlimited SI', 'Pre-existing Waiver', 'NCB / Cumulative Bonus Protect', 'Consumables Cover', 'Hospital Cash', 'Air Ambulance', 'Annual Health Check-up'];
// Householder's Package — building + contents sum insured × rate per mille
const HOME_PROPERTY = ['Owned', 'Rented', 'Under Construction'];
const HOME_SECTIONS = ['Building / Structure', 'Home Contents', 'Jewellery & Valuables', 'Electronic Appliances', 'Portable Equipment'];
const HOME_ADDONS = ['Burglary & Theft', 'All-Risk (Jewellery)', 'Electronic Equipment', 'Public Liability', 'Alternative Accommodation', 'Terrorism', 'STFI', 'Earthquake', 'Domestic Servant PA'];
// Engineering (CAR / EAR / CPM / MB) — project or plant value × rate per mille
const ENG_TYPES = ['Contractors All Risks (CAR)', 'Erection All Risks (EAR)', 'Contractors Plant & Machinery (CPM)', 'Machinery Breakdown (MB)', 'Boiler & Pressure Plant', 'Electronic Equipment (EEI)'];
const ENG_ADDONS = ['Third Party Liability', 'Debris Removal', 'Escalation', 'Surrounding Property', 'Maintenance (Extended)', 'Design Defect (DE)', 'Terrorism', 'Earthquake', 'STFI', 'Express Freight'];
const RESP = ['Awaited', 'Quoted', 'Declined'];
const STATUSES = ['Draft', 'Sent', 'Quotes Received', 'Quoted', 'Approved by Customer', 'Proposal Requested', 'Closed', 'Lost'];
const STATUS_BADGE = { Draft: '', Sent: 'blue', 'Quotes Received': 'orange', Quoted: 'green', 'Approved by Customer': 'green', 'Proposal Requested': 'blue', Closed: '', Lost: 'red' };
// Offered when an insurer comes back without a quote, so "Declined" carries a
// reason instead of being a dead end nobody can explain later.
const DECLINE_REASONS = ['Vehicle age / model not acceptable', 'Location not serviceable', 'Adverse claim history', 'Declined by underwriting', 'Rate not competitive', 'Required documents not provided', 'Risk outside appetite', 'No response within deadline', 'Other'];
const PRIORITY_BADGE = { High: 'red', Medium: 'orange', Low: '' };

const EMPTY = {
  client_name: '', mobile: '', email: '', category: 'Motor', policy_nature: 'New', policy_type: 'Package (Comprehensive)',
  product: '', sum_assured: '', requested_idv: '', add_ons: [], details: {}, requirement: '',
  priority: 'Medium', due_date: '', status: 'Draft', remarks: '', quote_send_date: '',
  insurers: [blankInsurer()],
};
const quotedCount = (o) => parse(o, []).filter((x) => x.status === 'Quoted' && Number(x.premium) > 0).length;
const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const modelCat = (make) => 'model:' + encodeURIComponent(make);
const variantCat = (make, model) => 'variant:' + encodeURIComponent(make) + ':' + encodeURIComponent(model);

export default function Rfq() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [flash, setFlash] = useState(() => new Set());
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [companies, setCompanies] = useState([]);
  const [emailMap, setEmailMap] = useState({});
  const [makeOpts, setMakeOpts] = useState([]);
  const [modelOpts, setModelOpts] = useState([]);
  const [variantOpts, setVariantOpts] = useState([]);
  const [clients, setClients] = useState([]);
  const [endoQuery, setEndoQuery] = useState('');
  const [endoMatches, setEndoMatches] = useState([]);
  const [endoPolicy, setEndoPolicy] = useState(null);
  const [endoFetching, setEndoFetching] = useState(false);
  const [attachIdx, setAttachIdx] = useState(-1);
  const [compareRfq, setCompareRfq] = useState(null);
  const [docTarget, setDocTarget] = useState('rc');
  const attachRef = useRef(null);
  const docRef = useRef(null);
  const dueShownRef = useRef(false);
  const [dueOpen, setDueOpen] = useState(false);

  function load() { setLoading(true); api('/rfqs').then(setRows).finally(() => setLoading(false)); }
  useEffect(() => {
    load();
    api('/masters/companies?line=GI').then((c) => setCompanies(c.map((x) => x.company_name))).catch(() => { });
    api('/company-emails').then((l) => setEmailMap(Object.fromEntries(l.map((x) => [x.company_name, x.claim_email])))).catch(() => { });
    api('/lookups/make').then((l) => setMakeOpts(l.map((x) => x.name))).catch(() => { });
    api('/clients').then(setClients).catch(() => { });
  }, []);

  // Names only, since SearchSelect works on strings. Deduped because two
  // clients can share a name — showing it twice tells the user nothing and
  // gives the list duplicate React keys.
  const clientOptions = useMemo(
    () => [...new Set(clients.map((c) => (c.client_name || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [clients]
  );

  // Exists only so SearchSelect offers its "Add" action; it must not set the
  // name itself, because SearchSelect calls onChange straight afterwards and
  // pickClient needs to still see the *previous* client to know the selection
  // changed. The client record is written on save, by which point the mobile
  // and email typed underneath are there to be saved with it.
  const addClientName = async () => {};

  function pickClient(name) {
    const same = (a, b) => (a || '').trim().toLowerCase() === (b || '').trim().toLowerCase();
    setEditing((e) => {
      const prev = e.form.client_name;
      // Re-selecting the same client leaves the contact fields alone, so a
      // number typed by hand isn't wiped by reopening the picker.
      if (same(prev, name)) return { ...e, form: { ...e.form, client_name: name } };
      const c = clients.find((x) => same(x.client_name, name));
      // Mobile and email describe the selected client, so switching client
      // replaces them — blank included. Without the blanking, adding a new
      // client after picking an existing one carried that client's number
      // onto the new one, and the RFQ went out to the wrong contact.
      // GSTIN follows the client for the same reason mobile and email do: it
      // identifies that business. Leaving it in place when the client changes
      // put one company's tax number on another company's RFQ.
      const details = { ...e.form.details, gst: c?.gstin || '' };
      return { ...e, form: { ...e.form, client_name: name, mobile: c?.mobile || '', email: c?.email || '', details } };
    });
  }

  // New RFQ, client not on file yet — add them to Client Master so the RFQ
  // isn't the only record of them. Best-effort: never blocks the RFQ save.
  async function ensureClient(name, mobile, email) {
    try {
      const matches = await api('/clients?name=' + encodeURIComponent(name));
      const exact = matches.some((c) => (c.client_name || '').trim().toLowerCase() === name.toLowerCase());
      if (exact) return;
      await api('/clients', { method: 'POST', body: { client_name: name, mobile: mobile || '', email: email || '' } });
      setClients((c) => [...c, { client_name: name, mobile: mobile || '', email: email || '' }]);
      toast.success(`New client "${name}" created`);
    } catch { /* non-fatal */ }
  }

  // Endorsement RFQs are raised against an existing policy — look it up by
  // policy/registration number and pull the client details onto the form.
  async function fetchEndoPolicy() {
    const q = endoQuery.trim();
    if (!q) { toast.error('Enter a policy or registration number'); return; }
    setEndoFetching(true); setEndoPolicy(null); setEndoMatches([]);
    try {
      const [byPol, byReg] = await Promise.all([
        api('/policies?policyNo=' + encodeURIComponent(q)).catch(() => []),
        api('/policies?reg=' + encodeURIComponent(q)).catch(() => []),
      ]);
      const seen = new Set(); const list = [];
      for (const p of [...byPol, ...byReg]) { if (!seen.has(p.id)) { seen.add(p.id); list.push(p); } }
      if (!list.length) { toast.error(`No policy found for "${q}"`); return; }
      setEndoMatches(list);
      applyEndoPolicy(list[0]);
      toast.success(list.length > 1 ? `${list.length} policies found` : `Policy found — ${list[0].insured_name}`);
    } catch (e) { toast.error(e.message || 'Lookup failed'); }
    finally { setEndoFetching(false); }
  }
  function applyEndoPolicy(p) {
    setEndoPolicy(p);
    const c = clients.find((x) => (x.client_name || '').trim().toLowerCase() === (p.insured_name || '').trim().toLowerCase());
    setEditing((e) => ({ ...e, form: { ...e.form, client_name: p.insured_name || e.form.client_name, mobile: c?.mobile || e.form.mobile, email: c?.email || e.form.email } }));
  }

  // Model options depend on the selected Make; Variant options depend on Make + Model.
  const selMake = editing?.form?.details?.make;
  const selModel = editing?.form?.details?.model;
  useEffect(() => {
    if (!selMake) { setModelOpts([]); return; }
    api('/lookups/' + modelCat(selMake)).then((l) => setModelOpts(l.map((x) => x.name))).catch(() => setModelOpts([]));
  }, [selMake]);
  useEffect(() => {
    if (!selMake || !selModel) { setVariantOpts([]); return; }
    api('/lookups/' + variantCat(selMake, selModel)).then((l) => setVariantOpts(l.map((x) => x.name))).catch(() => setVariantOpts([]));
  }, [selMake, selModel]);

  function pickMake(v) { setEditing((e) => ({ ...e, form: { ...e.form, details: { ...e.form.details, make: v, model: '', variant: '' } } })); }
  function pickModel(v) { setEditing((e) => ({ ...e, form: { ...e.form, details: { ...e.form.details, model: v, variant: '' } } })); }
  async function addMake(name) {
    await api('/lookups/make', { method: 'POST', body: { name } });
    setMakeOpts((o) => (o.includes(name) ? o : [...o, name].sort()));
  }
  async function addModel(name) {
    await api('/lookups/' + modelCat(selMake), { method: 'POST', body: { name } });
    setModelOpts((o) => (o.includes(name) ? o : [...o, name].sort()));
  }
  async function addVariant(name) {
    await api('/lookups/' + variantCat(selMake, selModel), { method: 'POST', body: { name } });
    setVariantOpts((o) => (o.includes(name) ? o : [...o, name].sort()));
  }

  function markFlash(id) {
    if (id == null) return;
    setFlash((s) => new Set(s).add(id));
    setTimeout(() => setFlash((s) => { const n = new Set(s); n.delete(id); return n; }), 1600);
  }
  useRealtime('rfq', (evt) => {
    setRows((prev) => {
      if (evt.action === 'deleted') return prev.filter((r) => r.id !== evt.data.id);
      const q = evt.data;
      if (evt.action === 'updated') return prev.map((r) => (r.id === q.id ? q : r));
      if (evt.action === 'created') return prev.some((r) => r.id === q.id) ? prev : [q, ...prev];
      return prev;
    });
    markFlash(evt.data?.id);
  });

  const stats = useMemo(() => ({
    open: rows.filter((r) => !['Closed', 'Lost', 'Quoted'].includes(r.status)).length,
    awaiting: rows.filter((r) => r.status === 'Sent').length,
    received: rows.filter((r) => r.status === 'Quotes Received').length,
    quoted: rows.filter((r) => r.status === 'Quoted').length,
  }), [rows]);

  function toForm(r) {
    return {
      client_name: r.client_name || '', mobile: r.mobile || '', email: r.email || '', category: r.category || 'Motor',
      policy_nature: r.policy_nature || 'New', policy_type: r.policy_type || '', product: r.product || '',
      sum_assured: r.sum_assured || '', requested_idv: r.requested_idv || '', add_ons: parse(r.add_ons, []),
      details: parse(r.details, {}), requirement: r.requirement || '', priority: r.priority || 'Medium',
      due_date: r.due_date || todayISO(), status: r.status || 'Draft', remarks: r.remarks || '',
      quote_send_date: r.quote_send_date || '', quote_sent_at: r.quote_sent_at || '',
      insurers: parse(r.insurers, []).length ? parse(r.insurers, []).map((x) => ({ ...blankInsurer(), ...x })) : [blankInsurer()],
    };
  }
  function openNew() { setEditing({ id: null, form: { ...JSON.parse(JSON.stringify(EMPTY)), due_date: todayISO() } }); setEndoQuery(''); setEndoMatches([]); setEndoPolicy(null); }
  function openEdit(r) { setEditing({ id: r.id, form: toForm(r) }); setEndoQuery(''); setEndoMatches([]); setEndoPolicy(null); }

  const setF = (k, v) => setEditing((e) => ({ ...e, form: { ...e.form, [k]: v } }));
  const setD = (k, v) => setEditing((e) => {
    const details = { ...e.form.details, [k]: v };
    // Rollover Motor: Requested IDV is the sum of Chassis IDV + Body IDV.
    const form = k === 'chassis_idv' || k === 'body_idv'
      ? { ...e.form, details, requested_idv: (Number(details.chassis_idv) || 0) + (Number(details.body_idv) || 0) }
      : { ...e.form, details };
    return { ...e, form };
  });
  const setIns = (i, patch) => setEditing((e) => {
    const cat = e.form.category;
    const dt = e.form.details || {};
    const RATED_BASE = { 'Workmen Compensation': 'wage_roll', 'Group Personal Accident': 'total_csi', 'Fire & Property': 'total_si', 'Householder': 'total_si', 'Engineering': 'project_value', 'Marine Cargo': 'consignment_si', 'Liability': 'limit_aoy', 'Group Term Life': 'total_sa' };
    const isRated = cat in RATED_BASE; // base × rate per mille
    const isGHIcat = cat === 'Group Health Insurance' || cat === 'Retail Health'; // lump-quoted (net + add-on)
    const base = Number(dt[RATED_BASE[cat]]) || 0;
    const insurers = e.form.insurers.map((o, j) => {
      if (j !== i) return o;
      const next = { ...o, ...patch };
      if (isRated) {
        // Basic premium = base (wage roll / total CSI) × rate per mille (auto-filled; still editable).
        if ('wc_rate' in patch) { const b = base * (Number(next.wc_rate) || 0) / 1000; if (b) next.wc_basic = Math.round(b); }
        if ('wc_rate' in patch || 'wc_basic' in patch || 'wc_medical' in patch || 'addon_premium' in patch) {
          next.premium = (Number(next.wc_basic) || 0) + (Number(next.wc_medical) || 0) + (Number(next.addon_premium) || 0);
        }
      } else if (isGHIcat) {
        const families = Number(e.form.details?.total_employees) || 0;
        // Net premium = per-family premium × number of families (auto-filled; still editable).
        if ('wc_rate' in patch) { const b = (Number(next.wc_rate) || 0) * families; if (b) next.wc_basic = Math.round(b); }
        if ('wc_rate' in patch || 'wc_basic' in patch || 'addon_premium' in patch) {
          next.premium = (Number(next.wc_basic) || 0) + (Number(next.addon_premium) || 0);
        }
      } else if ('od_premium' in patch || 'tp_premium' in patch || 'addon_premium' in patch) {
        next.premium = (Number(next.od_premium) || 0) + (Number(next.tp_premium) || 0) + (Number(next.addon_premium) || 0);
      }
      return next;
    });
    return { ...e, form: { ...e.form, insurers } };
  });
  // Wage-roll category rows (WC): keep total employees + wage roll in sync.
  const recalcWage = (cats) => ({ total_employees: cats.reduce((s, c) => s + (Number(c.count) || 0), 0), wage_roll: cats.reduce((s, c) => s + (Number(c.wages) || 0), 0) });
  const addWageCat = () => setEditing((e) => { const cats = [...(e.form.details.wage_cats || []), { cat: 'Unskilled', count: '', wages: '' }]; return { ...e, form: { ...e.form, details: { ...e.form.details, wage_cats: cats, ...recalcWage(cats) } } }; });
  const setWageCat = (idx, key, val) => setEditing((e) => { const cats = (e.form.details.wage_cats || []).map((c, j) => (j === idx ? { ...c, [key]: val } : c)); return { ...e, form: { ...e.form, details: { ...e.form.details, wage_cats: cats, ...recalcWage(cats) } } }; });
  const removeWageCat = (idx) => setEditing((e) => { const cats = (e.form.details.wage_cats || []).filter((_, j) => j !== idx); return { ...e, form: { ...e.form, details: { ...e.form.details, wage_cats: cats, ...recalcWage(cats) } } }; });
  // Member category rows (GPA): keep member count + total capital sum insured in sync.
  const recalcMembers = (cats) => ({ total_members: cats.reduce((s, c) => s + (Number(c.count) || 0), 0), total_csi: cats.reduce((s, c) => s + (Number(c.count) || 0) * (Number(c.csi) || 0), 0) });
  const addMemberCat = () => setEditing((e) => { const cats = [...(e.form.details.member_cats || []), { cat: 'Officers / Executives', count: '', csi: '' }]; return { ...e, form: { ...e.form, details: { ...e.form.details, member_cats: cats, ...recalcMembers(cats) } } }; });
  const setMemberCat = (idx, key, val) => setEditing((e) => { const cats = (e.form.details.member_cats || []).map((c, j) => (j === idx ? { ...c, [key]: val } : c)); return { ...e, form: { ...e.form, details: { ...e.form.details, member_cats: cats, ...recalcMembers(cats) } } }; });
  const removeMemberCat = (idx) => setEditing((e) => { const cats = (e.form.details.member_cats || []).filter((_, j) => j !== idx); return { ...e, form: { ...e.form, details: { ...e.form.details, member_cats: cats, ...recalcMembers(cats) } } }; });
  // Generic schedule rows for Fire (asset_schedule) and Group Term Life (life_cats).
  const SCHED_RECALC = {
    asset_schedule: (arr) => ({ total_si: arr.reduce((s, c) => s + (Number(c.si) || 0), 0) }),
    home_schedule: (arr) => ({ total_si: arr.reduce((s, c) => s + (Number(c.si) || 0), 0) }),
    life_cats: (arr) => ({ total_members: arr.reduce((s, c) => s + (Number(c.count) || 0), 0), total_sa: arr.reduce((s, c) => s + (Number(c.count) || 0) * (Number(c.sa) || 0), 0) }),
    health_members: (arr) => ({ total_members: arr.length, eldest_age: arr.reduce((m, c) => Math.max(m, Number(c.age) || 0), 0) }),
  };
  const addSched = (key, blank) => setEditing((e) => { const arr = [...(e.form.details[key] || []), blank]; return { ...e, form: { ...e.form, details: { ...e.form.details, [key]: arr, ...SCHED_RECALC[key](arr) } } }; });
  const setSched = (key, idx, k, v) => setEditing((e) => { const arr = (e.form.details[key] || []).map((c, j) => (j === idx ? { ...c, [k]: v } : c)); return { ...e, form: { ...e.form, details: { ...e.form.details, [key]: arr, ...SCHED_RECALC[key](arr) } } }; });
  const rmSched = (key, idx) => setEditing((e) => { const arr = (e.form.details[key] || []).filter((_, j) => j !== idx); return { ...e, form: { ...e.form, details: { ...e.form.details, [key]: arr, ...SCHED_RECALC[key](arr) } } }; });
  const addIns = () => setEditing((e) => ({ ...e, form: { ...e.form, insurers: [...e.form.insurers, blankInsurer()] } }));
  const removeIns = (i) => setEditing((e) => ({ ...e, form: { ...e.form, insurers: e.form.insurers.filter((_, j) => j !== i) } }));
  const setRecommend = (i) => setEditing((e) => ({ ...e, form: { ...e.form, insurers: e.form.insurers.map((o, j) => ({ ...o, selected: j === i })) } }));

  // Records the client's decision against the quote they picked. Who approved
  // and when are stamped here rather than derived later, because the client
  // name on the RFQ can change afterwards and the approval should still say
  // who actually agreed to it.
  const approveByClient = (i) => setEditing((e) => {
    const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
    const insurers = e.form.insurers.map((o, j) => (j === i
      ? { ...o, client_approved: true, approved_by: e.form.client_name || '', approved_at: stamp }
      : { ...o, client_approved: false, approved_by: '', approved_at: '' }));
    // Only advance the status; don't drag a further-along RFQ backwards.
    const status = ['Draft', 'Sent', 'Quotes Received', 'Quoted'].includes(e.form.status) ? 'Approved by Customer' : e.form.status;
    return { ...e, form: { ...e.form, insurers, status } };
  });

  const clearApproval = (i) => setEditing((e) => ({
    ...e,
    form: { ...e.form, insurers: e.form.insurers.map((o, j) => (j === i ? { ...o, client_approved: false, approved_by: '', approved_at: '' } : o)) },
  }));

  function triggerAttach(i) { setAttachIdx(i); if (attachRef.current) { attachRef.current.value = ''; attachRef.current.click(); } }
  function onAttach(ev) {
    const file = ev.target.files?.[0]; if (!file) return;
    if (file.type !== 'application/pdf') { toast.error('Please attach a PDF file'); return; }
    if (file.size > 4 * 1024 * 1024) { toast.error('PDF too large (max 4 MB)'); return; }
    const r = new FileReader();
    r.onload = () => { setIns(attachIdx, { quote_doc: r.result, quote_name: file.name }); toast.success('Original quote attached'); };
    r.readAsDataURL(file);
  }
  function viewDoc(uri) { if (!uri) return; fetch(uri).then((r) => r.blob()).then((b) => { const u = URL.createObjectURL(b); window.open(u, '_blank'); setTimeout(() => URL.revokeObjectURL(u), 60000); }).catch(() => toast.error('Could not open file')); }

  // RFQ-level document uploads (RC book — mandatory; previous policy — optional).
  function triggerDoc(target) { setDocTarget(target); if (docRef.current) { docRef.current.value = ''; docRef.current.click(); } }
  function onDoc(ev) {
    const file = ev.target.files?.[0]; if (!file) return;
    if (file.type !== 'application/pdf' && !file.type.startsWith('image/')) { toast.error('Upload a PDF or image'); return; }
    if (file.size > 5 * 1024 * 1024) { toast.error('File too large (max 5 MB)'); return; }
    const r = new FileReader();
    r.onload = () => {
      setEditing((e) => {
        const details = { ...e.form.details };
        if (docTarget === 'other') {
          const list = Array.isArray(details.other_docs) ? [...details.other_docs] : [];
          list.push({ name: file.name, doc: r.result });
          details.other_docs = list;
        } else {
          details[docTarget + '_doc'] = r.result;
          details[docTarget + '_name'] = file.name;
        }
        return { ...e, form: { ...e.form, details } };
      });
      toast.success('Document attached');
    };
    r.readAsDataURL(file);
  }
  const clearDoc = (which) => setEditing((e) => ({ ...e, form: { ...e.form, details: { ...e.form.details, [which + '_doc']: '', [which + '_name']: '' } } }));
  const removeOtherDoc = (idx) => setEditing((e) => { const list = (Array.isArray(e.form.details.other_docs) ? e.form.details.other_docs : []).filter((_, j) => j !== idx); return { ...e, form: { ...e.form, details: { ...e.form.details, other_docs: list } } }; });

  async function save() {
    const f = editing.form;
    if (!f.client_name.trim()) { toast.error('Client name is required'); return; }
    const d = f.details;
    const PRODUCT_DEFAULT = { 'Workmen Compensation': "Workmen's Compensation", 'Group Personal Accident': 'Group Personal Accident', 'Group Health Insurance': 'Group Mediclaim', 'Retail Health': (d.rh_type ? `Health Floater (${d.rh_type})` : 'Health Floater'), 'Fire & Property': 'Fire & Special Perils', 'Householder': "Householder's Package", 'Engineering': (d.eng_type || 'Engineering'), 'Marine Cargo': 'Marine Cargo', 'Liability': (d.liability_type || 'Liability'), 'Group Term Life': 'Group Term Life' };
    const product = f.category === 'Motor'
      ? ([d.make, d.model, d.variant].filter(Boolean).join(' ') || d.vehicle_class || 'Motor')
      : (f.product || PRODUCT_DEFAULT[f.category] || f.category);
    const insurers = f.insurers.filter((o) => (o.insurer || '').trim()).map((o) => ({
      insurer: o.insurer.trim(), email: o.email || '', status: o.status || 'Awaited', txn: o.txn || 'Quote', ncb: o.ncb || '',
      idv: Number(o.idv) || 0, od_premium: Number(o.od_premium) || 0, tp_premium: Number(o.tp_premium) || 0,
      addon_premium: Number(o.addon_premium) || 0, premium: Number(o.premium) || 0,
      wc_rate: o.wc_rate === '' ? '' : Number(o.wc_rate) || 0, wc_basic: Number(o.wc_basic) || 0, wc_medical: Number(o.wc_medical) || 0,
      addons_incl: Array.isArray(o.addons_incl) ? o.addons_incl : null, selected: !!o.selected,
      quote_doc: o.quote_doc || '', quote_name: o.quote_name || '', remark: o.remark || '',
      decline_reason: o.decline_reason || '',
      client_approved: !!o.client_approved, approved_by: o.approved_by || '', approved_at: o.approved_at || '',
    }));
    setSaving(true);
    try {
      const body = { ...f, product, sum_assured: Number(f.sum_assured) || 0, requested_idv: Number(f.requested_idv) || 0, add_ons: f.add_ons, details: f.details, insurers };
      if (editing.id) { await api('/rfqs/' + editing.id, { method: 'PUT', body }); toast.success('RFQ updated'); }
      else { const r = await api('/rfqs', { method: 'POST', body }); toast.success(`RFQ ${r.rfq_no} created`); }
      // Runs for updates too: the client name is editable on an existing RFQ,
      // so retyping it there should reach Client Master the same way it does
      // on a new one. It checks for an exact match first, so re-saving an
      // unchanged RFQ writes nothing.
      await ensureClient(f.client_name.trim(), f.mobile, f.email);
      setEditing(null); load();
    } catch (e) { toast.error(e.message || 'Could not save'); }
    finally { setSaving(false); }
  }

  function genPdf(r) { printHTML(`RFQ ${r.rfq_no}`, buildRfqDoc(r)); toast.info('RFQ document ready — Save as PDF from the print dialog'); }
  function comparePdf(r) {
    if (quotedCount(r.insurers) === 0) { toast.error('No insurer has quoted yet'); return; }
    printHTML(`Comparison ${r.rfq_no}`, buildCompareDoc(r)); toast.info('Comparison ready — Save as PDF to share');
  }
  async function emailInsurers(r) {
    const det = parse(r.details, {});
    const cat = r.category;
    // Workmen Compensation deliberately absent — the wage register was dropped,
    // so nothing gates sending a WC RFQ.
    const MAND = { 'Group Personal Accident': 'Member list', 'Group Health Insurance': 'Employee census', 'Retail Health': 'Member / age details', 'Fire & Property': 'Property / asset statement', 'Householder': 'Property / contents statement', 'Engineering': 'Project / plant details', 'Marine Cargo': 'Invoice / packing list', 'Liability': 'Proposal / exposure details', 'Group Term Life': 'Member data sheet', 'Motor': 'RC Book copy' };
    const mandLabel = MAND[cat] || 'Supporting document';
    const needsDoc = cat in MAND;
    if (needsDoc && !det.rc_doc) { toast.error(`${mandLabel} is mandatory before sending — edit the RFQ and attach it`); openEdit(r); return; }
    const list = parse(r.insurers, []).filter((i) => i.email);
    if (!list.length) { toast.error('Add insurers with email addresses first'); return; }
    const to = list.map((i) => i.email).join(',');
    const others = Array.isArray(det.other_docs) ? det.other_docs : [];
    const enclosures = ['RFQ PDF', det.rc_name && mandLabel, det.prev_name && 'Previous policy copy', others.length && `${others.length} other document${others.length > 1 ? 's' : ''}`].filter(Boolean).join(', ');
    const subject = `RFQ ${r.rfq_no} — ${r.product || r.category} — ${r.client_name}`;
    const ASK = {
      'Workmen Compensation': `Kindly share your most competitive rate per mille (‰) on the wage roll, medical extension premium and the requested add-on covers (ODC, sub-contractors, terrorism).`,
      'Group Personal Accident': `Kindly share your most competitive rate per mille (‰) on the total capital sum insured, along with the TTD / medical extension premium and the requested benefits.`,
      'Group Health Insurance': `Kindly share your most competitive per-family premium for the sum insured and family definition below, along with maternity, PED-waiver and the requested add-ons.`,
      'Fire & Property': `Kindly share your most competitive rate per mille (‰) on the total sum insured across the asset schedule, along with the requested perils (STFI, earthquake, terrorism, BI).`,
      'Marine Cargo': `Kindly share your most competitive rate per mille (‰) on the consignment value for the transit and cover basis below, along with the requested extensions (war/SRCC, W-to-W).`,
      'Liability': `Kindly share your most competitive premium for the limit of indemnity and cover below, along with the requested extensions (retroactive, worldwide jurisdiction, legal costs).`,
      'Group Term Life': `Kindly share your most competitive rate per mille (‰) on the total sum assured for the member schedule below, along with the requested riders (ADB, PTD, CI).`,
      'Retail Health': `Kindly share your most competitive premium for the sum insured and members (ages) below, along with room-rent, PED-waiting and the requested add-ons.`,
      'Householder': `Kindly share your most competitive rate per mille (‰) on the total sum insured (building + contents) below, along with burglary, all-risk and the requested sections.`,
      'Engineering': `Kindly share your most competitive rate per mille (‰) on the project / plant value below for the ${cat === 'Engineering' ? (det.eng_type || 'engineering') : 'engineering'} risk, along with the requested extensions (TPL, escalation, maintenance).`,
    };
    const ask = ASK[cat] || `Kindly share your most competitive premium including IDV, OD & TP premium and the requested add-on covers.`;
    const body = `Dear Sir/Madam,\n\nPlease find our Request for Quotation (${r.rfq_no}) for ${r.client_name}. ${ask}\n\nEnclosures: ${enclosures}.\n\nRegards,\n${companyProfile().name || 'WeCare Assurance'}`;
    if (r.status === 'Draft') { try { await api('/rfqs/' + r.id, { method: 'PUT', body: { status: 'Sent' } }); load(); } catch { /* ignore */ } }
    toast.info('Generating RFQ PDF…');
    try {
      const pdf = await htmlToPdfBase64(`RFQ ${r.rfq_no}`, buildRfqDoc(r));
      await sendEmail(to, subject, body, pdf, `RFQ-${r.rfq_no}.pdf`, companyProfile());
      toast.success(`Email sent to ${list.length} insurer${list.length > 1 ? 's' : ''} — RFQ PDF attached${det.rc_name ? `, remember to also forward the ${mandLabel.toLowerCase()} separately` : ''}`);
    } catch (e) { toast.error(e.message || 'Could not send email'); }
  }
  async function shareClient(r) {
    if (quotedCount(r.insurers) === 0) { toast.error('No quotes to share yet'); return; }
    if (!r.mobile && !r.email) { toast.error('No client mobile or email on file'); return; }
    const quoted = parse(r.insurers, []).filter((i) => Number(i.premium) > 0);
    const best = quoted.reduce((a, b) => (!a || Number(b.premium) < Number(a.premium) ? b : a), null);
    const msg = `Hi ${r.client_name}, please find the premium comparison for your ${r.product}. Our recommendation: ${best.insurer} at ₹${inr(best.premium)}. Reply to approve and we'll proceed with issuance.`;
    const profile = companyProfile();
    toast.info('Generating comparison PDF…');
    let pdf = null;
    try { pdf = await htmlToPdfBase64(`Comparison ${r.rfq_no}`, buildCompareDoc(r)); }
    catch { /* fall through and still try to send without the attachment */ }
    const sent = [];
    const failed = [];
    if (r.mobile) {
      try { await sendWhatsApp(r.mobile, msg, pdf, `Comparison-${r.rfq_no}.pdf`); sent.push('WhatsApp'); }
      catch (e) { failed.push(`WhatsApp (${e.message || 'failed'})`); }
    }
    if (r.email) {
      try { await sendEmail(r.email, 'Premium comparison — ' + r.product, msg, pdf, `Comparison-${r.rfq_no}.pdf`, profile); sent.push('Email'); }
      catch (e) { failed.push(`Email (${e.message || 'failed'})`); }
    }
    if (sent.length) {
      toast.success(`Comparison sent to client via ${sent.join(' & ')}`);
      // Stamping the send is what takes this RFQ out of the reminder sweep —
      // without it the "quote due" reminder keeps firing after it has gone.
      try {
        await api('/rfqs/' + r.id, { method: 'PUT', body: { quote_sent_at: new Date().toISOString().slice(0, 16).replace('T', ' ') } });
        load();
      } catch { /* the send already happened; bookkeeping shouldn't surface as a failure */ }
    }
    if (failed.length) toast.error(`Could not send via ${failed.join(', ')}`);
  }

  // Once the client approves a quote, the next step is asking that insurer to
  // issue the proposal and a payment link.
  async function requestProposal(r) {
    const list = parse(r.insurers, []);
    const won = list.find((i) => i.client_approved);
    if (!won) { toast.error('Mark which quote the client approved first'); return; }
    if (!won.email) { toast.error(`No email on file for ${won.insurer}`); return; }
    const ok = await confirm({
      title: 'Request proposal from ' + won.insurer + '?',
      message: `${won.insurer} will be told the customer approved their quote of ₹${inr(won.premium)} and asked to share the proposal and payment link.`,
      confirmText: 'Send Request', icon: 'send',
    });
    if (!ok) return;
    const profile = companyProfile();
    const subject = `Request for Proposal - ${r.rfq_no} - ${r.client_name}`;
    const premiumBit = Number(won.premium) > 0 ? ` at Rs. ${inr(won.premium)}` : '';
    // Built as HTML rather than plain text with newlines, because sendEmail
    // delivers this as the message body and line breaks have to survive it.
    const body = [
      'Dear Sir/Madam,',
      `Our customer <b>${r.client_name}</b> has approved your quote for ${r.product || r.category}${premiumBit}.`,
      'Kindly share the proposal form and the payment link so we can proceed with issuance.',
      `RFQ reference: ${r.rfq_no}`,
      `Regards,<br>${profile.name || 'WeCare Assurance'}`,
    ].join('<br><br>');
    try {
      await sendEmail(won.email, subject, body, null, null, profile);
      await api('/rfqs/' + r.id, { method: 'PUT', body: { status: 'Proposal Requested' } });
      toast.success(`Proposal requested from ${won.insurer}`);
      load();
    } catch (e) { toast.error(e.message || 'Could not send the request'); }
  }
  async function convert(r) {
    if (quotedCount(r.insurers) === 0) { toast.error('No insurer has quoted a premium yet'); return; }
    const ok = await confirm({ title: 'Create quotation from responses?', message: `A comparison quotation will be built from ${quotedCount(r.insurers)} insurer quote(s) for ${r.client_name}.`, confirmText: 'Create Quotation', icon: 'doc' });
    if (!ok) return;
    try { const d = await api('/rfqs/' + r.id + '/convert', { method: 'POST' }); toast.success(`Quotation ${d.quote_no} created`); load(); }
    catch (e) { toast.error(e.message || 'Could not convert'); }
  }
  async function del(r) {
    const ok = await confirm({ title: 'Delete RFQ?', message: `${r.rfq_no} for ${r.client_name} will be removed.`, tone: 'danger', confirmText: 'Delete', icon: 'trash' });
    if (!ok) return;
    const snap = rows;
    setRows((prev) => prev.filter((x) => x.id !== r.id));
    try { await api('/rfqs/' + r.id, { method: 'DELETE' }); toast.success('RFQ deleted'); }
    catch (e) { setRows(snap); toast.error(e.message || 'Could not delete'); }
  }

  const kpis = [
    { label: 'Open RFQs', num: stats.open, icon: 'clipboard', tone: 'info' },
    { label: 'Awaiting Quotes', num: stats.awaiting, icon: 'clock', tone: 'warning' },
    { label: 'Quotes Received', num: stats.received, icon: 'mail', tone: 'warning' },
    { label: 'Quoted', num: stats.quoted, icon: 'check', tone: 'success', hint: 'ready to present to client' },
  ];
  const f = editing?.form;
  const isMotor = f?.category === 'Motor';
  const isWC = f?.category === 'Workmen Compensation';
  const isGPA = f?.category === 'Group Personal Accident';
  const isGHI = f?.category === 'Group Health Insurance';
  const isFire = f?.category === 'Fire & Property';
  const isMarine = f?.category === 'Marine Cargo';
  const isLiab = f?.category === 'Liability';
  const isGTL = f?.category === 'Group Term Life';
  const isHealthR = f?.category === 'Retail Health';
  const isHome = f?.category === 'Householder';
  const isEng = f?.category === 'Engineering';
  const rated6 = isWC || isGPA; // rated grid with a medical/TTD column
  const rated5 = isFire || isMarine || isLiab || isGTL || isHome || isEng; // rated grid, no medical column
  const baseVal = f && (isWC ? f.details.wage_roll : isGPA ? f.details.total_csi : (isFire || isHome) ? f.details.total_si : isMarine ? f.details.consignment_si : isLiab ? f.details.limit_aoy : isGTL ? f.details.total_sa : isEng ? f.details.project_value : 0);
  const baseLabel = isWC ? 'Wage Roll' : isGPA ? 'Total CSI' : (isFire || isHome) ? 'Total SI' : isMarine ? 'Sum Insured' : isLiab ? 'Limit (AOY)' : isGTL ? 'Total SA' : isEng ? 'Project Value' : '';
  const showPrev = isMotor && ['Renewal', 'Rollover'].includes(f?.policy_nature);
  // Shared Documents section (mandatory doc + previous policy + other docs). Render helper, not a component.
  const renderDocs = (mandLabel, otherSub, hint) => (
    <>
      <div className="section-head">Documents</div>
      <div className="doc-grid">
        <DocAttach label={mandLabel} required name={f.details.rc_name} onPick={() => triggerDoc('rc')} onView={() => viewDoc(f.details.rc_doc)} onRemove={() => clearDoc('rc')} />
        <DocAttach label="Previous Policy Copy" name={f.details.prev_name} onPick={() => triggerDoc('prev')} onView={() => viewDoc(f.details.prev_doc)} onRemove={() => clearDoc('prev')} />
      </div>
      <div className="other-docs">
        <div className="od-head">
          <span className="da-label">Other Documents <span className="od-sub">{otherSub}</span></span>
          <button type="button" className="btn ghost da-btn" onClick={() => triggerDoc('other')}><Ic name="upload" size={14} /> Add document</button>
        </div>
        {(f.details.other_docs || []).length > 0 && (
          <div className="od-list">
            {(f.details.other_docs || []).map((doc, k) => (
              <span className="da-file" key={k}><Ic name="file" size={14} /><button type="button" className="dt-link" onClick={() => viewDoc(doc.doc)}>{doc.name}</button><button type="button" className="action-btn danger" title="Remove" onClick={() => removeOtherDoc(k)}><Ic name="x" size={12} /></button></span>
            ))}
          </div>
        )}
      </div>
      <input ref={docRef} type="file" accept="application/pdf,image/*" hidden onChange={onDoc} />
      <p className="doc-hint"><Ic name="alert" size={13} /> {hint}</p>
    </>
  );
  const renderPrev = (lastLabel = 'Claims in last 3 years', ph = 'e.g. Nil') => (
    <>
      <div className="section-head">Previous Policy &amp; Claim Experience</div>
      <div className="form-grid">
        <div className="form-field"><label>Previous Insurer</label><input value={f.details.prev_insurer || ''} onChange={(e) => setD('prev_insurer', e.target.value)} /></div>
        <div className="form-field"><label>Previous Policy No</label><input value={f.details.prev_policy_no || ''} onChange={(e) => setD('prev_policy_no', e.target.value)} /></div>
        <div className="form-field"><label>Previous Expiry</label><DateField value={f.details.prev_expiry || ''} onChange={(e) => setD('prev_expiry', e.target.value)} /></div>
        <div className="form-field" style={{ gridColumn: 'span 2' }}><label>{lastLabel}</label><input value={f.details.claims_3yr || ''} onChange={(e) => setD('claims_3yr', e.target.value)} placeholder={ph} /></div>
      </div>
    </>
  );
  // RFQs whose comparison was meant to reach the client by now and hasn't.
  const quoteDue = useMemo(() => rows.filter((r) => {
    const d = (r.quote_send_date || '').trim();
    if (!d || (r.quote_sent_at || '').trim()) return false;
    if (['Closed', 'Lost'].includes(r.status)) return false;
    return d <= todayISO();
  }), [rows]);
  // Pops once per visit, not on every realtime row update, or it would reopen
  // itself the moment anything else on the page changed.
  useEffect(() => {
    if (!dueShownRef.current && quoteDue.length) { dueShownRef.current = true; setDueOpen(true); }
  }, [quoteDue]);

  const editingHasQuotes = editing?.id && quotedCount(f?.insurers) > 0;
  const savedRow = editing?.id ? rows.find((x) => x.id === editing.id) : null;
  const savedApproval = parse(savedRow?.insurers, []).find((o) => o.client_approved) || null;
  const companyOpts = companies.length ? companies : Object.keys(emailMap);

  return (
    <div>
      <PageHeader
        title="RFQ — Request for Quotation"
        action={
          <>
            {quoteDue.length > 0 && (
              <button className="btn ghost" onClick={() => setDueOpen(true)} title="Quotes due to be sent to clients">
                <Ic name="clock" size={16} /> {quoteDue.length} quote{quoteDue.length > 1 ? 's' : ''} due
              </button>
            )}
            <button className="btn blue" onClick={openNew}><Ic name="plus" size={16} /> New RFQ</button>
          </>
        }
      />

      <Modal
        open={dueOpen}
        onClose={() => setDueOpen(false)}
        title="Quotes due to be sent"
        subtitle="These comparisons were scheduled to reach the client on or before today."
        icon="clock"
        footer={<button className="btn ghost" onClick={() => setDueOpen(false)}>Close</button>}
      >
        <div className="due-list">
          {quoteDue.map((r) => {
            const overdue = (r.quote_send_date || '') < todayISO();
            return (
              <button
                key={r.id}
                className="due-row"
                onClick={() => { setDueOpen(false); openEdit(r); }}
              >
                <span className="due-when">
                  <span className={'badge ' + (overdue ? 'red' : 'orange')}>{overdue ? 'Overdue' : 'Today'}</span>
                  <span className="due-date">{fmtDate(r.quote_send_date)}</span>
                </span>
                <span className="due-main">
                  <b>{r.rfq_no}</b> — {r.client_name}
                  <small>{r.product || r.category}</small>
                </span>
                <Ic name="chevron" size={15} style={{ transform: 'rotate(-90deg)', opacity: 0.6 }} />
              </button>
            );
          })}
        </div>
      </Modal>

      <div className="kpi-grid" style={{ marginBottom: 18 }}>
        {kpis.map((it) => (
          <div className="kpi-card" data-tone={it.tone} key={it.label}>
            <div className="kpi-card-top"><span className="kpi-card-ic"><Ic name={it.icon} size={16} /></span><span className="kpi-card-label">{it.label}</span></div>
            <div className="kpi-card-num">{it.num}</div>
            {it.hint && <div className="kpi-card-hint">{it.hint}</div>}
          </div>
        ))}
      </div>

      <div className="card">
        <DataTable
          title="Requests for Quotation"
          count={rows.length}
          loading={loading}
          rows={rows}
          flash={flash}
          onRowClick={openEdit}
          searchPlaceholder="Search client, product or RFQ no…"
          searchKeys={['rfq_no', 'client_name', 'product', 'requirement']}
          columns={[
            { key: 'rfq_no', label: 'RFQ No', render: (r) => <b>{r.rfq_no}</b> },
            { key: 'client_name', label: 'Client' },
            { key: 'category', label: 'Category', render: (r) => <span className="badge blue">{r.category || '—'}</span> },
            { key: 'product', label: 'Product / Risk' },
            { key: 'policy_nature', label: 'Nature' },
            { key: 'requested_idv', label: 'Req. IDV', num: true, render: (r) => (r.requested_idv ? inr(r.requested_idv) : '—') },
            { key: 'insurers', label: 'Responses', noFilter: true, render: (r) => <span title="Quoted / Requested"><b>{quotedCount(r.insurers)}</b> / {parse(r.insurers, []).length}</span> },
            { key: 'priority', label: 'Priority', render: (r) => <span className={'badge ' + (PRIORITY_BADGE[r.priority] || '')}>{r.priority}</span> },
            { key: 'status', label: 'Status', render: (r) => <span className={'badge ' + (STATUS_BADGE[r.status] || '')}>{r.status}</span> },
          ]}
          actions={(r) => (
            <>
              <button className="action-btn" title="Generate RFQ PDF" onClick={() => genPdf(r)}><Ic name="file-export" size={15} /></button>
              <button className="action-btn" title="Email to insurers" onClick={() => emailInsurers(r)}><Ic name="mail" size={15} /></button>
              <button className="action-btn" title="View comparison" onClick={() => setCompareRfq(r)} disabled={quotedCount(r.insurers) === 0}><Ic name="chart" size={15} /></button>
              <button className="action-btn" title="Edit" onClick={() => openEdit(r)}><Ic name="edit" size={15} /></button>
              <button className="action-btn danger" title="Delete" onClick={() => del(r)}><Ic name="trash" size={15} /></button>
            </>
          )}
          empty={{ icon: 'clipboard', title: 'No RFQs yet', sub: 'Start the client journey — raise an RFQ and gather insurer quotes.' }}
        />
      </div>

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing?.id ? `Edit RFQ${editing.form.category === 'Motor' ? ' · Motor' : ''}` : 'New RFQ'}
        subtitle="Capture the requirement, gather quotes, compare and convert"
        icon="clipboard"
        size="lg"
        footer={
          <>
            <button className="btn ghost" onClick={() => setEditing(null)}>Cancel</button>
            <button className="btn blue" onClick={save} disabled={saving}>{saving ? 'Saving…' : editing?.id ? 'Update RFQ' : 'Save RFQ'}</button>
          </>
        }
      >
        {editing && (
          <>
            {editing.id && (
              <div className="rfq-workflow">
                <button className="btn ghost" onClick={() => genPdf({ ...rows.find((x) => x.id === editing.id), ...f, add_ons: f.add_ons, details: f.details, insurers: f.insurers })}><Ic name="file-export" size={15} /> RFQ PDF</button>
                <button className="btn ghost" onClick={() => emailInsurers(rows.find((x) => x.id === editing.id))}><Ic name="mail" size={15} /> Email Insurers</button>
                <button className="btn ghost" onClick={() => comparePdf({ ...rows.find((x) => x.id === editing.id), ...f, insurers: f.insurers })} disabled={quotedCount(f.insurers) === 0}><Ic name="chart" size={15} /> Comparison PDF</button>
                <button className="btn ghost" onClick={() => shareClient(rows.find((x) => x.id === editing.id))} disabled={quotedCount(f.insurers) === 0}><Ic name="send" size={15} /> Share Client</button>
                <button
                  className="btn ghost"
                  onClick={() => requestProposal(savedRow)}
                  disabled={!savedApproval}
                  title={savedApproval ? `Ask ${savedApproval.insurer} for the proposal and payment link` : 'Mark the client-approved quote and save first'}
                ><Ic name="doc" size={15} /> Request Proposal</button>
                <button className="btn blue" style={{ marginLeft: 'auto' }} onClick={() => convert(rows.find((x) => x.id === editing.id))} disabled={!editingHasQuotes}><Ic name="doc" size={15} /> Create Quotation</button>
              </div>
            )}

            <div className="section-head">Requirement</div>
            <div className="form-grid">
              <div className="form-field"><label>Category</label><Select value={f.category} onChange={(e) => setF('category', e.target.value)}>{CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}</Select></div>
              <div className="form-field"><label>Policy Nature</label><Select value={f.policy_nature} onChange={(e) => setF('policy_nature', e.target.value)}>{NATURES.map((n) => <option key={n} value={n}>{n}</option>)}</Select></div>
              <div className="form-field"><label>{isWC ? 'Policy Basis' : 'Policy Type'}</label>{isMotor
                ? <Select value={f.policy_type} onChange={(e) => setF('policy_type', e.target.value)}>{MOTOR_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</Select>
                : isWC
                  ? <Select value={f.policy_type || WC_TABLES[1]} onChange={(e) => setF('policy_type', e.target.value)}>{WC_TABLES.map((t) => <option key={t} value={t}>{t}</option>)}</Select>
                  : isFire
                    ? <Select value={f.policy_type} onChange={(e) => setF('policy_type', e.target.value)} placeholder="Select policy type">{FIRE_POLICY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</Select>
                    : isMarine
                      ? <Select value={f.policy_type} onChange={(e) => setF('policy_type', e.target.value)} placeholder="Select policy type">{MARINE_POLICY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</Select>
                      : (isGHI || isGPA)
                        ? <Select value={f.policy_type} onChange={(e) => setF('policy_type', e.target.value)} placeholder="Select policy type">{GHI_GPA_POLICY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</Select>
                        : <input value={f.policy_type} onChange={(e) => setF('policy_type', e.target.value)} placeholder="Policy type" />}</div>
              <div className="form-field"><label>Priority</label><Select value={f.priority} onChange={(e) => setF('priority', e.target.value)}><option>High</option><option>Medium</option><option>Low</option></Select></div>
              <div className="form-field"><label>Quote Dated</label><input value={fmtDate(f.due_date)} disabled /></div>
              <div className="form-field"><label>Send Quote to Client On</label>
                <DateField value={f.quote_send_date || ''} onChange={(e) => setF('quote_send_date', e.target.value)} />
                <div className="hint-line">{f.quote_sent_at ? `Shared with client on ${f.quote_sent_at}` : 'A reminder is raised on this date until the comparison is shared.'}</div>
              </div>
              <div className="form-field"><label>Status</label><Select value={f.status} onChange={(e) => setF('status', e.target.value)}>{STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}</Select></div>
            </div>

            {f.policy_nature === 'Endorsement' && (
              <>
                <div className="section-head">Endorsement — Existing Policy</div>
                <div className="fetch-row">
                  <div className="form-field" style={{ flex: 1, minWidth: 220 }}>
                    <label>Policy / Registration No</label>
                    <input value={endoQuery} onChange={(e) => setEndoQuery(e.target.value.toUpperCase())} placeholder="e.g. GJ03NB2970 or GPA/2026/0450" onKeyDown={(e) => e.key === 'Enter' && fetchEndoPolicy()} />
                  </div>
                  <button type="button" className="btn blue fetch-btn" onClick={fetchEndoPolicy} disabled={endoFetching}>{endoFetching ? 'Fetching…' : <><Ic name="search" size={15} /> Fetch</>}</button>
                </div>
                {endoPolicy && (
                  <div className="policy-found">
                    <div className="pf-head"><Ic name="check" size={16} /> Policy found{endoMatches.length > 1 ? ` — ${endoMatches.length} policies` : ''}</div>
                    {endoMatches.length > 1 && (
                      <div className="form-field" style={{ marginBottom: 12 }}>
                        <label>Select policy</label>
                        <Select value={String(endoPolicy.id)} onChange={(e) => applyEndoPolicy(endoMatches.find((m) => String(m.id) === e.target.value) || endoMatches[0])}>
                          {endoMatches.map((m) => <option key={m.id} value={String(m.id)}>{[m.company_name, m.product_name, m.policy_number].filter(Boolean).join(' · ')}</option>)}
                        </Select>
                      </div>
                    )}
                    <div className="pf-grid">
                      <div><span className="pf-k">Insured Name</span><span className="pf-v">{endoPolicy.insured_name}</span></div>
                      <div><span className="pf-k">Insurance Company</span><span className="pf-v">{endoPolicy.company_name || '—'}</span></div>
                      <div><span className="pf-k">Product</span><span className="pf-v">{endoPolicy.product_name || '—'}</span></div>
                      <div><span className="pf-k">Policy No</span><span className="pf-v">{endoPolicy.policy_number || '—'}</span></div>
                      <div><span className="pf-k">Type</span><span className="pf-v">{endoPolicy.insurance_type || endoPolicy.insurance_line}</span></div>
                      <div><span className="pf-k">Expiry</span><span className="pf-v">{endoPolicy.period_to || '—'}</span></div>
                    </div>
                  </div>
                )}
              </>
            )}

            <div className="section-head">Client & Contact</div>
            <div className="form-grid">
              <div className="form-field"><label>Client Name <span className="req">*</span></label>
                <SearchSelect
                  value={f.client_name}
                  onChange={pickClient}
                  options={clientOptions}
                  onAdd={addClientName}
                  placeholder="Search a client, or type a new name to add"
                />
              </div>
              <div className="form-field"><label>Mobile</label><input value={f.mobile} onChange={(e) => setF('mobile', e.target.value)} /></div>
              <div className="form-field"><label>Email</label><input value={f.email} onChange={(e) => setF('email', e.target.value)} /></div>
            </div>

            {isMotor ? (
              <>
                <div className="section-head">Vehicle / RC Details</div>
                <div className="form-grid">
                  <div className="form-field"><label>Vehicle Class</label><Select value={f.details.vehicle_class || 'Private Car'} onChange={(e) => setD('vehicle_class', e.target.value)}>{VEHICLE_CLASSES.map((v) => <option key={v} value={v}>{v}</option>)}</Select></div>
                  <div className="form-field"><label>Registration No</label><input value={f.details.reg_no || ''} onChange={(e) => setD('reg_no', e.target.value)} placeholder="GJ01 AB 1234" /></div>
                  <div className="form-field"><label>Make</label><SearchSelect value={f.details.make || ''} options={makeOpts} onChange={pickMake} onAdd={addMake} placeholder="Select make" /></div>
                  <div className="form-field"><label>Model</label><SearchSelect value={f.details.model || ''} options={modelOpts} onChange={pickModel} onAdd={addModel} placeholder={f.details.make ? 'Select model' : 'Select make first'} disabled={!f.details.make} /></div>
                  <div className="form-field"><label>Variant</label><SearchSelect value={f.details.variant || ''} options={variantOpts} onChange={(v) => setD('variant', v)} onAdd={addVariant} placeholder={f.details.model ? 'Select variant' : 'Select model first'} disabled={!f.details.model} /></div>
                  <div className="form-field"><label>Mfg Year</label>
                    <Select value={f.details.mfg_year || ''} onChange={(e) => setD('mfg_year', e.target.value)} placeholder="Select year">
                      {MFG_YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
                    </Select>
                  </div>
                  <div className="form-field"><label>Registration Date</label><DateField value={f.details.reg_date || ''} onChange={(e) => setD('reg_date', e.target.value)} /></div>
                  <div className="form-field"><label>RTO</label><input value={f.details.rto || ''} onChange={(e) => setD('rto', e.target.value)} /></div>
                  <div className="form-field"><label>Fuel</label><Select value={f.details.fuel || 'Petrol'} onChange={(e) => setD('fuel', e.target.value)}>{FUELS.map((v) => <option key={v} value={v}>{v}</option>)}</Select></div>
                  {f.details.fuel === 'Electric'
                    ? <div className="form-field"><label>Power (kW)</label><input value={f.details.kw || ''} onChange={(e) => setD('kw', e.target.value)} /></div>
                    : <div className="form-field"><label>Cubic Capacity</label><input value={f.details.cc || ''} onChange={(e) => setD('cc', e.target.value)} /></div>}
                  <div className="form-field"><label>Seating</label><input value={f.details.seating || ''} onChange={(e) => setD('seating', e.target.value)} /></div>
                  {f.details.vehicle_class === 'GCV' && (
                    <div className="form-field"><label>GVW (kg)</label><input type="number" value={f.details.gvw || ''} onChange={(e) => setD('gvw', e.target.value)} placeholder="Gross Vehicle Weight" /></div>
                  )}
                </div>

                {showPrev && (
                  <>
                    <div className="section-head">Previous Policy &amp; NCB</div>
                    <div className="form-grid">
                      <div className="form-field"><label>Previous Insurer</label><input value={f.details.prev_insurer || ''} onChange={(e) => setD('prev_insurer', e.target.value)} /></div>
                      <div className="form-field"><label>Previous Policy No</label><input value={f.details.prev_policy_no || ''} onChange={(e) => setD('prev_policy_no', e.target.value)} /></div>
                      <div className="form-field"><label>Previous Expiry</label><DateField value={f.details.prev_expiry || ''} onChange={(e) => setD('prev_expiry', e.target.value)} /></div>
                      <div className="form-field"><label>Claim Taken</label><Select value={f.details.claim_taken || 'No'} onChange={(e) => setD('claim_taken', e.target.value)}><option>No</option><option>Yes</option></Select></div>
                      <div className="form-field"><label>NCB %</label><Select value={f.details.ncb_pct || '0'} onChange={(e) => setD('ncb_pct', e.target.value)}>{NCB_PCTS.map((n) => <option key={n} value={n}>{n}%</option>)}</Select></div>
                    </div>
                  </>
                )}

                <div className="section-head">Cover Required</div>
                <div className="form-grid">
                  <div className="form-field"><label>Requested IDV (₹)</label><input type="number" value={f.requested_idv} onChange={(e) => setF('requested_idv', e.target.value)} /></div>
                  {(f.details.vehicle_class || 'Private Car') === 'GCV' && (
                    <>
                      <div className="form-field"><label>Chassis IDV (₹)</label><input type="number" value={f.details.chassis_idv || ''} onChange={(e) => setD('chassis_idv', e.target.value)} /></div>
                      <div className="form-field"><label>Body IDV (₹)</label><input type="number" value={f.details.body_idv || ''} onChange={(e) => setD('body_idv', e.target.value)} /></div>
                    </>
                  )}
                </div>
                <label style={{ fontSize: 12.5, fontWeight: 650, color: 'var(--text-2)', display: 'block', margin: '4px 0 8px' }}>Add-on Covers</label>
                <MultiChips options={MOTOR_ADDONS} value={f.add_ons} onChange={(v) => setF('add_ons', v)} />

                <div className="section-head">Documents</div>
                <div className="doc-grid">
                  <DocAttach label="RC Book Copy" required name={f.details.rc_name} onPick={() => triggerDoc('rc')} onView={() => viewDoc(f.details.rc_doc)} onRemove={() => clearDoc('rc')} />
                  <DocAttach label="Previous Policy Copy" name={f.details.prev_name} onPick={() => triggerDoc('prev')} onView={() => viewDoc(f.details.prev_doc)} onRemove={() => clearDoc('prev')} />
                </div>
                <div className="other-docs">
                  <div className="od-head">
                    <span className="da-label">Other Documents <span className="od-sub">(KYC, DL, inspection, cheque…)</span></span>
                    <button type="button" className="btn ghost da-btn" onClick={() => triggerDoc('other')}><Ic name="upload" size={14} /> Add document</button>
                  </div>
                  {(f.details.other_docs || []).length > 0 && (
                    <div className="od-list">
                      {(f.details.other_docs || []).map((doc, k) => (
                        <span className="da-file" key={k}><Ic name="file" size={14} /><button type="button" className="dt-link" onClick={() => viewDoc(doc.doc)}>{doc.name}</button><button type="button" className="action-btn danger" title="Remove" onClick={() => removeOtherDoc(k)}><Ic name="x" size={12} /></button></span>
                      ))}
                    </div>
                  )}
                </div>
                <input ref={docRef} type="file" accept="application/pdf,image/*" hidden onChange={onDoc} />
                <p className="doc-hint"><Ic name="alert" size={13} /> RC Book copy is required before you can send the RFQ to insurers. Both files are attached with the RFQ email.</p>
              </>
            ) : isWC ? (
              <>
                <div className="section-head">Business / Insured Details</div>
                <div className="form-grid">
                  <div className="form-field" style={{ gridColumn: 'span 2' }}><label>Nature of Business / Trade</label><input value={f.details.business || ''} onChange={(e) => setD('business', e.target.value)} placeholder="e.g. MS fabrication & structural steel works" /></div>
                  <div className="form-field"><label>Type of Work</label><Select value={f.details.work_type || 'Manufacturing'} onChange={(e) => setD('work_type', e.target.value)}>{WC_WORK_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</Select></div>
                  {f.details.work_type === 'Other' && (
                    <div className="form-field"><label>Specify Type of Work</label>
                      <input value={f.details.work_type_other || ''} onChange={(e) => setD('work_type_other', e.target.value)} placeholder="Describe the work" autoFocus /></div>
                  )}
                  <div className="form-field" style={{ gridColumn: 'span 2' }}><label>Risk Location</label><input value={f.details.location || ''} onChange={(e) => setD('location', e.target.value)} placeholder="Factory / site address" /></div>
                  <div className="form-field"><label>GSTIN (optional)</label><input value={f.details.gst || ''} onChange={(e) => setD('gst', e.target.value)} /></div>
                </div>

                <div className="section-head">Employees &amp; Wage Roll</div>
                <div className="wage-table">
                  <div className="wage-head"><span>Category</span><span>Head-count</span><span>Annual Wages (₹)</span><span></span></div>
                  {(f.details.wage_cats || []).map((c, k) => (
                    <div className="wage-row" key={k}>
                      <SearchSelect
                        value={c.cat || ''}
                        onChange={(v) => setWageCat(k, 'cat', v)}
                        options={WC_EMP_CATS}
                        onAdd={async () => {}}
                        placeholder="Select or add category"
                      />
                      <input type="number" value={c.count} onChange={(e) => setWageCat(k, 'count', e.target.value)} placeholder="0" />
                      <input type="number" value={c.wages} onChange={(e) => setWageCat(k, 'wages', e.target.value)} placeholder="0" />
                      <button className="action-btn danger" title="Remove" onClick={() => removeWageCat(k)}><Ic name="x" size={14} /></button>
                    </div>
                  ))}
                  <button className="btn ghost da-btn" style={{ marginTop: 8 }} onClick={addWageCat}><Ic name="plus" size={14} /> Add category</button>
                  <div className="wage-totals">
                    <span><b>{Number(f.details.total_employees || 0)}</b> employees</span>
                    <span>Total Annual Wage Roll: <b>₹ {inr(f.details.wage_roll || 0)}</b></span>
                  </div>
                </div>
                <div className="form-grid" style={{ marginTop: 12 }}>
                  <div className="form-field"><label>Medical Extension</label><Select value={f.details.medical_ext || 'No'} onChange={(e) => setD('medical_ext', e.target.value)}><option>No</option><option>Yes</option></Select></div>
                  {f.details.medical_ext === 'Yes' && (
                    <div className="form-field"><label>Medical Limit / Employee (₹)</label><input type="number" value={f.details.med_limit || ''} onChange={(e) => setD('med_limit', e.target.value)} placeholder="e.g. 100000" /></div>
                  )}
                </div>

                <div className="section-head">Cover &amp; Add-ons</div>
                <label style={{ fontSize: 12.5, fontWeight: 650, color: 'var(--text-2)', display: 'block', margin: '4px 0 8px' }}>Extensions Required</label>
                <MultiChips options={WC_ADDONS} value={f.add_ons} onChange={(v) => setF('add_ons', v)} />

                {f.policy_nature !== 'New' && (
                  <>
                    <div className="section-head">Previous Policy &amp; Claim Experience</div>
                    <div className="form-grid">
                      <div className="form-field"><label>Previous Insurer</label><input value={f.details.prev_insurer || ''} onChange={(e) => setD('prev_insurer', e.target.value)} /></div>
                      <div className="form-field"><label>Previous Policy No</label><input value={f.details.prev_policy_no || ''} onChange={(e) => setD('prev_policy_no', e.target.value)} /></div>
                      <div className="form-field"><label>Previous Expiry</label><DateField value={f.details.prev_expiry || ''} onChange={(e) => setD('prev_expiry', e.target.value)} /></div>
                      <div className="form-field" style={{ gridColumn: 'span 2' }}><label>Claims in last 3 years</label><input value={f.details.claims_3yr || ''} onChange={(e) => setD('claims_3yr', e.target.value)} placeholder="e.g. Nil / 1 minor (₹18,000)" /></div>
                    </div>
                  </>
                )}

                <div className="section-head">Documents</div>
                <div className="doc-grid">
                  <DocAttach label="Previous Policy Copy" name={f.details.prev_name} onPick={() => triggerDoc('prev')} onView={() => viewDoc(f.details.prev_doc)} onRemove={() => clearDoc('prev')} />
                </div>
                <div className="other-docs">
                  <div className="od-head">
                    <span className="da-label">Other Documents <span className="od-sub">(employee declaration, GST cert, ESIC…)</span></span>
                    <button type="button" className="btn ghost da-btn" onClick={() => triggerDoc('other')}><Ic name="upload" size={14} /> Add document</button>
                  </div>
                  {(f.details.other_docs || []).length > 0 && (
                    <div className="od-list">
                      {(f.details.other_docs || []).map((doc, k) => (
                        <span className="da-file" key={k}><Ic name="file" size={14} /><button type="button" className="dt-link" onClick={() => viewDoc(doc.doc)}>{doc.name}</button><button type="button" className="action-btn danger" title="Remove" onClick={() => removeOtherDoc(k)}><Ic name="x" size={12} /></button></span>
                      ))}
                    </div>
                  )}
                </div>
                <input ref={docRef} type="file" accept="application/pdf,image/*" hidden onChange={onDoc} />
                <p className="doc-hint"><Ic name="alert" size={13} /> Insurers rate the premium on the declared wage roll above.</p>
              </>
            ) : isGPA ? (
              <>
                <div className="section-head">Business / Insured Details</div>
                <div className="form-grid">
                  <div className="form-field" style={{ gridColumn: 'span 2' }}><label>Nature of Business / Industry</label><input value={f.details.business || ''} onChange={(e) => setD('business', e.target.value)} placeholder="e.g. IT / software services" /></div>
                  <div className="form-field"><label>Risk Group</label><Select value={f.details.risk_group || GPA_RISK_GROUPS[0]} onChange={(e) => setD('risk_group', e.target.value)}>{GPA_RISK_GROUPS.map((t) => <option key={t} value={t}>{t}</option>)}</Select></div>
                  <div className="form-field" style={{ gridColumn: 'span 2' }}><label>Location / Address</label><input value={f.details.location || ''} onChange={(e) => setD('location', e.target.value)} /></div>
                  <div className="form-field"><label>GSTIN (optional)</label><input value={f.details.gst || ''} onChange={(e) => setD('gst', e.target.value)} /></div>
                </div>

                <div className="section-head">Members &amp; Capital Sum Insured</div>
                <div className="form-grid" style={{ marginBottom: 10 }}>
                  <div className="form-field"><label>CSI Basis</label><Select value={f.details.csi_basis || GPA_CSI_BASIS[0]} onChange={(e) => setD('csi_basis', e.target.value)}>{GPA_CSI_BASIS.map((t) => <option key={t} value={t}>{t}</option>)}</Select></div>
                </div>
                <div className="wage-table">
                  <div className="wage-head"><span>Category / Cadre</span><span>Members</span><span>CSI / Member (₹)</span><span></span></div>
                  {(f.details.member_cats || []).map((c, k) => (
                    <div className="wage-row" key={k}>
                      <Select value={c.cat} onChange={(e) => setMemberCat(k, 'cat', e.target.value)}>{GPA_MEMBER_CATS.map((x) => <option key={x} value={x}>{x}</option>)}</Select>
                      <input type="number" value={c.count} onChange={(e) => setMemberCat(k, 'count', e.target.value)} placeholder="0" />
                      <input type="number" value={c.csi} onChange={(e) => setMemberCat(k, 'csi', e.target.value)} placeholder="0" />
                      <button className="action-btn danger" title="Remove" onClick={() => removeMemberCat(k)}><Ic name="x" size={14} /></button>
                    </div>
                  ))}
                  <button className="btn ghost da-btn" style={{ marginTop: 8 }} onClick={addMemberCat}><Ic name="plus" size={14} /> Add category</button>
                  <div className="wage-totals">
                    <span><b>{Number(f.details.total_members || 0)}</b> members</span>
                    <span>Total Capital Sum Insured: <b>₹ {inr(f.details.total_csi || 0)}</b></span>
                  </div>
                </div>
                <div className="form-grid" style={{ marginTop: 12 }}>
                  <div className="form-field"><label>Medical Extension</label><Select value={f.details.medical_ext || 'No'} onChange={(e) => setD('medical_ext', e.target.value)}><option>No</option><option>Yes</option></Select></div>
                  {f.details.medical_ext === 'Yes' && (
                    <div className="form-field"><label>Medical Limit / Member (₹)</label><input type="number" value={f.details.med_limit || ''} onChange={(e) => setD('med_limit', e.target.value)} placeholder="e.g. 100000" /></div>
                  )}
                  <div className="form-field"><label>TTD Weekly Benefit (₹/wk)</label><input type="number" value={f.details.ttd_weekly || ''} onChange={(e) => setD('ttd_weekly', e.target.value)} placeholder="e.g. 5000" /></div>
                </div>

                <div className="section-head">Cover &amp; Extensions</div>
                <label style={{ fontSize: 12.5, fontWeight: 650, color: 'var(--text-2)', display: 'block', margin: '4px 0 8px' }}>Base cover: Accidental Death · PTD · PPD. Extensions required:</label>
                <MultiChips options={GPA_ADDONS} value={f.add_ons} onChange={(v) => setF('add_ons', v)} />

                <div className="section-head">Previous Policy &amp; Claim Experience</div>
                <div className="form-grid">
                  <div className="form-field"><label>Previous Insurer</label><input value={f.details.prev_insurer || ''} onChange={(e) => setD('prev_insurer', e.target.value)} /></div>
                  <div className="form-field"><label>Previous Policy No</label><input value={f.details.prev_policy_no || ''} onChange={(e) => setD('prev_policy_no', e.target.value)} /></div>
                  <div className="form-field"><label>Previous Expiry</label><DateField value={f.details.prev_expiry || ''} onChange={(e) => setD('prev_expiry', e.target.value)} /></div>
                  <div className="form-field" style={{ gridColumn: 'span 2' }}><label>Claims in last 3 years</label><input value={f.details.claims_3yr || ''} onChange={(e) => setD('claims_3yr', e.target.value)} placeholder="e.g. Nil / 1 AD claim (₹10L)" /></div>
                </div>

                <div className="section-head">Documents</div>
                <div className="doc-grid">
                  <DocAttach label="Member List / Census" required name={f.details.rc_name} onPick={() => triggerDoc('rc')} onView={() => viewDoc(f.details.rc_doc)} onRemove={() => clearDoc('rc')} />
                  <DocAttach label="Previous Policy Copy" name={f.details.prev_name} onPick={() => triggerDoc('prev')} onView={() => viewDoc(f.details.prev_doc)} onRemove={() => clearDoc('prev')} />
                </div>
                <div className="other-docs">
                  <div className="od-head">
                    <span className="da-label">Other Documents <span className="od-sub">(KYC, GST cert, prior claims MIS…)</span></span>
                    <button type="button" className="btn ghost da-btn" onClick={() => triggerDoc('other')}><Ic name="upload" size={14} /> Add document</button>
                  </div>
                  {(f.details.other_docs || []).length > 0 && (
                    <div className="od-list">
                      {(f.details.other_docs || []).map((doc, k) => (
                        <span className="da-file" key={k}><Ic name="file" size={14} /><button type="button" className="dt-link" onClick={() => viewDoc(doc.doc)}>{doc.name}</button><button type="button" className="action-btn danger" title="Remove" onClick={() => removeOtherDoc(k)}><Ic name="x" size={12} /></button></span>
                      ))}
                    </div>
                  )}
                </div>
                <input ref={docRef} type="file" accept="application/pdf,image/*" hidden onChange={onDoc} />
                <p className="doc-hint"><Ic name="alert" size={13} /> Member list with names, cadre &amp; CSI is required before sending — insurers rate on the total capital sum insured.</p>
              </>
            ) : isGHI ? (
              <>
                <div className="section-head">Business / Insured Details</div>
                <div className="form-grid">
                  <div className="form-field" style={{ gridColumn: 'span 2' }}><label>Nature of Business / Industry</label><input value={f.details.business || ''} onChange={(e) => setD('business', e.target.value)} placeholder="e.g. Retail chain" /></div>
                  <div className="form-field" style={{ gridColumn: 'span 2' }}><label>Location / Address</label><input value={f.details.location || ''} onChange={(e) => setD('location', e.target.value)} /></div>
                  <div className="form-field"><label>GSTIN (optional)</label><input value={f.details.gst || ''} onChange={(e) => setD('gst', e.target.value)} /></div>
                </div>

                <div className="section-head">Group &amp; Sum Insured</div>
                <div className="form-grid">
                  <div className="form-field"><label>Family Definition</label><Select value={f.details.family_def || GHI_FAMILY_DEFS[2]} onChange={(e) => setD('family_def', e.target.value)}>{GHI_FAMILY_DEFS.map((t) => <option key={t} value={t}>{t}</option>)}</Select></div>
                  <div className="form-field"><label>Sum Insured / Family (₹)</label><Select value={f.details.si_per_family || '500000'} onChange={(e) => setD('si_per_family', e.target.value)}>{GHI_SI_OPTIONS.map((t) => <option key={t} value={t}>{Number(t).toLocaleString('en-IN')}</option>)}</Select></div>
                  <div className="form-field"><label>No. of Employees / Families</label><input type="number" value={f.details.total_employees || ''} onChange={(e) => setD('total_employees', e.target.value)} /></div>
                  <div className="form-field"><label>Total Lives Covered</label><input type="number" value={f.details.total_lives || ''} onChange={(e) => setD('total_lives', e.target.value)} /></div>
                  <div className="form-field"><label>Room Rent</label><Select value={f.details.room_rent || GHI_ROOM[0]} onChange={(e) => setD('room_rent', e.target.value)}>{GHI_ROOM.map((t) => <option key={t} value={t}>{t}</option>)}</Select></div>
                  <div className="form-field"><label>Co-pay %</label><input type="number" value={f.details.copay || ''} onChange={(e) => setD('copay', e.target.value)} placeholder="e.g. 10" /></div>
                  <div className="form-field"><label>PED Waiver Day-1</label><Select value={f.details.ped_waiver || 'Yes'} onChange={(e) => setD('ped_waiver', e.target.value)}><option>Yes</option><option>No</option></Select></div>
                  <div className="form-field"><label>Maternity Limit (₹)</label><input type="number" value={f.details.maternity_limit || ''} onChange={(e) => setD('maternity_limit', e.target.value)} placeholder="e.g. 50000" /></div>
                </div>

                <div className="section-head">Cover &amp; Add-ons</div>
                <label style={{ fontSize: 12.5, fontWeight: 650, color: 'var(--text-2)', display: 'block', margin: '4px 0 8px' }}>Add-on Covers Required</label>
                <MultiChips options={GHI_ADDONS} value={f.add_ons} onChange={(v) => setF('add_ons', v)} />

                <div className="section-head">Previous Policy &amp; Claim Experience</div>
                <div className="form-grid">
                  <div className="form-field"><label>Previous Insurer</label><input value={f.details.prev_insurer || ''} onChange={(e) => setD('prev_insurer', e.target.value)} /></div>
                  <div className="form-field"><label>Previous Policy No</label><input value={f.details.prev_policy_no || ''} onChange={(e) => setD('prev_policy_no', e.target.value)} /></div>
                  <div className="form-field"><label>Previous Expiry</label><DateField value={f.details.prev_expiry || ''} onChange={(e) => setD('prev_expiry', e.target.value)} /></div>
                  <div className="form-field" style={{ gridColumn: 'span 2' }}><label>Claims Ratio / Burning Cost</label><input value={f.details.claims_3yr || ''} onChange={(e) => setD('claims_3yr', e.target.value)} placeholder="e.g. 78% incurred claims ratio" /></div>
                </div>

                <div className="section-head">Documents</div>
                <div className="doc-grid">
                  <DocAttach label="Employee Census (age / family data)" required name={f.details.rc_name} onPick={() => triggerDoc('rc')} onView={() => viewDoc(f.details.rc_doc)} onRemove={() => clearDoc('rc')} />
                  <DocAttach label="Previous Policy Copy" name={f.details.prev_name} onPick={() => triggerDoc('prev')} onView={() => viewDoc(f.details.prev_doc)} onRemove={() => clearDoc('prev')} />
                </div>
                <div className="other-docs">
                  <div className="od-head">
                    <span className="da-label">Other Documents <span className="od-sub">(claims MIS, GST cert, addon requirements…)</span></span>
                    <button type="button" className="btn ghost da-btn" onClick={() => triggerDoc('other')}><Ic name="upload" size={14} /> Add document</button>
                  </div>
                  {(f.details.other_docs || []).length > 0 && (
                    <div className="od-list">
                      {(f.details.other_docs || []).map((doc, k) => (
                        <span className="da-file" key={k}><Ic name="file" size={14} /><button type="button" className="dt-link" onClick={() => viewDoc(doc.doc)}>{doc.name}</button><button type="button" className="action-btn danger" title="Remove" onClick={() => removeOtherDoc(k)}><Ic name="x" size={12} /></button></span>
                      ))}
                    </div>
                  )}
                </div>
                <input ref={docRef} type="file" accept="application/pdf,image/*" hidden onChange={onDoc} />
                <p className="doc-hint"><Ic name="alert" size={13} /> Employee census (age band &amp; family data) is required — insurers price group mediclaim on the age mix &amp; claims history.</p>
              </>
            ) : isFire ? (
              <>
                <div className="section-head">Risk / Occupancy Details</div>
                <div className="form-grid">
                  <div className="form-field" style={{ gridColumn: 'span 2' }}><label>Nature of Business</label><input value={f.details.business || ''} onChange={(e) => setD('business', e.target.value)} placeholder="e.g. Textile trading & warehousing" /></div>
                  <div className="form-field"><label>Occupancy</label><Select value={f.details.occupancy || FIRE_OCCUPANCY[0]} onChange={(e) => setD('occupancy', e.target.value)}>{FIRE_OCCUPANCY.map((t) => <option key={t} value={t}>{t}</option>)}</Select></div>
                  <div className="form-field"><label>Construction</label><Select value={f.details.construction || FIRE_CONSTRUCTION[0]} onChange={(e) => setD('construction', e.target.value)}>{FIRE_CONSTRUCTION.map((t) => <option key={t} value={t}>{t}</option>)}</Select></div>
                  <div className="form-field" style={{ gridColumn: 'span 2' }}><label>Risk Location</label><input value={f.details.location || ''} onChange={(e) => setD('location', e.target.value)} /></div>
                  <div className="form-field"><label>Bank / Financier (HPA)</label><input value={f.details.bank || ''} onChange={(e) => setD('bank', e.target.value)} /></div>
                </div>
                <div className="section-head">Property / Asset Schedule</div>
                <div className="wage-table">
                  <div className="wage-head" style={{ gridTemplateColumns: '1.6fr 1.4fr 40px' }}><span>Asset Type</span><span>Sum Insured (₹)</span><span></span></div>
                  {(f.details.asset_schedule || []).map((c, k) => (
                    <div className="wage-row" key={k} style={{ gridTemplateColumns: '1.6fr 1.4fr 40px' }}>
                      <Select value={c.asset} onChange={(e) => setSched('asset_schedule', k, 'asset', e.target.value)}>{FIRE_ASSETS.map((x) => <option key={x} value={x}>{x}</option>)}</Select>
                      <input type="number" value={c.si} onChange={(e) => setSched('asset_schedule', k, 'si', e.target.value)} placeholder="0" />
                      <button className="action-btn danger" title="Remove" onClick={() => rmSched('asset_schedule', k)}><Ic name="x" size={14} /></button>
                    </div>
                  ))}
                  <button className="btn ghost da-btn" style={{ marginTop: 8 }} onClick={() => addSched('asset_schedule', { asset: 'Building', si: '' })}><Ic name="plus" size={14} /> Add asset</button>
                  <div className="wage-totals"><span>Total Sum Insured: <b>₹ {inr(f.details.total_si || 0)}</b></span></div>
                </div>
                <div className="section-head">Perils &amp; Add-ons</div>
                <label style={{ fontSize: 12.5, fontWeight: 650, color: 'var(--text-2)', display: 'block', margin: '4px 0 8px' }}>Base cover: Fire &amp; Special Perils. Additional perils required:</label>
                <MultiChips options={FIRE_ADDONS} value={f.add_ons} onChange={(v) => setF('add_ons', v)} />
                {renderPrev()}
                {renderDocs('Property / Asset Statement', '(valuation report, GST cert, prior claims…)', 'Property / asset statement is required before sending — insurers rate on the declared sum insured.')}
              </>
            ) : isMarine ? (
              <>
                <div className="section-head">Consignment Details</div>
                <div className="form-grid">
                  <div className="form-field" style={{ gridColumn: 'span 2' }}><label>Nature of Goods</label><input value={f.details.goods || ''} onChange={(e) => setD('goods', e.target.value)} placeholder="e.g. Ceramic tiles (fragile)" /></div>
                  <div className="form-field"><label>Packing</label><input value={f.details.packing || ''} onChange={(e) => setD('packing', e.target.value)} placeholder="e.g. Wooden crates" /></div>
                  <div className="form-field"><label>Sum Insured / Consignment Value (₹)</label><input type="number" value={f.details.consignment_si || ''} onChange={(e) => setD('consignment_si', e.target.value)} /></div>
                </div>
                <div className="section-head">Transit &amp; Cover</div>
                <div className="form-grid">
                  <div className="form-field"><label>From (Origin)</label><input value={f.details.from || ''} onChange={(e) => setD('from', e.target.value)} /></div>
                  <div className="form-field"><label>To (Destination)</label><input value={f.details.to || ''} onChange={(e) => setD('to', e.target.value)} /></div>
                  <div className="form-field"><label>Mode of Transit</label><Select value={f.details.mode || MARINE_MODES[0]} onChange={(e) => setD('mode', e.target.value)}>{MARINE_MODES.map((t) => <option key={t} value={t}>{t}</option>)}</Select></div>
                  <div className="form-field"><label>Policy Basis</label><Select value={f.details.marine_basis || MARINE_BASIS[0]} onChange={(e) => setD('marine_basis', e.target.value)}>{MARINE_BASIS.map((t) => <option key={t} value={t}>{t}</option>)}</Select></div>
                  <div className="form-field"><label>Cover Basis</label><Select value={f.details.cover_basis || MARINE_COVER[0]} onChange={(e) => setD('cover_basis', e.target.value)}>{MARINE_COVER.map((t) => <option key={t} value={t}>{t}</option>)}</Select></div>
                  <div className="form-field"><label>Transit Date</label><DateField value={f.details.voyage_date || ''} onChange={(e) => setD('voyage_date', e.target.value)} /></div>
                </div>
                <div className="section-head">Extensions</div>
                <MultiChips options={MARINE_ADDONS} value={f.add_ons} onChange={(v) => setF('add_ons', v)} />
                {renderPrev()}
                {renderDocs('Invoice / Packing List', '(purchase order, LR / BL, prior claims…)', 'Invoice / packing list is required before sending — insurers rate on the consignment value.')}
              </>
            ) : isLiab ? (
              <>
                <div className="section-head">Cover &amp; Insured Details</div>
                <div className="form-grid">
                  <div className="form-field"><label>Liability Type</label><Select value={f.details.liability_type || LIABILITY_TYPES[0]} onChange={(e) => setD('liability_type', e.target.value)}>{LIABILITY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</Select></div>
                  <div className="form-field" style={{ gridColumn: 'span 2' }}><label>Nature of Business / Profession</label><input value={f.details.business || ''} onChange={(e) => setD('business', e.target.value)} /></div>
                  <div className="form-field"><label>Limit of Indemnity — AOA (₹)</label><input type="number" value={f.details.limit_aoa || ''} onChange={(e) => setD('limit_aoa', e.target.value)} placeholder="Any One Accident" /></div>
                  <div className="form-field"><label>Limit of Indemnity — AOY (₹)</label><input type="number" value={f.details.limit_aoy || ''} onChange={(e) => setD('limit_aoy', e.target.value)} placeholder="Aggregate / year" /></div>
                  <div className="form-field"><label>Annual Turnover (₹)</label><input type="number" value={f.details.turnover || ''} onChange={(e) => setD('turnover', e.target.value)} /></div>
                  <div className="form-field"><label>Retroactive Date</label><DateField value={f.details.retroactive_date || ''} onChange={(e) => setD('retroactive_date', e.target.value)} /></div>
                  <div className="form-field"><label>Jurisdiction</label><input value={f.details.jurisdiction || ''} onChange={(e) => setD('jurisdiction', e.target.value)} placeholder="e.g. India" /></div>
                </div>
                <div className="section-head">Extensions</div>
                <MultiChips options={LIABILITY_ADDONS} value={f.add_ons} onChange={(v) => setF('add_ons', v)} />
                {renderPrev('Claims / circumstances notified')}
                {renderDocs('Proposal / Exposure Details', '(financials, contracts, claims history…)', 'Proposal / exposure details are required before sending — insurers rate liability on the limit & exposure.')}
              </>
            ) : isGTL ? (
              <>
                <div className="section-head">Business / Insured Details</div>
                <div className="form-grid">
                  <div className="form-field" style={{ gridColumn: 'span 2' }}><label>Nature of Business</label><input value={f.details.business || ''} onChange={(e) => setD('business', e.target.value)} /></div>
                  <div className="form-field"><label>SA Basis</label><Select value={f.details.sa_basis || GTL_SA_BASIS[0]} onChange={(e) => setD('sa_basis', e.target.value)}>{GTL_SA_BASIS.map((t) => <option key={t} value={t}>{t}</option>)}</Select></div>
                  <div className="form-field" style={{ gridColumn: 'span 2' }}><label>Location</label><input value={f.details.location || ''} onChange={(e) => setD('location', e.target.value)} /></div>
                  <div className="form-field"><label>Free Cover Limit (₹)</label><input type="number" value={f.details.fcl || ''} onChange={(e) => setD('fcl', e.target.value)} /></div>
                </div>
                <div className="section-head">Member Schedule &amp; Sum Assured</div>
                <div className="wage-table">
                  <div className="wage-head"><span>Category / Grade</span><span>Members</span><span>SA / Member (₹)</span><span></span></div>
                  {(f.details.life_cats || []).map((c, k) => (
                    <div className="wage-row" key={k}>
                      <Select value={c.cat} onChange={(e) => setSched('life_cats', k, 'cat', e.target.value)}>{GTL_MEMBER_CATS.map((x) => <option key={x} value={x}>{x}</option>)}</Select>
                      <input type="number" value={c.count} onChange={(e) => setSched('life_cats', k, 'count', e.target.value)} placeholder="0" />
                      <input type="number" value={c.sa} onChange={(e) => setSched('life_cats', k, 'sa', e.target.value)} placeholder="0" />
                      <button className="action-btn danger" title="Remove" onClick={() => rmSched('life_cats', k)}><Ic name="x" size={14} /></button>
                    </div>
                  ))}
                  <button className="btn ghost da-btn" style={{ marginTop: 8 }} onClick={() => addSched('life_cats', { cat: 'Officers / Executives', count: '', sa: '' })}><Ic name="plus" size={14} /> Add category</button>
                  <div className="wage-totals"><span><b>{Number(f.details.total_members || 0)}</b> members</span><span>Total Sum Assured: <b>₹ {inr(f.details.total_sa || 0)}</b></span></div>
                </div>
                <div className="section-head">Riders</div>
                <label style={{ fontSize: 12.5, fontWeight: 650, color: 'var(--text-2)', display: 'block', margin: '4px 0 8px' }}>Base cover: Death. Riders required:</label>
                <MultiChips options={GTL_ADDONS} value={f.add_ons} onChange={(v) => setF('add_ons', v)} />
                {renderPrev()}
                {renderDocs('Member Data Sheet', '(DOB, SA, nominee details…)', 'Member data sheet (DOB & SA per member) is required before sending — insurers rate on the age mix & total SA.')}
              </>
            ) : isHealthR ? (
              <>
                <div className="section-head">Policy &amp; Sum Insured</div>
                <div className="form-grid">
                  <div className="form-field"><label>Policy Type</label><Select value={f.details.rh_type || RH_TYPES[1]} onChange={(e) => setD('rh_type', e.target.value)}>{RH_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</Select></div>
                  <div className="form-field"><label>Sum Insured (₹)</label><Select value={f.details.si_per_family || '500000'} onChange={(e) => setD('si_per_family', e.target.value)}>{RH_SI.map((t) => <option key={t} value={t}>{Number(t).toLocaleString('en-IN')}</option>)}</Select></div>
                  <div className="form-field"><label>Pre-existing Disease</label><Select value={f.details.ped || 'No'} onChange={(e) => setD('ped', e.target.value)}><option>No</option><option>Yes</option></Select></div>
                  {f.details.ped === 'Yes' && <div className="form-field" style={{ gridColumn: 'span 2' }}><label>PED Details</label><input value={f.details.ped_details || ''} onChange={(e) => setD('ped_details', e.target.value)} placeholder="e.g. Diabetes (self), Hypertension (spouse)" /></div>}
                  <div className="form-field"><label>Room Rent</label><input value={f.details.room_rent || ''} onChange={(e) => setD('room_rent', e.target.value)} placeholder="e.g. Single Private AC / No cap" /></div>
                  <div className="form-field"><label>Co-pay %</label><input type="number" value={f.details.copay || ''} onChange={(e) => setD('copay', e.target.value)} /></div>
                  <div className="form-field"><label>Ported from Insurer?</label><Select value={f.details.ported || 'No'} onChange={(e) => setD('ported', e.target.value)}><option>No</option><option>Yes</option></Select></div>
                </div>
                <div className="section-head">Members to Cover</div>
                <div className="wage-table">
                  <div className="wage-head" style={{ gridTemplateColumns: '1.6fr 1.4fr 40px' }}><span>Relationship</span><span>Age (years)</span><span></span></div>
                  {(f.details.health_members || []).map((c, k) => (
                    <div className="wage-row" key={k} style={{ gridTemplateColumns: '1.6fr 1.4fr 40px' }}>
                      <Select value={c.relation} onChange={(e) => setSched('health_members', k, 'relation', e.target.value)}>{RH_RELATIONS.map((x) => <option key={x} value={x}>{x}</option>)}</Select>
                      <input type="number" value={c.age} onChange={(e) => setSched('health_members', k, 'age', e.target.value)} placeholder="0" />
                      <button className="action-btn danger" title="Remove" onClick={() => rmSched('health_members', k)}><Ic name="x" size={14} /></button>
                    </div>
                  ))}
                  <button className="btn ghost da-btn" style={{ marginTop: 8 }} onClick={() => addSched('health_members', { relation: 'Self', age: '' })}><Ic name="plus" size={14} /> Add member</button>
                  <div className="wage-totals"><span><b>{Number(f.details.total_members || 0)}</b> members</span><span>Eldest age: <b>{Number(f.details.eldest_age || 0)}</b> yrs</span></div>
                </div>
                <div className="section-head">Add-on Covers</div>
                <MultiChips options={RH_ADDONS} value={f.add_ons} onChange={(v) => setF('add_ons', v)} />
                {renderPrev()}
                {renderDocs('Member / Age Details', '(KYC, previous policy, medical reports…)', 'Member & age details are required before sending — retail health is priced on the eldest member age & sum insured.')}
              </>
            ) : isHome ? (
              <>
                <div className="section-head">Property Details</div>
                <div className="form-grid">
                  <div className="form-field"><label>Property</label><Select value={f.details.property_type || HOME_PROPERTY[0]} onChange={(e) => setD('property_type', e.target.value)}>{HOME_PROPERTY.map((t) => <option key={t} value={t}>{t}</option>)}</Select></div>
                  <div className="form-field"><label>Building Type</label><input value={f.details.building_type || ''} onChange={(e) => setD('building_type', e.target.value)} placeholder="e.g. Apartment / Bungalow" /></div>
                  <div className="form-field"><label>Year Built</label><input value={f.details.year_built || ''} onChange={(e) => setD('year_built', e.target.value)} /></div>
                  <div className="form-field" style={{ gridColumn: 'span 2' }}><label>Location / Address</label><input value={f.details.location || ''} onChange={(e) => setD('location', e.target.value)} /></div>
                  <div className="form-field"><label>PIN Code</label><input value={f.details.pin || ''} onChange={(e) => setD('pin', e.target.value)} /></div>
                </div>
                <div className="section-head">Sum Insured Sections</div>
                <div className="wage-table">
                  <div className="wage-head" style={{ gridTemplateColumns: '1.6fr 1.4fr 40px' }}><span>Section</span><span>Sum Insured (₹)</span><span></span></div>
                  {(f.details.home_schedule || []).map((c, k) => (
                    <div className="wage-row" key={k} style={{ gridTemplateColumns: '1.6fr 1.4fr 40px' }}>
                      <Select value={c.section} onChange={(e) => setSched('home_schedule', k, 'section', e.target.value)}>{HOME_SECTIONS.map((x) => <option key={x} value={x}>{x}</option>)}</Select>
                      <input type="number" value={c.si} onChange={(e) => setSched('home_schedule', k, 'si', e.target.value)} placeholder="0" />
                      <button className="action-btn danger" title="Remove" onClick={() => rmSched('home_schedule', k)}><Ic name="x" size={14} /></button>
                    </div>
                  ))}
                  <button className="btn ghost da-btn" style={{ marginTop: 8 }} onClick={() => addSched('home_schedule', { section: 'Building / Structure', si: '' })}><Ic name="plus" size={14} /> Add section</button>
                  <div className="wage-totals"><span>Total Sum Insured: <b>₹ {inr(f.details.total_si || 0)}</b></span></div>
                </div>
                <div className="section-head">Covers &amp; Add-ons</div>
                <MultiChips options={HOME_ADDONS} value={f.add_ons} onChange={(v) => setF('add_ons', v)} />
                {renderPrev()}
                {renderDocs('Property / Contents Statement', '(valuation, jewellery list, prior claims…)', 'Property / contents statement is required before sending — insurers rate on the declared sum insured.')}
              </>
            ) : isEng ? (
              <>
                <div className="section-head">Project / Risk Details</div>
                <div className="form-grid">
                  <div className="form-field"><label>Engineering Type</label><Select value={f.details.eng_type || ENG_TYPES[0]} onChange={(e) => setD('eng_type', e.target.value)}>{ENG_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</Select></div>
                  <div className="form-field" style={{ gridColumn: 'span 2' }}><label>Project / Plant Description</label><input value={f.details.business || ''} onChange={(e) => setD('business', e.target.value)} placeholder="e.g. Construction of RCC bridge / DG set erection" /></div>
                  <div className="form-field"><label>Project / Plant Value (₹)</label><input type="number" value={f.details.project_value || ''} onChange={(e) => setD('project_value', e.target.value)} /></div>
                  <div className="form-field" style={{ gridColumn: 'span 2' }}><label>Location / Site</label><input value={f.details.location || ''} onChange={(e) => setD('location', e.target.value)} /></div>
                  <div className="form-field"><label>Commencement Date</label><DateField value={f.details.commencement || ''} onChange={(e) => setD('commencement', e.target.value)} /></div>
                  <div className="form-field"><label>Project Period (months)</label><input type="number" value={f.details.period_months || ''} onChange={(e) => setD('period_months', e.target.value)} /></div>
                  <div className="form-field"><label>Testing Period (weeks)</label><input type="number" value={f.details.testing_period || ''} onChange={(e) => setD('testing_period', e.target.value)} /></div>
                </div>
                <div className="section-head">Extensions</div>
                <MultiChips options={ENG_ADDONS} value={f.add_ons} onChange={(v) => setF('add_ons', v)} />
                {renderPrev()}
                {renderDocs('Project / Plant Details', '(BOQ, contract, plant list, site layout…)', 'Project / plant details are required before sending — insurers rate on the contract / plant value.')}
              </>
            ) : (
              <>
                <div className="section-head">Cover Required</div>
                <div className="form-grid">
                  <div className="form-field"><label>Product / Risk</label><input value={f.product} onChange={(e) => setF('product', e.target.value)} /></div>
                  <div className="form-field"><label>Sum Assured (₹)</label><input type="number" value={f.sum_assured} onChange={(e) => setF('sum_assured', e.target.value)} /></div>
                  <div className="form-field"><label>Expected Premium (₹)</label><input type="number" value={f.details.expected_premium || ''} onChange={(e) => setD('expected_premium', e.target.value)} /></div>
                  <div className="form-field" style={{ gridColumn: 'span 3' }}><label>Requirement / Risk Details</label><textarea rows={2} value={f.requirement} onChange={(e) => setF('requirement', e.target.value)} /></div>
                </div>
              </>
            )}

            <div className="section-head">Insurers &amp; Quotes</div>
            <div className="switch-row" style={{ marginBottom: 10 }}>
              <span className="sr-label">Include addressed insurer list in RFQ PDF</span>
              <Toggle checked={!!f.details.include_quotes_pdf} onChange={(v) => setD('include_quotes_pdf', v)} label="Include addressed insurer list in RFQ PDF" />
            </div>
            <div className="quote-opts">
              {f.insurers.map((o, i) => (
                <div className="ins-row" key={i}>
                  <div className="ins-main">
                    {companyOpts.length
                      ? <SearchSelect value={o.insurer} onChange={(v) => setIns(i, { insurer: v, email: emailMap[v] || o.email })} options={companyOpts}
                          onAdd={async (name) => { await api('/masters/companies', { method: 'POST', body: { company_name: name, type: 'GI' } }); setCompanies((c) => (c.includes(name) ? c : [...c, name].sort())); }}
                          placeholder="Select insurer" />
                      : <input value={o.insurer} onChange={(e) => setIns(i, { insurer: e.target.value })} placeholder="Insurer name" />}
                    <input value={o.email} onChange={(e) => setIns(i, { email: e.target.value })} placeholder="Insurer email" />
                    <Select value={o.status} onChange={(e) => setIns(i, { status: e.target.value })}>{RESP.map((s) => <option key={s} value={s}>{s}</option>)}</Select>
                    <button className="action-btn danger" title="Remove" onClick={() => removeIns(i)} disabled={f.insurers.length === 1}><Ic name="x" size={14} /></button>
                  </div>
                  {o.status === 'Declined' && (
                    <div className="ins-decline">
                      <div className="im-field" style={{ flex: 1 }}>
                        <label>Reason not quoted</label>
                        <SearchSelect
                          value={o.decline_reason || ''}
                          onChange={(v) => setIns(i, { decline_reason: v })}
                          options={DECLINE_REASONS}
                          onAdd={async () => {}}
                          placeholder="Why didn't they quote?"
                        />
                      </div>
                    </div>
                  )}
                  {o.status === 'Quoted' && (
                    <>
                      {(rated6 || rated5) ? (
                        <div className={'ins-quote ' + (rated6 ? 'wc' : 'r5')}>
                          <div><label>{baseLabel}</label><input type="number" value={baseVal || 0} readOnly /></div>
                          <div><label>Rate ‰</label><input type="number" step="0.01" value={o.wc_rate} onChange={(e) => setIns(i, { wc_rate: e.target.value })} placeholder="per mille" /></div>
                          <div><label>Basic Prem.</label><input type="number" value={o.wc_basic} onChange={(e) => setIns(i, { wc_basic: e.target.value })} /></div>
                          {rated6 && <div><label>{isGPA ? 'TTD / Med.' : 'Medical Ext.'}</label><input type="number" value={o.wc_medical} onChange={(e) => setIns(i, { wc_medical: e.target.value })} /></div>}
                          <div><label>Add-on</label><input type="number" value={o.addon_premium} onChange={(e) => setIns(i, { addon_premium: e.target.value })} /></div>
                          <div><label>Total</label><input type="number" value={o.premium} onChange={(e) => setIns(i, { premium: e.target.value })} readOnly /></div>
                        </div>
                      ) : isGHI ? (
                        <div className="ins-quote ghi">
                          <div><label>Lives</label><input type="number" value={f.details.total_lives || 0} readOnly /></div>
                          <div><label>Per-Family ₹</label><input type="number" value={o.wc_rate} onChange={(e) => setIns(i, { wc_rate: e.target.value })} placeholder="per family" /></div>
                          <div><label>Net Premium</label><input type="number" value={o.wc_basic} onChange={(e) => setIns(i, { wc_basic: e.target.value })} /></div>
                          <div><label>Add-on / Loading</label><input type="number" value={o.addon_premium} onChange={(e) => setIns(i, { addon_premium: e.target.value })} /></div>
                          <div><label>Total</label><input type="number" value={o.premium} onChange={(e) => setIns(i, { premium: e.target.value })} readOnly /></div>
                        </div>
                      ) : isHealthR ? (
                        <div className="ins-quote ghi">
                          <div><label>Sum Insured</label><input type="number" value={f.details.si_per_family || 0} readOnly /></div>
                          <div><label>Members</label><input type="number" value={f.details.total_members || 0} readOnly /></div>
                          <div><label>Net Premium</label><input type="number" value={o.wc_basic} onChange={(e) => setIns(i, { wc_basic: e.target.value })} /></div>
                          <div><label>Add-on / Loading</label><input type="number" value={o.addon_premium} onChange={(e) => setIns(i, { addon_premium: e.target.value })} /></div>
                          <div><label>Total</label><input type="number" value={o.premium} onChange={(e) => setIns(i, { premium: e.target.value })} readOnly /></div>
                        </div>
                      ) : (
                        <div className="ins-quote">
                          <div><label>IDV</label><input type="number" value={o.idv} onChange={(e) => setIns(i, { idv: e.target.value })} /></div>
                          <div><label>OD Premium</label><input type="number" value={o.od_premium} onChange={(e) => setIns(i, { od_premium: e.target.value })} /></div>
                          <div><label>TP Premium</label><input type="number" value={o.tp_premium} onChange={(e) => setIns(i, { tp_premium: e.target.value })} /></div>
                          <div><label>Add-on</label><input type="number" value={o.addon_premium} onChange={(e) => setIns(i, { addon_premium: e.target.value })} /></div>
                          <div><label>Total</label><input type="number" value={o.premium} onChange={(e) => setIns(i, { premium: e.target.value })} readOnly /></div>
                        </div>
                      )}
                      <div className="ins-meta">
                        <div className="im-field"><label>Transaction</label><Select value={o.txn || 'Quote'} onChange={(e) => setIns(i, { txn: e.target.value })}><option>Quote</option><option>Renewal</option><option>New</option><option>Rollover</option></Select></div>
                        {isMotor && <div className="im-field"><label>NCB %</label><input value={o.ncb} onChange={(e) => setIns(i, { ncb: e.target.value })} placeholder={f.details.ncb_pct || '0'} /></div>}
                        <label className="im-rec"><input type="radio" name="recommend" checked={!!o.selected} onChange={() => setRecommend(i)} /> Recommend</label>
                        {o.client_approved ? (
                          <span className="im-approved" title={o.approved_at ? `Marked approved ${o.approved_at}` : undefined}>
                            <Ic name="check" size={13} />
                            Approved by customer{o.approved_by ? ` (${o.approved_by})` : ''}
                            <button type="button" className="action-btn danger" title="Undo approval" onClick={() => clearApproval(i)}><Ic name="x" size={11} /></button>
                          </span>
                        ) : (
                          <button type="button" className="btn ghost sm im-approve" onClick={() => approveByClient(i)} title="Record that the client chose this quote">
                            <Ic name="check" size={13} /> Client approved
                          </button>
                        )}
                        <div className="im-attach">
                          {o.quote_name
                            ? <span className="attached"><Ic name="file" size={14} /><button type="button" className="dt-link" onClick={() => viewDoc(o.quote_doc)} style={{ maxWidth: 180 }}>{o.quote_name}</button><button type="button" className="action-btn danger" title="Remove file" onClick={() => setIns(i, { quote_doc: '', quote_name: '' })}><Ic name="x" size={12} /></button></span>
                            : <button type="button" className="btn ghost" onClick={() => triggerAttach(i)}><Ic name="upload" size={14} /> Attach insurer PDF</button>}
                        </div>
                      </div>
                      {f.add_ons.length > 0 && (
                        <div className="ins-cover">
                          <label>Add-ons covered by this insurer</label>
                          <MultiChips options={f.add_ons} value={o.addons_incl ?? f.add_ons} onChange={(v) => setIns(i, { addons_incl: v })} />
                        </div>
                      )}
                    </>
                  )}
                </div>
              ))}
              <button className="btn ghost" style={{ marginTop: 10 }} onClick={addIns}><Ic name="plus" size={15} /> Add insurer</button>
              <input ref={attachRef} type="file" accept="application/pdf" hidden onChange={onAttach} />
            </div>

            <div className="section-head">Notes</div>
            <div className="form-field"><textarea rows={2} value={f.remarks} onChange={(e) => setF('remarks', e.target.value)} placeholder="Internal remarks" /></div>

            <div className="section-head">Message</div>
            <div className="form-field"><textarea rows={6} value={f.details.message || ''} onChange={(e) => setD('message', e.target.value)} placeholder="Message to include for this RFQ…" /></div>
          </>
        )}
      </Modal>

      <CompareModal rfq={compareRfq} onClose={() => setCompareRfq(null)} onPdf={comparePdf} onShare={shareClient} onConvert={convert} />
    </div>
  );
}

// A labelled document upload slot (RC book / previous policy).
function DocAttach({ label, required, name, onPick, onView, onRemove }) {
  return (
    <div className="doc-attach">
      <span className="da-label">{label}{required && <span className="req"> *</span>}</span>
      {name
        ? <span className="da-file"><Ic name="file" size={14} /><button type="button" className="dt-link" onClick={onView}>{name}</button><button type="button" className="action-btn danger" title="Remove" onClick={onRemove}><Ic name="x" size={12} /></button></span>
        : <button type="button" className={'btn ghost da-btn' + (required ? ' req-btn' : '')} onClick={onPick}><Ic name="upload" size={14} /> Upload</button>}
    </div>
  );
}

// On-screen comparison — same matrix as the PDF, viewable in one click.
function CompareModal({ rfq, onClose, onPdf, onShare, onConvert }) {
  if (!rfq) return null;
  const d = parse(rfq.details, {});
  const quoted = parse(rfq.insurers, []).filter((i) => Number(i.premium) > 0);
  const requested = parse(rfq.add_ons, []);
  const addonRows = requested.length ? requested : [...new Set(quoted.flatMap((i) => parse(i.addons_incl, [])))];
  const selected = quoted.find((i) => i.selected) || quoted.reduce((a, b) => (!a || Number(b.premium) < Number(a.premium) ? b : a), null);
  const isSel = (i) => selected && i.insurer === selected.insurer;
  const covers = (i, a) => {
    const raw = i.addons_incl;
    let l = Array.isArray(raw) ? raw : null;
    if (!l && typeof raw === 'string' && raw.trim().startsWith('[')) { try { l = JSON.parse(raw); } catch { l = null; } }
    return Array.isArray(l) ? l.includes(a) : true; // no explicit list => covers all requested
  };
  const txnOf = (i) => i.txn || 'Quote';
  const isWCr = rfq.category === 'Workmen Compensation';
  const isGPAr = rfq.category === 'Group Personal Accident';
  const isGHIr = rfq.category === 'Group Health Insurance';
  const isFireR = rfq.category === 'Fire & Property';
  const isMarineR = rfq.category === 'Marine Cargo';
  const isLiabR = rfq.category === 'Liability';
  const isGTLR = rfq.category === 'Group Term Life';
  const isHealthRr = rfq.category === 'Retail Health';
  const isHomeR = rfq.category === 'Householder';
  const isEngR = rfq.category === 'Engineering';
  const isGroup = isWCr || isGPAr || isGHIr || isFireR || isMarineR || isLiabR || isGTLR || isHealthRr || isHomeR || isEngR;
  const subtitle = isGroup ? (d.business || rfq.product || rfq.category) : ([d.make, d.model, d.reg_no].filter(Boolean).join(' ') || rfq.product);
  // Helpers for the simpler "sum insured × rate" matrices (Fire / Marine / Liability / GTL).
  const th = quoted.map((i, k) => <td key={k} className={'ins' + (isSel(i) ? ' sel' : '')}>{shortIns(i.insurer)}</td>);
  const cellRow = (fn) => quoted.map((i, k) => <td key={k} className={isSel(i) ? 'sel' : ''}>{fn(i)}</td>);
  const totRow = quoted.map((i, k) => <td key={k} className={'tot' + (isSel(i) ? ' sel' : '')}>{inr(i.premium)}</td>);
  const addonMx = () => addonRows.map((a) => <tr key={a}><td className="lbl">{a}</td>{quoted.map((i, k) => <td key={k} className={isSel(i) ? 'sel' : ''}>{covers(i, a) ? <span className="yes">YES</span> : <span className="no">NO</span>}</td>)}</tr>);
  const ratedMatrix = (bLabel, bVal, infoRows) => (
    <>
      <tr><td className="lbl">{bLabel} — ₹ {inr(bVal)}</td>{th}</tr>
      {infoRows}
      <tr><td className="lbl">Rate ‰ (per mille)</td>{cellRow((i) => i.wc_rate || '—')}</tr>
      <tr><td className="lbl">Basic Premium</td>{cellRow((i) => inr(i.wc_basic || 0))}</tr>
      {addonMx()}
      <tr className="total"><td className="lbl">TOTAL PREMIUM</td>{totRow}</tr>
    </>
  );
  return (
    <Modal open={!!rfq} onClose={onClose} title={`Premium Comparison · ${rfq.client_name}`} subtitle={subtitle} icon="chart" size="lg"
      footer={<>
        <button className="btn ghost" onClick={onClose}>Close</button>
        <button className="btn ghost" onClick={() => onShare(rfq)}><Ic name="send" size={15} /> Share Client</button>
        <button className="btn ghost" onClick={() => onPdf(rfq)}><Ic name="file-export" size={15} /> Download PDF</button>
        <button className="btn blue" onClick={() => { onClose(); onConvert(rfq); }}><Ic name="doc" size={15} /> Create Quotation</button>
      </>}>
      <div className="cmp-scroll">
        <table className="cmp-matrix">
          <tbody>
            {isWCr ? (
              <>
                <tr><td className="lbl">Wage Roll — ₹ {inr(d.wage_roll || 0)}</td>{quoted.map((i, k) => <td key={k} className={'ins' + (isSel(i) ? ' sel' : '')}>{shortIns(i.insurer)}</td>)}</tr>
                <tr><td className="lbl">No. of Employees</td>{quoted.map((i, k) => <td key={k} className={isSel(i) ? 'sel' : ''}>{d.total_employees || '—'}</td>)}</tr>
                <tr><td className="lbl">Rate ‰ (per mille)</td>{quoted.map((i, k) => <td key={k} className={isSel(i) ? 'sel' : ''}>{i.wc_rate || '—'}</td>)}</tr>
                <tr><td className="lbl">Basic Premium</td>{quoted.map((i, k) => <td key={k} className={isSel(i) ? 'sel' : ''}>{inr(i.wc_basic || 0)}</td>)}</tr>
                <tr><td className="lbl">Medical Extension</td>{quoted.map((i, k) => <td key={k} className={isSel(i) ? 'sel' : ''}>{Number(i.wc_medical) > 0 ? inr(i.wc_medical) : <span className="no">NO</span>}</td>)}</tr>
                {addonRows.filter((a) => a !== 'Medical Extension').map((a) => <tr key={a}><td className="lbl">{a}</td>{quoted.map((i, k) => <td key={k} className={isSel(i) ? 'sel' : ''}>{covers(i, a) ? <span className="yes">YES</span> : <span className="no">NO</span>}</td>)}</tr>)}
                <tr className="total"><td className="lbl">TOTAL PREMIUM</td>{quoted.map((i, k) => <td key={k} className={'tot' + (isSel(i) ? ' sel' : '')}>{inr(i.premium)}</td>)}</tr>
              </>
            ) : isGPAr ? (
              <>
                <tr><td className="lbl">Total CSI — ₹ {inr(d.total_csi || 0)}</td>{quoted.map((i, k) => <td key={k} className={'ins' + (isSel(i) ? ' sel' : '')}>{shortIns(i.insurer)}</td>)}</tr>
                <tr><td className="lbl">No. of Members</td>{quoted.map((i, k) => <td key={k} className={isSel(i) ? 'sel' : ''}>{d.total_members || '—'}</td>)}</tr>
                <tr><td className="lbl">Rate ‰ (per mille)</td>{quoted.map((i, k) => <td key={k} className={isSel(i) ? 'sel' : ''}>{i.wc_rate || '—'}</td>)}</tr>
                <tr><td className="lbl">Basic Premium</td>{quoted.map((i, k) => <td key={k} className={isSel(i) ? 'sel' : ''}>{inr(i.wc_basic || 0)}</td>)}</tr>
                <tr><td className="lbl">TTD / Medical</td>{quoted.map((i, k) => <td key={k} className={isSel(i) ? 'sel' : ''}>{Number(i.wc_medical) > 0 ? inr(i.wc_medical) : <span className="no">NO</span>}</td>)}</tr>
                {addonRows.filter((a) => !['Medical Extension', 'Temporary Total Disablement (Weekly)'].includes(a)).map((a) => <tr key={a}><td className="lbl">{a}</td>{quoted.map((i, k) => <td key={k} className={isSel(i) ? 'sel' : ''}>{covers(i, a) ? <span className="yes">YES</span> : <span className="no">NO</span>}</td>)}</tr>)}
                <tr className="total"><td className="lbl">TOTAL PREMIUM</td>{quoted.map((i, k) => <td key={k} className={'tot' + (isSel(i) ? ' sel' : '')}>{inr(i.premium)}</td>)}</tr>
              </>
            ) : isGHIr ? (
              <>
                <tr><td className="lbl">Sum Insured / Family — ₹ {inr(d.si_per_family || 0)}</td>{quoted.map((i, k) => <td key={k} className={'ins' + (isSel(i) ? ' sel' : '')}>{shortIns(i.insurer)}</td>)}</tr>
                <tr><td className="lbl">Family Definition</td>{quoted.map((i, k) => <td key={k} className={isSel(i) ? 'sel' : ''} style={{ fontSize: 10 }}>{d.family_def || '—'}</td>)}</tr>
                <tr><td className="lbl">Lives Covered</td>{quoted.map((i, k) => <td key={k} className={isSel(i) ? 'sel' : ''}>{d.total_lives || '—'}</td>)}</tr>
                <tr><td className="lbl">Per-Family Premium</td>{quoted.map((i, k) => <td key={k} className={isSel(i) ? 'sel' : ''}>{Number(i.wc_rate) > 0 ? inr(i.wc_rate) : '—'}</td>)}</tr>
                <tr><td className="lbl">Net Premium</td>{quoted.map((i, k) => <td key={k} className={isSel(i) ? 'sel' : ''}>{inr(i.wc_basic || 0)}</td>)}</tr>
                {addonRows.map((a) => <tr key={a}><td className="lbl">{a}</td>{quoted.map((i, k) => <td key={k} className={isSel(i) ? 'sel' : ''}>{covers(i, a) ? <span className="yes">YES</span> : <span className="no">NO</span>}</td>)}</tr>)}
                <tr className="total"><td className="lbl">TOTAL PREMIUM</td>{quoted.map((i, k) => <td key={k} className={'tot' + (isSel(i) ? ' sel' : '')}>{inr(i.premium)}</td>)}</tr>
              </>
            ) : isFireR ? ratedMatrix('Total Sum Insured', d.total_si, <tr><td className="lbl">Occupancy</td>{cellRow(() => d.occupancy || '—')}</tr>)
              : isMarineR ? ratedMatrix('Sum Insured', d.consignment_si, <><tr><td className="lbl">Transit</td>{cellRow(() => [d.from, d.to].filter(Boolean).join(' → ') || '—')}</tr><tr><td className="lbl">Cover Basis</td>{cellRow(() => d.cover_basis || '—')}</tr></>)
                : isLiabR ? ratedMatrix('Limit of Indemnity (AOY)', d.limit_aoy, <tr><td className="lbl">Liability Type</td>{cellRow(() => d.liability_type || '—')}</tr>)
                  : isGTLR ? ratedMatrix('Total Sum Assured', d.total_sa, <tr><td className="lbl">No. of Members</td>{cellRow(() => d.total_members || '—')}</tr>)
                    : isHomeR ? ratedMatrix('Total Sum Insured', d.total_si, <tr><td className="lbl">Property</td>{cellRow(() => d.property_type || '—')}</tr>)
                      : isEngR ? ratedMatrix('Project / Plant Value', d.project_value, <tr><td className="lbl">Type</td>{cellRow(() => (d.eng_type || '—').replace(/\s*\(.*\)/, ''))}</tr>)
                        : isHealthRr ? (
                          <>
                            <tr><td className="lbl">Sum Insured — ₹ {inr(d.si_per_family || 0)}</td>{th}</tr>
                            <tr><td className="lbl">Members / Eldest Age</td>{cellRow(() => `${d.total_members || 0} / ${d.eldest_age || 0} yr`)}</tr>
                            <tr><td className="lbl">Net Premium</td>{cellRow((i) => inr(i.wc_basic || 0))}</tr>
                            {addonMx()}
                            <tr className="total"><td className="lbl">TOTAL PREMIUM</td>{totRow}</tr>
                          </>
                        ) : (
                          <>
                            <tr><td className="lbl">Registration Year — {d.mfg_year || '—'}</td>{quoted.map((i, k) => <td key={k} className={isSel(i) ? 'sel' : ''}>{txnOf(i)}</td>)}</tr>
                            <tr><td className="lbl">{[d.vehicle_class || 'Vehicle', d.cc].filter(Boolean).join(' ')}</td>{quoted.map((i, k) => <td key={k} className={'ins' + (isSel(i) ? ' sel' : '')}>{shortIns(i.insurer)}</td>)}</tr>
                            <tr><td className="lbl">NCB</td>{quoted.map((i, k) => <td key={k} className={isSel(i) ? 'sel' : ''}>{(i.ncb || d.ncb_pct || '0')}%</td>)}</tr>
                            <tr><td className="lbl">IDV</td>{quoted.map((i, k) => <td key={k} className={isSel(i) ? 'sel' : ''}>{Number(i.idv || rfq.requested_idv || 0).toLocaleString('en-IN')}</td>)}</tr>
                            {addonRows.map((a) => <tr key={a}><td className="lbl">{a}</td>{quoted.map((i, k) => <td key={k} className={isSel(i) ? 'sel' : ''}>{covers(i, a) ? <span className="yes">YES</span> : <span className="no">NO</span>}</td>)}</tr>)}
                            <tr className="total"><td className="lbl">TOTAL</td>{quoted.map((i, k) => <td key={k} className={'tot' + (isSel(i) ? ' sel' : '')}>{Number(i.premium).toLocaleString('en-IN')}</td>)}</tr>
                          </>
                        )}
          </tbody>
        </table>
      </div>
      {selected && <div className="cmp-reco"><Ic name="check" size={16} /> Recommended: <b>{selected.insurer}</b> at ₹ {Number(selected.premium).toLocaleString('en-IN')}{quoted.some((i) => i.quote_name) ? ` · Original quotes on file: ${quoted.filter((i) => i.quote_name).map((i) => shortIns(i.insurer)).join(', ')}` : ''}</div>}
    </Modal>
  );
}
