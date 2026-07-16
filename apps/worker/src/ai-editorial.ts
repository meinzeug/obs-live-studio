import { prepareEditorialArticle, readOpenRouterEnvironment, resolveOpenRouterConfig } from '@ans/ai-provider';
import { saveArticlePackage, updateArticleEditorialAssessment, type ArticleRecord } from '@ans/database';

export async function prepareAndSaveAiEditorial(
  article: ArticleRecord,
  sourceName: string,
  options: { automatic?: boolean; env?: NodeJS.ProcessEnv } = {},
) {
  const env = options.env ?? (await readOpenRouterEnvironment());
  const config = resolveOpenRouterConfig(env);
  if (!config.apiKey || (options.automatic !== false && !config.autoProcessIngest)) return null;
  const result = await prepareEditorialArticle(
    {
      title: article.title,
      text: article.main_text ?? article.excerpt ?? article.title,
      source: sourceName,
      sourceUrl: article.canonical_url ?? article.url,
      publishedAt: article.published_at,
      category: article.category,
      region: article.region,
      existingWarnings: article.warnings,
      channelName: env.CHANNEL_NAME ?? 'Studio',
    },
    { env },
  );
  const output = result.output;
  await saveArticlePackage(article.id, output.summary, output.speakerScript, output.screenText, output.tickerText, {
    sourcePassages: [
      JSON.stringify({ kind: 'rewritten-headline', text: output.rewrittenHeadline }),
      JSON.stringify({ kind: 'context', text: output.context }),
      ...output.keyPoints.map((text) => JSON.stringify({ kind: 'key-point', text })),
      ...output.uncertainties.map((text) => JSON.stringify({ kind: 'uncertainty', text })),
    ],
    modelName: 'openrouter',
    modelVersion: result.model,
    promptVersion: 'editorial-openrouter-v1',
  });
  await updateArticleEditorialAssessment(article.id, {
    category: output.category,
    warnings: [...new Set([...(article.warnings ?? []), ...output.riskFlags])].slice(0, 20),
  });
  return result;
}
