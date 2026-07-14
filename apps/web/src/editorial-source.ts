export function safeEditorialSourceUrl(canonicalUrl: unknown, sourceUrl: unknown) {
  for (const candidate of [canonicalUrl, sourceUrl]) {
    if (typeof candidate !== 'string' || !candidate.trim()) continue;
    try {
      const url = new URL(candidate);
      if (url.protocol === 'http:' || url.protocol === 'https:') return url.toString();
    } catch {
      continue;
    }
  }
  return null;
}
