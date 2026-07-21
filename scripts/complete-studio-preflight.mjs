import { runStudioPreflight } from './studio-preflight-lib.mjs';
import { inspectStreamingConfiguration } from './streaming-runtime-status.mjs';
import { inspectTtsRuntime } from './tts-runtime-status.mjs';

const TTS_CHECK_IDS = new Set([
  'tts-engine',
  'tts-executable',
  'tts-ffprobe',
  'tts-model',
  'tts-model-config',
  'tts-pocket-service',
  'tts-qwen-model',
  'tts-qwen-tokenizer',
]);
const TTS_SCOPES = new Set(['all', 'api']);
const STREAMING_SCOPES = new Set(['all', 'api', 'obs', 'configuration']);

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

function reconcileObsStreamService(checks, streaming, env) {
  const manualUnconfigured =
    env.STREAM_AUTO_START !== 'true' && streaming?.primary && streaming.primary.configured === false;
  if (!manualUnconfigured) return checks;
  return checks.map((check) =>
    check.id === 'obs-stream-service'
      ? {
          ...check,
          status: 'disabled',
          message: 'Das OBS-Hauptziel ist noch nicht konfiguriert; der automatische Streamstart ist deaktiviert.',
        }
      : check,
  );
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
  const env = preflightOptions.env ?? process.env;
  let checks = report.checks.map(normalizeLegacyCheck).filter(Boolean);
  let tts = null;
  let streaming = null;

  if (TTS_SCOPES.has(report.scope)) {
    tts = await ttsInspector({
      env,
      root: preflightOptions.root ?? process.cwd(),
      ...(commandAvailable ? { commandAvailable } : {}),
    });
    checks = [...checks.filter((check) => !TTS_CHECK_IDS.has(check.id)), ...tts.checks];
  }

  if (STREAMING_SCOPES.has(report.scope)) {
    streaming = await streamingInspector(env);
    checks = reconcileObsStreamService(checks, streaming, env);
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
