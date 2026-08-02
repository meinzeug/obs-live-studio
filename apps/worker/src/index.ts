import dotenv from 'dotenv';
import { parseFeed, parseHtmlArticle, contentHash } from '@ans/news-parser';
import { fetchHttpText, isAllowedLocalStudioTestUrl } from '@ans/source-connectors';
import {
  getSource,
  markSourceError,
  markSourceSuccess,
  recordSourceCheck,
  upsertArticle,
  pool,
  claimWorkerJob,
  completeWorkerJob,
  failWorkerJob,
  getArticleDetail,
  getAutopilotConfig,
  getSetting,
  query,
} from '@ans/database';
import {
  redactOperationalText,
  resolveOperationalNotification,
  upsertOperationalNotification,
} from '@ans/database/notifications';
import {
  dueSourcesWithBackoff,
  scheduleSourceFetchJobsWithBackoff,
  sourceRetryDelaySeconds,
} from '@ans/database/source-health';
import { classifyCritical } from '@ans/content-processing';
import { discoverAndImportArticleMedia } from '@ans/media-engine/workflow';
import {
  configureOpenRouterBudgetAdapter,
  isAiProviderConfigured,
  readOpenRouterEnvironment,
  resolveOpenRouterConfig,
  suggestMediaSearchQueries,
} from '@ans/ai-provider';
import { openRouterDatabaseBudgetAdapter } from '@ans/database/ai-usage';
import { autopilotOnce } from './autopilot.js';
import { resolveSourceUserAgent } from './source-request-options.js';
import { prepareAndSaveAutomaticEditorial } from './ai-editorial.js';
import { PROJECT_ROOT } from './project-root.js';
import { importYoutubeChannelVideos } from '../../api/src/youtube-channel-source.js';
import { YoutubeShortsProcessor } from './youtube-shorts.js';
import { TikTokShortsProcessor } from './tiktok-shorts.js';
import { AutonomousStudioProcessor } from './autonomous-studio.js';
import { AutonomousOperationsSupervisor } from './autonomous-operations.js';
import { AgentOrchestratorProcessor } from './agent-orchestrator.js';
import { VideoEditorDownloadProcessor, VideoEditorProcessor } from './video-editor.js';
import { EditorialDeskProcessor } from './editorial-desk.js';
import { CodexNewsroomPlanner } from './newsroom-planner.js';

process.chdir(PROJECT_ROOT);
dotenv.config({ path: `${PROJECT_ROOT}/.env` });
configureOpenRouterBudgetAdapter(openRouterDatabaseBudgetAdapter);
function boundedInterval(value: string | undefined, fallback: number) {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) ? Math.max(1000, Math.min(3_600_000, Math.floor(parsed))) : fallback;
}
const pollMs = boundedInterval(process.env.WORKER_POLL_MS, 30_000);
const allowPrivate = process.env.ALLOW_PRIVATE_SOURCES === 'true';
const appPort = process.env.APP_PORT ?? 12000;
const workerId = `worker-${process.pid}`;

function allowLocalTestFeed(url: URL) {
  return isAllowedLocalStudioTestUrl(url, {
    appPort,
    allowedPaths: ['/test-feed.xml'],
  });
}

function allowLocalTestArticle(url: URL) {
  return isAllowedLocalStudioTestUrl(url, {
    appPort,
    allowedPaths: ['/test/articles/on-air'],
  });
}

function log(event: string, extra: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ component: 'worker', level: 'info', event, time: new Date().toISOString(), ...extra }));
}

async function bestEffortNotification(operation: Promise<unknown>, context: Record<string, unknown>) {
  try {
    await operation;
  } catch (error) {
    log('notification_write_failed', {
      ...context,
      error: redactOperationalText(error instanceof Error ? error.message : String(error)),
    });
  }
}

function sourceFailureKey(sourceId: string) {
  return `source:${sourceId}:fetch`;
}

