import { PAGE_INDEX } from '../nav.js';
import { Ic, iconFor } from '../components/Icons.jsx';
import PageHeader from '../components/PageHeader.jsx';

export default function Placeholder({ slug }) {
  const info = PAGE_INDEX[slug] || { label: 'Page', group: '', menu: '' };
  return (
    <div>
      <PageHeader title={info.label} subtitle={`${info.menu}${info.group ? ' · ' + info.group : ''}`} />
      <div className="card">
        <div className="placeholder">
          <div className="ic"><Ic name={iconFor(info.label)} size={34} /></div>
          <h2>{info.label}</h2>
          <div className="crumb">{info.menu}{info.group ? ' › ' + info.group : ''}</div>
          <div className="demo-note">
            This module isn't available in this workspace right now. The active modules are
            Dashboard, Client Master, Dashboard Preference Master, Favourite Links, Claim, Client Journey and RFQ.
          </div>
        </div>
      </div>
    </div>
  );
}
