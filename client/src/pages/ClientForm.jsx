import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import toast from '../components/toast.js';
import PageHeader from '../components/PageHeader.jsx';
import ClientFormFields, { EMPTY_CLIENT } from '../components/ClientFormFields.jsx';

// Standalone add/edit page kept for direct URLs; the Client Master list uses
// the modal flow instead.
export default function ClientForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [form, setForm] = useState(EMPTY_CLIENT);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (id) api('/clients/' + id).then((c) => {
      const clean = {};
      for (const k of Object.keys(EMPTY_CLIENT)) clean[k] = c[k] == null ? '' : c[k];
      setForm(clean);
    });
  }, [id]);

  function set(k, v) { setForm((f) => ({ ...f, [k]: v })); }

  async function save() {
    if (!form.client_name.trim()) { toast.error('Client Name is required'); return; }
    setSaving(true);
    try {
      if (id) await api('/clients/' + id, { method: 'PUT', body: form });
      else await api('/clients', { method: 'POST', body: form });
      toast.success(id ? 'Client updated' : 'Client added successfully');
      navigate('/page/client-master');
    } catch (e) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <PageHeader title={`${id ? 'Edit' : 'Add'} Client Basic Information`} subtitle="Capture the client's personal and contact details" />
      <div className="card card-pad">
        <ClientFormFields form={form} set={set} />
        <div className="btn-row">
          <button className="btn navy" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
          <button className="btn red" onClick={() => navigate('/page/client-master')}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
