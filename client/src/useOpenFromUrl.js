import { useEffect, useRef } from 'react';
import toast from './components/toast.js';

// Opens the record named in the address (?open=<id>) once the page's list has loaded — how a
// report's drill-down list links straight to one policy, claim, lead… — and, with ?new=1, the page's
// "new" form (the dashboard's quick actions). The parameter is then taken off the address so a
// refresh or the back button doesn't open it again.
export function useOpenFromUrl(rows, loading, open, onNew) {
  const done = useRef(false);
  useEffect(() => {
    if (done.current || loading) return;
    done.current = true;
    const q = new URLSearchParams(window.location.search);
    const id = Number(q.get('open'));
    const isNew = q.get('new') === '1';
    if (!id && !isNew) return;
    const url = new URL(window.location.href);
    url.searchParams.delete('open');
    url.searchParams.delete('new');
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
    if (isNew) { onNew?.(); return; }
    const row = rows.find((r) => Number(r.id) === id);
    if (row) open(row);
    else toast.info('That record is not in this list — it may have been deleted or belong to another department.');
  }, [rows, loading]);   // eslint-disable-line react-hooks/exhaustive-deps
}
