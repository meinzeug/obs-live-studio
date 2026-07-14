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
  if (!['new', 'review', 'approved'].includes(article.status)) return false;
  if (Number(article.trust_score) < minimumTrust) return false;
  if (article.warnings?.length) return false;
  if (!article.source_id) return false;
  if (activeSourceIds && !activeSourceIds.has(article.source_id)) return false;
  return sourceIds.size === 0 || sourceIds.has(article.source_id);
}
