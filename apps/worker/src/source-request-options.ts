export interface SourceRequestSettings {
  user_agent?: unknown;
}

export function resolveSourceUserAgent(
  source: SourceRequestSettings,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  if (typeof source.user_agent === 'string' && source.user_agent.trim()) return source.user_agent.trim();
  const fallback = env.NEWS_USER_AGENT?.trim();
  return fallback || undefined;
}
