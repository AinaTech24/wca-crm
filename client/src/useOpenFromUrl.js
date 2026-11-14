import { useEffect, useRef } from 'react';
import toast from './components/toast.js';

// Opens the record named in the address (?open=<id>) once the page's list has loaded — how a
// report's drill-down list links straight to one policy, claim, lead… The parameter is then
// taken off the address so a refresh or the back button doesn't open it again.
export function useOpenFromUrl(rows, loading, open) {
  const done = useRef(false);
  useEffect(() => {
    if (done.current || loading) return;
    done.current = true;
    const id = Number(new URLSearchParams(window.location.search).get('open'));
    if (!id) return;
    const url = new URL(window.location.href);
    url.searchParams.delete('open');
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
    const row = rows.find((r) => Number(r.id) === id);
    if (row) open(row);
    else toast.info('That record is not in this list — it may have been deleted or belong to another department.');
  }, [rows, loading]);   // eslint-disable-line react-hooks/exhaustive-deps
}
