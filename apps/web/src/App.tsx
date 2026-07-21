import React, { lazy, Suspense, useEffect, useState } from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AUTH_REQUIRED_EVENT, ApiError, api, setCsrf, type SessionUser, type StudioProfile } from './api/client.js';
import { Shell } from './components/Shell.js';
import { ErrorBox, Loading } from './components/Status.js';
import { routes } from './navigation.js';
import { LoginPage } from './pages/LoginPage.js';
import { StudioStatusProvider } from './studio-status.js';

const DashboardPage = lazy(() =>
  import('./pages/DashboardPage.js').then((module) => ({ default: module.DashboardPage })),
);
const NewsroomPage = lazy(() => import('./pages/NewsroomPage.js').then((module) => ({ default: module.NewsroomPage })));
const SourcesPage = lazy(() => import('./pages/SourcesPage.js').then((module) => ({ default: module.SourcesPage })));
const SourceHealthPage = lazy(() =>
  import('./pages/SourceHealthPage.js').then((module) => ({ default: module.SourceHealthPage })),
);
const ArticlesPage = lazy(() => import('./pages/ArticlesPage.js').then((module) => ({ default: module.ArticlesPage })));
const ArticleDetailRoutePage = lazy(() =>
  import('./pages/ArticleDetailRoutePage.js').then((module) => ({ default: module.ArticleDetailRoutePage })),
);
const YoutubeVideosPage = lazy(() =>
  import('./pages/YoutubeVideosPage.js').then((module) => ({ default: module.YoutubeVideosPage })),
);
const YoutubeShortsPage = lazy(() =>
  import('./pages/YoutubeShortsPage.js').then((module) => ({ default: module.YoutubeShortsPage })),
);
const BroadcastPage = lazy(() =>
  import('./pages/BroadcastPage.js').then((module) => ({ default: module.BroadcastPage })),
);
const LivePage = lazy(() => import('./pages/LivePage.js').then((module) => ({ default: module.LivePage })));
const OverlaysPage = lazy(() => import('./pages/OverlaysPage.js').then((module) => ({ default: module.OverlaysPage })));
const OverlayEditorRoutePage = lazy(() =>
  import('./pages/OverlayEditorRoutePage.js').then((module) => ({ default: module.OverlayEditorRoutePage })),
);
const MediaPage = lazy(() => import('./pages/MediaPage.js').then((module) => ({ default: module.MediaPage })));
const MediaDetailPage = lazy(() =>
  import('./pages/MediaDetailPage.js').then((module) => ({ default: module.MediaDetailPage })),
);
const ObsPage = lazy(() => import('./pages/ObsPage.js').then((module) => ({ default: module.ObsPage })));
const AiStudioPage = lazy(() => import('./pages/AiStudioPage.js').then((module) => ({ default: module.AiStudioPage })));
const AutomationPage = lazy(() =>
  import('./pages/AutomationPage.js').then((module) => ({ default: module.AutomationPage })),
);
const AnalyticsPage = lazy(() =>
  import('./pages/AnalyticsPage.js').then((module) => ({ default: module.AnalyticsPage })),
);
const SystemPage = lazy(() => import('./pages/SystemPage.js').then((module) => ({ default: module.SystemPage })));
const NotificationsPage = lazy(() =>
  import('./pages/NotificationsPage.js').then((module) => ({ default: module.NotificationsPage })),
);
const SettingsPage = lazy(() => import('./pages/SettingsPage.js').then((module) => ({ default: module.SettingsPage })));
const MediaSettingsPage = lazy(() =>
  import('./pages/MediaSettingsPage.js').then((module) => ({ default: module.MediaSettingsPage })),
);
const AdminUsersPage = lazy(() =>
  import('./pages/AdminUsersPage.js').then((module) => ({ default: module.AdminUsersPage })),
);
const AdminAuditPage = lazy(() =>
  import('./pages/AdminAuditPage.js').then((module) => ({ default: module.AdminAuditPage })),
);
const AdminSessionsPage = lazy(() =>
  import('./pages/AdminSessionsPage.js').then((module) => ({ default: module.AdminSessionsPage })),
);
const NotFoundPage = lazy(() => import('./pages/NotFoundPage.js').then((module) => ({ default: module.NotFoundPage })));

const defaultStudio: StudioProfile = {
  studioName: 'Open TV Studio',
  channelName: 'Mein Kanal',
  logoConfigured: false,
  logoUrl: '',
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
      <StudioStatusProvider>
        <Shell studio={studio} user={user} onLogout={logout} onStudioChange={setStudio}>
          {error && <ErrorBox message={error} />}
          <Suspense fallback={<Loading />}>
            <Routes>
              <Route path={routes.root} element={<Navigate to={routes.overview} replace />} />
              <Route path={routes.overview} element={<DashboardPage user={user} />} />
              <Route path={routes.dashboard} element={<Navigate to={routes.overview} replace />} />
              <Route path={routes.newsroom} element={<NewsroomPage user={user} />} />
              <Route path={routes.sources} element={<SourcesPage user={user} />} />
              <Route path={routes.sourceHealth} element={<SourceHealthPage user={user} />} />
              <Route path={routes.articles} element={<ArticlesPage />} />
              <Route path={`${routes.articles}/:id`} element={<ArticleDetailRoutePage user={user} />} />
              <Route path={routes.youtubeVideos} element={<YoutubeVideosPage user={user} />} />
              <Route path={routes.youtubeShorts} element={<YoutubeShortsPage user={user} />} />
              <Route path={routes.broadcast} element={<BroadcastPage user={user} />} />
              <Route path={routes.live} element={<LivePage user={user} />} />
              <Route path={routes.overlays} element={<OverlaysPage user={user} />} />
              <Route path={`${routes.overlays}/:id/edit`} element={<OverlayEditorRoutePage user={user} />} />
              <Route path={routes.media} element={<MediaPage user={user} />} />
              <Route path={`${routes.media}/:id`} element={<MediaDetailPage />} />
              <Route path={routes.obs} element={<ObsPage studio={studio} user={user} onStudioChange={setStudio} />} />
              <Route path={routes.aiStudio} element={<AiStudioPage user={user} />} />
              <Route path={routes.automation} element={<AutomationPage user={user} />} />
              <Route path={routes.analytics} element={<AnalyticsPage user={user} />} />
              <Route path={routes.system} element={<SystemPage user={user} />} />
              <Route path={routes.notifications} element={<NotificationsPage />} />
              <Route
                path={routes.settings}
                element={<SettingsPage user={user} studio={studio} onStudioChange={setStudio} />}
              />
              <Route path={routes.mediaSettings} element={<MediaSettingsPage user={user} />} />
              <Route path={routes.adminUsers} element={<AdminUsersPage user={user} />} />
              <Route path={routes.adminAudit} element={<AdminAuditPage user={user} />} />
              <Route path={routes.adminSessions} element={<AdminSessionsPage user={user} />} />
              <Route path="*" element={<NotFoundPage />} />
            </Routes>
          </Suspense>
        </Shell>
      </StudioStatusProvider>
    </HashRouter>
  );
}
