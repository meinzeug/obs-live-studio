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
  current: { item: string; next: string; nextAt: string | null; scene: string };
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
    contentMode: 'news' | 'youtube' | 'mixed' | 'youtube-news-sidebar';
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
  notifications: { unreadCount: number };
  serverTime: string;
};

type StudioStatusValue = {
  dashboard: StudioDashboard | null;
  loading: boolean;
  refreshing: boolean;
  error: string;
  lastUpdated: Date | null;
  refresh: () => Promise<void>;
};

const StudioStatusContext = createContext<StudioStatusValue | null>(null);

export function StudioStatusProvider({ children }: { children: React.ReactNode }) {
  const [dashboard, setDashboard] = useState<StudioDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const inFlight = useRef<Promise<void> | null>(null);
  const backoffUntil = useRef(0);
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    if (inFlight.current) return inFlight.current;
    if (Date.now() < backoffUntil.current) return;
    const request = (async () => {
      setRefreshing(true);
      try {
        const next = await api<StudioDashboard>('/api/dashboard');
        if (!mounted.current) return;
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
    void refresh();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, 15_000);
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    const handleOnline = () => void refresh();
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('online', handleOnline);
    return () => {
      mounted.current = false;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('online', handleOnline);
    };
  }, [refresh]);

  return (
    <StudioStatusContext.Provider value={{ dashboard, loading, refreshing, error, lastUpdated, refresh }}>
      {children}
    </StudioStatusContext.Provider>
  );
}

export function useStudioStatus() {
  const context = useContext(StudioStatusContext);
  if (!context) throw new Error('useStudioStatus muss innerhalb des StudioStatusProvider verwendet werden');
  return context;
}
