import { Ic } from './Icons.jsx';

// Consistent empty state used across every list, report and panel.
export default function EmptyState({ icon = 'file', title = 'Nothing here yet', sub, action }) {
  return (
    <div className="empty-state">
      <div className="es-ic"><Ic name={icon} size={26} /></div>
      <div className="es-title">{title}</div>
      {sub && <div className="es-sub">{sub}</div>}
      {action && <div style={{ marginTop: 4 }}>{action}</div>}
    </div>
  );
}
