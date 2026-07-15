export interface SourceRequestSettings {
  user_agent?: unknown;
}

const invalidUserAgentCharacters = /[\u0000-\u001f\u007f]/;

function safeUserAgent(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  if (!normalized || invalidUserAgentCharacters.test(normalized)) return undefined;
  return normalized;
}

export function resolveSourceUserAgent(
  source: SourceRequestSettings,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  return safeUserAgent(source.user_agent) ?? safeUserAgent(env.NEWS_USER_AGENT);
}
