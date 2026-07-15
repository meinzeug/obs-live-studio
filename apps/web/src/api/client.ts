export type SessionUser = { id: string; email: string; display_name: string; role: string; permissions: string[] };
export type StreamingPlatformId = 'youtube' | 'twitch' | 'x' | 'rumble' | 'kick' | 'facebook' | 'linkedin' | 'custom';
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

export const AUTH_REQUIRED_EVENT = 'studio:auth-required';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly path: string,
    readonly data: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

let csrfToken: string | null = null;

export function setCsrf(token: string | null) {
  csrfToken = token;
}

function parseBody(text: string, contentType: string | null) {
  if (!text) return null;
  if (contentType?.includes('json')) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function errorMessage(data: unknown, fallback: string) {
  if (typeof data === 'string' && data.trim()) return data.trim();
  if (data && typeof data === 'object') {
    const object = data as Record<string, unknown>;
    if (typeof object.message === 'string' && object.message.trim()) return object.message;
    if (typeof object.error === 'string' && object.error.trim()) return object.error;
  }
  return fallback;
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (!(init.body instanceof FormData) && !headers.has('content-type') && init.body) {
    headers.set('content-type', 'application/json');
  }
  if (csrfToken) headers.set('x-csrf-token', csrfToken);

  let response: Response;
  try {
    response = await fetch(path, { credentials: 'include', ...init, headers });
  } catch {
    throw new ApiError('Der Studio-Server ist nicht erreichbar.', 0, path, null);
  }

  const text = await response.text();
  const data = parseBody(text, response.headers.get('content-type'));
  if (!response.ok) {
    if (response.status === 401 && csrfToken && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(AUTH_REQUIRED_EVENT));
    }
    throw new ApiError(errorMessage(data, `HTTP ${response.status}`), response.status, path, data);
  }
  return data as T;
}

export function can(user: SessionUser | null, permission: string) {
  return user?.role === 'administrator' || Boolean(user?.permissions?.includes(permission));
}
