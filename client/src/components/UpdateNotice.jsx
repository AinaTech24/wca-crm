// A tab left open keeps running the version it loaded. After a deploy it would miss new features — and,
// since a deploy clears the old files, could even fail when it loads a page it has not opened yet.
// So the app checks now and then (and whenever the tab comes back into view) whether the site has a
// newer build, and offers a one-click refresh. It never reloads by itself: an unsaved form would be lost.
import { useEffect, useState } from 'react';
import { Ic } from './Icons.jsx';

const EVERY = 3 * 60 * 1000;
const bundleOf = (html) => (/\/assets\/index-[\w-]+\.js/.exec(html || '') || [])[0] || '';

export default function UpdateNotice() {
  const [fresh, setFresh] = useState(false);
  useEffect(() => {
    const mine = bundleOf(document.documentElement.innerHTML);
    if (!mine) return undefined;                          // dev server: nothing to compare
    let last = 0;
    const check = async () => {
      if (Date.now() - last < 30000) return;
      last = Date.now();
      try {
        const html = await (await fetch('/?v=' + Date.now(), { cache: 'no-store' })).text();
        const live = bundleOf(html);
        if (live && live !== mine) setFresh(true);
      } catch { /* offline — try later */ }
    };
    const t = setInterval(check, EVERY);
    const onShow = () => { if (document.visibilityState === 'visible') check(); };
    document.addEventListener('visibilitychange', onShow);
    window.addEventListener('focus', onShow);
    // A page the old build cannot load any more (its file was replaced) → check straight away.
    const onFail = (e) => { if (/dynamically imported module|Importing a module script failed|Loading chunk/i.test(String(e?.reason?.message || e?.message || ''))) { last = 0; check(); } };
    window.addEventListener('unhandledrejection', onFail);
    window.addEventListener('error', onFail);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', onShow); window.removeEventListener('focus', onShow); window.removeEventListener('unhandledrejection', onFail); window.removeEventListener('error', onFail); };
  }, []);
  if (!fresh) return null;
  return (
    <div className="update-notice" role="status">
      <Ic name="refresh" size={16} />
      <span><b>A newer version of the CRM is ready.</b> Save what you are working on, then refresh to get it.</span>
      <button type="button" className="btn blue sm" onClick={() => window.location.reload()}>Refresh now</button>
      <button type="button" className="update-x" aria-label="Later" onClick={() => setFresh(false)}>×</button>
    </div>
  );
}
