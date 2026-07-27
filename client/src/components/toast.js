// Lightweight toast notifications — importable from anywhere (no provider needed).
// Usage: import toast from '../components/toast.js'; toast.success('Saved');
let wrap = null;

function ensureWrap() {
  if (!wrap || !document.body.contains(wrap)) {
    wrap = document.createElement('div');
    wrap.className = 'toast-wrap';
    document.body.appendChild(wrap);
  }
  return wrap;
}

const ICONS = { success: '✓', error: '!', info: 'i' };

function show(message, type = 'info', ms = 3200) {
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.setAttribute('role', 'status');
  const ic = document.createElement('span');
  ic.className = 't-ic';
  ic.textContent = ICONS[type] || 'i';
  const txt = document.createElement('span');
  txt.textContent = String(message);
  el.append(ic, txt);
  ensureWrap().appendChild(el);
  const remove = () => {
    el.style.opacity = '0';
    el.style.transform = 'translateX(24px)';
    setTimeout(() => el.remove(), 200);
  };
  const timer = setTimeout(remove, ms);
  el.addEventListener('click', () => { clearTimeout(timer); remove(); });
}

const toast = {
  success: (m) => show(m, 'success'),
  error: (m) => show(m, 'error', 4200),
  info: (m) => show(m, 'info'),
};

export default toast;
