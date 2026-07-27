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
