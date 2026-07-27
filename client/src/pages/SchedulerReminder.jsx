import { useState } from 'react';
import PageHeader from '../components/PageHeader.jsx';
import DataTable from '../components/DataTable.jsx';
import { Ic } from '../components/Icons.jsx';
import Select from '../components/Select.jsx';

const CHANNELS = ['Email', 'WhatsApp', 'SMS'];
const FREQ = ['Daily', 'Weekly', 'Monthly'];
const EVENTS = ['Policy Renewal Due', 'Premium (FUP) Due', 'Birthday', 'Anniversary', 'FD Maturity'];

export default function SchedulerReminder() {
  const [rules, setRules] = useState([
    { id: 1, event: 'Policy Renewal Due', channel: 'WhatsApp', freq: 'Daily', daysBefore: 15, active: true },
    { id: 2, event: 'Birthday', channel: 'Email', freq: 'Daily', daysBefore: 0, active: true },
    { id: 3, event: 'FD Maturity', channel: 'Email', freq: 'Weekly', daysBefore: 30, active: false },
  ]);
  const [f, setF] = useState({ event: EVENTS[0], channel: CHANNELS[0], freq: FREQ[0], daysBefore: 7 });

  function add() {
    setRules([...rules, { ...f, id: Date.now(), active: true }]);
    setF({ event: EVENTS[0], channel: CHANNELS[0], freq: FREQ[0], daysBefore: 7 });
  }
  function toggle(id) { setRules(rules.map((r) => r.id === id ? { ...r, active: !r.active } : r)); }
  function remove(id) { setRules(rules.filter((r) => r.id !== id)); }

  return (
    <div>
      <PageHeader title="Scheduler Reminder" subtitle="Automate renewal, birthday and maturity alerts" />

      <div className="card card-pad" style={{ marginBottom: 22 }}>
        <div className="section-head">New Reminder Rule</div>
        <div className="form-grid">
          <div className="form-field"><label>Event</label><Select value={f.event} onChange={(e) => setF({ ...f, event: e.target.value })}>{EVENTS.map((x) => <option key={x}>{x}</option>)}</Select></div>
          <div className="form-field"><label>Channel</label><Select value={f.channel} onChange={(e) => setF({ ...f, channel: e.target.value })}>{CHANNELS.map((x) => <option key={x}>{x}</option>)}</Select></div>
          <div className="form-field"><label>Frequency</label><Select value={f.freq} onChange={(e) => setF({ ...f, freq: e.target.value })}>{FREQ.map((x) => <option key={x}>{x}</option>)}</Select></div>
          <div className="form-field"><label>Days Before</label><input type="number" value={f.daysBefore} onChange={(e) => setF({ ...f, daysBefore: e.target.value })} /></div>
        </div>
        <div className="btn-row"><button className="btn blue" onClick={add}>Add Rule</button></div>
      </div>

      <div className="card">
        <DataTable
          title={<>Active Rules <span className="sub">({rules.length})</span></>}
          searchPlaceholder="Search rules…"
          rows={rules}
          columns={[
            { key: 'event', label: 'Event' },
            { key: 'channel', label: 'Channel' },
            { key: 'freq', label: 'Frequency' },
            { key: 'daysBefore', label: 'Days Before', num: true },
            { key: 'active', label: 'Status', render: (r) => <span className={'badge ' + (r.active ? 'green' : 'orange')}>{r.active ? 'Active' : 'Paused'}</span> },
          ]}
          actions={(r) => (
            <>
              <button className="action-btn" title={r.active ? 'Pause' : 'Resume'} onClick={() => toggle(r.id)}><Ic name={r.active ? 'clock' : 'check'} size={15} /></button>
              <button className="action-btn danger" title="Delete" onClick={() => remove(r.id)}><Ic name="trash" size={15} /></button>
            </>
          )}
          empty={{ icon: 'clock', title: 'No reminder rules', sub: 'Create a rule above to automate alerts.' }}
        />
      </div>
    </div>
  );
}
