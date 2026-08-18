import { createContext, useContext, useState } from 'react';
import { api } from './api.js';

const AuthContext = createContext(null);

// Only trust the cached user if a non-expired token is present.
// Prevents the app from rendering protected pages with a dead token,
// which caused a redirect/reload loop (flicker).
function readSession() {
  const token = localStorage.getItem('wca_token');
  const raw = localStorage.getItem('wca_user');
  if (!token || !raw) return null;
  try {
    const payload = JSON.parse(atob(token.split('.')[1] || ''));
    if (payload.exp && payload.exp * 1000 < Date.now()) throw new Error('expired');
    return JSON.parse(raw);
  } catch {
    localStorage.removeItem('wca_token');
    localStorage.removeItem('wca_user');
    return null;
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(readSession);

  function persist(data) {
    localStorage.setItem('wca_token', data.token);
    localStorage.setItem('wca_user', JSON.stringify(data.user));
    setUser(data.user);
    return data.user;
  }

  async function login(username, password) {
    const data = await api('/login', { method: 'POST', body: { username, password }, auth: false });
    return persist(data);
  }

  // Used after an account change (e.g. rename) that reissues a token —
  // same shape as a login response, just without hitting /login again.
  function updateSession(data) { return persist(data); }

  function logout() {
    localStorage.removeItem('wca_token');
    localStorage.removeItem('wca_user');
    setUser(null);
  }

  return <AuthContext.Provider value={{ user, login, logout, updateSession }}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
