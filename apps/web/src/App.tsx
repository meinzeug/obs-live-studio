import React, { useEffect, useState } from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AUTH_REQUIRED_EVENT, ApiError, api, setCsrf, type SessionUser, type StudioProfile } from './api/client.js';
import { Shell } from './components/Shell.js';
import { ErrorBox, Loading } from './components/Status.js';
import { routes } from './navigation.js';
import { LoginPage } from './pages/LoginPage.js';
import { DashboardPage } from './pages/DashboardPage.js';
import { SourcesPage } from './pages/SourcesPage.js';
import { SourceHealthPage } from './pages/SourceHealthPage.js';
import { ArticlesPage } from './pages/ArticlesPage.js';
import { ArticleDetailRoutePage } from './pages/ArticleDetailRoutePage.js';
import { BroadcastPage } from './pages/BroadcastPage.js';
import { OverlaysPage } from './pages/OverlaysPage.js';
import { OverlayEditorRoutePage } from './pages/OverlayEditorRoutePage.js';
import { MediaPage } from './pages/MediaPage.js';
import { MediaDetailPage } from './pages/MediaDetailPage.js';
import { ObsPage } from './pages/ObsPage.js';
import { NotificationsPage } from './pages/NotificationsPage.js';
import { SettingsPage } from './pages/SettingsPage.js';
import { AdminUsersPage } from './pages/AdminUsersPage.js';
import { AdminAuditPage } from './pages/AdminAuditPage.js';
import { AdminSessionsPage } from './pages/AdminSessionsPage.js';
import { NotFoundPage } from './pages/NotFoundPage.js';

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
    const requireAuthentication = () => {
      setCsrf(null);
      setUser(null);
      setError('Die Sitzung ist abgelaufen. Bitte erneut anmelden.');
    };
    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      if (!(event.reason instanceof ApiError)) return;
      event.preventDefault();
      if (event.reason.status !== 401) setError(event.reason.message);
    };
    window.addEventListener(AUTH_REQUIRED_EVENT, requireAuthentication);
    window.addEventListener('unhandledrejection', handleUnhandledRejection);
    return () => {
      window.removeEventListener(AUTH_REQUIRED_EVENT, requireAuthentication);
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
    };
  }, []);

  useEffect(() => {
    api<{
      authenticated: boolean;
      user: SessionUser | null;
      csrfToken: string | null;
      setupRequired: boolean;
      studio?: StudioProfile;
    }>('/api/auth/session')
      .then((session) => {
        setError('');
        setSetup(session.setupRequired);
        setUser(session.user);
        if (session.studio) setStudio(session.studio);
        setCsrf(session.csrfToken);
      })
      .catch((requestError) => {
        setError(requestError instanceof Error ? requestError.message : String(requestError));
      })
      .finally(() => setLoading(false));
  }, []);

  async function logout() {
    try {
      await api('/api/auth/logout', { method: 'POST' });
      setError('');
    } catch (requestError) {
      const detail = requestError instanceof Error ? requestError.message : String(requestError);
      setError(`Lokal abgemeldet. Die Serversitzung konnte nicht bestätigt werden: ${detail}`);
    } finally {
      setUser(null);
      setCsrf(null);
    }
  }

  if (loading) return <Loading />;
  if (!user) {
    return (
      <LoginPage
        studio={studio}
        setupRequired={setup}
        initialMessage={error}
        onDone={(authenticatedUser) => {
          setError('');
          setUser(authenticatedUser);
          setSetup(false);
        }}
      />
    );
  }

  return (
    <HashRouter>
      <Shell studio={studio} user={user} onLogout={logout}>
        {error && <ErrorBox message={error} />}
        <Routes>
          <Route path={routes.root} element={<Navigate to={routes.dashboard} replace />} />
          <Route path={routes.dashboard} element={<DashboardPage user={user} />} />
          <Route path={routes.sources} element={<SourcesPage user={user} />} />
          <Route path={routes.sourceHealth} element={<SourceHealthPage user={user} />} />
          <Route path={routes.articles} element={<ArticlesPage />} />
          <Route path={`${routes.articles}/:id`} element={<ArticleDetailRoutePage user={user} />} />
          <Route path={routes.broadcast} element={<BroadcastPage user={user} />} />
          <Route path={routes.overlays} element={<OverlaysPage user={user} />} />
          <Route path={`${routes.overlays}/:id/edit`} element={<OverlayEditorRoutePage user={user} />} />
          <Route path={routes.media} element={<MediaPage user={user} />} />
          <Route path={`${routes.media}/:id`} element={<MediaDetailPage />} />
          <Route path={routes.obs} element={<ObsPage studio={studio} user={user} onStudioChange={setStudio} />} />
          <Route path={routes.notifications} element={<NotificationsPage />} />
          <Route path={routes.settings} element={<SettingsPage user={user} studio={studio} />} />
          <Route path={routes.adminUsers} element={<AdminUsersPage user={user} />} />
          <Route path={routes.adminAudit} element={<AdminAuditPage user={user} />} />
          <Route path={routes.adminSessions} element={<AdminSessionsPage user={user} />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </Shell>
    </HashRouter>
  );
}
