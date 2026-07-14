import dotenv from 'dotenv';
import { parseFeed, parseHtmlArticle, contentHash } from '@ans/news-parser';
import { fetchHttpText } from '@ans/source-connectors';
import {
  dueSources,
  getSource,
  markSourceError,
  markSourceSuccess,
  recordSourceCheck,
  upsertArticle,
  pool,
  scheduleSourceFetchJobs,
  claimWorkerJob,
  completeWorkerJob,
  failWorkerJob,
} from '@ans/database';
import { resolveOperationalNotification, upsertOperationalNotification } from '@ans/database/notifications';
import { classifyCritical } from '@ans/content-processing';
import { autopilotOnce } from './autopilot.js';
dotenv.config();
const pollMs = Number(process.env.WORKER_POLL_MS ?? 30000);
const allowPrivate = process.env.ALLOW_PRIVATE_SOURCES === 'true';
const workerId = `worker-${process.pid}`;
function isLocal(raw: string) {
  const url = new URL(raw);
  return ['127.0.0.1', 'localhost'].includes(url.hostname) && url.port === String(process.env.APP_PORT ?? 12000);
}
function log(event: string, extra: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ component: 'worker', level: 'info', event, time: new Date().toISOString(), ...extra }));
}
function sourceFailureKey(sourceId: string) {
  return `source:${sourceId}:fetch`;
}
export async function withSourceLock<T>(sourceId: string, fn: () => Promise<T>) {
  const client = await pool.connect();
  const key = Buffer.from(sourceId.replace(/-/g, '').slice(0, 16), 'hex').readBigInt64BE();
  try {
    await client.query('begin');
    const ok = (await client.query('select pg_try_advisory_xact_lock($1) locked', [key])).rows[0]?.locked;
    if (!ok) {
      await client.query('rollback');
      return null;
    }
    const result = await fn();
    await client.query('commit');
    return result;
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }
}
export async function ingestSource(source: any) {
  return withSourceLock(source.id, async () => {
    try {
      const fetched = await fetchHttpText(source.url, {
        timeoutMs: source.max_fetch_seconds * 1000,
        maxBytes: 1024 * 1024,
        etag: source.etag,
        lastModified: source.last_modified,
        allowPrivate: allowPrivate || isLocal(source.url),
        userAgent: process.env.NEWS_USER_AGENT,
      });
      if (fetched.notModified) {
        await markSourceSuccess(source.id, fetched.etag, fetched.lastModified);
        await resolveOperationalNotification(sourceFailureKey(source.id));
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
              allowPrivate: allowPrivate || isLocal(item.url),
              userAgent: process.env.NEWS_USER_AGENT,
            });
            full = parseHtmlArticle(page.body, page.url);
          } catch (e) {
            log('article_fetch_failed', { url: item.url, error: e instanceof Error ? e.message : String(e) });
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
        if (row) inserted++;
      }
      await markSourceSuccess(source.id, fetched.etag, fetched.lastModified);
      await resolveOperationalNotification(sourceFailureKey(source.id));
      await recordSourceCheck(source.id, 'ok', {
        status: fetched.status,
        items: parsed.length,
        inserted,
        finalUrl: fetched.url,
      });
      log('source_fetched', { sourceId: source.id, items: parsed.length, inserted });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await markSourceError(source.id, message);
      const attempts = source.consecutive_errors + 1;
      const delay = Math.min(3600, 2 ** attempts * 60);
      await recordSourceCheck(source.id, 'error', { error: message, retryInSeconds: delay });
      await upsertOperationalNotification({
        level: attempts >= 3 ? 'error' : 'warning',
        component: 'source-ingest',
        dedupeKey: sourceFailureKey(source.id),
        message: `Quelle „${source.name}“ konnte nicht abgerufen werden.`,
        details: {
          sourceId: source.id,
          sourceName: source.name,
          error: message.slice(0, 1000),
          retryInSeconds: delay,
          consecutiveErrors: attempts,
        },
      });
      log('source_failed', { sourceId: source.id, error: message, retryInSeconds: delay, workerId });
    }
  });
}
export async function ingestOnce() {
  const sources = await dueSources();
  for (const source of sources) await ingestSource(source);
}
export async function workOnce() {
  await scheduleSourceFetchJobs();
  const job = await claimWorkerJob(workerId);
  if (!job) return ingestOnce();
  try {
    if (job.kind === 'fetch-source') {
      const sourceId = job.payload?.sourceId;
      if (!sourceId) throw new Error('fetch-source job ohne sourceId');
      const source = await getSource(sourceId);
      if (!source) throw new Error(`Quelle ${sourceId} nicht gefunden`);
      await ingestSource(source);
    }
    await completeWorkerJob(job.id);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const delay = Math.min(3600, 2 ** Number(job.attempts || 1) * 60);
    await failWorkerJob(job.id, message, delay);
    throw e;
  }
}
if (process.env.NODE_ENV !== 'test') {
  let tickRunning = false;
  const tick = async () => {
    if (tickRunning) return;
    tickRunning = true;
    try {
      await workOnce();
      await autopilotOnce(log);
    } finally {
      tickRunning = false;
    }
  };
  log('started', { pollMs, workerId, autopilot: process.env.AUTOPILOT_ENABLED === 'true' });
  await tick();
  setInterval(
    () => tick().catch((e) => log('loop_failed', { error: e instanceof Error ? e.message : String(e) })),
    pollMs,
  );
}
