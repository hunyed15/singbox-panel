import { Navigate, Route, Routes } from 'react-router-dom';
import { MainLayout } from '../layouts/MainLayout';
import { RequireAuth } from '../router/RequireAuth';
import { LoginPage } from '../pages/LoginPage';
import { NodesPage } from '../pages/NodesPage';
import { ServersPage } from '../pages/ServersPage';
import { SubscribePage } from '../pages/SubscribePage';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireAuth />}>
        <Route element={<MainLayout />}>
          <Route index element={<Navigate to="/servers" replace />} />
          <Route path="servers" element={<ServersPage />} />
          <Route path="nodes" element={<NodesPage />} />
          <Route path="subscribe" element={<SubscribePage />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}