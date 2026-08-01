import 'dotenv/config';
import {
  closeDatabase,
  failYoutubeTranscript,
  getYoutubeVideo,
  markYoutubeTranscriptProcessing,
  saveYoutubeTranscript,
  type YoutubeVideoRecord,
} from '../packages/database/src/index.js';
import {
  listYoutubePreproductionCandidates,
  markYoutubePreproductionStatus,
  youtubePreproductionSummary,
} from '../packages/database/src/youtube-preproduction.js';
import { fetchYoutubeTranscript } from '../apps/api/src/youtube-transcript.js';
import {
  preproduceYoutubeVideo,
  YOUTUBE_PREPRODUCTION_GENERATOR_VERSION,
} from '../apps/api/src/youtube-preproduction.js';

type Options = {
  limit: number;
  concurrency: number;
  forceTranscripts: boolean;
  scriptsOnly: boolean;
  missingOnly: boolean;
  delayMs: number;
  videoId: string | null;
};

function optionsFromArgv(argv: string[]): Options {
  const numberAfter = (flag: string, fallback: number) => {
    const index = argv.indexOf(flag);
    const value = index >= 0 ? Number(argv[index + 1]) : Number.NaN;
    return Number.isFinite(value) ? Math.floor(value) : fallback;
  };
  return {
    limit: Math.max(1, Math.min(10_000, numberAfter('--limit', 10_000))),
    concurrency: Math.max(1, Math.min(6, numberAfter('--concurrency', 2))),
    forceTranscripts: argv.includes('--force-transcripts'),
    scriptsOnly: argv.includes('--scripts-only'),
    missingOnly: argv.includes('--missing-only'),
    delayMs: Math.max(0, Math.min(120_000, numberAfter('--delay-ms', 4_500))),
    videoId: (() => {
      const index = argv.indexOf('--video-id');
      return index >= 0 && argv[index + 1]?.trim() ? argv[index + 1]!.trim() : null;
    })(),
  };
}

function videoLabel(video: YoutubeVideoRecord) {
  return `${video.video_id} · ${video.title}`.slice(0, 180);
}

async function storeScript(video: YoutubeVideoRecord) {
  const result = await preproduceYoutubeVideo(video, { ttsConcurrency: 2 });
  return { script: result.script, cues: result.cues.length, model: result.model };
}

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

async function fetchAndStoreTranscript(video: YoutubeVideoRecord) {
  await markYoutubeTranscriptProcessing(video.id);
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const transcript = await fetchYoutubeTranscript(video.video_id);
      const saved = await saveYoutubeTranscript(video.id, transcript);
      if (!saved) throw new Error('Video wurde während der Verarbeitung entfernt.');
      return saved;
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      if (!/\b429\b|Too Many Requests|quota/i.test(message) || attempt >= 3) break;
      const cooldownMs = attempt * 90_000;
      console.warn(
        `[youtube-preproduction] YouTube drosselt den Abruf; ${Math.round(cooldownMs / 1_000)} Sekunden Pause vor Versuch ${attempt + 1}.`,
      );
      await wait(cooldownMs);
    }
  }
  const message = lastError instanceof Error ? lastError.message : String(lastError);
  await failYoutubeTranscript(
    video.id,
    message,
    /kein.*Transkript|keine Untertitel|leer oder zu kurz|live event will begin/i.test(message)
      ? 'unavailable'
      : 'error',
  );
  await markYoutubePreproductionStatus(
    video.id,
    /\b429\b|Too Many Requests|quota/i.test(message) ? 'error' : 'unavailable',
    message,
  );
  throw lastError;
}

async function workerPool<T>(
  items: T[],
  concurrency: number,
  delayMs: number,
  run: (item: T, index: number) => Promise<void>,
) {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, Math.max(1, items.length)) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      await run(items[index]!, index);
      if (cursor < items.length && delayMs > 0) await wait(delayMs);
    }
  });
  await Promise.all(workers);
}

async function main() {
  const options = optionsFromArgv(process.argv.slice(2));
  const candidates = await listYoutubePreproductionCandidates({
    limit: options.limit,
    includeReady: false,
    missingTranscriptOnly: options.missingOnly,
    generatorVersion: YOUTUBE_PREPRODUCTION_GENERATOR_VERSION,
    videoId: options.videoId ?? undefined,
  });
  const ready = candidates.filter(
    (video) =>
      video.transcript_status === 'ready' &&
      Boolean(video.transcript_text?.trim()) &&
      (!options.forceTranscripts || options.scriptsOnly),
  );
  const missing = options.scriptsOnly
    ? []
    : candidates.filter(
        (video) => options.forceTranscripts || video.transcript_status !== 'ready' || !video.transcript_text?.trim(),
      );
  let scripted = 0;
  let fetched = 0;
  let failed = 0;
  let cues = 0;

  console.log(
    `[youtube-preproduction] Start: ${ready.length} vorhandene Transkripte, ${missing.length} Abrufe, Parallelität ${options.concurrency}`,
  );

  for (const [index, video] of ready.entries()) {
    try {
      const result = await storeScript(video);
      scripted += 1;
      cues += result.cues;
    } catch (error) {
      failed += 1;
      await markYoutubePreproductionStatus(video.id, 'error', error instanceof Error ? error.message : String(error));
    }
    if ((index + 1) % 25 === 0 || index + 1 === ready.length)
      console.log(`[youtube-preproduction] Codex + TTS: ${index + 1}/${ready.length} · ${cues} fertige Cues`);
  }

  await workerPool(missing, options.concurrency, options.delayMs, async (candidate, index) => {
    try {
      const current = options.forceTranscripts ? candidate : ((await getYoutubeVideo(candidate.id)) ?? candidate);
      const video =
        !options.forceTranscripts && current.transcript_status === 'ready' && current.transcript_text?.trim()
          ? current
          : await fetchAndStoreTranscript(current);
      fetched += 1;
      const result = await storeScript(video);
      scripted += 1;
      cues += result.cues;
      console.log(
        `[youtube-preproduction] ${index + 1}/${missing.length} OK · ${result.cues} Codex-/TTS-Cues · ${videoLabel(video)}`,
      );
    } catch (error) {
      failed += 1;
      console.warn(
        `[youtube-preproduction] ${index + 1}/${missing.length} FEHLER · ${videoLabel(candidate)} · ${
          error instanceof Error ? error.message.slice(0, 400) : String(error).slice(0, 400)
        }`,
      );
    }
  });

  const summary = await youtubePreproductionSummary();
  console.log(
    `[youtube-preproduction] Fertig: ${scripted} Skripte, ${fetched} neue Transkripte, ${failed} Fehler, ${cues} Cues in diesem Lauf.`,
  );
  console.log(`[youtube-preproduction] Datenbank: ${JSON.stringify(summary)}`);
  if (failed > 0) process.exitCode = 2;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDatabase();
  });
