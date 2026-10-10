import { useEffect, useState, useMemo, useRef } from 'react';
import { api } from '../api.js';
import toast from '../components/toast.js';
import Modal from '../components/Modal.jsx';
import Select from '../components/Select.jsx';
import SearchSelect from '../components/SearchSelect.jsx';
import DateField from '../components/DateField.jsx';
import { Ic } from '../components/Icons.jsx';
import {
  INSURANCE_LINES, PRODUCTS, policyTypesFor, CURRENCIES, POLICY_MODES, PAYMENT_MODES,
  POLICY_STATUSES, ACTIVE_STATUSES, POLICY_WITH_US, NOMINEE_RELATIONS, NCB_PCTS,
  isLife, isMotor, isHealth, isLost, rateEditable, sumAssuredLabel, emptyPolicy,
} from './policyConstants.js';

// Shared by the Policies module and the Policies related list on a client.
// `lockClient` pins the policy holder (when created from a client record).
export default function PolicyFormModal({ open, policyId, seed, lockClient, onClose, onSaved }) {
  const [f, setF] = useState(emptyPolicy);
  const [saving, setSaving] = useState(false);
  const [users, setUsers] = useState([]);
  const [clients, setClients] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [associateOpts, setAssociateOpts] = useState([]);

  // A new associate is saved to the shared lookup as well as selected, so the
  // next policy offers it instead of needing it typed again.
  const addAssociate = async (name) => {
    await api('/lookups/associate', { method: 'POST', body: { name } });
    setAssociateOpts((l) => (l.includes(name) ? l : [...l, name].sort()));
  };
  const fileRef = useRef(null);

  const seedRef = useRef(seed);
  seedRef.current = seed;

  useEffect(() => {
    if (!open) return;
    setF({ ...emptyPolicy(), ...(seedRef.current || {}) });
  }, [open]);

  useEffect(() => {
    if (!open || users.length || clients.length) return;
    api('/users').then(setUsers).catch(() => {});
    api('/clients').then(setClients).catch(() => {});
    api('/masters/companies').then(setCompanies).catch(() => {});
    api('/lookups/associate').then((l) => setAssociateOpts(l.map((x) => x.name))).catch(() => {});
  }, [open]);

  const userNames = useMemo(() => users.map((u) => u.full_name || u.username).filter(Boolean), [users]);
  const clientNames = useMemo(() => clients.map((c) => c.client_name).filter(Boolean), [clients]);
  const companyNames = useMemo(
    () => companies.filter((c) => !f.insurance_line || c.type === f.insurance_line).map((c) => c.company_name),
    [companies, f.insurance_line]
  );

  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));

  // Changing the line invalidates the product, which invalidates the variant.
  function setLine(line) {
    setF((p) => ({ ...p, insurance_line: line, insurance_type: '', policy_type: '', company_name: '' }));
  }
  function setProduct(product) {
    setF((p) => ({ ...p, insurance_type: product, policy_type: '' }));
  }
  function pickClient(name) {
    const c = clients.find((x) => x.client_name === name);
    setF((p) => ({ ...p, insured_name: name, client_id: c?.id ?? null, client_email: c?.email || p.client_email }));
  }

  // Total = Basic + GST, unless the user has typed a total of their own.
  function setBasic(v) {
    setF((p) => {
      const gst = Number(p.gst_amount) || 0;
      const autoTotal = (Number(p.net_premium) || 0) + gst;
      const totalWasAuto = !p.final_premium || Number(p.final_premium) === autoTotal;
      const next = { ...p, net_premium: v };
      if (totalWasAuto) next.final_premium = String((Number(v) || 0) + gst);
      return next;
    });
  }
  function setGst(v) {
    setF((p) => {
      const basic = Number(p.net_premium) || 0;
      const autoTotal = basic + (Number(p.gst_amount) || 0);
      const totalWasAuto = !p.final_premium || Number(p.final_premium) === autoTotal;
      const next = { ...p, gst_amount: v };
      if (totalWasAuto) next.final_premium = String(basic + (Number(v) || 0));
      return next;
    });
  }

  function onDoc(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) { toast.error('Policy document must be under 8 MB'); return; }
    const reader = new FileReader();
    reader.onload = () => setF((p) => ({ ...p, policy_doc: reader.result, policy_doc_name: file.name }));
    reader.readAsDataURL(file);
  }

  async function save() {
    if (!f.product_name.trim()) { toast.error('Product is required'); return; }
    if (!f.policy_with_us) { toast.error('Policy with Us is required'); return; }
    if (f.period_from && f.period_to && f.period_to < f.period_from) {
      toast.error('Renewal date cannot be before the policy start date'); return;
    }
    setSaving(true);
    try {
      const row = policyId
        ? await api('/policies/' + policyId, { method: 'PUT', body: f })
        : await api('/policies', { method: 'POST', body: f });
      toast.success(policyId ? 'Policy updated' : 'Policy created');
      onSaved?.(row);
      onClose?.();
    } catch (e) {
      toast.error(e.message || 'Could not save policy');
    } finally { setSaving(false); }
  }

  const life = isLife(f), motor = isMotor(f), health = isHealth(f), lost = isLost(f);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={policyId ? 'Edit Policy' : 'New Policy'}
      subtitle="Fields adapt to the insurance type and product you choose"
      icon="file"
      size="lg"
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn blue" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : policyId ? 'Update Policy' : 'Save Policy'}
          </button>
        </>
      }
    >
      {open && (
        <>
          {/* ---- policy details ---- */}
          <div className="form-grid">
            <div className="form-field"><label>Product <span className="req">*</span></label>
              <input value={f.product_name} onChange={(e) => set('product_name', e.target.value)} placeholder="e.g. Jeevan Anand / Pvt Car Package" /></div>
            <div className="form-field"><label>Login Date</label>
              <DateField value={f.login_date} onChange={(e) => set('login_date', e.target.value)} /></div>
            <div className="form-field"><label>Associate</label>
              <SearchSelect
                value={f.associate || ''}
                onChange={(v) => set('associate', v)}
                options={associateOpts}
                onAdd={addAssociate}
                placeholder="Select or add associate"
              /></div>

            <div className="form-field"><label>Policy Holder Name</label>
              {lockClient ? (
                <input value={f.insured_name} readOnly />
              ) : (
                <SearchSelect value={f.insured_name} onChange={pickClient} options={clientNames} placeholder="Select client…" />
              )}
            </div>
            <div className="form-field"><label>Client Email</label>
              <input value={f.client_email} onChange={(e) => set('client_email', e.target.value)} placeholder="name@example.com" /></div>
            <div className="form-field"><label>Insurance Owner</label>
              <Select value={f.assigned_to} onChange={(e) => set('assigned_to', e.target.value)}>
                <option value="">Me</option>
                {userNames.map((u) => <option key={u} value={u}>{u}</option>)}
              </Select></div>

            <div className="form-field"><label>Type</label>
              <Select value={f.insurance_line} onChange={(e) => setLine(e.target.value)}>
                {INSURANCE_LINES.map((l) => <option key={l.v} value={l.v}>{l.label}</option>)}
              </Select></div>
            <div className="form-field"><label>Policy</label>
              <Select value={f.insurance_type} onChange={(e) => setProduct(e.target.value)}>
                <option value="">Select…</option>
                {(PRODUCTS[f.insurance_line] || []).map((p) => <option key={p} value={p}>{p}</option>)}
              </Select></div>
            <div className="form-field"><label>Policy Type</label>
              <Select value={f.policy_type} onChange={(e) => set('policy_type', e.target.value)} disabled={!f.insurance_type}>
                <option value="">{f.insurance_type ? 'Select…' : 'Choose a Policy first'}</option>
                {f.insurance_type && policyTypesFor(f.insurance_type).map((t) => <option key={t} value={t}>{t}</option>)}
              </Select></div>

            <div className="form-field"><label>Insurance Company Name</label>
              <SearchSelect value={f.company_name} onChange={(v) => set('company_name', v)} options={companyNames} placeholder="Select insurer…" /></div>
            <div className="form-field"><label>Policy No</label>
              <input value={f.policy_number} onChange={(e) => set('policy_number', e.target.value)} /></div>
            <div className="form-field" />
          </div>

          {/* ---- premium & term ---- */}
          <div className="sub-section">
            <div className="section-head">Premium &amp; Term</div>
            <div className="form-grid">
              <div className="form-field"><label>Currency</label>
                <Select value={f.currency} onChange={(e) => set('currency', e.target.value)}>
                  {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </Select></div>
              <div className="form-field"><label>Exchange Rate</label>
                <input type="number" step="0.0001" value={rateEditable(f) ? f.exchange_rate : 1}
                  onChange={(e) => set('exchange_rate', e.target.value)} disabled={!rateEditable(f)} />
                {!rateEditable(f) && <div className="hint-line">Fixed at 1 for INR — pick another currency to edit.</div>}
              </div>
              <div className="form-field" />

              <div className="form-field"><label>{sumAssuredLabel(f)}</label>
                <input type="number" value={f.sum_assured} onChange={(e) => set('sum_assured', e.target.value)} placeholder="0" /></div>
              <div className="form-field"><label>Basic Premium</label>
                <input type="number" value={f.net_premium} onChange={(e) => setBasic(e.target.value)} placeholder="0" /></div>
              <div className="form-field"><label>GST Amount</label>
                <input type="number" value={f.gst_amount} onChange={(e) => setGst(e.target.value)} placeholder="0" /></div>

              <div className="form-field"><label>Total Premium</label>
                <input type="number" value={f.final_premium} onChange={(e) => set('final_premium', e.target.value)} placeholder="0" />
                <div className="hint-line">Auto-sums Basic + GST until you override it.</div>
              </div>
              <div className="form-field"><label>Payment Mode</label>
                <Select value={f.payment_type} onChange={(e) => set('payment_type', e.target.value)}>
                  <option value="">Select…</option>
                  {PAYMENT_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
                </Select></div>
              <div className="form-field" />

              {/* Term, PPT, premium frequency and bonus are life-side concepts. */}
              {life && (
                <>
                  <div className="form-field"><label>Policy Mode</label>
                    <Select value={f.policy_mode} onChange={(e) => set('policy_mode', e.target.value)}>
                      <option value="">Select…</option>
                      {POLICY_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
                    </Select></div>
                  <div className="form-field"><label>Term (years)</label>
                    <input value={f.term_years} onChange={(e) => set('term_years', e.target.value)} /></div>
                  <div className="form-field"><label>Premium Paying Term</label>
                    <input value={f.ppt_years} onChange={(e) => set('ppt_years', e.target.value)} /></div>
                  <div className="form-field"><label>Cumulative Bonus</label>
                    <input type="number" value={f.cumulative_bonus} onChange={(e) => set('cumulative_bonus', e.target.value)} placeholder="0" /></div>
                  <div className="form-field" /><div className="form-field" />
                </>
              )}
            </div>
          </div>

          {/* ---- dates ---- */}
          <div className="sub-section">
            <div className="section-head">Dates</div>
            <div className="form-grid">
              <div className="form-field"><label>Policy Start Date</label>
                <DateField value={f.period_from} onChange={(e) => set('period_from', e.target.value)} /></div>
              <div className="form-field"><label>Renewal Date</label>
                <DateField value={f.period_to} onChange={(e) => set('period_to', e.target.value)} />
                <div className="hint-line">Drives the renewal pipeline on the dashboard.</div>
              </div>
              <div className="form-field" />
              {life && (
                <>
                  <div className="form-field"><label>Commencement Date</label>
                    <DateField value={f.commencement_date} onChange={(e) => set('commencement_date', e.target.value)} /></div>
                  <div className="form-field"><label>Date of Maturity</label>
                    <DateField value={f.maturity_date} onChange={(e) => set('maturity_date', e.target.value)} /></div>
                  <div className="form-field" />
                </>
              )}
            </div>
          </div>

          {/* ---- nominee: life only ---- */}
          {life && (
            <div className="sub-section">
              <div className="section-head">Nominee</div>
              <div className="form-grid">
                <div className="form-field"><label>Nominee Name</label>
                  <input value={f.nominee_name} onChange={(e) => set('nominee_name', e.target.value)} /></div>
                <div className="form-field"><label>Nominee Age</label>
                  <input value={f.nominee_age} onChange={(e) => set('nominee_age', e.target.value)} /></div>
                <div className="form-field"><label>Relation with Nominee</label>
                  <Select value={f.nominee_relation} onChange={(e) => set('nominee_relation', e.target.value)}>
                    <option value="">Select…</option>
                    {NOMINEE_RELATIONS.map((r) => <option key={r} value={r}>{r}</option>)}
                  </Select></div>
              </div>
            </div>
          )}

          {/* ---- product specifics ---- */}
          {(motor || health) && (
            <div className="sub-section">
              <div className="section-head">{motor ? 'Vehicle Details' : 'Health Cover Details'}</div>
              <div className="form-grid">
                {motor && (
                  <>
                    <div className="form-field"><label>Registration No</label>
                      <input value={f.reg_no} onChange={(e) => set('reg_no', e.target.value)} placeholder="GJ01 AB 1234" /></div>
                    <div className="form-field"><label>NCB %</label>
                      <Select value={f.ncb_pct} onChange={(e) => set('ncb_pct', e.target.value)}>
                        <option value="">Select…</option>
                        {NCB_PCTS.map((n) => <option key={n} value={n}>{n}%</option>)}
                      </Select></div>
                    <div className="form-field" />
                  </>
                )}
                {health && (
                  <>
                    <div className="form-field"><label>Members Covered</label>
                      <input value={f.members_covered} onChange={(e) => set('members_covered', e.target.value)} placeholder="e.g. 1+3" /></div>
                    <div className="form-field"><label>Room Rent Limit</label>
                      <input value={f.room_rent} onChange={(e) => set('room_rent', e.target.value)} placeholder="e.g. 1% of SI / day" /></div>
                    <div className="form-field"><label>PED Waiting Period</label>
                      <input value={f.ped_waiting} onChange={(e) => set('ped_waiting', e.target.value)} placeholder="e.g. 2 years" /></div>
                  </>
                )}
              </div>
            </div>
          )}

          {/* ---- outcome, document, status ---- */}
          <div className="sub-section">
            <div className="section-head">Status &amp; Document</div>
            <div className="form-grid">
              <div className="form-field"><label>Policy with Us <span className="req">*</span></label>
                <Select value={f.policy_with_us} onChange={(e) => set('policy_with_us', e.target.value)}>
                  <option value="">Select…</option>
                  {POLICY_WITH_US.map((v) => <option key={v} value={v}>{v}</option>)}
                </Select></div>
              <div className="form-field"><label>Status</label>
                <Select value={f.policy_status} onChange={(e) => set('policy_status', e.target.value)}>
                  {POLICY_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                </Select></div>
              <div className="form-field"><label>Active / Inactive</label>
                <Select value={f.active_status} onChange={(e) => set('active_status', e.target.value)}>
                  {ACTIVE_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                </Select></div>
            </div>

            {/* Only meaningful when the business didn't come to us. */}
            {lost && (
              <div className="form-field" style={{ marginTop: 12 }}>
                <label>Reason for Lost Business</label>
                <textarea rows={3} value={f.lost_reason} onChange={(e) => set('lost_reason', e.target.value)}
                  placeholder="Why did this not convert?" />
              </div>
            )}

            <div className="form-field" style={{ marginTop: 12 }}>
              <label>Policy Upload</label>
              <div className="logo-row">
                <button type="button" className="btn ghost sm" onClick={() => fileRef.current?.click()}>
                  <Ic name="upload" size={14} /> {f.policy_doc_name || 'Choose file'}
                </button>
                {f.policy_doc && policyId && (
                  <>
                    {/* The name is the policy's, set by the server when it was saved — insured,
                        policy number, product — so what downloads is not "scan0042.pdf". */}
                    <a className="btn ghost sm" href={f.policy_doc} target="_blank" rel="noreferrer" title="Open in a new tab">
                      <Ic name="eye" size={14} /> Open
                    </a>
                    <a className="btn ghost sm" href={f.policy_doc} download={f.policy_doc_name || 'Policy'} title={f.policy_doc_name}>
                      <Ic name="file-export" size={14} /> Download
                    </a>
                  </>
                )}
                {f.policy_doc && (
                  <button type="button" className="action-btn danger" title="Remove document"
                    onClick={() => setF((p) => ({ ...p, policy_doc: '', policy_doc_name: '' }))}>
                    <Ic name="trash" size={14} />
                  </button>
                )}
                <input ref={fileRef} type="file" accept="application/pdf,image/*" hidden onChange={onDoc} />
              </div>
              {f.policy_doc && (
                <div className="hint-line">
                  {policyId
                    ? <>Saved as <b>{f.policy_doc_name}</b>. It goes out with the policy-issued email under that name.</>
                    : 'Once saved it is renamed for the policy — insured, policy number and product — and attached to the policy-issued email.'}
                </div>
              )}
            </div>

            <div className="form-field" style={{ marginTop: 12 }}>
              <label>Remarks</label>
              <textarea rows={2} value={f.remarks} onChange={(e) => set('remarks', e.target.value)} />
            </div>
          </div>
        </>
      )}
    </Modal>
  );
}
