import { useEffect, useState } from 'react';
import { api } from '../api.js';
import PageHeader from '../components/PageHeader.jsx';

const TYPE_COLOR = { task: '#b5670a', renewal: '#1b6fb0', birthday: '#6d4bd6' };
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function EventCalendar() {
  const [events, setEvents] = useState([]);
  const [cursor, setCursor] = useState(() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() }; });

  useEffect(() => { api('/calendar').then(setEvents).catch(() => setEvents([])); }, []);

  const first = new Date(cursor.y, cursor.m, 1);
  const startDow = first.getDay();
  const daysInMonth = new Date(cursor.y, cursor.m + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  function eventsForDay(d) {
    const ds = `${cursor.y}-${String(cursor.m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    return events.filter((e) => e.date === ds);
  }
  function move(delta) {
    let m = cursor.m + delta, y = cursor.y;
    if (m < 0) { m = 11; y--; } if (m > 11) { m = 0; y++; }
    setCursor({ y, m });
  }
  const today = new Date();
  const isToday = (d) => today.getFullYear() === cursor.y && today.getMonth() === cursor.m && today.getDate() === d;

  return (
    <div>
      <PageHeader title="Event Calendar" subtitle="Renewals, tasks and client events at a glance" />
      <div className="card">
        <div className="card-head">
          {MONTHS[cursor.m]} {cursor.y}
          <span style={{ display: 'flex', gap: 8 }}>
            <button className="btn ghost" style={{ padding: '6px 12px' }} onClick={() => move(-1)}>◀ Prev</button>
            <button className="btn ghost" style={{ padding: '6px 12px' }} onClick={() => setCursor({ y: today.getFullYear(), m: today.getMonth() })}>Today</button>
            <button className="btn ghost" style={{ padding: '6px 12px' }} onClick={() => move(1)}>Next ▶</button>
          </span>
        </div>
        <div className="card-pad">
          <div style={{ display: 'flex', gap: 18, marginBottom: 14, fontSize: 12 }}>
            {Object.entries(TYPE_COLOR).map(([k, c]) => (
              <span key={k} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 12, height: 12, borderRadius: 3, background: c, display: 'inline-block' }} /> {k[0].toUpperCase() + k.slice(1)}
              </span>
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 6 }}>
            {DOW.map((d) => <div key={d} style={{ fontWeight: 700, textAlign: 'center', padding: 6, color: 'var(--wca-muted)' }}>{d}</div>)}
            {cells.map((d, i) => (
              <div key={i} style={{ minHeight: 92, border: '1px solid var(--wca-border)', borderRadius: 8, padding: 6, background: d ? '#fff' : '#fafbfc' }}>
                {d && (
                  <>
                    <div style={{ fontWeight: 700, fontSize: 13, textAlign: 'right', color: isToday(d) ? '#fff' : 'var(--wca-text)', background: isToday(d) ? 'var(--wca-primary)' : 'transparent', borderRadius: 6, width: 24, height: 24, lineHeight: '24px', marginLeft: 'auto' }}>{d}</div>
                    {eventsForDay(d).slice(0, 3).map((e, j) => (
                      <div key={j} title={e.label} style={{ fontSize: 10, background: TYPE_COLOR[e.type] + '22', color: TYPE_COLOR[e.type], borderRadius: 4, padding: '2px 4px', marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.label}</div>
                    ))}
                    {eventsForDay(d).length > 3 && <div style={{ fontSize: 10, color: 'var(--wca-muted)', marginTop: 2 }}>+{eventsForDay(d).length - 3} more</div>}
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
