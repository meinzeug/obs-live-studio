import { stat } from 'node:fs/promises';

const startedAt = Date.now();
const text = process.env.TTS_DIAGNOSTIC_TEXT ?? 'Dies ist die technische Prüfung der Sprachausgabe.';

try {
  const { generateTtsAudio } = await import('../apps/api/dist/apps/api/src/tts-generation.js').catch(
    async (firstError) => {
      try {
        return await import('../apps/api/dist/tts-generation.js');
      } catch (secondError) {
        throw new Error('Die API ist noch nicht gebaut. Bitte zuerst npm run build ausführen.', {
          cause: secondError ?? firstError,
        });
      }
    },
  );

  const speech = await generateTtsAudio(text, process.env);
  const file = await stat(speech.file);
  console.log(
    JSON.stringify({
      ok: true,
      engine: speech.engine,
      configuredEngine: speech.configuredEngine,
      voice: speech.voice,
      modelPath:
        speech.configuredEngine === 'pocket-tts'
          ? (process.env.POCKET_TTS_LANGUAGE ?? 'german_24l')
          : (process.env.PIPER_MODEL_PATH ?? process.env.TTS_MODEL_PATH ?? null),
      cached: speech.cached,
      file: speech.file,
      sizeBytes: file.size,
      durationSeconds: speech.durationSeconds,
      elapsedMs: Date.now() - startedAt,
    }),
  );
} catch (error) {
  console.error(
    JSON.stringify({
      ok: false,
      engine: (process.env.TTS_ENGINE ?? 'pocket-tts').toLowerCase(),
      voice: process.env.TTS_DEFAULT_VOICE ?? process.env.POCKET_TTS_VOICE ?? 'anna',
      error: error instanceof Error ? error.message : String(error),
      elapsedMs: Date.now() - startedAt,
    }),
  );
  process.exitCode = 1;
}
