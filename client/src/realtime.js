// Real-time client — a single authenticated Server-Sent Events stream that the
// whole app subscribes to. Events are backend-driven (real mutations), deduped
// by id, and applied incrementally by each screen. No polling, no fake timers.
import { useEffect, useRef, useState } from 'react';
import toast from './components/toast.js';
import { BASE } from './api.js';

const entityListeners = new Map();   // entity -> Set<cb>
const statusListeners = new Set();   // cb(status)
const seenIds = [];                  // ring buffer for dedup
const seenSet = new Set();

let es = null;
let status = 'connecting';           // connecting | connected | reconnecting | offline
let everConnected = false;
let bannerTimer = null;

function setStatus(next) {
  if (next === status) return;
  status = next;
  statusListeners.forEach((cb) => { try { cb(status); } catch {} });
  renderBanner();
}

function dispatch(evt) {
  if (evt.id != null) {
    if (seenSet.has(evt.id)) return;          // idempotent: drop duplicates
    seenSet.add(evt.id); seenIds.push(evt.id);
    if (seenIds.length > 800) seenSet.delete(seenIds.shift());
  }
  const direct = entityListeners.get(evt.entity);
  if (direct) direct.forEach((cb) => { try { cb(evt); } catch {} });
  const all = entityListeners.get('*');
  if (all) all.forEach((cb) => { try { cb(evt); } catch {} });
}

export function connectRealtime() {
  const token = localStorage.getItem('wca_token');
  if (!token) return;
  if (es) { try { es.close(); } catch {} es = null; }
  if (status !== 'connected') setStatus(everConnected ? 'reconnecting' : 'connecting');

  es = new EventSource(BASE + '/events?token=' + encodeURIComponent(token));
  es.onopen = () => { everConnected = true; setStatus('connected'); };
  es.onmessage = (e) => {
    let evt; try { evt = JSON.parse(e.data); } catch { return; }
    if (evt.entity === 'system') { if (evt.action === 'connected') setStatus('connected'); return; }
    dispatch(evt);
  };
  es.onerror = () => {
    // EventSource retries automatically (retry hint from server); reflect the state.
    setStatus(navigator.onLine ? 'reconnecting' : 'offline');
  };
}

export function disconnectRealtime() {
  if (es) { try { es.close(); } catch {} es = null; }
  everConnected = false;
  setStatus('offline');
}

function ensureConnected() {
  if (!es && localStorage.getItem('wca_token')) connectRealtime();
}

export function subscribe(entity, cb) {
  ensureConnected();
  if (!entityListeners.has(entity)) entityListeners.set(entity, new Set());
  entityListeners.get(entity).add(cb);
  return () => entityListeners.get(entity)?.delete(cb);
}
export function onStatus(cb) { statusListeners.add(cb); cb(status); return () => statusListeners.delete(cb); }
export function getStatus() { return status; }

/* ---- subtle connection banner (only for abnormal, sustained states) ---- */
function renderBanner() {
  // Only surface a banner once a working connection has actually dropped —
  // never on first-load slowness or an intentional logout.
  const show = everConnected && (status === 'reconnecting' || status === 'offline');
  clearTimeout(bannerTimer);
  if (show) {
    // Delay so brief blips don't flicker a banner.
    bannerTimer = setTimeout(() => {
      let el = document.getElementById('wca-conn');
      if (!el) {
        el = document.createElement('div');
        el.id = 'wca-conn';
        el.className = 'conn-banner';
        document.body.appendChild(el);
      }
      el.dataset.state = status;
      el.innerHTML = status === 'offline'
        ? '<span class="dot"></span> You&rsquo;re offline — changes will sync when the connection returns'
        : '<span class="dot"></span> Reconnecting…';
    }, 1600);
  } else {
    const el = document.getElementById('wca-conn');
    if (el) { el.remove(); if (everConnected && status === 'connected') toast.success('Connection restored'); }
  }
}

// Reconnect on network / tab-focus changes.
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => connectRealtime());
  window.addEventListener('offline', () => setStatus('offline'));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && status !== 'connected') connectRealtime();
  });
}

/* ---- React helpers ---- */
export function useRealtime(entity, handler) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => subscribe(entity, (evt) => ref.current && ref.current(evt)), [entity]);
}
export function useConnectionStatus() {
  const [s, setS] = useState(getStatus());
  useEffect(() => onStatus(setS), []);
  return s;
}
