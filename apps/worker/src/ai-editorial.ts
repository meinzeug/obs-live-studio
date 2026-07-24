import { prepareEditorialArticle, readOpenRouterEnvironment, resolveOpenRouterConfig } from '@ans/ai-provider';
import {
  cleanArticleTextForBroadcast,
  combineEditorialWarnings,
  makeScript,
  summarize,
} from '@ans/content-processing';
import { saveArticlePackage, type ArticleRecord } from '@ans/database';

export function automaticEditorialStatus(
  article: Pick<ArticleRecord, 'trust_score'>,
  warnings: string[],
  minimumTrust = 50,
) {
  return warnings.length === 0 && Number(article.trust_score) >= minimumTrust ? 'approved' : 'review';
}

export async function prepareAndSaveAiEditorial(
  article: ArticleRecord,
  sourceName: string,
  options: { automatic?: boolean; env?: NodeJS.ProcessEnv; channelName?: string; minimumTrust?: number } = {},
) {
  const env = options.env ?? (await readOpenRouterEnvironment());
  const config = resolveOpenRouterConfig(env);
  if (!config.apiKey || (options.automatic !== false && !config.autoProcessIngest)) return null;
  const sourceText = cleanArticleTextForBroadcast(article.main_text ?? article.excerpt ?? article.title, 24_000);
  const result = await prepareEditorialArticle(
    {
      title: article.title,
      text: sourceText,
      source: sourceName,
      sourceUrl: article.canonical_url ?? article.url,
      publishedAt: article.published_at,
      category: article.category,
      region: article.region,
      existingWarnings: combineEditorialWarnings(article.title, sourceText),
      channelName: options.channelName ?? env.CHANNEL_NAME ?? 'Studio',
    },
    { env },
  );
  const output = result.output;
  const warnings = combineEditorialWarnings(article.title, sourceText, output.riskFlags);
  await saveArticlePackage(article.id, output.summary, output.speakerScript, output.screenText, output.tickerText, {
    sourcePassages: [
      JSON.stringify({ kind: 'rewritten-headline', text: output.rewrittenHeadline }),
      JSON.stringify({ kind: 'context', text: output.context }),
      ...output.keyPoints.map((text) => JSON.stringify({ kind: 'key-point', text })),
      ...output.uncertainties.map((text) => JSON.stringify({ kind: 'uncertainty', text })),
      ...output.riskFlags.map((text) => JSON.stringify({ kind: 'risk-flag', text })),
    ],
    modelName: 'openrouter',
    modelVersion: result.model,
    promptVersion: 'editorial-openrouter-v2',
    category: output.category,
    warnings,
    status:
      options.automatic === true
        ? automaticEditorialStatus(article, warnings, options.minimumTrust)
        : 'review',
  });
  return result;
}

export async function prepareAndSaveAutomaticEditorial(
  article: ArticleRecord,
  sourceName: string,
  options: { env?: NodeJS.ProcessEnv; channelName?: string; minimumTrust?: number } = {},
) {
  const env = options.env ?? (await readOpenRouterEnvironment());
  if (!resolveOpenRouterConfig(env).autoProcessIngest) return null;
  try {
    const ai = await prepareAndSaveAiEditorial(article, sourceName, { ...options, env, automatic: true });
    if (ai) return { ...ai, fallback: false as const, fallbackError: undefined };
  } catch (error) {
    const fallback = await prepareAndSaveAutomaticEditorialFallback(article, sourceName, options);
    return {
      ...fallback,
      fallbackError: error instanceof Error ? error.message : String(error),
    };
  }
  return prepareAndSaveAutomaticEditorialFallback(article, sourceName, options);
}

export async function prepareAndSaveAutomaticEditorialFallback(
  article: ArticleRecord,
  sourceName: string,
  options: { channelName?: string; minimumTrust?: number },
) {
  const sourceText = cleanArticleTextForBroadcast(article.main_text ?? article.excerpt ?? article.title, 24_000);
  const summary = summarize(sourceText, 900) || sourceText.slice(0, 900) || article.title;
  const warnings = combineEditorialWarnings(article.title, sourceText);
  await saveArticlePackage(
    article.id,
    summary,
    makeScript(article.title, summary, sourceName, options.channelName ?? 'Studio'),
    summary,
    `${article.title}: ${summary}`.slice(0, 280),
    {
      modelName: 'local-editorial-fallback',
      modelVersion: '1',
      promptVersion: 'automatic-editorial-fallback-v1',
      category: article.category,
      warnings,
      status: automaticEditorialStatus(article, warnings, options.minimumTrust),
    },
  );
  return {
    model: 'local-editorial-fallback',
    tier: 'local' as const,
    usage: null,
    fallback: true as const,
    fallbackError: undefined,
  };
}
