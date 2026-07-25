import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api, isApiRateLimitError } from './api/client.js';

export type StudioDashboard = {
  status: string;
  counts: {
    newArticles: number;
    approved: number;
    planned: number;
    discarded: number;
    failedSources: number;
  };
  current: { show?: string; item: string; next: string; nextAt: string | null; scene: string };
  obs: { status?: string; lastError?: string | null } | null;
  stream: {
    outputActive?: boolean;
    outputReconnecting?: boolean;
    outputTimecode?: string;
    outputBytes?: number;
    outputSkippedFrames?: number;
    outputTotalFrames?: number;
  } | null;
  automation: {
    enabled: boolean;
    contentMode: 'news' | 'youtube' | 'mixed' | 'youtube-news-sidebar' | 'youtube-context';
    showItemCount: number;
    minimumTrust: number;
    requireStream: boolean;
    requireVideo: boolean;
    pauseSeconds: number;
    pauseBetweenShowsSeconds: number;
    sidebarRotationSeconds: number;
    scanLimit: number;
  };
  playback: Record<string, unknown> | null;
  operations: {
    mode: 'autopilot' | 'manual' | 'live' | 'breaking' | 'standby' | string;
    current: {
      runId: string | null;
      playlist: { id?: string; name?: string; format_name?: string; production_status?: string } | null;
      item: {
        id?: string;
        title?: string;
        position?: number;
        duration_seconds?: number;
        status?: string;
        rules?: Record<string, unknown>;
      } | null;
      playback: Record<string, unknown>;
      rundown: Array<{
        id: string;
        title?: string;
        position?: number;
        status?: string;
        duration_seconds?: number;
        rules?: Record<string, unknown>;
      }>;
      nextItems: Array<{
        id: string;
        title?: string;
        position?: number;
        status?: string;
        duration_seconds?: number;
        rules?: Record<string, unknown>;
      }>;
      elapsedMs: number;
      durationMs: number;
      remainingMs: number | null;
    };
    next: {
      id?: string;
      name?: string;
      scheduled_at?: string;
      format_name?: string;
      item_count?: number;
    } | null;
    live: {
      enabled: boolean;
      sceneName: string;
      currentSceneName: string | null;
      interruption?: Record<string, unknown> | null;
    };
    autopilot: { enabled: boolean };
    obs: { connected: boolean; status?: string };
    stream: { active: boolean; reconnecting: boolean; congestion: number };
    scheduleHealth?: { status?: string; delay_seconds?: number } | null;
    warnings: Array<{ code: string; level: 'info' | 'warning' | 'error'; message: string }>;
  } | null;
  schedule: Array<{
    id: string;
    name: string;
    description: string | null;
    scheduledAt: string;
    status: string;
    kind: string;
    itemCount: number;
    durationSeconds: number;
  }>;
  resources: {
    cpu: { percent: number; cores: number; load: number[] };
    memory: { usedBytes: number; totalBytes: number; percent: number };
    disk: { usedBytes: number; totalBytes: number; freeBytes: number; percent: number } | null;
    gpu: {
      available: boolean;
      name: string | null;
      percent: number | null;
      memoryUsedMb: number | null;
      memoryTotalMb: number | null;
    };
    runtime: { node: string; platform: string; architecture: string; uptimeSeconds: number };
  };
  library: { sources: number; articles: number; youtubeVideos: number; media: number; overlays: number };
  notifications: {
    unreadCount: number;
    items: Array<{
      id: string;
      level: 'info' | 'warning' | 'error' | 'critical';
      component: string;
      message: string;
      occurrences: number;
      lastSeenAt: string;
      read: boolean;
    }>;
  };
  editorial: {
    settings: {
      enabled: boolean;
      cycle_interval_minutes: number;
      next_cycle_at: string;
    };
    lastCycle: {
      status: 'running' | 'completed' | 'degraded' | 'failed';
      summary: string | null;
      started_at: string;
      completed_at: string | null;
      fallback_used: boolean;
    } | null;
    metrics: {
      fresh_articles: number;
      new_articles: number;
      review_articles: number;
      approved_articles: number;
      published_articles: number;
      active_sources: number;
      healthy_sources: number;
      distinct_sources_24h: number;
    };
    activity: Array<{
      staff_member_id: string;
      display_name: string;
      title: string;
      status: string | null;
      created_at: string;
    }>;
    serverTime: string;
  } | null;
  governance: {
    open_decisions: number;
    council_waiting: number;
    review_waiting: number;
    audience_waiting: number;
    failed_decisions: number;
  };
  serverTime: string;
};

type StudioStatusValue = {
  dashboard: StudioDashboard | null;
  loading: boolean;
  refreshing: boolean;
  error: string;
  lastUpdated: Date | null;
  transport: 'connecting' | 'live' | 'reconnecting' | 'fallback' | 'offline';
  lastEventAt: Date | null;
  refresh: () => Promise<void>;
};

