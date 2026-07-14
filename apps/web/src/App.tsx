import React, { useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { api, setCsrf, type SessionUser, type StudioProfile } from './api/client.js';
import { Shell } from './components/Shell.js';
import { ErrorBox, Loading } from './components/Status.js';
import { LoginPage } from './pages/LoginPage.js';
import { DashboardPage } from './pages/DashboardPage.js';
import { SourcesPage } from './pages/SourcesPage.js';
import { SourceHealthPage } from './pages/SourceHealthPage.js';
import { ArticlesPage } from './pages/ArticlesPage.js';
import { ArticleDetailPage } from './pages/ArticleDetailPage.js';
import { BroadcastPage } from './pages/BroadcastPage.js';
import { OverlaysPage } from './pages/OverlaysPage.js';
import { OverlayEditorPage } from './pages/OverlayEditorPage.js';
import { MediaPage } from './pages/MediaPage.js';
import { ObsPage } from './pages/ObsPage.js';
import { NotificationsPage } from './pages/NotificationsPage.js';
import { AdminUsersPage } from './pages/AdminUsersPage.js';
import { AdminAuditPage } from './pages/AdminAuditPage.js';
import { AdminSessionsPage } from './pages/AdminSessionsPage.js';

const defaultStudio: StudioProfile = {
  studioName: 'Open TV Studio',
  channelName: 'Mein Kanal',
  channelUrl: '',
  primary: {
    id: 'primary',
    managedId: 'studio-primary',
    name: 'Streaming-Ziel',
    platform: 'custom',
    server: '',
    channelUrl: '',
    enabled: true,
    configured: false,
    secure: false,
    syncStart: true,
    syncStop: true,
    obsServiceName: null,
  },
  additionalTargets: [],
  multistream: false,
  supportedPlatforms: [],
};

export function App() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [studio, setStudio] = useState<StudioProfile>(defaultStudio);
  const [setup, setSetup] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    api<{
      authenticated: boolean;
      user: SessionUser | null;
      csrfToken: string | null;
      setupRequired: boolean;
      studio?: StudioProfile;
    }>('/api/auth/session')
      .then((session) => {
        setSetup(session.setupRequired);
        setUser(session.user);
        if (session.studio) setStudio(session.studio);
        setCsrf(session.csrfToken);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);
  async function logout() {
    await api('/api/auth/logout', { method: 'POST' });
    setUser(null);
    setCsrf(null);
  }
  if (loading) return <Loading />;
  if (!user)
    return (
      <LoginPage
        studio={studio}
        setupRequired={setup}
        onDone={(u) => {
          setUser(u);
          setSetup(false);
        }}
      />
    );
  return (
    <BrowserRouter>
      <Shell studio={studio} user={user} onLogout={logout}>
        {error && <ErrorBox message={error} />}
        <Routes>
          <Route path="/dashboard" element={<DashboardPage user={user} />} />
          <Route path="/sources" element={<SourcesPage user={user} />} />
          <Route path="/source-health" element={<SourceHealthPage user={user} />} />
          <Route path="/articles" element={<ArticlesPage />} />
          <Route path="/articles/:id" element={<ArticleDetailPage user={user} />} />
          <Route path="/broadcast" element={<BroadcastPage user={user} />} />
          <Route path="/overlays" element={<OverlaysPage user={user} />} />
          <Route path="/overlays/:id/edit" element={<OverlayEditorPage user={user} />} />
          <Route path="/media" element={<MediaPage user={user} />} />
          <Route path="/obs" element={<ObsPage studio={studio} user={user} />} />
          <Route path="/notifications" element={<NotificationsPage />} />
          <Route path="/admin/users" element={<AdminUsersPage user={user} />} />
          <Route path="/admin/audit" element={<AdminAuditPage user={user} />} />
          <Route path="/admin/sessions" element={<AdminSessionsPage user={user} />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </Shell>
    </BrowserRouter>
  );
}
