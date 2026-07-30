import { useState, useEffect } from 'react';
import toast from '../components/toast.js';
import PageHeader from '../components/PageHeader.jsx';
import DataTable from '../components/DataTable.jsx';
import { Ic } from '../components/Icons.jsx';

// Manage client-app content lists (YouTube videos / home sliders).
export default function ContentManager({ storeKey, title, subtitle, urlLabel, seed }) {
  const [items, setItems] = useState(() => {
    const raw = localStorage.getItem(storeKey);
    return raw ? JSON.parse(raw) : (seed || []);
  });
  const [f, setF] = useState({ title: '', url: '' });

  useEffect(() => { localStorage.setItem(storeKey, JSON.stringify(items)); }, [items, storeKey]);
  useEffect(() => { setF({ title: '', url: '' }); }, [storeKey]);

  function add() {
    if (!f.title.trim()) { toast.error('Title is required'); return; }
    if (!f.url.trim()) { toast.error(`${urlLabel} is required`); return; }
    setItems([...items, { id: (items.at(-1)?.id || 0) + 1, ...f }]);
    setF({ title: '', url: '' });
  }
  function remove(id) { setItems(items.filter((x) => x.id !== id)); }

  return (
    <div>
      <PageHeader title={title} subtitle={subtitle} />
      <div className="card card-pad" style={{ marginBottom: 22 }}>
        <div className="section-head">Add Item</div>
        <div className="form-grid two">
          <div className="form-field"><label>Title <span className="req">*</span></label><input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></div>
          <div className="form-field"><label>{urlLabel} <span className="req">*</span></label><input value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} placeholder="https://…" /></div>
        </div>
        <div className="btn-row"><button className="btn blue" onClick={add}>Add</button></div>
      </div>

      <div className="card">
        <DataTable
          title={<>Items <span className="sub">({items.length})</span></>}
          searchPlaceholder="Search items…"
          index
          rows={items}
          columns={[
            { key: 'title', label: 'Title' },
            { key: 'url', label: urlLabel, render: (it) => <a href={it.url} target="_blank" rel="noreferrer" className="dt-link">{it.url}</a> },
          ]}
          actions={(it) => <button className="action-btn danger" title="Remove" onClick={() => remove(it.id)}><Ic name="trash" size={15} /></button>}
          empty={{ icon: 'doc', title: 'No items yet', sub: 'Add your first item above.' }}
        />
      </div>
    </div>
  );
}
