import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import Select from './Select.jsx';
import SearchSelect from './SearchSelect.jsx';
import DateField, { fmt as fmtDate } from './DateField.jsx';
import { Ic } from './Icons.jsx';
import {
  CLIENT_CATEGORIES, CLIENT_STATUSES, FAMILY_TYPES, inFamily,
  REVIEW_FREQUENCIES, NOMINEE_RELATIONS, EMPTY_NOMINEE, nomineeShareTotal, emptyClient,
  BUSINESS_FIELDS, YES_NO, SALUTATIONS, RISK_PROFILES, CLIENT_CURRENCIES, FILE_EMAIL_OPTS,
} from '../pages/clientConstants.js';

export { emptyClient as EMPTY_CLIENT };

// `selfId` is excluded from the lookups so a client can't be picked as their
// own referrer or family head.
export default function ClientFormFields({ form, set, selfId, lastMeetingDate }) {
  const [clients, setClients] = useState([]);
  const [users, setUsers] = useState([]);

  useEffect(() => {
    api('/clients').then(setClients).catch(() => {});
    api('/users').then((u) => setUsers(u.map((x) => x.full_name || x.username).filter(Boolean))).catch(() => {});
  }, []);

  const others = useMemo(
    () => clients.filter((c) => !selfId || c.id !== Number(selfId)),
    [clients, selfId]
  );
  const otherNames = useMemo(() => others.map((c) => c.client_name).filter(Boolean), [others]);
  // Only actual heads (or ungrouped clients) make sense as a family head.
  const headNames = useMemo(
    () => others.filter((c) => c.family_type !== 'Family Member').map((c) => c.client_name).filter(Boolean),
    [others]
  );

  const nominees = Array.isArray(form.nominees) ? form.nominees : [];
  const shareTotal = nomineeShareTotal(nominees);

  function pickReferrer(name) {
    const c = others.find((x) => x.client_name === name);
    set('referred_by_client_name', name);
    set('referred_by_client_id', c?.id ?? null);
  }
  function pickHead(name) {
    const c = others.find((x) => x.client_name === name);
    set('family_head_name', name);
    set('family_head_id', c?.id ?? null);
  }
  function setFamilyType(t) {
    set('family_type', t);
    // Dropping to Individual clears the link so it can't linger unseen.
    if (!inFamily(t)) { set('family_head_id', null); set('family_head_name', ''); }
  }

  const setNominee = (i, k, v) => set('nominees', nominees.map((n, x) => (x === i ? { ...n, [k]: v } : n)));
  const addNominee = () => set('nominees', [...nominees, { ...EMPTY_NOMINEE }]);
  const removeNominee = (i) => set('nominees', nominees.filter((_, x) => x !== i));

  // Also shown when a head is already recorded: an imported client can carry one without the type being set.
  const showHead = inFamily(form.family_type) || !!form.family_head_name;

  return (
    <>
      <div className="form-grid">
        <div className="form-field"><label>Name <span className="req">*</span></label>
          <input value={form.client_name} onChange={(e) => set('client_name', e.target.value)} placeholder="Client's full name" /></div>
        <div className="form-field"><label>Mobile</label>
          <input value={form.mobile} onChange={(e) => set('mobile', e.target.value)} placeholder="10-digit mobile" /></div>
        <div className="form-field"><label>Email</label>
          <input value={form.email} onChange={(e) => set('email', e.target.value)} placeholder="name@example.com" /></div>

        <div className="form-field"><label>Client Category</label>
          <Select value={form.client_category} onChange={(e) => set('client_category', e.target.value)}>
            <option value="">Select…</option>
            {CLIENT_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </Select></div>
        <div className="form-field"><label>Client Owner</label>
          <Select value={form.owner} onChange={(e) => set('owner', e.target.value)}>
            <option value="">Me</option>
            {users.map((u) => <option key={u} value={u}>{u}</option>)}
          </Select></div>
        <div className="form-field"><label>Client Status</label>
          <Select value={form.client_status} onChange={(e) => set('client_status', e.target.value)}>
            {CLIENT_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </Select></div>

        <div className="form-field"><label>Lead Source</label>
          <input value={form.lead_source} readOnly placeholder="Set when a lead is converted" />
          <div className="hint-line">
            {form.lead_id ? 'Carried over from the converted lead.' : 'Populated automatically on lead conversion.'}
          </div>
        </div>
        <div className="form-field"><label>Referred By (Client)</label>
          <SearchSelect value={form.referred_by_client_name} onChange={pickReferrer} options={otherNames} placeholder="Select client…" />
        </div>
        <div className="form-field"><label>Date of Onboarding</label>
          <DateField value={form.onboarding_date} onChange={(e) => set('onboarding_date', e.target.value)} /></div>
      </div>

      <div className="sub-section">
        <div className="section-head">Family</div>
        <div className="form-grid">
          <div className="form-field"><label>Family or Individual</label>
            <Select value={form.family_type} onChange={(e) => setFamilyType(e.target.value)}>
              {FAMILY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </Select></div>
          {showHead && (
            <div className="form-field">
              <label>Family Head {form.family_type === 'Family Member' && <span className="req">*</span>}</label>
              <SearchSelect value={form.family_head_name} onChange={pickHead} options={headNames} placeholder="Select family head…" />
              {form.family_type === 'Family Head' && (
                <div className="hint-line">Optional — only if this head sits under a senior head.</div>
              )}
            </div>
          )}
          <div className="form-field" />
        </div>
      </div>

      <div className="sub-section">
        <div className="section-head">Personal &amp; KYC</div>
        <div className="form-grid">
          <div className="form-field"><label>Aadhar Card No</label>
            <input value={form.aadhar_no} onChange={(e) => set('aadhar_no', e.target.value)} placeholder="12-digit Aadhaar" /></div>
          <div className="form-field"><label>Salutation</label>
            <Select value={form.salutation || ''} onChange={(e) => set('salutation', e.target.value)} placeholder="Select">
              {SALUTATIONS.map((v) => <option key={v} value={v}>{v}</option>)}
            </Select></div>
          <div className="form-field"><label>Pan Card No</label>
            <input value={form.pan_no} onChange={(e) => set('pan_no', e.target.value.toUpperCase())} placeholder="ABCDE1234F" /></div>
          <div className="form-field"><label>GSTIN</label>
            <input value={form.gstin || ''} onChange={(e) => set('gstin', e.target.value.toUpperCase())} placeholder="22AAAAA0000A1Z5" /></div>
          <div className="form-field"><label>Date of Birth</label>
            <DateField value={form.dob} onChange={(e) => set('dob', e.target.value)} /></div>

          <div className="form-field"><label>Profession</label>
            <input value={form.occupation} onChange={(e) => set('occupation', e.target.value)} placeholder="e.g. Business, Salaried, Doctor" /></div>
          <div className="form-field"><label>Review Frequency</label>
            <Select value={form.review_frequency} onChange={(e) => set('review_frequency', e.target.value)}>
              <option value="">Select…</option>
              {REVIEW_FREQUENCIES.map((r) => <option key={r} value={r}>{r}</option>)}
            </Select></div>
          <div className="form-field"><label>Last Meeting Date</label>
            <input value={lastMeetingDate ? fmtDate(lastMeetingDate) : '—'} readOnly />
            <div className="hint-line">Read from the Meeting module — the most recent past meeting.</div>
          </div>

          <div className="form-field"><label>Anniversary</label>
            <DateField value={form.anniversary} onChange={(e) => set('anniversary', e.target.value)} /></div>
          <div className="form-field"><label>Group Head Name</label>
            <input value={form.group_head_name} onChange={(e) => set('group_head_name', e.target.value)} /></div>
          <div className="form-field"><label>Group Code</label>
            <input value={form.group_code} onChange={(e) => set('group_code', e.target.value)} /></div>
          <div className="form-field"><label>Tag</label>
            <input value={form.tag || ''} onChange={(e) => set('tag', e.target.value)} /></div>
          <div className="form-field"><label>Age (years)</label>
            <input value={form.age_in_years || ''} onChange={(e) => set('age_in_years', e.target.value)} />
          </div>
        </div>
      </div>

      <div className="sub-section">
        <div className="section-head">
          <span>Nominee Information</span>
          <button type="button" className="btn ghost sm" style={{ marginLeft: 'auto' }} onClick={addNominee}>
            <Ic name="plus" size={14} /> Add Nominee
          </button>
        </div>
        {nominees.length === 0 && <div className="empty-inline">No nominees added</div>}
        {nominees.map((n, i) => (
          <div className="form-grid" key={i} style={{ marginBottom: 10 }}>
            <div className="form-field"><label>Nominee Name</label>
              <input value={n.name || ''} onChange={(e) => setNominee(i, 'name', e.target.value)} /></div>
            <div className="form-field"><label>Relation</label>
              <Select value={n.relation || ''} onChange={(e) => setNominee(i, 'relation', e.target.value)}>
                <option value="">Select…</option>
                {NOMINEE_RELATIONS.map((r) => <option key={r} value={r}>{r}</option>)}
              </Select></div>
            <div className="form-field"><label>Date of Birth</label>
              <DateField value={n.dob || ''} onChange={(e) => setNominee(i, 'dob', e.target.value)} /></div>
            <div className="form-field"><label>Mobile</label>
              <input value={n.mobile || ''} onChange={(e) => setNominee(i, 'mobile', e.target.value)} /></div>
            <div className="form-field"><label>Share %</label>
              <input type="number" value={n.share_pct || ''} onChange={(e) => setNominee(i, 'share_pct', e.target.value)} placeholder="0" /></div>
            <div className="form-field" style={{ display: 'flex', alignItems: 'flex-end' }}>
              <button type="button" className="action-btn danger" title="Remove nominee" onClick={() => removeNominee(i)}>
                <Ic name="trash" size={15} />
              </button>
            </div>
          </div>
        ))}
        {nominees.length > 0 && (
          <div className="hint-line" style={{ color: shareTotal > 100 ? 'var(--danger)' : undefined }}>
            Total share: {shareTotal}%{shareTotal > 100 ? ' — that exceeds 100%' : shareTotal === 100 ? ' ✓' : ''}
          </div>
        )}
      </div>

      <div className="sub-section">
        <div className="section-head">Address Information</div>
        <div className="form-grid">
          <div className="form-field" style={{ gridColumn: 'span 3' }}><label>Address</label>
            <textarea rows={2} value={form.address} onChange={(e) => set('address', e.target.value)} /></div>
          <div className="form-field"><label>City</label>
            <input value={form.city} onChange={(e) => set('city', e.target.value)} /></div>
          <div className="form-field"><label>State</label>
            <input value={form.state} onChange={(e) => set('state', e.target.value)} /></div>
          <div className="form-field"><label>Pincode</label>
            <input value={form.pincode} onChange={(e) => set('pincode', e.target.value)} /></div>
          <div className="form-field"><label>Country</label>
            <input value={form.country} onChange={(e) => set('country', e.target.value)} /></div>
          <div className="form-field" /><div className="form-field" />
        </div>

        <div className="section-head" style={{ marginTop: 16 }}>Other Address</div>
        <div className="form-grid">
          <div className="form-field"><label>Other City</label>
            <input value={form.other_city || ''} onChange={(e) => set('other_city', e.target.value)} /></div>
          <div className="form-field"><label>Other State</label>
            <input value={form.other_state || ''} onChange={(e) => set('other_state', e.target.value)} /></div>
          <div className="form-field"><label>Other Zip</label>
            <input value={form.other_zip || ''} onChange={(e) => set('other_zip', e.target.value)} /></div>
          <div className="form-field"><label>Other Country</label>
            <input value={form.other_country || ''} onChange={(e) => set('other_country', e.target.value)} /></div>
          <div className="form-field"><label>Courier to this address?</label>
            <Select value={form.courier_ok || ''} onChange={(e) => set('courier_ok', e.target.value)} placeholder="Select">
              {YES_NO.map((v) => <option key={v} value={v}>{v}</option>)}
            </Select></div>
          <div className="form-field" />
        </div>
      </div>

      <div className="sub-section">
        <div className="section-head">Identifiers &amp; Preferences</div>
        <div className="form-grid">
          <div className="form-field"><label>Client Code</label>
            <input value={form.client_code || ''} onChange={(e) => set('client_code', e.target.value)} /></div>
          <div className="form-field"><label>CAN / IIN No</label>
            <input value={form.can_iin_no || ''} onChange={(e) => set('can_iin_no', e.target.value)} /></div>
          <div className="form-field"><label>Finnsys ID</label>
            <input value={form.finnsys_id || ''} onChange={(e) => set('finnsys_id', e.target.value)} /></div>
          <div className="form-field"><label>Social Lead ID</label>
            <input value={form.social_lead_id || ''} onChange={(e) => set('social_lead_id', e.target.value)} /></div>
          <div className="form-field"><label>Client Record ID</label>
            <input value={form.client_record_id || ''} onChange={(e) => set('client_record_id', e.target.value)} /></div>
          <div className="form-field"><label>Added By</label>
            <input value={form.added_by || ''} onChange={(e) => set('added_by', e.target.value)} /></div>
          <div className="form-field"><label>TIN Number</label>
            <input value={form.tin_number || ''} onChange={(e) => set('tin_number', e.target.value)} /></div>
          <div className="form-field"><label>Is TIN Updated?</label>
            <Select value={form.tin_updated || ''} onChange={(e) => set('tin_updated', e.target.value)} placeholder="Select">
              {YES_NO.map((v) => <option key={v} value={v}>{v}</option>)}
            </Select></div>
          <div className="form-field"><label>Risk Profile</label>
            <Select value={form.risk_profile || ''} onChange={(e) => set('risk_profile', e.target.value)} placeholder="Select">
              {RISK_PROFILES.map((v) => <option key={v} value={v}>{v}</option>)}
            </Select></div>
          <div className="form-field"><label>Company Name</label>
            <input value={form.company_name || ''} onChange={(e) => set('company_name', e.target.value)} /></div>
          <div className="form-field"><label>Currency</label>
            <Select value={form.currency || 'INR'} onChange={(e) => set('currency', e.target.value)}>
              {CLIENT_CURRENCIES.map((v) => <option key={v} value={v}>{v}</option>)}
            </Select></div>
          <div className="form-field"><label>Exchange Rate</label>
            <input value={form.exchange_rate || ''} onChange={(e) => set('exchange_rate', e.target.value)} disabled={(form.currency || 'INR') === 'INR'} /></div>
          <div className="form-field"><label>File / Email</label>
            <Select value={form.file_email || ''} onChange={(e) => set('file_email', e.target.value)} placeholder="Select">
              {FILE_EMAIL_OPTS.map((v) => <option key={v} value={v}>{v}</option>)}
            </Select></div>
          <div className="form-field"><label>Send Goal Sheet</label>
            <Select value={form.send_goal_sheet || 'No'} onChange={(e) => set('send_goal_sheet', e.target.value)}>
              {YES_NO.map((v) => <option key={v} value={v}>{v}</option>)}
            </Select></div>
          <div className="form-field"><label>Guardian Name</label>
            <input value={form.guardian_name || ''} onChange={(e) => set('guardian_name', e.target.value)} /></div>
          <div className="form-field"><label>If Nominee Minor — Guardian</label>
            <input value={form.nominee_minor_guardian || ''} onChange={(e) => set('nominee_minor_guardian', e.target.value)} /></div>
        </div>
      </div>

      <div className="sub-section">
        <div className="section-head">Business Information</div>
        <div className="form-grid biz-grid">
          {BUSINESS_FIELDS.map((b) => (
            <div className="form-field" key={b.key}><label>{b.label}</label>
              <Select value={form[b.key] || 'No'} onChange={(e) => set(b.key, e.target.value)}>
                {YES_NO.map((v) => <option key={v} value={v}>{v}</option>)}
              </Select></div>
          ))}
        </div>
      </div>

      <div className="sub-section">
        <div className="section-head">Description</div>
        <div className="form-field">
          <textarea rows={3} value={form.description || ''} onChange={(e) => set('description', e.target.value)} placeholder="Anything else worth recording about this client" />
        </div>
      </div>
    </>
  );
}
