import DateField from './DateField.jsx';

export const EMPTY_CLIENT = {
  client_name: '', group_head_name: '', group_code: '', email: '', mobile: '', pan_no: '',
  dob: '', anniversary: '', address: '', city: '', state: '', pincode: '', occupation: '',
};

// Shared client form body, used by both the standalone page and the modal so
// the two never drift. `set(key, value)` updates one field.
export default function ClientFormFields({ form, set }) {
  return (
    <>
      <div className="section-head">Basic Details</div>
      <div className="form-grid">
        <div className="form-field"><label>Client / Insured Name <span className="req">*</span></label><input value={form.client_name} onChange={(e) => set('client_name', e.target.value)} /></div>
        <div className="form-field"><label>Group Head Name</label><input value={form.group_head_name} onChange={(e) => set('group_head_name', e.target.value)} /></div>
        <div className="form-field"><label>Group Code</label><input value={form.group_code} onChange={(e) => set('group_code', e.target.value)} /></div>
        <div className="form-field"><label>Mobile Number</label><input value={form.mobile} onChange={(e) => set('mobile', e.target.value)} /></div>
        <div className="form-field"><label>Email Id</label><input value={form.email} onChange={(e) => set('email', e.target.value)} /></div>
        <div className="form-field"><label>PAN No</label><input value={form.pan_no} onChange={(e) => set('pan_no', e.target.value)} /></div>
        <div className="form-field"><label>Date of Birth</label><DateField value={form.dob} onChange={(e) => set('dob', e.target.value)} /></div>
        <div className="form-field"><label>Anniversary</label><DateField value={form.anniversary} onChange={(e) => set('anniversary', e.target.value)} /></div>
        <div className="form-field"><label>Occupation</label><input value={form.occupation} onChange={(e) => set('occupation', e.target.value)} /></div>
      </div>

      <div className="section-head">Address</div>
      <div className="form-grid">
        <div className="form-field" style={{ gridColumn: 'span 3' }}><label>Address</label><textarea rows={2} value={form.address} onChange={(e) => set('address', e.target.value)} /></div>
        <div className="form-field"><label>City</label><input value={form.city} onChange={(e) => set('city', e.target.value)} /></div>
        <div className="form-field"><label>State</label><input value={form.state} onChange={(e) => set('state', e.target.value)} /></div>
        <div className="form-field"><label>Pincode</label><input value={form.pincode} onChange={(e) => set('pincode', e.target.value)} /></div>
      </div>
    </>
  );
}
