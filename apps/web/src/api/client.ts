export type SessionUser = { id: string; email: string; display_name: string; role: string; permissions: string[] };
let csrfToken: string | null = null;
export function setCsrf(token: string | null) {
  csrfToken = token;
}
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (!headers.has('content-type') && init.body) headers.set('content-type', 'application/json');
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
