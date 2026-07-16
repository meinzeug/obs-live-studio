import {
  DEFAULT_PIPER_EXECUTABLE,
  DEFAULT_PIPER_MODEL_PATH,
  DEFAULT_PIPER_VOICE,
  DEFAULT_TTS_ENGINE,
  probeAudioDuration,
  synthesizeEspeak,
  synthesizePiper,
} from '@ans/tts-engine';

type SpeechFile = { file: string; cached: boolean };

type TtsGenerationDependencies = {
  synthesizePiper: (text: string, options: Parameters<typeof synthesizePiper>[1]) => Promise<SpeechFile>;
  synthesizeEspeak: (text: string, options: Parameters<typeof synthesizeEspeak>[1]) => Promise<SpeechFile>;
  probeAudioDuration: typeof probeAudioDuration;
};

const defaultDependencies: TtsGenerationDependencies = {
  synthesizePiper,
  synthesizeEspeak,
  probeAudioDuration,
};

export type TtsEngineName = 'piper' | 'espeak-ng';

export class TtsGenerationError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'TtsGenerationError';
  }
}

function timeoutMs(env: NodeJS.ProcessEnv) {
  const value = Number(env.TTS_TIMEOUT_MS ?? 120_000);
  return Number.isFinite(value) ? Math.max(1_000, Math.min(15 * 60_000, Math.floor(value))) : 120_000;
}

export function resolveTtsGenerationConfig(env: NodeJS.ProcessEnv = process.env) {
  const configuredEngine = String(env.TTS_ENGINE ?? DEFAULT_TTS_ENGINE)
    .trim()
    .toLowerCase();
  const engine = configuredEngine === 'espeak' ? 'espeak-ng' : configuredEngine;
  if (engine !== 'piper' && engine !== 'espeak-ng') {
    throw new TtsGenerationError(
      `Die konfigurierte TTS-Engine „${engine || '(leer)'}“ wird nicht unterstützt. Erlaubt sind piper und espeak-ng.`,
      503,
    );
  }
  const espeak = engine === 'espeak-ng';
  return {
    engine: engine as TtsEngineName,
    outputDirectory: env.TTS_OUTPUT_DIR ?? env.TTS_OUTPUT_DIRECTORY ?? './var/tts',
    executable: espeak
      ? (env.ESPEAK_EXECUTABLE ?? '/usr/bin/espeak-ng')
      : (env.PIPER_EXECUTABLE ?? DEFAULT_PIPER_EXECUTABLE),
    modelPath: espeak ? null : (env.PIPER_MODEL_PATH ?? env.TTS_MODEL_PATH ?? DEFAULT_PIPER_MODEL_PATH),
    voice: env.TTS_DEFAULT_VOICE ?? (espeak ? 'de' : DEFAULT_PIPER_VOICE),
    speed: Number(env.TTS_SPEED ?? (espeak ? 165 : 1)),
    volume: Number(env.TTS_VOLUME ?? (espeak ? 100 : 1)),
    timeoutMs: timeoutMs(env),
    ffprobeExecutable: env.FFPROBE_EXECUTABLE,
  };
}

function synthesisError(engine: TtsEngineName, error: unknown) {
  const detail = error instanceof Error ? error.message : String(error);
  if (/zeitlimit|time.?out/i.test(detail)) {
    return new TtsGenerationError('Die Sprachausgabe hat das konfigurierte Zeitlimit überschritten.', 504, {
      cause: error,
    });
  }
  if (engine === 'piper') {
    return new TtsGenerationError(
      'Piper oder das deutsche Thorsten-Modell fehlt beziehungsweise ist nicht ausführbar. Führe „npm run studio:tts:install“ aus.',
      503,
      { cause: error },
    );
  }
  return new TtsGenerationError(
    'eSpeak NG fehlt beziehungsweise ist nicht ausführbar. Installiere das Paket „espeak-ng“ oder aktiviere Piper.',
    503,
    { cause: error },
  );
}

export async function generateTtsAudio(
  text: string,
  env: NodeJS.ProcessEnv = process.env,
  dependencies: TtsGenerationDependencies = defaultDependencies,
) {
  const config = resolveTtsGenerationConfig(env);
  let speech: SpeechFile;
  try {
    speech =
      config.engine === 'espeak-ng'
        ? await dependencies.synthesizeEspeak(text, {
            outputDirectory: config.outputDirectory,
            executable: config.executable,
            voice: config.voice,
            speed: config.speed,
            volume: config.volume,
            timeoutMs: config.timeoutMs,
          })
        : await dependencies.synthesizePiper(text, {
            outputDirectory: config.outputDirectory,
            piperExecutable: config.executable,
            modelPath: config.modelPath!,
            voice: config.voice,
            speed: config.speed,
            volume: config.volume,
            timeoutMs: config.timeoutMs,
          });
  } catch (error) {
    throw synthesisError(config.engine, error);
  }

  try {
    const durationSeconds = await dependencies.probeAudioDuration(
      speech.file,
      config.ffprobeExecutable,
      Math.min(config.timeoutMs, 30_000),
    );
    return { ...speech, durationSeconds, engine: config.engine, voice: config.voice };
  } catch (error) {
    throw new TtsGenerationError(
      'Die Audiodatei wurde erzeugt, konnte aber nicht mit FFprobe geprüft werden. Prüfe die FFmpeg-Installation.',
      503,
      { cause: error },
    );
  }
}