function articleMediaFailureKey(articleId: string) {
  return `article:${articleId}:required-visual`;
}

const automaticEditorialFallbackKey = 'editorial:auto-fallback';
let nextEditorialReconciliationAt = 0;

export async function reconcileAutomaticEditorialPipeline(force = false) {
  if (!force && Date.now() < nextEditorialReconciliationAt) return { approved: 0, prepared: 0 };
  nextEditorialReconciliationAt = Date.now() + 30_000;
  const editorialEnvironment = await readOpenRouterEnvironment();
  if (!resolveOpenRouterConfig(editorialEnvironment).autoProcessIngest) return { approved: 0, prepared: 0 };
  const config = await getAutopilotConfig();
  const identity = await getSetting<{ channelName?: string }>('studio.identity').catch(() => null);
  const channelName = identity?.channelName?.trim() || process.env.CHANNEL_NAME?.trim() || 'Studio';
  const approved = await query<{ id: string }>(
    `update articles article
     set status='approved',version=version+1
     where article.deleted_at is null
       and article.status='review'
       and article.trust_score >= $1
       and coalesce(cardinality(article.warnings),0)=0
       and exists(select 1 from summaries where article_id=article.id)
       and exists(select 1 from scripts where article_id=article.id)
     returning article.id`,
    [config.minimumTrust],
  );
  const pending = (
    await query<{ id: string }>(
      `select article.id
       from articles article
       where article.deleted_at is null
         and article.status='new'
       order by
         (coalesce(cardinality(article.warnings),0)=0 and article.trust_score >= $1) desc,
         article.fetched_at desc
       limit 20`,
      [config.minimumTrust],
    )
  ).rows;
  let prepared = 0;
  for (const row of pending) {
    const article = await getArticleDetail(row.id);
    if (!article || article.status !== 'new') continue;
    const result = await prepareAndSaveAutomaticEditorial(article, article.source_name ?? 'der Originalquelle', {
      channelName,
      minimumTrust: config.minimumTrust,
    });
    if (!result) continue;
    prepared++;
    if (result.fallback) {
      await bestEffortNotification(
        upsertOperationalNotification({
          level: 'warning',
          component: 'editorial-pipeline',
          dedupeKey: automaticEditorialFallbackKey,
          message: 'Die automatische Redaktion verwendet vorübergehend den lokalen KI-Fallback.',
          details: {
            articleId: article.id,
            model: result.model,
            reason: result.fallbackError ?? 'OpenRouter ist nicht verfügbar oder nicht konfiguriert.',
            broadcastContinues: true,
          },
        }),
        { articleId: article.id, action: 'editorial-fallback' },
      );
    } else {
      await bestEffortNotification(resolveOperationalNotification(automaticEditorialFallbackKey), {
        articleId: article.id,
        action: 'resolve-editorial-fallback',
      });
    }
    log('article_editorial_reconciled', {
      articleId: article.id,
      status: result.fallback ? 'local-fallback' : 'ai',
      model: result.model,
    });
  }
  if (approved.rowCount || prepared)
    log('article_editorial_pipeline_reconciled', {
      approved: approved.rowCount ?? 0,
      prepared,
      minimumTrust: config.minimumTrust,
    });
  return { approved: approved.rowCount ?? 0, prepared };
}

export async function withSourceLock<T>(sourceId: string, fn: () => Promise<T>) {
  const client = await pool.connect();
  const key = Buffer.from(sourceId.replace(/-/g, '').slice(0, 16), 'hex').readBigInt64BE();
  let locked = false;
  try {
    locked = Boolean((await client.query('select pg_try_advisory_lock($1) locked', [key])).rows[0]?.locked);
    if (!locked) return null;
    return await fn();
  } finally {
    if (locked) await client.query('select pg_advisory_unlock($1)', [key]).catch(() => undefined);
    client.release();
  }
}

