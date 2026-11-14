// Admin: which people may open which report, and who may download / email reports out of the CRM.
// A report with everyone ticked is open to all (the default). Admins always see everything.
import { useEffect, useState } from 'react';
import { api } from '../../api.js';
import Modal from '../../components/Modal.jsx';
import toast from '../../components/toast.js';

export default function AccessModal({ open, onClose, onSaved }) {
  const [d, setD] = useState(null);
  const [kinds, setKinds] = useState({});         // kind → Set of user ids (absent = everyone)
  const [exporters, setExporters] = useState(null);   // null = everyone
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!open) return;
    api('/report-access').then((x) => {
      setD(x);
      setKinds(Object.fromEntries(Object.entries(x.config?.kinds || {}).map(([k, v]) => [k, new Set(v)])));
      setExporters(x.config?.exporters ? new Set(x.config.exporters) : null);
    }).catch((e) => toast.error(e.message));
  }, [open]);
  const people = (d?.users || []).filter((u) => u.role !== 'admin');
  const allIds = people.map((u) => u.id);
  const has = (k, id) => !kinds[k] || kinds[k].has(id);
  function toggle(k, id) {
    setKinds((cur) => {
      const s = new Set(cur[k] || allIds);
      s.has(id) ? s.delete(id) : s.add(id);
      const n = { ...cur };
      if (s.size === allIds.length) delete n[k]; else n[k] = s;
      return n;
    });
  }
  const canExport = (id) => !exporters || exporters.has(id);
  function toggleExport(id) {
    setExporters((cur) => {
      const s = new Set(cur || allIds);
      s.has(id) ? s.delete(id) : s.add(id);
      return s.size === allIds.length ? null : s;
    });
  }
  async function save() {
    setSaving(true);
    try {
      await api('/report-access', { method: 'PUT', body: { kinds: Object.fromEntries(Object.entries(kinds).map(([k, s]) => [k, [...s]])), exporters: exporters ? [...exporters] : null } });
      toast.success('Report access saved'); onSaved?.(); onClose();
    } catch (e) { toast.error(e.message || 'Could not save'); }
    finally { setSaving(false); }
  }
  return (
    <Modal open={open} onClose={onClose} title="Report access" subtitle="Untick a person to hide a report from them. Admins always see every report." icon="lock" size="lg"
      footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn blue" onClick={save} disabled={saving || !d}>{saving ? 'Saving…' : 'Save'}</button></>}>
      {!d ? <div className="no-data">Loading…</div> : !people.length ? <div className="no-data">There are no non-admin users yet.</div> : (
        <div className="table-wrap acc-wrap">
          <table className="grid dense acc-table">
            <thead><tr><th>Report</th>{people.map((u) => <th key={u.id} className="acc-u">{u.name}</th>)}</tr></thead>
            <tbody>
              {d.reports.map((r) => (
                <tr key={r.key}>
                  <td>{r.label}{r.adminOnly && <span className="att-dow"> admins only</span>}</td>
                  {people.map((u) => (
                    <td key={u.id} className="acc-c">{r.adminOnly ? '—' : <input type="checkbox" checked={has(r.key, u.id)} onChange={() => toggle(r.key, u.id)} />}</td>
                  ))}
                </tr>
              ))}
              <tr className="acc-export">
                <td><b>May download &amp; email reports</b></td>
                {people.map((u) => <td key={u.id} className="acc-c"><input type="checkbox" checked={canExport(u.id)} onChange={() => toggleExport(u.id)} /></td>)}
              </tr>
            </tbody>
          </table>
        </div>
      )}
      <p className="att-rule" style={{ marginTop: 10 }}>Hiding a report removes its tab and blocks its figures and records for that person. Without “download”, the Export buttons and scheduled emails are not offered to them.</p>
    </Modal>
  );
}
