import { useState, useEffect, useMemo } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { NAV } from '../nav.js';
import Logo, { LogoMark } from './Logo.jsx';
import { Ic, iconFor } from './Icons.jsx';

const MENU_ICONS = {
  master: 'grid',
  transaction: 'refresh',
  office: 'doc',
  mis: 'chart',
  misc: 'sliders',
};

const isRouteActive = (itemPath, currentPath) => currentPath === itemPath || currentPath.startsWith(itemPath + '/');
function readFavs() { try { return JSON.parse(localStorage.getItem('wca_favs') || '[]'); } catch { return []; } }

export default function Sidebar({ collapsed, mobileOpen, onCloseMobile, onExpand, onTogglePin }) {
  const location = useLocation();
  const navigate = useNavigate();
  const current = location.pathname;
  const activeMenu = NAV.find((menu) => menu.columns.some((column) => column.items.some((item) => isRouteActive(item.path, current))));
  const [openMenu, setOpenMenu] = useState(activeMenu?.key || 'master');
  const [openGroups, setOpenGroups] = useState(() => new Set());
  const [favs, setFavs] = useState(readFavs);
  const [favOpen, setFavOpen] = useState(true);
  const [navQuery, setNavQuery] = useState('');
  const query = navQuery.trim().toLowerCase();

  // Filter the nav tree down to menus/groups that still have matching items,
  // so a sidebar search doubles as a quick module finder across all ~90 links.
  const matchedMenus = useMemo(() => {
    if (!query) return NAV;
    return NAV.map((menu) => ({
      ...menu,
      columns: menu.columns
        .map((column) => ({ ...column, items: column.items.filter((item) => item.label.toLowerCase().includes(query)) }))
        .filter((column) => column.items.length > 0),
    })).filter((menu) => menu.columns.length > 0);
  }, [query]);

  // Keep the favourites group in sync when the Favourite Links page changes them.
  useEffect(() => {
    const h = () => setFavs(readFavs());
    window.addEventListener('wca-favs-changed', h);
    window.addEventListener('storage', h);
    return () => { window.removeEventListener('wca-favs-changed', h); window.removeEventListener('storage', h); };
  }, []);
  useEffect(() => { setFavs(readFavs()); }, [current]);

  const allLinks = useMemo(() => NAV.flatMap((m) => m.columns.flatMap((c) => c.items)), []);
  const favLinks = favs.map((p) => allLinks.find((l) => l.path === p)).filter(Boolean);

  useEffect(() => {
    if (!activeMenu) return;
    setOpenMenu(activeMenu.key);
    const group = activeMenu.columns.find((column) => column.items.some((item) => isRouteActive(item.path, current)));
    if (group) {
      const id = `${activeMenu.key}:${group.title}`;
      setOpenGroups((previous) => previous.has(id) ? previous : new Set(previous).add(id));
    }
  }, [current]);

  function toggleMenu(key) {
    if (collapsed) {
      onExpand?.();
      setOpenMenu(key);
      return;
    }
    setOpenMenu((value) => value === key ? null : key);
  }

  function toggleGroup(id) {
    setOpenGroups((previous) => {
      const next = new Set(previous);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

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
        {query && matchedMenus.length === 0 && <div className="side-search-empty">No modules match “{navQuery.trim()}”</div>}
        {matchedMenus.map((menu) => {
          const isOpen = query ? true : openMenu === menu.key;
          const isActive = activeMenu?.key === menu.key;
          return (
            <div className={'side-menu' + (isOpen ? ' open' : '')} key={menu.key}>
              <button
                className={'side-menu-head' + (isActive ? ' active' : '')}
                onClick={() => toggleMenu(menu.key)}
                title={collapsed ? menu.label : undefined}
                aria-expanded={isOpen}
              >
                <span className="si"><Ic name={MENU_ICONS[menu.key]} size={19} /></span>
                <span className="label">{menu.label}</span>
                <Ic name="chevron" size={15} style={{ transform: isOpen ? 'rotate(180deg)' : 'none' }} />
              </button>

              {/* Flyout — shown only when the rail is collapsed (hover / focus) */}
              <div className="side-flyout" role="menu">
                <div className="side-flyout-title">{menu.label}</div>
                {menu.columns.map((column) => (
                  <div className="side-flyout-group" key={column.title}>
                    <div className="side-flyout-cap">{column.title === 'Primary Master' ? 'Core Setup' : column.title}</div>
                    {column.items.map((item) => (
                      <Link
                        key={item.path}
                        to={item.path}
                        className={'side-flyout-item' + (current === item.path ? ' active' : '')}
                        onClick={() => onCloseMobile?.()}
                      >
                        <span className="ii"><Ic name={iconFor(item.label)} size={15} stroke={1.8} /></span>
                        <span>{item.label}</span>
                      </Link>
                    ))}
                  </div>
                ))}
              </div>

              {!collapsed && (
                <div className={'side-menu-collapse' + (isOpen ? ' open' : '')} aria-hidden={!isOpen}>
                  <div className="side-menu-body">
                    {menu.columns.map((column) => {
                      const id = `${menu.key}:${column.title}`;
                      const groupActive = column.items.some((item) => isRouteActive(item.path, current));
                      const groupOpen = query ? true : (openGroups.has(id) || groupActive);
                      return (
                        <div className="side-group" key={id}>
                          <button className={'side-group-head' + (groupActive ? ' active' : '')} onClick={() => toggleGroup(id)} aria-expanded={groupOpen}>
                            <span>{column.title === 'Primary Master' ? 'Core Setup' : column.title}</span>
                            <Ic name="chevron" size={14} style={{ transform: groupOpen ? 'rotate(180deg)' : 'none' }} />
                          </button>
                          <div className={'side-items-collapse' + (groupOpen ? ' open' : '')} aria-hidden={!groupOpen}>
                            <div className="side-items">
                              {column.items.map((item) => (
                                <Link
                                  key={item.path}
                                  to={item.path}
                                  title={item.label}
                                  className={'side-item' + (isRouteActive(item.path, current) ? ' active' : '')}
                                  onClick={() => onCloseMobile?.()}
                                  aria-current={isRouteActive(item.path, current) ? 'page' : undefined}
                                  tabIndex={groupOpen ? undefined : -1}
                                >
                                  <span className="ii"><Ic name={iconFor(item.label)} size={16} stroke={1.8} /></span>
                                  <span>{item.label}</span>
                                </Link>
                              ))}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
