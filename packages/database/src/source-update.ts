export interface StoredSourceUpdateState extends Record<string, unknown> {
  url: string;
  user_agent?: string | null;
}

export interface PreparedSourceUpdate {
  next: Record<string, unknown>;
  url: URL;
  urlChanged: boolean;
  userAgent: string | null;
}

function normalizedUserAgent(value: unknown) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized || null;
}

export function prepareSourceUpdate(
  current: StoredSourceUpdateState,
  input: Record<string, unknown>,
): PreparedSourceUpdate {
  const next: Record<string, unknown> = { ...current, ...input };
  const currentUrl = new URL(String(current.url));
  const url = new URL(String(next.url));
  const userAgent = Object.hasOwn(input, 'userAgent')
    ? normalizedUserAgent(input.userAgent)
    : normalizedUserAgent(current.user_agent);

  return {
    next,
    url,
    urlChanged: currentUrl.toString() !== url.toString(),
    userAgent,
  };
}