export async function ingestSource(source: any) {
  return withSourceLock(source.id, async () => {
    const startedAt = Date.now();
    const userAgent = resolveSourceUserAgent(source) ?? process.env.NEWS_USER_AGENT ?? 'OpenTVStudio/1.0';
    try {
      if (source.type === 'youtube-channel') {
        const result = await importYoutubeChannelVideos(source, {
          limit: source.max_articles,
          userAgent,
          apiKey: process.env.YOUTUBE_DATA_API_KEY,
        });
        await bestEffortNotification(resolveOperationalNotification(sourceFailureKey(source.id)), {
          sourceId: source.id,
          action: 'resolve',
        });
        log('youtube_channel_fetched', {
          sourceId: source.id,
          items: result.scanned,
          imported: result.imported,
          skipped: result.skipped,
          liveScanned: result.liveScanned,
          liveImported: result.liveImported,
          durationMs: Date.now() - startedAt,
        });
        return;
      }
      const fetched = await fetchHttpText(source.url, {
        timeoutMs: source.max_fetch_seconds * 1000,
        maxBytes: 1024 * 1024,
        etag: source.etag,
        lastModified: source.last_modified,
        allowPrivate,
        allowPrivateUrl: allowLocalTestFeed,
        userAgent,
      });
      if (fetched.notModified) {
        await markSourceSuccess(source.id, fetched.etag, fetched.lastModified);
        await recordSourceCheck(source.id, 'ok', {
          status: fetched.status,
          finalUrl: fetched.url,
          notModified: true,
          durationMs: Date.now() - startedAt,
        });
        await bestEffortNotification(resolveOperationalNotification(sourceFailureKey(source.id)), {
          sourceId: source.id,
          action: 'resolve',
        });
        return;
      }
      const feedLike = fetched.contentType.includes('xml') || /<(rss|feed)\b/i.test(fetched.body.slice(0, 300));
      const parsed = (
        feedLike ? parseFeed(fetched.body, fetched.url) : [parseHtmlArticle(fetched.body, fetched.url)]
      ).slice(0, source.max_articles);
      let inserted = 0;
      for (const item of parsed) {
        let full = item;
        if (feedLike && item.url) {
          try {
            const page = await fetchHttpText(item.url, {
              timeoutMs: source.max_fetch_seconds * 1000,
              maxBytes: 1024 * 1024,
              allowPrivate,
              allowPrivateUrl: allowLocalTestArticle,
              userAgent,
            });
            full = parseHtmlArticle(page.body, page.url);
          } catch (error) {
            log('article_fetch_failed', {
              url: item.url,
              error: redactOperationalText(error instanceof Error ? error.message : String(error)),
            });
          }
        }
        const text = full.text || item.text || item.excerpt;
        const warnings = classifyCritical(`${full.title} ${text}`);
        const row = await upsertArticle({
          sourceId: source.id,
          title: full.title || item.title,
          url: item.url,
          canonicalUrl: full.canonicalUrl ?? item.canonicalUrl ?? item.url,
          publishedAt: full.publishedAt ?? item.publishedAt,
          author: full.author ?? item.author,
          excerpt: (full.excerpt || text).slice(0, 280),
          mainText: text,
          contentHash: contentHash(text),
          category: source.category,
          region: source.region,
          trustScore: warnings.length ? 45 : source.trust_level,
          warnings,
        });
        if (row) {
          inserted++;
          try {
            const config = await getAutopilotConfig();
            const identity = await getSetting<{ channelName?: string }>('studio.identity').catch(() => null);
            const ai = await prepareAndSaveAutomaticEditorial(row, source.name, {
              minimumTrust: config.minimumTrust,
              channelName: identity?.channelName?.trim() || process.env.CHANNEL_NAME?.trim() || 'Studio',
            });
            if (!ai) continue;
            log(ai.fallback ? 'article_editorial_fallback' : 'article_ai_prepared', {
              articleId: row.id,
              model: ai.model,
              tier: ai.tier,
              reason: ai.fallbackError,
            });
            await bestEffortNotification(
              ai.fallback
                ? upsertOperationalNotification({
                    level: 'warning',
                    component: 'editorial-pipeline',
                    dedupeKey: automaticEditorialFallbackKey,
                    message: 'Die automatische Redaktion verwendet vorübergehend den lokalen KI-Fallback.',
                    details: {
                      articleId: row.id,
                      model: ai.model,
                      reason: ai.fallbackError ?? 'OpenRouter ist nicht verfügbar oder nicht konfiguriert.',
                      broadcastContinues: true,
                    },
                  })
                : resolveOperationalNotification(automaticEditorialFallbackKey),
              { articleId: row.id, action: ai.fallback ? 'editorial-fallback' : 'resolve-editorial-fallback' },
            );
          } catch (error) {
            log('article_ai_failed', {
              articleId: row.id,
              error: redactOperationalText(error instanceof Error ? error.message : String(error)),
            });
          }
        }
      }
      await markSourceSuccess(source.id, fetched.etag, fetched.lastModified);
      await bestEffortNotification(resolveOperationalNotification(sourceFailureKey(source.id)), {
        sourceId: source.id,
        action: 'resolve',
      });
      await recordSourceCheck(source.id, 'ok', {
        status: fetched.status,
        items: parsed.length,
        inserted,
        finalUrl: fetched.url,
        durationMs: Date.now() - startedAt,
      });
      log('source_fetched', { sourceId: source.id, items: parsed.length, inserted });
    } catch (error) {
      const message = redactOperationalText(error instanceof Error ? error.message : String(error)).slice(0, 1000);
      await markSourceError(source.id, message);
      const attempts = source.consecutive_errors + 1;
      const delay = sourceRetryDelaySeconds(attempts);
      await recordSourceCheck(source.id, 'error', {
        error: message,
        retryInSeconds: delay,
        durationMs: Date.now() - startedAt,
      });
      await bestEffortNotification(
        upsertOperationalNotification({
          level: attempts >= 3 ? 'error' : 'warning',
          component: 'source-ingest',
          dedupeKey: sourceFailureKey(source.id),
          message: `Quelle „${source.name}“ konnte nicht abgerufen werden.`,
          details: {
            sourceId: source.id,
            sourceName: source.name,
            error: message,
            retryInSeconds: delay,
            consecutiveErrors: attempts,
          },
        }),
        { sourceId: source.id, action: 'upsert' },
      );
      log('source_failed', { sourceId: source.id, error: message, retryInSeconds: delay, workerId });
    }
  });
}

