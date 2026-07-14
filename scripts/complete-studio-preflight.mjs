import { runStudioPreflight } from './studio-preflight-lib.mjs';
import { inspectStreamingConfiguration } from './streaming-runtime-status.mjs';
import { inspectTtsRuntime } from './tts-runtime-status.mjs';

const TTS_CHECK_IDS = new Set(['tts-engine', 'tts-executable', 'tts-ffprobe', 'tts-model', 'tts-model-config']);
const TTS_SCOPES = new Set(['all', 'api']);
const STREAMING_SCOPES = new Set(['all', 'obs', 'configuration']);

function summarize(checks) {
  const errors = checks.filter((check) => check.status === 'error');
  return {
    ok: errors.length === 0,
    summary: {
      total: checks.length,
      passed: checks.filter((check) => check.status === 'ok').length,
      disabled: checks.filter((check) => check.status === 'disabled').length,
      errors: errors.length,
    },
  };
}

function normalizeLegacyCheck(check) {
  if (check.id === 'youtube-stream-key') return null;
  if (check.id.startsWith('twitch-')) return { ...check, id: `multistream-${check.id.slice('twitch-'.length)}` };
  return check;
}

export async function runCompleteStudioPreflight(options = {}) {
  const {
    basePreflight = runStudioPreflight,
    ttsInspector = inspectTtsRuntime,
    streamingInspector = inspectStreamingConfiguration,
    commandAvailable,
    ...preflightOptions
  } = options;
  const report = await basePreflight(preflightOptions);
  let checks = report.checks.map(normalizeLegacyCheck).filter(Boolean);
  let tts = null;
  let streaming = null;

  if (TTS_SCOPES.has(report.scope)) {
    tts = await ttsInspector({
      env: preflightOptions.env ?? process.env,
      root: preflightOptions.root ?? process.cwd(),
      ...(commandAvailable ? { commandAvailable } : {}),
    });
    checks = [...checks.filter((check) => !TTS_CHECK_IDS.has(check.id)), ...tts.checks];
  }

  if (STREAMING_SCOPES.has(report.scope)) {
    streaming = await streamingInspector(preflightOptions.env ?? process.env);
    checks.push(...streaming.checks);
  }

  const result = summarize(checks);
  return {
    ...report,
    ok: result.ok,
    summary: result.summary,
    checks,
    ...(tts
      ? {
          tts: {
            ok: tts.ok,
            engine: tts.engine,
            voice: tts.voice,
            model: tts.model,
          },
        }
      : {}),
    ...(streaming
      ? {
          streaming: {
            ok: streaming.ok,
            studio: streaming.studio,
            primary: streaming.primary,
            additionalTargets: streaming.additionalTargets,
          },
        }
      : {}),
  };
}
