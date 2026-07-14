import { stat } from 'node:fs/promises';

const startedAt = Date.now();
const engine = (process.env.TTS_ENGINE ?? 'piper').toLowerCase();
const outputDirectory = process.env.TTS_OUTPUT_DIR ?? process.env.TTS_OUTPUT_DIRECTORY ?? './var/tts';
const timeoutMs = Math.max(1_000, Number(process.env.TTS_TIMEOUT_MS ?? 120_000));
const text = process.env.TTS_DIAGNOSTIC_TEXT ?? 'Dies ist die technische Prüfung der Sprachausgabe.';

try {
  const { probeAudioDuration, synthesizeEspeak, synthesizePiper } = await import(
    '../packages/tts-engine/dist/index.js'
  ).catch((error) => {
    throw new Error('Das TTS-Paket ist noch nicht gebaut. Bitte zuerst npm run build ausführen.', { cause: error });
  });

  const speech =
    engine === 'espeak-ng' || engine === 'espeak'
      ? await synthesizeEspeak(text, {
          outputDirectory,
          executable: process.env.ESPEAK_EXECUTABLE,
          voice: process.env.TTS_DEFAULT_VOICE ?? 'de',
          speed: Number(process.env.TTS_SPEED ?? 165),
          volume: Number(process.env.TTS_VOLUME ?? 100),
          timeoutMs,
        })
      : await synthesizePiper(text, {
          outputDirectory,
          modelPath: process.env.PIPER_MODEL_PATH ?? process.env.TTS_MODEL_PATH ?? '',
          piperExecutable: process.env.PIPER_EXECUTABLE,
          voice: process.env.TTS_DEFAULT_VOICE,
          speed: Number(process.env.TTS_SPEED ?? 1),
          volume: Number(process.env.TTS_VOLUME ?? 1),
          timeoutMs,
        });

  if (engine !== 'espeak-ng' && engine !== 'espeak' && !process.env.PIPER_MODEL_PATH && !process.env.TTS_MODEL_PATH) {
    throw new Error('Für Piper fehlt PIPER_MODEL_PATH oder TTS_MODEL_PATH');
  }

  const durationSeconds = await probeAudioDuration(
    speech.file,
    process.env.FFPROBE_EXECUTABLE,
    Math.min(timeoutMs, 30_000),
  );
  const file = await stat(speech.file);
  console.log(
    JSON.stringify({
      ok: true,
      engine,
      cached: speech.cached,
      file: speech.file,
      sizeBytes: file.size,
      durationSeconds,
      elapsedMs: Date.now() - startedAt,
    }),
  );
} catch (error) {
  console.error(
    JSON.stringify({
      ok: false,
      engine,
      error: error instanceof Error ? error.message : String(error),
      elapsedMs: Date.now() - startedAt,
    }),
  );
  process.exitCode = 1;
}
