export type SessionUser = { id: string; email: string; display_name: string; role: string; permissions: string[] };
export type StreamingPlatformId =
  | 'youtube'
  | 'twitch'
  | 'x'
  | 'rumble'
  | 'kick'
  | 'facebook'
  | 'linkedin'
  | 'custom';
export type PublicStreamTarget = {
  id: string;
  managedId: string;
  name: string;
  platform: StreamingPlatformId;
  server: string;
  channelUrl: string;
  enabled: boolean;
  configured: boolean;
  secure: boolean;
  syncStart: boolean;
  syncStop: boolean;
  obsServiceName: string | null;
};
export type StudioProfile = {
  studioName: string;
  channelName: string;
  channelUrl: string;
  primary: PublicStreamTarget;
  additionalTargets: PublicStreamTarget[];
  multistream: boolean;
  supportedPlatforms: Array<{
    id: StreamingPlatformId;
    label: string;
    setupUrl: string | null;
    defaultServer: string | null;
    obsServiceName: string | null;
    serverProvidedByDashboard: boolean;
  }>;
};
let csrfToken: string | null = null;
export function setCsrf(token: string | null) {
  csrfToken = token;
}
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (!(init.body instanceof FormData) && !headers.has('content-type') && init.body)
    headers.set('content-type', 'application/json');
  if (csrfToken) headers.set('x-csrf-token', csrfToken);
  const r = await fetch(path, { credentials: 'include', ...init, headers });
  const text = await r.text();
  const data = text ? JSON.parse(text) : null;
  if (!r.ok) throw new Error(data?.message ?? data?.error ?? text ?? `HTTP ${r.status}`);
  return data as T;
}
export function can(user: SessionUser | null, permission: string) {
  return user?.role === 'administrator' || Boolean(user?.permissions?.includes(permission));
}
