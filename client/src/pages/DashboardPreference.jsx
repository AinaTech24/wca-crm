import { useState, useEffect } from 'react';
import PageHeader from '../components/PageHeader.jsx';
import Toggle from '../components/Toggle.jsx';
import toast from '../components/toast.js';

const WIDGETS = [
  ['steps', '5-Steps Business Process'],
  ['charts', 'Company / Type / Business Charts'],
  ['policySummary', 'Policy Summary'],
  ['claimSummary', 'Claim Summary'],
  ['favourites', 'Favourite Links'],
  ['giRenewals', 'GI Renewal List'],
  ['liRenewals', 'Life Renewal List'],
];

export default function DashboardPreference() {
  const [prefs, setPrefs] = useState(() => JSON.parse(localStorage.getItem('wca_dash_prefs') || 'null') || Object.fromEntries(WIDGETS.map(([k]) => [k, true])));

  useEffect(() => { localStorage.setItem('wca_dash_prefs', JSON.stringify(prefs)); }, [prefs]);

  function toggle(k, v) { setPrefs((p) => ({ ...p, [k]: v })); toast.success('Preferences saved'); }
  const allOn = WIDGETS.every(([k]) => prefs[k]);
  function toggleAll(v) { setPrefs(Object.fromEntries(WIDGETS.map(([k]) => [k, v]))); toast.success(v ? 'All widgets shown' : 'All widgets hidden'); }

  return (
    <div>
      <PageHeader title="Dashboard Preference Master" />
      <div className="card card-pad pref-card">
        <div className="section-head">Show / Hide Dashboard Widgets</div>

        <div className="switch-row master">
          <div>
            <div className="sr-label">Show all widgets</div>
            <div className="sr-sub">Turn every dashboard widget on or off at once</div>
          </div>
          <Toggle checked={allOn} onChange={toggleAll} label="Toggle all widgets" />
        </div>

        {WIDGETS.map(([k, label]) => (
          <div className="switch-row" key={k}>
            <span className="sr-label">{label}</span>
            <Toggle checked={!!prefs[k]} onChange={(v) => toggle(k, v)} label={label} />
          </div>
        ))}
        <p style={{ color: 'var(--wca-muted)', fontSize: 12, marginTop: 14 }}>Preferences are stored on this device.</p>
      </div>
    </div>
  );
}
