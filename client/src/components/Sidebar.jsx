import { useState, useEffect, useMemo } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { NAV } from '../nav.js';
import { useAuth } from '../auth.jsx';
import Logo from './Logo.jsx';
import { Ic, iconFor } from './Icons.jsx';

const isRouteActive = (itemPath, currentPath) => currentPath === itemPath || currentPath.startsWith(itemPath + '/');
function readFavs() { try { return JSON.parse(localStorage.getItem('wca_favs') || '[]'); } catch { return []; } }

export default function Sidebar({ collapsed, mobileOpen, onCloseMobile, onTogglePin }) {
  const location = useLocation();
  const navigate = useNavigate();
  const current = location.pathname;
  const [favs, setFavs] = useState(readFavs);
  const [favOpen, setFavOpen] = useState(true);
  const [navQuery, setNavQuery] = useState('');
  const query = navQuery.trim().toLowerCase();

  // Flat list of every module — the nav is small enough now to show directly
  // rather than nested inside expandable groups.
  const { access } = useAuth();
  // Modules the user may open. Until access has loaded, everything shows —
  // a menu that flickers smaller is worse than one that briefly offers a link
  // the server would refuse anyway.
  const allLinks = useMemo(() => {
    const everything = NAV.flatMap((m) => m.columns.flatMap((c) => c.items));
    // Admin-only modules (Email Setup) are never in anyone else's menu, even one with no limits.
    const all = everything.filter((l) => !(access?.adminOnly || []).includes(l.path.replace('/page/', '')));
    if (!access || access.all || !Array.isArray(access.modules)) return all;
    return all.filter((l) => access.modules.includes(l.path.replace('/page/', '')));
  }, [access]);
  const flatItems = useMemo(() => allLinks.filter((l) => !query || l.label.toLowerCase().includes(query)), [allLinks, query]);

  // Keep the favourites group in sync when the Favourite Links page changes them.
  useEffect(() => {
    const h = () => setFavs(readFavs());
    window.addEventListener('wca-favs-changed', h);
    window.addEventListener('storage', h);
    return () => { window.removeEventListener('wca-favs-changed', h); window.removeEventListener('storage', h); };
  }, []);
  useEffect(() => { setFavs(readFavs()); }, [current]);

  const favLinks = favs.map((p) => allLinks.find((l) => l.path === p)).filter(Boolean);

  return (
    <aside className={'sidebar' + (collapsed ? ' collapsed' : '') + (mobileOpen ? ' mobile-open' : '')} aria-label="Main navigation">
      <div className="side-brand">
        {collapsed ? (
          <button
            className="side-pin collapsed-toggle desktop-only"
            onClick={onTogglePin}
            aria-label="Pin sidebar open"
            title="Pin sidebar open"
          >
            <Ic name="panel-open" size={20} />
          </button>
        ) : (
          <>
            <Logo scale={0.82} tagline={true} />
            <button
              className="side-pin desktop-only"
              onClick={onTogglePin}
              aria-label="Collapse sidebar"
              title="Collapse sidebar"
            >
              <Ic name="panel-close" size={19} />
            </button>
          </>
        )}
        <button className="side-close mobile-only" onClick={onCloseMobile} aria-label="Close menu" title="Close menu">×</button>
      </div>

      <nav className="side-nav">
        <button className={'side-link top' + (current === '/' ? ' active' : '')} onClick={() => { navigate('/'); onCloseMobile?.(); }} title={collapsed ? 'Dashboard' : undefined}>
          <span className="si"><Ic name="home" /></span>
          <span className="label">Dashboard</span>
        </button>

        {!collapsed && (
          <div className="side-search">
            <span className="ss-ic"><Ic name="search" size={15} /></span>
            <input
              value={navQuery}
              onChange={(e) => setNavQuery(e.target.value)}
              placeholder="Search menu…"
              aria-label="Search sidebar menu"
            />
            {navQuery && (
              <button className="ss-clear" onClick={() => setNavQuery('')} aria-label="Clear search">
                <Ic name="x" size={13} />
              </button>
            )}
          </div>
        )}

        {/* Favourites — only shown when the user has pinned at least one link. */}
        {!collapsed && !query && favLinks.length > 0 && (
          <div className={'side-menu fav-menu' + (favOpen ? ' open' : '')}>
            <button className="side-menu-head" onClick={() => setFavOpen((o) => !o)} aria-expanded={favOpen}>
              <span className="si"><Ic name="star" size={18} /></span>
              <span className="label">Favourites</span>
              <Ic name="chevron" size={15} style={{ transform: favOpen ? 'rotate(180deg)' : 'none' }} />
            </button>
            <div className={'side-menu-collapse' + (favOpen ? ' open' : '')} aria-hidden={!favOpen}>
              <div className="side-menu-body">
                <div className="side-items">
                  {favLinks.map((l) => (
                    <Link
                      key={l.path}
                      to={l.path}
                      title={l.label}
                      className={'side-item' + (isRouteActive(l.path, current) ? ' active' : '')}
                      onClick={() => onCloseMobile?.()}
                    >
                      <span className="ii"><Ic name={iconFor(l.label)} size={16} stroke={1.8} /></span>
                      <span>{l.label}</span>
                    </Link>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="side-caption">Workspace</div>
        {query && flatItems.length === 0 && <div className="side-search-empty">No modules match “{navQuery.trim()}”</div>}
        {flatItems.map((item) => (
          <Link
            key={item.path}
            to={item.path}
            className={'side-link top' + (isRouteActive(item.path, current) ? ' active' : '')}
            title={collapsed ? item.label : undefined}
            onClick={() => onCloseMobile?.()}
          >
            <span className="si"><Ic name={iconFor(item.label)} /></span>
            <span className="label">{item.label}</span>
          </Link>
        ))}
      </nav>
    </aside>
  );
}
