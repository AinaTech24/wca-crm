import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import toast from '../components/toast.js';
import PageHeader from '../components/PageHeader.jsx';
import Select from '../components/Select.jsx';
import DateField from '../components/DateField.jsx';
import { Ic } from '../components/Icons.jsx';

const INSURANCE_TYPES = ['Motor', 'Health', 'Personal Accident', 'Fire', 'Marine', 'Travel', 'Property', 'Liability'];

export default function PolicyPurchase({ slug }) {
  const line = slug === 'policy-purchase-li' ? 'LI' : 'GI';
  const navigate = useNavigate();
  const [tab, setTab] = useState('main');
  const [companies, setCompanies] = useState([]);
  const [agencies, setAgencies] = useState([]);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    policy_status: 'Proposal', policy_type: 'Fresh', renewable: 'Yes', insurance_line: line,
    insured_name: '', group_head_name: '', policy_number: '', agency_name: '', ba_name: '', sm_name: '',
    company_name: '', insurance_type: '', product_name: '', login_date: '', period_from: '', period_to: '',
    addon_name: '', reg_no: '', sum_assured: '', net_premium: '', gst_amount: '', final_premium: '',
    payment_type: '', payment_ref: '', payment_date: '', total_amount: '', remarks: '',
  });

  useEffect(() => {
    api('/masters/companies?line=' + line).then(setCompanies).catch(() => {});
    api('/masters/agencies').then(setAgencies).catch(() => {});
  }, [line]);

  function set(k, v) {
    setForm((prev) => {
      const next = { ...prev, [k]: v };
      if (k === 'net_premium' || k === 'gst_amount') {
        next.final_premium = (Number(next.net_premium) || 0) + (Number(next.gst_amount) || 0);
      }
      return next;
    });
  }

  async function save() {
    if (!form.insured_name.trim()) { toast.error('Insured Name is required'); setTab('main'); return; }
    if (!form.policy_number.trim()) { toast.error('Policy Number is required'); setTab('main'); return; }
    setSaving(true);
    try {
      await api('/policies', { method: 'POST', body: form });
      toast.success('Policy saved successfully');
      navigate('/');
    } catch (e) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <PageHeader title={`${line === 'LI' ? 'Life' : 'General'} Insurance Policy Purchase`} subtitle="Enter policy, premium and payment details" />
      <div className="card card-pad">
        <div className="tabs">
          <button className={'tab' + (tab === 'main' ? ' active' : '')} onClick={() => setTab('main')}><Ic name="file" size={15} /> {line} Policy Purchase</button>
          <button className={'tab' + (tab === 'related' ? ' active' : '')} onClick={() => setTab('related')}><Ic name="clipboard" size={15} /> Policy Related Information</button>
          <button className={'tab' + (tab === 'docs' ? ' active' : '')} onClick={() => setTab('docs')}><Ic name="upload" size={15} /> Document Upload</button>
        </div>

        {tab === 'main' && (
          <>
            <div className="form-grid">
              <div className="form-field"><label>Policy Status</label>
                <Select value={form.policy_status} onChange={(e) => set('policy_status', e.target.value)}>
                  <option>Proposal</option><option>Policy</option><option>Issued</option><option>Cancel</option><option>Decline</option>
                </Select>
              </div>
              <div className="form-field"><label>Policy Type</label>
                <Select value={form.policy_type} onChange={(e) => set('policy_type', e.target.value)}>
                  <option>Fresh</option><option>Renewal</option><option>Rollover</option><option>Portability</option>
                </Select>
              </div>
              <div className="form-field"><label>Renewable</label>
                <Select value={form.renewable} onChange={(e) => set('renewable', e.target.value)}><option>Yes</option><option>No</option></Select>
              </div>

              <div className="form-field"><label>Insured Name <span className="req">*</span></label><input value={form.insured_name} onChange={(e) => set('insured_name', e.target.value)} placeholder="Insured Name" /></div>
              <div className="form-field"><label>Group Head Name</label><input value={form.group_head_name} onChange={(e) => set('group_head_name', e.target.value)} /></div>
              <div className="form-field"><label>Policy Number <span className="req">*</span></label><input value={form.policy_number} onChange={(e) => set('policy_number', e.target.value)} placeholder="Policy Number" /></div>

              <div className="form-field"><label>Agency Name <span className="req">*</span></label>
                <Select value={form.agency_name} onChange={(e) => set('agency_name', e.target.value)}>
                  <option value="">-Select-</option>
                  {agencies.map((a) => <option key={a.id}>{a.agency_name}</option>)}
                </Select>
              </div>
              <div className="form-field"><label>BA Name</label><input value={form.ba_name} onChange={(e) => set('ba_name', e.target.value)} /></div>
              <div className="form-field"><label>SM Name</label><input value={form.sm_name} onChange={(e) => set('sm_name', e.target.value)} /></div>

              <div className="form-field"><label>Company Name <span className="req">*</span></label>
                <Select value={form.company_name} onChange={(e) => set('company_name', e.target.value)}>
                  <option value="">-Select-</option>
                  {companies.map((c) => <option key={c.id}>{c.company_name}</option>)}
                </Select>
              </div>
              <div className="form-field"><label>Insurance Type <span className="req">*</span></label>
                <Select value={form.insurance_type} onChange={(e) => set('insurance_type', e.target.value)}>
                  <option value="">-Select-</option>
                  {INSURANCE_TYPES.map((t) => <option key={t}>{t}</option>)}
                </Select>
              </div>
              <div className="form-field"><label>Product Name <span className="req">*</span></label><input value={form.product_name} onChange={(e) => set('product_name', e.target.value)} /></div>

              <div className="form-field"><label>Login Date <span className="req">*</span></label><DateField value={form.login_date} onChange={(e) => set('login_date', e.target.value)} /></div>
              <div className="form-field"><label>Period From <span className="req">*</span></label><DateField value={form.period_from} onChange={(e) => set('period_from', e.target.value)} /></div>
              <div className="form-field"><label>Period To <span className="req">*</span></label><DateField value={form.period_to} onChange={(e) => set('period_to', e.target.value)} /></div>

              <div className="form-field"><label>AddOn Name</label><input value={form.addon_name} onChange={(e) => set('addon_name', e.target.value)} /></div>
              <div className="form-field"><label>Registration No</label><input value={form.reg_no} onChange={(e) => set('reg_no', e.target.value)} /></div>
            </div>

            <div className="section-head">Premium Details</div>
            <div className="form-grid">
              <div className="form-field"><label>Sum Assured</label><input type="number" value={form.sum_assured} onChange={(e) => set('sum_assured', e.target.value)} /></div>
              <div className="form-field"><label>Net Premium</label><input type="number" value={form.net_premium} onChange={(e) => set('net_premium', e.target.value)} /></div>
              <div className="form-field"><label>GST Amount</label><input type="number" value={form.gst_amount} onChange={(e) => set('gst_amount', e.target.value)} /></div>
              <div className="form-field"><label>Final Premium</label><input type="number" value={form.final_premium} readOnly style={{ background: '#f4f6f9' }} /></div>
            </div>

            <div className="section-head">Payment Details</div>
            <div className="form-grid">
              <div className="form-field"><label>Payment Type</label>
                <Select value={form.payment_type} onChange={(e) => set('payment_type', e.target.value)}>
                  <option value="">Select Payment Type</option><option>Cash</option><option>Cheque</option><option>Online / NEFT</option><option>UPI</option><option>Card</option>
                </Select>
              </div>
              <div className="form-field"><label>Pay. Reference No.</label><input value={form.payment_ref} onChange={(e) => set('payment_ref', e.target.value)} /></div>
              <div className="form-field"><label>Payment Date</label><DateField value={form.payment_date} onChange={(e) => set('payment_date', e.target.value)} /></div>
              <div className="form-field"><label>Total Amount</label><input type="number" value={form.total_amount} onChange={(e) => set('total_amount', e.target.value)} /></div>
              <div className="form-field" style={{ gridColumn: 'span 2' }}><label>Remarks</label><textarea rows={2} value={form.remarks} onChange={(e) => set('remarks', e.target.value)} /></div>
            </div>

            <div className="btn-row">
              <button className="btn navy" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
              <button className="btn red" onClick={() => navigate('/')}>Cancel</button>
              <button className="btn blue" style={{ marginLeft: 'auto' }} onClick={() => setTab('related')}>Next <Ic name="arrowright" size={15} /></button>
            </div>
          </>
        )}

        {tab === 'related' && (
          <>
            <div className="section-head">Policy Related Information</div>
            <div className="form-grid">
              <div className="form-field"><label>Nominee Name</label><input placeholder="Nominee Name" /></div>
              <div className="form-field"><label>Nominee Relation</label><input placeholder="Relation" /></div>
              <div className="form-field"><label>Nominee Age</label><input type="number" placeholder="Age" /></div>
              <div className="form-field"><label>Previous Policy No</label><input placeholder="Previous Policy No" /></div>
              <div className="form-field"><label>NCB %</label><input type="number" placeholder="NCB" /></div>
              <div className="form-field"><label>IDV / Coverage</label><input type="number" placeholder="IDV" /></div>
            </div>
            <div className="btn-row">
              <button className="btn ghost" onClick={() => setTab('main')}><Ic name="arrowleft" size={15} /> Back</button>
              <button className="btn blue" style={{ marginLeft: 'auto' }} onClick={() => setTab('docs')}>Next <Ic name="arrowright" size={15} /></button>
            </div>
          </>
        )}

        {tab === 'docs' && (
          <>
            <div className="section-head">Document Upload</div>
            <div className="form-grid two">
              <div className="form-field"><label>Policy Copy (PDF)</label><input type="file" /></div>
              <div className="form-field"><label>KYC Document</label><input type="file" /></div>
              <div className="form-field"><label>Payment Proof</label><input type="file" /></div>
              <div className="form-field"><label>Other</label><input type="file" /></div>
            </div>
            <div className="btn-row">
              <button className="btn ghost" onClick={() => setTab('related')}><Ic name="arrowleft" size={15} /> Back</button>
              <button className="btn navy" style={{ marginLeft: 'auto' }} onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save Policy'}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
