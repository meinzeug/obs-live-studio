import { stat } from 'node:fs/promises';

const startedAt = Date.now();
const outputDirectory = process.env.TTS_OUTPUT_DIR ?? process.env.TTS_OUTPUT_DIRECTORY ?? './var/tts';
const configuredEngine = String(process.env.TTS_ENGINE ?? 'piper').toLowerCase();
const configuredTimeout = Number(process.env.TTS_TIMEOUT_MS ?? 120_000);
const minimumTimeout = configuredEngine === 'qwen3-tts' ? 300_000 : 1_000;
const fallbackTimeout = configuredEngine === 'qwen3-tts' ? 300_000 : 120_000;
const timeoutMs = Number.isFinite(configuredTimeout) ? Math.max(minimumTimeout, configuredTimeout) : fallbackTimeout;
const text = process.env.TTS_DIAGNOSTIC_TEXT ?? 'Dies ist die technische Prüfung der Sprachausgabe.';

try {
  const {
    DEFAULT_PIPER_EXECUTABLE,
    DEFAULT_PIPER_MODEL_PATH,
    DEFAULT_PIPER_VOICE,
    DEFAULT_TTS_ENGINE,
    probeAudioDuration,
    synthesizeEspeak,
    synthesizePiper,
    synthesizeQwen3Tts,
  } = await import('../packages/tts-engine/dist/index.js').catch(async (firstError) => {
    try {
      return await import('../packages/tts-engine/dist/packages/tts-engine/src/index.js');
    } catch (secondError) {
      throw new Error('Das TTS-Paket ist noch nicht gebaut. Bitte zuerst npm run build ausführen.', {
        cause: secondError ?? firstError,
      });
    }
  });

  const engine = (process.env.TTS_ENGINE ?? DEFAULT_TTS_ENGINE).toLowerCase();
  const espeak = engine === 'espeak-ng' || engine === 'espeak';
  const qwen = engine === 'qwen3-tts';
  const modelPath = process.env.PIPER_MODEL_PATH ?? process.env.TTS_MODEL_PATH ?? DEFAULT_PIPER_MODEL_PATH;
  const qwenModel = process.env.QWEN3_TTS_MODEL ?? 'Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice';
  const voice = qwen ? 'qwen3-tts-german' : (process.env.TTS_DEFAULT_VOICE ?? (espeak ? 'de' : DEFAULT_PIPER_VOICE));

  const speech = espeak
    ? await synthesizeEspeak(text, {
        outputDirectory,
        executable: process.env.ESPEAK_EXECUTABLE,
        voice,
        speed: Number(process.env.TTS_SPEED ?? 165),
        volume: Number(process.env.TTS_VOLUME ?? 100),
        timeoutMs,
      })
    : qwen
      ? await synthesizeQwen3Tts(text, {
          outputDirectory,
          executable: process.env.QWEN3_TTS_EXECUTABLE ?? './var/qwen3-tts-venv/bin/python',
          model: qwenModel,
          modelDirectory: process.env.QWEN3_TTS_MODEL_DIR,
          language: process.env.QWEN3_TTS_LANGUAGE ?? 'German',
          speaker: process.env.QWEN3_TTS_SPEAKER ?? 'Ryan',
          instruct:
            process.env.QWEN3_TTS_INSTRUCT ??
            'Sprich wie ein ruhiger deutscher Nachrichtensprecher: klar, seriös, neutral und gut verständlich.',
          timeoutMs,
        })
      : await synthesizePiper(text, {
          outputDirectory,
          modelPath,
          piperExecutable: process.env.PIPER_EXECUTABLE ?? DEFAULT_PIPER_EXECUTABLE,
          voice,
          speed: Number(process.env.TTS_SPEED ?? 1),
          volume: Number(process.env.TTS_VOLUME ?? 1),
          timeoutMs,
        });

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
      voice,
      modelPath: espeak ? null : qwen ? (process.env.QWEN3_TTS_MODEL_DIR ?? qwenModel) : modelPath,
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
      engine: (process.env.TTS_ENGINE ?? 'piper').toLowerCase(),
      voice: process.env.TTS_DEFAULT_VOICE ?? 'de_DE-dii-high',
      error: error instanceof Error ? error.message : String(error),
      elapsedMs: Date.now() - startedAt,
    }),
  );
  process.exitCode = 1;
}
