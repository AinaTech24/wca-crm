import { useState, useEffect } from 'react';
import Modal from './Modal.jsx';
import { _subscribe } from './confirm.js';

// Renders the confirmation modal for the global `confirm()` helper. Mount once.
export default function ConfirmHost() {
  const [req, setReq] = useState(null);

  useEffect(() => _subscribe((r) => setReq(r)), []);

  function done(result) { req?.resolve(result); setReq(null); }

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
          <button className={'btn ' + (req?.tone === 'danger' ? 'red' : 'blue')} onClick={() => done(true)}>{req?.confirmText}</button>
        </>
      }
    >
      {req?.message && <p className="confirm-msg">{req.message}</p>}
    </Modal>
  );
}
