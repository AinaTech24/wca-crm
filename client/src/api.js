// In dev the Vite proxy forwards /api -> localhost:4000. In a deployed build the
// backend lives on another host, so point VITE_API_BASE at it (e.g.
// https://wca-crm-api.onrender.com/api) at build time.
export const BASE = (import.meta.env.VITE_API_BASE || '/api').replace(/\/$/, '');

function getToken() {
  return localStorage.getItem('wca_token');
}

export async function api(path, { method = 'GET', body, auth = true } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth && getToken()) headers.Authorization = 'Bearer ' + getToken();
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401 && path !== '/login') {
    // Session expired/invalid: clear the whole session (token AND cached user)
    // so we don't ping-pong between "/" and "/login" (which caused flickering).
    localStorage.removeItem('wca_token');
    localStorage.removeItem('wca_user');
    if (window.location.pathname !== '/login') window.location.replace('/login');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}
