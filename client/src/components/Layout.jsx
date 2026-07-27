import { useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import Sidebar from './Sidebar.jsx';
import Topbar from './Topbar.jsx';
import ConfirmHost from './ConfirmHost.jsx';

export default function Layout() {
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('wca_sidebar_collapsed') === 'true');
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();

  function toggleSidebar() {
    setCollapsed((value) => {
      const next = !value;
      localStorage.setItem('wca_sidebar_collapsed', String(next));
      return next;
    });
  }

  return (
    <div className="app-shell">
      <Sidebar
        collapsed={collapsed && !mobileOpen}
        mobileOpen={mobileOpen}
        onCloseMobile={() => setMobileOpen(false)}
        onExpand={() => collapsed && toggleSidebar()}
        onTogglePin={toggleSidebar}
      />
      <button
        className={'sidebar-overlay' + (mobileOpen ? ' show' : '')}
        onClick={() => setMobileOpen(false)}
        aria-label="Close navigation"
      />

      <div className={'main' + (collapsed ? ' collapsed' : '')}>
        <Topbar
          collapsed={collapsed}
          onToggleSidebar={toggleSidebar}
          onToggleMobile={() => setMobileOpen((m) => !m)}
        />
        <main className="content">
          <div className="page-container" key={location.pathname}><Outlet /></div>
        </main>
        <footer className="app-footer">
          © {new Date().getFullYear()} WeCare Assurance <span>·</span> Insurance with Assurance
        </footer>
      </div>
      <ConfirmHost />
    </div>
  );
}
