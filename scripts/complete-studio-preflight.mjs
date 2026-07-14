import { runStudioPreflight } from './studio-preflight-lib.mjs';
import { inspectTtsRuntime } from './tts-runtime-status.mjs';

const TTS_CHECK_IDS = new Set(['tts-engine', 'tts-executable', 'tts-model', 'tts-model-config']);
const TTS_SCOPES = new Set(['all', 'api', 'configuration']);

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

export async function runCompleteStudioPreflight(options = {}) {
  const {
    basePreflight = runStudioPreflight,
    ttsInspector = inspectTtsRuntime,
    commandAvailable,
    ...preflightOptions
  } = options;
  const report = await basePreflight(preflightOptions);
  if (!TTS_SCOPES.has(report.scope)) return report;

  const tts = await ttsInspector({
    env: preflightOptions.env ?? process.env,
    root: preflightOptions.root ?? process.cwd(),
    ...(commandAvailable ? { commandAvailable } : {}),
  });
  const checks = [...report.checks.filter((check) => !TTS_CHECK_IDS.has(check.id)), ...tts.checks];
  const result = summarize(checks);
  return {
    ...report,
    ok: result.ok,
    summary: result.summary,
    checks,
    tts: {
      ok: tts.ok,
      engine: tts.engine,
      voice: tts.voice,
      model: tts.model,
    },
  };
}
