import { useState, useRef, useEffect } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { NAV } from '../nav.js';

export default function TopNav() {
  const [open, setOpen] = useState(null);
  const navigate = useNavigate();
  const location = useLocation();
  const ref = useRef(null);

  useEffect(() => {
    function handler(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(null);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => { setOpen(null); }, [location.pathname]);

  return (
    <nav className="topnav" ref={ref}>
      <button
        className={'nav-item home' + (location.pathname === '/' ? ' active' : '')}
        onClick={() => navigate('/')}
      >
        🏠 Dashboard
      </button>

      {NAV.map((menu) => (
        <div key={menu.key} style={{ display: 'flex' }}>
          <button
            className={'nav-item' + (open === menu.key ? ' active' : '')}
            onClick={() => setOpen(open === menu.key ? null : menu.key)}
          >
            {menu.label} ▾
          </button>

          {open === menu.key && (
            <div className="mega">
              {menu.columns.map((col) => (
                <div className="mega-col" key={col.title}>
                  <h4>{col.title}</h4>
                  <div className={'links' + (col.items.length <= 4 ? ' single' : '')}>
                    {col.items.map((it) => (
                      <Link className="mega-link" to={it.path} key={it.path}>
                        <span className="dot">●</span> {it.label}
                      </Link>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </nav>
  );
}
