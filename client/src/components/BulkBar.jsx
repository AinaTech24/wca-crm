import { useState } from 'react';
import { api } from '../api.js';
import toast from './toast.js';
import confirm from './confirm.js';
import { Ic } from './Icons.jsx';

// Selection state for a table with row checkboxes. `toggleAll` receives every
// row the table currently shows (all pages, after its filters), so ticking the
// header box selects the whole filtered list rather than just one screen.
export function useBulkSelect() {
  const [selected, setSelected] = useState(() => new Set());
  return {
    selected,
    toggleRow: (k) => setSelected((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; }),
    toggleAll: (keys, on) => setSelected((s) => {
      const n = new Set(s);
      for (const k of keys) { if (on) n.add(k); else n.delete(k); }
      return n;
    }),
    clear: () => setSelected(new Set()),
  };
}

const CHUNK = 1000;

/**
 * The bar that appears while rows are ticked: how many, a way to clear, and
 * Delete. Deleting goes to the module's bulk-delete endpoint in chunks, so a
 * selection of tens of thousands is several modest requests, not one that a
 * proxy might refuse.
 */
export default function BulkBar({ bulk, noun, plural = noun + 's', endpoint, note = '', onDeleted }) {
  const [busy, setBusy] = useState(null);   // { done, total } while deleting
  const count = bulk.selected.size;
  if (!count && !busy) return null;
  const label = (n) => `${n.toLocaleString('en-IN')} ${n === 1 ? noun : plural}`;

  async function remove() {
    const ids = [...bulk.selected];
    const ok = await confirm({
      title: `Delete ${label(ids.length)}?`,
      message: `${ids.length === 1 ? 'This ' + noun + ' will' : 'These ' + plural + ' will'} be permanently removed. This cannot be undone.${note ? ' ' + note : ''}`,
      tone: 'danger', confirmText: `Delete ${ids.length.toLocaleString('en-IN')}`, icon: 'trash',
    });
    if (!ok) return;
    let deleted = 0, skipped = 0;
    const gone = [];
    setBusy({ done: 0, total: ids.length });
    try {
      for (let i = 0; i < ids.length; i += CHUNK) {
        const part = ids.slice(i, i + CHUNK);
        try {
          const r = await api(endpoint, { method: 'POST', body: { ids: part } });
          deleted += r.deleted || 0;
          skipped += r.skipped || 0;
          gone.push(...(r.ids || part));
        } catch (e) {
          toast.error(e.message || 'Part of the delete failed');
          break;
        }
        setBusy({ done: Math.min(i + CHUNK, ids.length), total: ids.length });
      }
    } finally {
      setBusy(null);
    }
    if (gone.length) onDeleted?.(new Set(gone));
    bulk.clear();
    if (deleted) toast.success(`${label(deleted)} deleted`);
    if (skipped) toast.error(`${label(skipped)} left in place — they belong to another department`);
  }

  return (
    <div className="bulk-bar">
      <span className="bulk-count"><b>{busy ? `Deleting ${busy.done.toLocaleString('en-IN')} / ${busy.total.toLocaleString('en-IN')}…` : `${label(count)} selected`}</b></span>
      <span className="bulk-actions">
        <button className="btn ghost" onClick={bulk.clear} disabled={!!busy}>Clear</button>
        <button className="btn ghost danger" onClick={remove} disabled={!!busy}><Ic name="trash" size={15} /> Delete selected</button>
      </span>
    </div>
  );
}
