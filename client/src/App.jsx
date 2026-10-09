import { useEffect } from 'react';
import { Routes, Route, Navigate, useParams } from 'react-router-dom';
import { useAuth } from './auth.jsx';
import Layout from './components/Layout.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import ClientForm from './pages/ClientForm.jsx';
import Placeholder from './pages/Placeholder.jsx';
import { resolvePage } from './routes.jsx';
import { connectRealtime, disconnectRealtime } from './realtime.js';

function RequireAuth({ children }) {
  const { user } = useAuth();
  useEffect(() => {
    if (user) connectRealtime();
    else disconnectRealtime();
  }, [user]);
  return user ? children : <Navigate to="/login" replace />;
}

function DynamicPage() {
  const { slug } = useParams();
  const { access } = useAuth();
  // Typing the URL shouldn't get past a removed module. The API refuses the
  // data regardless; this just means the page says so plainly instead of
  // rendering an empty shell full of failed requests.
  const blocked = access && !access.all && Array.isArray(access.modules)
    && !access.modules.includes(slug) && resolvePage(slug) !== null;
  if (blocked) {
    return (
      <div className="card card-pad" style={{ textAlign: 'center', padding: 40 }}>
        <h2 style={{ marginTop: 0 }}>No access to this module</h2>
        <p style={{ color: 'var(--text-3)' }}>Ask an admin to grant it under Team → Module Access.</p>
      </div>
    );
  }
  return resolvePage(slug) || <Placeholder slug={slug} />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route path="/" element={<Dashboard />} />
        <Route path="/page/client-master/new" element={<ClientForm />} />
        <Route path="/page/client-master/edit/:id" element={<ClientForm />} />
        <Route path="/page/:slug" element={<DynamicPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