async function discoverArticleVisuals(articleId: string) {
  const env = await readOpenRouterEnvironment();
  let query: string | undefined;
  if (env.MEDIA_AI_ENABLED === 'true' && isAiProviderConfigured(env)) {
    try {
      const article = await getArticleDetail(articleId);
      if (article) {
        const ai = await suggestMediaSearchQueries(
          {
            title: article.title,
            text: article.main_text ?? article.excerpt ?? article.title,
            category: article.category,
            region: article.region,
            source: article.source_name,
            publishedAt: article.published_at,
          },
          { env },
        );
        query = ai.output.queries[0]?.trim() || undefined;
        if (query) log('article_media_ai_query', { articleId, query, model: ai.model, tier: ai.tier });
      }
    } catch (error) {
      log('article_media_ai_query_failed', {
        articleId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  const result = await discoverAndImportArticleMedia(articleId, { autoImport: true, env, query });
  if (result.readiness.ready) {
    await bestEffortNotification(resolveOperationalNotification(articleMediaFailureKey(articleId)), {
      articleId,
      action: 'resolve-media',
    });
    log('article_media_ready', {
      articleId,
      approvedVideos: result.readiness.approved_videos,
      approvedGraphics: result.readiness.approved_graphics,
      candidateCount: result.candidates.length,
      providers: result.providers,
    });
    return result;
  }
  await bestEffortNotification(
    upsertOperationalNotification({
      level: 'warning',
      component: 'media-discovery',
      dedupeKey: articleMediaFailureKey(articleId),
      message: 'Für einen Beitrag wurde noch kein sendefähiges Video gefunden.',
      details: {
        articleId,
        searchQuery: result.query,
        candidates: result.candidates.length,
        providers: result.providers,
        requiredAction: 'Medienrecherche prüfen, weiteren Anbieter konfigurieren oder eigenes Video hochladen.',
      },
    }),
    { articleId, action: 'upsert-media' },
  );
  log('article_media_missing', { articleId, query: result.query, providers: result.providers });
  return result;
}

export async function ingestOnce() {
  const sources = await dueSourcesWithBackoff();
  for (const source of sources) await ingestSource(source);
}

export async function workOnce() {
  await scheduleSourceFetchJobsWithBackoff();
  const job = await claimWorkerJob(workerId);
  if (!job) return ingestOnce();
  try {
    if (job.kind === 'fetch-source') {
      const sourceId = job.payload?.sourceId;
      if (!sourceId) throw new Error('fetch-source job ohne sourceId');
      const source = await getSource(sourceId);
      if (!source) throw new Error(`Quelle ${sourceId} nicht gefunden`);
      await ingestSource(source);
    } else if (job.kind === 'discover-article-media') {
      const articleId = job.payload?.articleId;
      if (!articleId) throw new Error('discover-article-media job ohne articleId');
      await discoverArticleVisuals(articleId);
    } else {
      throw new Error(`Unbekannter Worker-Auftrag: ${String(job.kind)}`);
    }
    await completeWorkerJob(job.id);
  } catch (error) {
    const message = redactOperationalText(error instanceof Error ? error.message : String(error)).slice(0, 1000);
    const delay = sourceRetryDelaySeconds(Number(job.attempts || 1));
    await failWorkerJob(job.id, message, delay);
    throw error;
  }
}

if (process.env.NODE_ENV !== 'test' && process.env.VITEST !== 'true') {
  const youtubeShorts = new YoutubeShortsProcessor(workerId, log);
  await youtubeShorts.start();
  const tikTokShorts = new TikTokShortsProcessor(workerId, log);
  await tikTokShorts.start();
  const autonomousStudio = new AutonomousStudioProcessor(workerId, log);
  await autonomousStudio.start();
  const autonomousOperations = new AutonomousOperationsSupervisor(workerId, log);
  await autonomousOperations.start();
  const agentOrchestrator = new AgentOrchestratorProcessor(workerId, log);
  await agentOrchestrator.start();
  const videoEditorDownloads = new VideoEditorDownloadProcessor(workerId, log);
  await videoEditorDownloads.start();
  const videoEditor = new VideoEditorProcessor(workerId, log);
  await videoEditor.start();
  const editorialDesk = new EditorialDeskProcessor(log, reconcileAutomaticEditorialPipeline);
  await editorialDesk.start();
  const codexNewsroom = new CodexNewsroomPlanner(workerId, log);
  await codexNewsroom.start();
  let tickRunning = false;
  const tick = async () => {
    if (tickRunning) return;
    tickRunning = true;
    try {
      await reconcileAutomaticEditorialPipeline();
      await workOnce();
      await autopilotOnce(log);
    } finally {
      tickRunning = false;
    }
  };
  const autopilotStartup = await getAutopilotConfig().catch(() => null);
  log('started', {
    pollMs,
    workerId,
    autopilot: autopilotStartup?.enabled ?? process.env.AUTOPILOT_ENABLED === 'true',
  });
  await tick();
  setInterval(
    () => tick().catch((e) => log('loop_failed', { error: e instanceof Error ? e.message : String(e) })),
    pollMs,
  );
}
