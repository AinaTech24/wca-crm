import { useEffect, useState, useMemo } from 'react';
import { api } from '../api.js';
import toast from '../components/toast.js';
import confirm from '../components/confirm.js';
import PageHeader from '../components/PageHeader.jsx';
import DataTable from '../components/DataTable.jsx';
import Modal from '../components/Modal.jsx';
import Select from '../components/Select.jsx';
import DateField from '../components/DateField.jsx';
import { Ic } from '../components/Icons.jsx';
import { useRealtime } from '../realtime.js';

const inr = (v) => Number(v || 0).toLocaleString('en-IN');
const STATUSES = ['Draft', 'Sent', 'Accepted', 'Rejected', 'Converted'];
const STATUS_BADGE = { Draft: '', Sent: 'blue', Accepted: 'green', Rejected: 'red', Converted: 'green' };
const EMPTY = { client_name: '', mobile: '', insurance_line: 'GI', product: '', sum_assured: '', valid_till: '', status: 'Draft', remarks: '', options: [{ insurer: '', premium: '', remark: '' }] };

function parseOptions(o) {
  if (Array.isArray(o)) return o;
  try { return JSON.parse(o || '[]'); } catch { return []; }
}
function bestOf(options) {
  const valid = parseOptions(options).filter((o) => Number(o.premium) > 0);
  if (!valid.length) return null;
  return valid.reduce((a, b) => (Number(b.premium) < Number(a.premium) ? b : a));
}

