import { useEffect, useState } from 'react';
import { api } from '../api.js';
import toast from '../components/toast.js';
import PageHeader from '../components/PageHeader.jsx';

const PLACEHOLDERS = ['{client}', '{policy_no}', '{company}', '{product}', '{expiry}', '{amount}'];

// Generic template editor — powers all Template Management screens.
export default function MailTemplate({ tkey, title }) {
  const [tpl, setTpl] = useState({ subject: '', body: '' });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api('/templates/' + tkey).then((t) => setTpl({ subject: t.subject || '', body: t.body || '' })).finally(() => setLoading(false));
  }, [tkey]);

  async function save() {
    await api('/templates/' + tkey, { method: 'PUT', body: tpl });
    toast.success('Template saved successfully.');
  }

  if (loading) return <div className="spinner">Loading template…</div>;

  return (
    <div>
      <PageHeader title={title} subtitle="Edit the subject and body used for this notification" />
      <div className="card card-pad" style={{ maxWidth: 900 }}>
        <div className="section-head">Template Editor</div>
        <div className="form-field" style={{ marginBottom: 16 }}>
          <label>Subject</label>
          <input value={tpl.subject} onChange={(e) => setTpl({ ...tpl, subject: e.target.value })} />
        </div>
        <div className="form-field">
          <label>Body</label>
          <textarea rows={12} value={tpl.body} onChange={(e) => setTpl({ ...tpl, body: e.target.value })} style={{ fontFamily: 'inherit', lineHeight: 1.6 }} />
        </div>
        <div style={{ margin: '12px 0', fontSize: 12, color: 'var(--wca-muted)' }}>
          Available placeholders (click to insert):{' '}
          {PLACEHOLDERS.map((p) => (
            <button key={p} className="badge blue" style={{ border: 'none', margin: '0 4px', cursor: 'pointer' }}
              onClick={() => setTpl((t) => ({ ...t, body: t.body + ' ' + p }))}>{p}</button>
          ))}
        </div>
        <div className="btn-row"><button className="btn navy" onClick={save}>Save Template</button></div>
      </div>
    </div>
  );
}
