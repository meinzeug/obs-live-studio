import { prepareEditorialArticle, readOpenRouterEnvironment, resolveOpenRouterConfig } from '@ans/ai-provider';
import { combineEditorialWarnings } from '@ans/content-processing';
import { saveArticlePackage, type ArticleRecord } from '@ans/database';

export async function prepareAndSaveAiEditorial(
  article: ArticleRecord,
  sourceName: string,
  options: { automatic?: boolean; env?: NodeJS.ProcessEnv } = {},
) {
  const env = options.env ?? (await readOpenRouterEnvironment());
  const config = resolveOpenRouterConfig(env);
  if (!config.apiKey || (options.automatic !== false && !config.autoProcessIngest)) return null;
  const sourceText = article.main_text ?? article.excerpt ?? article.title;
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
      channelName: env.CHANNEL_NAME ?? 'Studio',
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
    promptVersion: 'editorial-openrouter-v1',
    category: output.category,
    warnings,
  });
  return result;
}
