import { useState } from 'react';
import { api } from '../api.js';
import toast from '../components/toast.js';
import PageHeader from '../components/PageHeader.jsx';

export default function ChangePassword() {
  const [f, setF] = useState({ current: '', next: '', confirm: '' });
  const [saving, setSaving] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (!f.current || !f.next) { toast.error('Please fill all fields.'); return; }
    if (f.next !== f.confirm) { toast.error('New password and confirmation do not match.'); return; }
    if (f.next.length < 6) { toast.error('New password must be at least 6 characters.'); return; }
    setSaving(true);
    try {
      await api('/change-password', { method: 'POST', body: { current: f.current, next: f.next } });
      toast.success('Password updated successfully.');
      setF({ current: '', next: '', confirm: '' });
    } catch (err) {
      toast.error(err.message || 'Could not update password');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <PageHeader title="Change Password" subtitle="Update your account password" />
      <form className="card card-pad" style={{ maxWidth: 520 }} onSubmit={submit}>
        <div className="section-head">Update Password</div>
        <div className="form-grid two" style={{ gridTemplateColumns: '1fr' }}>
          <div className="form-field"><label>Current Password</label><input type="password" value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} /></div>
          <div className="form-field"><label>New Password</label><input type="password" value={f.next} onChange={(e) => setF({ ...f, next: e.target.value })} /></div>
          <div className="form-field"><label>Confirm New Password</label><input type="password" value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} /></div>
        </div>
        <div className="btn-row"><button className="btn navy" disabled={saving}>{saving ? 'Updating…' : 'Update Password'}</button></div>
      </form>
    </div>
  );
}
