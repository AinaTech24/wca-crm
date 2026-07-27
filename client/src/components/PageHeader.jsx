import { Link, useLocation } from 'react-router-dom';
import { PAGE_INDEX } from '../nav.js';

export default function PageHeader({ title, action }) {
  const { pathname } = useLocation();
  const slug = pathname.startsWith('/page/') ? pathname.split('/')[2] : '';
  const info = PAGE_INDEX[slug];

  return (
    <div className="page-head">
      <div>
        <div className="breadcrumbs" aria-label="Breadcrumb">
          <Link to="/">Home</Link>
          {info?.menu && <><span>/</span><span>{info.menu}</span></>}
          {info?.group && <><span>/</span><span>{info.group}</span></>}
        </div>
        <h1 className="page-title">{title}</h1>
      </div>
      {action && <div className="page-actions">{action}</div>}
    </div>
  );
}
