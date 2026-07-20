import {
  DEFAULT_PIPER_EXECUTABLE,
  DEFAULT_PIPER_MODEL_PATH,
  DEFAULT_PIPER_VOICE,
  DEFAULT_TTS_ENGINE,
  probeAudioDuration,
  synthesizeEspeak,
  synthesizePiper,
  synthesizeQwen3Tts,
} from '@ans/tts-engine';
import { isAbsolute, resolve } from 'node:path';
import { PROJECT_ROOT } from './project-root.js';

type SpeechFile = { file: string; cached: boolean };

type TtsGenerationDependencies = {
  synthesizePiper: (text: string, options: Parameters<typeof synthesizePiper>[1]) => Promise<SpeechFile>;
  synthesizeEspeak: (text: string, options: Parameters<typeof synthesizeEspeak>[1]) => Promise<SpeechFile>;
  synthesizeQwen3Tts: (text: string, options: Parameters<typeof synthesizeQwen3Tts>[1]) => Promise<SpeechFile>;
  probeAudioDuration: typeof probeAudioDuration;
};

const defaultDependencies: TtsGenerationDependencies = {
  synthesizePiper,
  synthesizeEspeak,
  synthesizeQwen3Tts,
  probeAudioDuration,
};

export type TtsEngineName = 'piper' | 'espeak-ng' | 'qwen3-tts';

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

function timeoutMs(env: NodeJS.ProcessEnv, engine: TtsEngineName) {
  const value = Number(env.TTS_TIMEOUT_MS ?? 120_000);
  const minimum = engine === 'qwen3-tts' ? 300_000 : 1_000;
  const fallback = engine === 'qwen3-tts' ? 300_000 : 120_000;
  return Number.isFinite(value) ? Math.max(minimum, Math.min(15 * 60_000, Math.floor(value))) : fallback;
}

function resolveLocalPath(value: string | undefined | null) {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  if (!trimmed.includes('/') || isAbsolute(trimmed)) return trimmed;
  return resolve(PROJECT_ROOT, trimmed);
}

export function resolveTtsGenerationConfig(env: NodeJS.ProcessEnv = process.env) {
  const configuredEngine = String(env.TTS_ENGINE ?? DEFAULT_TTS_ENGINE)
    .trim()
    .toLowerCase();
  const engine = configuredEngine === 'espeak' ? 'espeak-ng' : configuredEngine;
  if (engine !== 'piper' && engine !== 'espeak-ng' && engine !== 'qwen3-tts') {
    throw new TtsGenerationError(
      `Die konfigurierte TTS-Engine „${engine || '(leer)'}“ wird nicht unterstützt. Erlaubt sind piper, espeak-ng und qwen3-tts.`,
      503,
    );
  }
  const espeak = engine === 'espeak-ng';
  const qwen = engine === 'qwen3-tts';
  return {
    engine: engine as TtsEngineName,
    outputDirectory: resolveLocalPath(env.TTS_OUTPUT_DIR ?? env.TTS_OUTPUT_DIRECTORY ?? './var/tts')!,
    executable: qwen
      ? resolveLocalPath(env.QWEN3_TTS_EXECUTABLE ?? './var/qwen3-tts-venv/bin/python')!
      : espeak
        ? resolveLocalPath(env.ESPEAK_EXECUTABLE ?? '/usr/bin/espeak-ng')!
        : resolveLocalPath(env.PIPER_EXECUTABLE ?? DEFAULT_PIPER_EXECUTABLE)!,
    modelPath:
      espeak || qwen ? null : resolveLocalPath(env.PIPER_MODEL_PATH ?? env.TTS_MODEL_PATH ?? DEFAULT_PIPER_MODEL_PATH),
    voice: qwen ? 'qwen3-tts-german' : (env.TTS_DEFAULT_VOICE ?? (espeak ? 'de' : DEFAULT_PIPER_VOICE)),
    qwenModel: env.QWEN3_TTS_MODEL ?? 'Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice',
    qwenModelDirectory: resolveLocalPath(env.QWEN3_TTS_MODEL_DIR),
    qwenLanguage: env.QWEN3_TTS_LANGUAGE ?? 'German',
    qwenSpeaker: env.QWEN3_TTS_SPEAKER ?? 'Ryan',
    qwenInstruct:
      env.QWEN3_TTS_INSTRUCT ??
      'Sprich wie ein ruhiger deutscher Nachrichtensprecher: klar, seriös, neutral und gut verständlich.',
    speed: Number(env.TTS_SPEED ?? (espeak ? 165 : 1)),
    volume: Number(env.TTS_VOLUME ?? (espeak ? 100 : 1)),
    timeoutMs: timeoutMs(env, engine as TtsEngineName),
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
  if (engine === 'qwen3-tts') {
    return new TtsGenerationError(
      'Qwen3-TTS fehlt beziehungsweise ist nicht ausführbar. Wähle das Qwen3-TTS-Preset unter Einstellungen → TTS und warte die Installation ab.',
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
      config.engine === 'qwen3-tts'
        ? await dependencies.synthesizeQwen3Tts(text, {
            outputDirectory: config.outputDirectory,
            executable: config.executable,
            model: config.qwenModel,
            modelDirectory: config.qwenModelDirectory,
            language: config.qwenLanguage,
            speaker: config.qwenSpeaker,
            instruct: config.qwenInstruct,
            timeoutMs: config.timeoutMs,
          })
        : config.engine === 'espeak-ng'
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