export default function Quotations() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [flash, setFlash] = useState(() => new Set());
  const [editing, setEditing] = useState(null); // { id?, form }
  const [saving, setSaving] = useState(false);

  function load() { setLoading(true); api('/quotations').then(setRows).finally(() => setLoading(false)); }
  useEffect(() => { load(); }, []);

  function markFlash(id) {
    if (id == null) return;
    setFlash((s) => new Set(s).add(id));
    setTimeout(() => setFlash((s) => { const n = new Set(s); n.delete(id); return n; }), 1600);
  }
  useRealtime('quotation', (evt) => {
    setRows((prev) => {
      if (evt.action === 'deleted') return prev.filter((r) => r.id !== evt.data.id);
      const q = evt.data;
      if (evt.action === 'updated') return prev.map((r) => (r.id === q.id ? q : r));
      if (evt.action === 'created') return prev.some((r) => r.id === q.id) ? prev : [q, ...prev];
      return prev;
    });
    markFlash(evt.data?.id);
  });

  const stats = useMemo(() => {
    const total = rows.length;
    const sent = rows.filter((r) => r.status === 'Sent').length;
    const accepted = rows.filter((r) => r.status === 'Accepted').length;
    const converted = rows.filter((r) => r.status === 'Converted').length;
    const closed = converted + rows.filter((r) => r.status === 'Rejected').length;
    const conversion = closed ? Math.round((converted / closed) * 100) : 0;
    return { total, sent, accepted, converted, conversion };
  }, [rows]);

  function openNew() { setEditing({ id: null, form: { ...EMPTY, options: [{ insurer: '', premium: '', remark: '' }] } }); }
  function openEdit(r) {
    setEditing({ id: r.id, form: {
      client_name: r.client_name || '', mobile: r.mobile || '', insurance_line: r.insurance_line || 'GI',
      product: r.product || '', sum_assured: r.sum_assured || '', valid_till: r.valid_till || '', status: r.status || 'Draft',
      remarks: r.remarks || '', options: parseOptions(r.options).length ? parseOptions(r.options) : [{ insurer: '', premium: '', remark: '' }],
    } });
  }
  const setF = (k, v) => setEditing((e) => ({ ...e, form: { ...e.form, [k]: v } }));
  const setOpt = (i, k, v) => setEditing((e) => { const options = e.form.options.map((o, j) => (j === i ? { ...o, [k]: v } : o)); return { ...e, form: { ...e.form, options } }; });
  const addOpt = () => setEditing((e) => ({ ...e, form: { ...e.form, options: [...e.form.options, { insurer: '', premium: '', remark: '' }] } }));
  const removeOpt = (i) => setEditing((e) => ({ ...e, form: { ...e.form, options: e.form.options.filter((_, j) => j !== i) } }));

  // Best-effort: if no client with this exact name exists yet, add one so the
  // quotation's client shows up in Client Master too. Never blocks the save.
  async function ensureClient(name, mobile) {
    try {
      const matches = await api('/clients?name=' + encodeURIComponent(name));
      const exact = matches.some((c) => (c.client_name || '').trim().toLowerCase() === name.trim().toLowerCase());
      if (!exact) await api('/clients', { method: 'POST', body: { client_name: name, mobile: mobile || '' } });
    } catch { /* non-fatal */ }
  }

  async function save() {
    const f = editing.form;
    if (!f.client_name.trim()) { toast.error('Client name is required'); return; }
    const cleanOpts = f.options.filter((o) => o.insurer.trim() || Number(o.premium) > 0).map((o) => ({ insurer: o.insurer.trim(), premium: Number(o.premium) || 0, remark: (o.remark || '').trim() }));
    setSaving(true);
    try {
      const body = { ...f, sum_assured: Number(f.sum_assured) || 0, options: cleanOpts };
      if (editing.id) { await api('/quotations/' + editing.id, { method: 'PUT', body }); toast.success('Quotation updated'); }
      else {
        await api('/quotations', { method: 'POST', body });
        toast.success('Quotation created');
        ensureClient(f.client_name.trim(), f.mobile);
      }
      setEditing(null); load();
    } catch (e) { toast.error(e.message || 'Could not save'); }
    finally { setSaving(false); }
  }

  async function share(r) {
    toast.success(`Quotation ${r.quote_no} shared with ${r.client_name} via WhatsApp & email`);
    if (r.status === 'Draft') { try { await api('/quotations/' + r.id, { method: 'PUT', body: { status: 'Sent' } }); load(); } catch { /* ignore */ } }
  }
  async function convert(r) {
    const ok = await confirm({ title: 'Convert to policy proposal?', message: `A proposal will be created for ${r.client_name} with ${r.selected_insurer || 'the selected insurer'} at ₹ ${inr(r.selected_premium)}.`, confirmText: 'Convert', icon: 'file' });
    if (!ok) return;
    try { await api('/quotations/' + r.id + '/convert', { method: 'POST' }); toast.success('Converted — proposal added to Policy Purchase'); load(); }
    catch (e) { toast.error(e.message || 'Could not convert'); }
  }
  async function del(r) {
    const ok = await confirm({ title: 'Delete quotation?', message: `${r.quote_no} for ${r.client_name} will be removed.`, tone: 'danger', confirmText: 'Delete', icon: 'trash' });
    if (!ok) return;
    const snap = rows;
    setRows((prev) => prev.filter((x) => x.id !== r.id));
    try { await api('/quotations/' + r.id, { method: 'DELETE' }); toast.success('Quotation deleted'); }
    catch (e) { setRows(snap); toast.error(e.message || 'Could not delete'); }
  }

  const kpis = [
    { label: 'Total Quotations', num: stats.total, icon: 'doc', tone: 'info' },
    { label: 'Sent — awaiting', num: stats.sent, icon: 'send', tone: 'warning' },
    { label: 'Accepted', num: stats.accepted, icon: 'check', tone: 'success' },
    { label: 'Conversion', num: stats.conversion + '%', icon: 'target', tone: stats.conversion >= 50 ? 'success' : 'info', hint: `${stats.converted} converted to policy` },
  ];

  const f = editing?.form;

  return (
    <div>
      <PageHeader title="Quotation Management" action={<button className="btn blue" onClick={openNew}><Ic name="plus" size={16} /> New Quotation</button>} />

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
          title="Quotations"
          count={rows.length}
          loading={loading}
          rows={rows}
          flash={flash}
          onRowClick={openEdit}
          searchPlaceholder="Search client, product or quote no…"
          searchKeys={['quote_no', 'client_name', 'product', 'selected_insurer']}
          columns={[
            { key: 'quote_no', label: 'Quote No', render: (r) => <b>{r.quote_no}</b> },
            { key: 'client_name', label: 'Client' },
            { key: 'insurance_line', label: 'Line', render: (r) => <span className="badge blue">{r.insurance_line}</span> },
            { key: 'product', label: 'Product' },
            { key: 'sum_assured', label: 'Sum Assured', num: true, render: (r) => inr(r.sum_assured) },
            { key: 'options', label: 'Insurers', noFilter: true, render: (r) => <span className="badge">{parseOptions(r.options).length}</span> },
            { key: 'selected_premium', label: 'Best Premium', num: true, render: (r) => <span title={r.selected_insurer}>₹ {inr(r.selected_premium)}</span> },
            { key: 'status', label: 'Status', render: (r) => <span className={'badge ' + (STATUS_BADGE[r.status] || '')}>{r.status}</span> },
            { key: 'valid_till', label: 'Valid Till', render: (r) => r.valid_till || '—' },
          ]}
          actions={(r) => (
            <>
              <button className="action-btn" title="Share (WhatsApp / Email)" onClick={() => share(r)}><Ic name="send" size={15} /></button>
              <button className="action-btn" title="Convert to policy" onClick={() => convert(r)} disabled={r.status === 'Converted'}><Ic name="file" size={15} /></button>
              <button className="action-btn" title="Edit" onClick={() => openEdit(r)}><Ic name="edit" size={15} /></button>
              <button className="action-btn danger" title="Delete" onClick={() => del(r)}><Ic name="trash" size={15} /></button>
            </>
          )}
          empty={{ icon: 'doc', title: 'No quotations yet', sub: 'Create a quote and compare insurer premiums with “New Quotation”.' }}
        />
      </div>

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing?.id ? 'Edit Quotation' : 'New Quotation'}
        subtitle="Capture the requirement and compare insurer premiums"
        icon="doc"
        size="lg"
        footer={
          <>
            <button className="btn ghost" onClick={() => setEditing(null)}>Cancel</button>
            <button className="btn blue" onClick={save} disabled={saving}>{saving ? 'Saving…' : editing?.id ? 'Update Quotation' : 'Save Quotation'}</button>
          </>
        }
      >
        {editing && (
          <>
            <div className="form-grid">
              <div className="form-field"><label>Client Name <span className="req">*</span></label><input autoFocus value={f.client_name} onChange={(e) => setF('client_name', e.target.value)} /></div>
              <div className="form-field"><label>Mobile</label><input value={f.mobile} onChange={(e) => setF('mobile', e.target.value)} /></div>
              <div className="form-field"><label>Line</label><Select value={f.insurance_line} onChange={(e) => setF('insurance_line', e.target.value)}><option value="GI">General Insurance</option><option value="LI">Life Insurance</option><option value="FD">Fixed Deposit</option></Select></div>
              <div className="form-field"><label>Product</label><input value={f.product} onChange={(e) => setF('product', e.target.value)} placeholder="e.g. Private Car - Comprehensive" /></div>
              <div className="form-field"><label>Sum Assured (₹)</label><input type="number" value={f.sum_assured} onChange={(e) => setF('sum_assured', e.target.value)} /></div>
              <div className="form-field"><label>Valid Till</label><DateField value={f.valid_till} onChange={(e) => setF('valid_till', e.target.value)} /></div>
              <div className="form-field"><label>Status</label><Select value={f.status} onChange={(e) => setF('status', e.target.value)}>{STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}</Select></div>
              <div className="form-field" style={{ gridColumn: 'span 2' }}><label>Remarks</label><input value={f.remarks} onChange={(e) => setF('remarks', e.target.value)} /></div>
            </div>

            <div className="section-head">Insurer Comparison</div>
            <div className="quote-opts">
              <div className="quote-opt-head"><span>Insurer</span><span>Premium (₹)</span><span>Remark</span><span /></div>
              {f.options.map((o, i) => {
                const best = bestOf(f.options);
                const isBest = best && Number(o.premium) > 0 && Number(o.premium) === Number(best.premium);
                return (
                  <div className={'quote-opt' + (isBest ? ' best' : '')} key={i}>
                    <input value={o.insurer} onChange={(e) => setOpt(i, 'insurer', e.target.value)} placeholder="Insurer name" />
                    <input type="number" value={o.premium} onChange={(e) => setOpt(i, 'premium', e.target.value)} placeholder="0" />
                    <input value={o.remark} onChange={(e) => setOpt(i, 'remark', e.target.value)} placeholder="e.g. Zero-dep incl." />
                    <div className="quote-opt-act">
                      {isBest && <span className="badge green" title="Lowest premium">Best</span>}
                      <button className="action-btn danger" title="Remove" onClick={() => removeOpt(i)} disabled={f.options.length === 1}><Ic name="x" size={14} /></button>
                    </div>
                  </div>
                );
              })}
              <button className="btn ghost" style={{ marginTop: 10 }} onClick={addOpt}><Ic name="plus" size={15} /> Add insurer</button>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}
