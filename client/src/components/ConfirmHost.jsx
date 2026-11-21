import { useState, useEffect } from 'react';
import Modal from './Modal.jsx';
import Select from './Select.jsx';
import { _subscribe } from './confirm.js';

// Renders the confirmation modal for the global `confirm()` helper. Mount once.
export default function ConfirmHost() {
  const [req, setReq] = useState(null);
  const [pick, setPick] = useState('');
  const [text, setText] = useState('');

  useEffect(() => _subscribe((r) => { setReq(r); setPick(''); setText(''); }), []);

  // With an input, Confirm hands back what was chosen / typed (Cancel gives null).
  const value = req?.input ? (req.input.options ? (pick === 'Other' ? text.trim() || '' : pick) : text.trim()) : true;
  function done(result) { req?.resolve(result && req?.input ? value : (req?.input ? null : result)); setReq(null); }

  return (
    <Modal
      open={!!req}
      onClose={() => done(false)}
      title={req?.title}
      size="sm"
      icon={req?.icon || (req?.tone === 'danger' ? 'alert' : undefined)}
      footer={
        <>
          <button className="btn ghost" onClick={() => done(false)}>{req?.cancelText}</button>
          <button className={'btn ' + (req?.tone === 'danger' ? 'red' : 'blue')} onClick={() => done(true)} disabled={!!req?.input && !value}>{req?.confirmText}</button>
        </>
      }
    >
      {req?.message && <p className="confirm-msg">{req.message}</p>}
      {req?.input && (
        <div className="form-field" style={{ marginTop: 10 }}>
          {req.input.label && <label>{req.input.label}</label>}
          {req.input.options && <Select value={pick} onChange={(e) => setPick(e.target.value)}><option value="">Choose…</option>{req.input.options.map((o) => <option key={o} value={o}>{o}</option>)}</Select>}
          {(!req.input.options || pick === 'Other') && <input autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder={req.input.placeholder || 'Type here'} style={{ marginTop: req.input.options ? 8 : 0 }} />}
        </div>
      )}
    </Modal>
  );
}