const StudioStatusContext = createContext<StudioStatusValue | null>(null);

export function StudioStatusProvider({ children }: { children: React.ReactNode }) {
  const [dashboard, setDashboard] = useState<StudioDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [lastEventAt, setLastEventAt] = useState<Date | null>(null);
  const [transport, setTransport] = useState<StudioStatusValue['transport']>('connecting');
  const inFlight = useRef<Promise<void> | null>(null);
  const backoffUntil = useRef(0);
  const mounted = useRef(true);
  const dashboardRef = useRef<StudioDashboard | null>(null);

  const refresh = useCallback(async () => {
    if (inFlight.current) return inFlight.current;
    if (Date.now() < backoffUntil.current) return;
    const request = (async () => {
      setRefreshing(true);
      try {
        const next = await api<StudioDashboard>('/api/dashboard');
        if (!mounted.current) return;
        dashboardRef.current = next;
        setDashboard(next);
        setError('');
        setLastUpdated(new Date());
        backoffUntil.current = 0;
      } catch (requestError) {
        if (!mounted.current) return;
        if (isApiRateLimitError(requestError)) backoffUntil.current = Date.now() + 30_000;
        setError(requestError instanceof Error ? requestError.message : String(requestError));
      } finally {
        if (mounted.current) {
          setLoading(false);
          setRefreshing(false);
        }
        inFlight.current = null;
      }
    })();
    inFlight.current = request;
    return request;
  }, []);

  useEffect(() => {
    mounted.current = true;
    let source: EventSource | null = null;
    let fallbackTimer: number | null = null;
    let stopped = false;
    const clearFallback = () => {
      if (fallbackTimer != null) window.clearTimeout(fallbackTimer);
      fallbackTimer = null;
    };
    const fallback = () => {
      clearFallback();
      fallbackTimer = window.setTimeout(async () => {
        if (stopped) return;
        if (document.visibilityState === 'visible') {
          setTransport((current) => (current === 'live' ? current : 'fallback'));
          await refresh();
        }
        if (!stopped && source?.readyState !== EventSource.OPEN) fallback();
      }, 15_000);
    };
    const connect = () => {
      source?.close();
      if (!('EventSource' in window)) {
        setTransport('fallback');
        void refresh();
        fallback();
        return;
      }
      setTransport(dashboardRef.current ? 'reconnecting' : 'connecting');
      source = new EventSource('/api/dashboard/events', { withCredentials: true });
      source.onopen = () => {
        if (stopped) return;
        clearFallback();
        setTransport('live');
        setError('');
      };
      source.addEventListener('studio-snapshot', (event) => {
        if (stopped) return;
        try {
          const payload = JSON.parse((event as MessageEvent).data) as {
            snapshot?: StudioDashboard;
            deliveredAt?: string;
          };
          if (!payload.snapshot) throw new Error('Leerer Studiozustand');
          dashboardRef.current = payload.snapshot;
          setDashboard(payload.snapshot);
          setLoading(false);
          setRefreshing(false);
          setError('');
          setTransport('live');
          setLastEventAt(new Date(payload.deliveredAt ?? Date.now()));
          setLastUpdated(new Date(payload.snapshot.serverTime ?? payload.deliveredAt ?? Date.now()));
          clearFallback();
        } catch (streamError) {
          setError(streamError instanceof Error ? streamError.message : String(streamError));
        }
      });
      source.addEventListener('studio-error', (event) => {
        if (stopped) return;
        try {
          const payload = JSON.parse((event as MessageEvent).data) as { message?: string };
          setError(payload.message || 'Der Live-Status konnte nicht aktualisiert werden.');
        } catch {
          setError('Der Live-Status konnte nicht aktualisiert werden.');
        }
      });
      source.onerror = () => {
        if (stopped) return;
        setTransport(navigator.onLine ? 'reconnecting' : 'offline');
        if (!dashboardRef.current) void refresh();
        fallback();
      };
    };
    connect();
    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && source?.readyState === EventSource.CLOSED) connect();
    };
    const handleOnline = () => connect();
    const handleOffline = () => setTransport('offline');
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      stopped = true;
      mounted.current = false;
      clearFallback();
      source?.close();
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [refresh]);

  return (
    <StudioStatusContext.Provider
      value={{ dashboard, loading, refreshing, error, lastUpdated, lastEventAt, transport, refresh }}
    >
      {children}
    </StudioStatusContext.Provider>
  );
}

export function useStudioStatus() {
  const context = useContext(StudioStatusContext);
  if (!context) throw new Error('useStudioStatus muss innerhalb des StudioStatusProvider verwendet werden');
  return context;
}
