import { useState, useEffect } from 'react';
import { NAV } from '../nav.js';
import PageHeader from '../components/PageHeader.jsx';
import Toggle from '../components/Toggle.jsx';
import toast from '../components/toast.js';

// Favourite Links setup — pick modules to pin (stored locally for the demo).
export default function FavouriteLinks() {
  const allLinks = NAV.flatMap((m) => m.columns.flatMap((c) => c.items));
  const [favs, setFavs] = useState(() => JSON.parse(localStorage.getItem('wca_favs') || '[]'));

  useEffect(() => {
    localStorage.setItem('wca_favs', JSON.stringify(favs));
    window.dispatchEvent(new Event('wca-favs-changed')); // keep the sidebar favourites group live
  }, [favs]);

  function toggle(path, on, label) {
    setFavs((prev) => on ? [...new Set([...prev, path])] : prev.filter((p) => p !== path));
    toast.success(on ? `Pinned “${label}”` : `Removed “${label}”`);
  }

  return (
    <div>
      <PageHeader title="Favourite Links" />
      <div className="card">
        <div className="card-head">Pin your most-used modules <span className="sub">({favs.length} selected)</span></div>
        <div className="card-pad">
          <div className="fav-grid no-scrollbar">
            {allLinks.map((l) => {
              const on = favs.includes(l.path);
              return (
                <div
                  key={l.path}
                  className={'fav-item' + (on ? ' on' : '')}
                  onClick={() => toggle(l.path, !on, l.label)}
                >
                  <span className="fav-label">{l.label}</span>
                  <span onClick={(e) => e.stopPropagation()} style={{ display: 'flex' }}>
                    <Toggle checked={on} onChange={(v) => toggle(l.path, v, l.label)} label={l.label} />
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
