import { useState, useRef, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { NAV } from '../nav.js';
import { Ic } from './Icons.jsx';
import { useRealtime } from '../realtime.js';
import { api } from '../api.js';

// Renders a notification's `created_at` ("YYYY-MM-DD HH:MM:SS", server time)
// as a relative time — the only thing here that's computed, not fetched.
function timeAgo(createdAt) {
  if (!createdAt) return '';
  const then = new Date(createdAt.replace(' ', 'T'));
  if (Number.isNaN(then.getTime())) return '';
  const mins = Math.max(0, Math.round((Date.now() - then.getTime()) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

export default function Topbar({ collapsed, onToggleSidebar, onToggleMobile }) {
  const { user, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [q, setQ] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  // Fully backend-driven: fetched from /api/notifications on mount (real
  // history, persists across reloads/sessions), then kept live over the
  // same SSE bus every other entity uses — no static/seeded content.
  const [notifs, setNotifs] = useState([]);
  const navigate = useNavigate();
  const ref = useRef(null);
  const searchRef = useRef(null);
  const notifRef = useRef(null);
  const unread = notifs.filter((n) => !n.read).length;

  useEffect(() => {
    api('/notifications').then(setNotifs).catch(() => {});
  }, []);

  useRealtime('notification', (evt) => {
    if (evt.action !== 'created') return;
    setNotifs((prev) => [evt.data, ...prev].slice(0, 50));
  });

  async function openNotif(n) {
    setNotifs((prev) => prev.map((x) => (x.id === n.id ? { ...x, read: 1 } : x)));
    setNotifOpen(false);
    if (n.link) navigate(n.link);
    if (!n.read) { try { await api(`/notifications/${n.id}/read`, { method: 'PUT' }); } catch {} }
  }
  async function markAllRead() {
    setNotifs((prev) => prev.map((n) => ({ ...n, read: 1 })));
    try { await api('/notifications/read-all', { method: 'PUT' }); } catch {}
  }
  const initials = (user?.name || user?.username || 'U').split(' ').map((s) => s[0]).slice(0, 2).join('').toUpperCase();

  const allLinks = useMemo(
    () => NAV.flatMap((m) => m.columns.flatMap((c) => c.items.map((it) => ({ ...it, menu: m.label })))),
    []
  );
  const results = q.trim() ? allLinks.filter((l) => l.label.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 10) : [];

  useEffect(() => {
    function h(e) {
      if (ref.current && !ref.current.contains(e.target)) setMenuOpen(false);
      if (searchRef.current && !searchRef.current.contains(e.target)) setSearchOpen(false);
      if (notifRef.current && !notifRef.current.contains(e.target)) setNotifOpen(false);
    }
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  useEffect(() => {
    function handleShortcut(e) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchRef.current?.querySelector('input')?.focus();
        setSearchOpen(true);
      }
      if (e.key === 'Escape') {
        setSearchOpen(false);
        setMenuOpen(false);
        searchRef.current?.querySelector('input')?.blur();
      }
    }
    document.addEventListener('keydown', handleShortcut);
    return () => document.removeEventListener('keydown', handleShortcut);
  }, []);

  function go(path) { navigate(path); setQ(''); setSearchOpen(false); }
  function handleLogout() { logout(); navigate('/login'); }

  return (
    <header className="topbar">
      <button className="hamburger mobile-only" onClick={onToggleMobile} title="Open menu" aria-label="Open menu"><Ic name="menu" /></button>

      <div className="topbar-search" ref={searchRef}>
        <span className="ts-icon"><Ic name="search" size={18} /></span>
        <input
          placeholder="Search clients, policies and modules…"
          aria-label="Search modules"
          value={q}
          onFocus={() => setSearchOpen(true)}
          onChange={(e) => { setQ(e.target.value); setSearchOpen(true); }}
        />
        {!q && <kbd>Ctrl K</kbd>}
        {searchOpen && q.trim() && (
          <div className="search-results" role="listbox">
            {results.length === 0 && <div className="empty">No modules found</div>}
            {results.map((r) => (
              <button key={r.path} onClick={() => go(r.path)} role="option">
                <span className="search-result-icon"><Ic name="search" size={15} /></span>
                <span>{r.label}<small>{r.menu}</small></span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="right">
        <div className="notif-menu" ref={notifRef}>
          <button className="top-icon" title="Notifications" aria-label="Notifications" aria-expanded={notifOpen} onClick={() => setNotifOpen((o) => !o)}>
            <Ic name="bell" size={20} />
            {unread > 0 && <span className="notif-badge">{unread > 9 ? '9+' : unread}</span>}
          </button>
          {notifOpen && (
            <div className="notif-panel" role="menu">
              <div className="notif-head">
                <span>Notifications {unread > 0 && <span className="notif-count">{unread} new</span>}</span>
                {unread > 0 && <button className="notif-mark" onClick={markAllRead}>Mark all read</button>}
              </div>
              <div className="notif-list">
                {notifs.length === 0 && <div className="notif-empty"><Ic name="bell" size={22} /><span>You're all caught up</span></div>}
                {notifs.map((n) => (
                  <button key={n.id} className={'notif-item' + (n.read ? '' : ' unread')} onClick={() => openNotif(n)} role="menuitem">
                    <span className="notif-ic" data-tone={n.tone}><Ic name={n.icon || 'bell'} size={16} /></span>
                    <span className="notif-body">
                      <span className="notif-title">{n.title}</span>
                      <span className="notif-text">{n.body}</span>
                      <span className="notif-time">{timeAgo(n.created_at)}</span>
                    </span>
                    {!n.read && <span className="notif-dot" />}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
        <button className="top-icon desktop-only" title="Help" aria-label="Help" onClick={() => navigate('/page/help')}><Ic name="help" size={20} /></button>
        <div className="user-menu" ref={ref}>
          <button className="user-chip" onClick={() => setMenuOpen(!menuOpen)} aria-expanded={menuOpen}>
            <span className="avatar">{initials}</span>
            <span className="u-info">
              <span className="u-name">{user?.name || user?.username}</span>
              <span className="u-role">{user?.role || 'Administrator'}</span>
            </span>
            <Ic name="chevron" size={14} />
          </button>
          {menuOpen && (
            <div className="user-dropdown">
              <div className="user-dropdown-head"><strong>{user?.name || user?.username}</strong><span>{user?.username}</span></div>
              <button onClick={() => { setMenuOpen(false); navigate('/page/my-profile'); }}><Ic name="user" size={16} /> My Profile</button>
              <button onClick={() => { setMenuOpen(false); navigate('/page/change-password'); }}><Ic name="lock" size={16} /> Change Password</button>
              <button onClick={() => { setMenuOpen(false); navigate('/page/favourite-links'); }}><Ic name="star" size={16} /> Favourite Links</button>
              <div className="divider" />
              <button className="logout-btn" onClick={handleLogout}><Ic name="logout" size={18} /> Logout</button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
