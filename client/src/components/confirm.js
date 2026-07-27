// Promise-based confirmation dialog, importable anywhere (no provider wiring at
// the call site). A single <ConfirmHost/> mounted in the app listens for
// requests and renders the themed modal.
//   import confirm from '../components/confirm.js';
//   if (await confirm({ title: 'Delete client?', tone: 'danger' })) { ... }
let listener = null;

export function _subscribe(fn) { listener = fn; return () => { listener = null; }; }

export default function confirm(opts = {}) {
  return new Promise((resolve) => {
    if (!listener) { resolve(window.confirm(opts.message || opts.title || 'Are you sure?')); return; }
    listener({
      title: opts.title || 'Are you sure?',
      message: opts.message || '',
      confirmText: opts.confirmText || 'Confirm',
      cancelText: opts.cancelText || 'Cancel',
      tone: opts.tone || 'primary', // primary | danger
      icon: opts.icon,
      resolve,
    });
  });
}
