export type AutopilotCandidateArticle = {
  source_id: string | null;
  status: string;
  trust_score: number;
  warnings: string[];
};

export function isAutopilotCandidate(
  article: AutopilotCandidateArticle,
  minimumTrust = Number(process.env.AUTOPILOT_MIN_TRUST ?? 80),
  sourceIds = new Set(
    (process.env.AUTOPILOT_SOURCE_IDS ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  ),
  activeSourceIds?: ReadonlySet<string>,
) {
  const normalizedMinimumTrust = Number.isFinite(minimumTrust) ? Math.max(0, Math.min(100, minimumTrust)) : 80;
  if (!['new', 'review', 'approved'].includes(article.status)) return false;
  if (!Number.isFinite(Number(article.trust_score)) || Number(article.trust_score) < normalizedMinimumTrust)
    return false;
  if (article.warnings?.length) return false;
  if (!article.source_id) return false;
  if (activeSourceIds && !activeSourceIds.has(article.source_id)) return false;
  return sourceIds.size === 0 || sourceIds.has(article.source_id);
}

export function isUnplayableAutopilotPlaylistError(error: unknown) {
  if (typeof error === 'object' && error && 'code' in error) {
    return String((error as { code?: unknown }).code ?? '') === 'playlist-has-no-broadcastable-items';
  }
  return error instanceof Error && error.message === 'playlist-has-no-broadcastable-items';
}
