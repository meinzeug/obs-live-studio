import {
  DEFAULT_POCKET_TTS_DECODE_STEPS,
  DEFAULT_POCKET_TTS_CHAT_VOICE,
  DEFAULT_POCKET_TTS_LANGUAGE,
  DEFAULT_POCKET_TTS_SERVER_URL,
  DEFAULT_POCKET_TTS_TEMPERATURE,
  DEFAULT_POCKET_TTS_VOICE,
  DEFAULT_PIPER_EXECUTABLE,
  DEFAULT_PIPER_MODEL_PATH,
  DEFAULT_PIPER_VOICE,
  DEFAULT_TTS_ENGINE,
  DEFAULT_TTS_OUTPUT_GAIN_DB,
  probeAudioDuration,
  synthesizeEspeak,
  synthesizePiper,
  synthesizePocketTts,
  synthesizeQwen3Tts,
} from '@ans/tts-engine';
import { isAbsolute, resolve } from 'node:path';
import { resolveOperationalNotification, upsertOperationalNotification } from '@ans/database/notifications';
import { PROJECT_ROOT } from './project-root.js';

type SpeechFile = { file: string; cached: boolean };

type TtsGenerationDependencies = {
  synthesizePocketTts: (text: string, options: Parameters<typeof synthesizePocketTts>[1]) => Promise<SpeechFile>;
  synthesizePiper: (text: string, options: Parameters<typeof synthesizePiper>[1]) => Promise<SpeechFile>;
  synthesizeEspeak: (text: string, options: Parameters<typeof synthesizeEspeak>[1]) => Promise<SpeechFile>;
  synthesizeQwen3Tts: (text: string, options: Parameters<typeof synthesizeQwen3Tts>[1]) => Promise<SpeechFile>;
  probeAudioDuration: typeof probeAudioDuration;
  reportTtsFallback: typeof reportTtsFallback;
  resolveTtsFallback: typeof resolveTtsFallback;
};

const defaultDependencies: TtsGenerationDependencies = {
  synthesizePocketTts,
  synthesizePiper,
  synthesizeEspeak,
  synthesizeQwen3Tts,
  probeAudioDuration,
  reportTtsFallback,
  resolveTtsFallback,
};

export type TtsEngineName = 'pocket-tts' | 'piper' | 'espeak-ng' | 'qwen3-tts';

export function ttsEnvironmentForAiPresenter(
  staffMemberId: string,
  env: NodeJS.ProcessEnv = process.env,
  voiceOverride?: string,
): NodeJS.ProcessEnv {
  const configuredEngine = String(env.TTS_ENGINE ?? DEFAULT_TTS_ENGINE)
    .trim()
    .toLowerCase();
  const voice = voiceOverride?.trim();
  if (voice) {
    if (configuredEngine === 'piper') {
      const modelPaths: Record<string, string> = {
        'de_DE-dii-high': './var/models/piper/de_DE-dii-high.onnx',
        'de_DE-thorsten-high': './var/models/piper/de_DE-thorsten-high.onnx',
        'de_DE-thorsten-medium': './var/models/piper/de_DE-thorsten-medium.onnx',
        'de_DE-eva_k-x_low': './var/models/piper/de_DE-eva_k-x_low.onnx',
      };
      if (!modelPaths[voice]) return env;
      return {
        ...env,
        TTS_DEFAULT_VOICE: voice,
        PIPER_MODEL_PATH: modelPaths[voice],
        TTS_MODEL_PATH: modelPaths[voice],
      };
    }
    const next: NodeJS.ProcessEnv = { ...env, TTS_DEFAULT_VOICE: voice };
    if (configuredEngine === 'qwen3-tts') next.QWEN3_TTS_SPEAKER = voice;
    return next;
  }
  if (!['chat-moderator', 'chat-analyst'].includes(staffMemberId) || configuredEngine !== 'pocket-tts') return env;
  return {
    ...env,
    TTS_DEFAULT_VOICE: env.AI_CHAT_MODERATOR_TTS_VOICE?.trim() || DEFAULT_POCKET_TTS_CHAT_VOICE,
  };
}

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

function numericSetting(value: string | undefined, fallback: number, minimum: number, maximum: number) {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback;
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
  if (engine !== 'pocket-tts' && engine !== 'piper' && engine !== 'espeak-ng' && engine !== 'qwen3-tts') {
    throw new TtsGenerationError(
      `Die konfigurierte TTS-Engine „${engine || '(leer)'}“ wird nicht unterstützt. Erlaubt sind pocket-tts, piper, espeak-ng und qwen3-tts.`,
      503,
    );
  }
  const espeak = engine === 'espeak-ng';
  const qwen = engine === 'qwen3-tts';
  const pocket = engine === 'pocket-tts';
  return {
    engine: engine as TtsEngineName,
    outputDirectory: resolveLocalPath(env.TTS_OUTPUT_DIR ?? env.TTS_OUTPUT_DIRECTORY ?? './var/tts')!,
    executable: qwen
      ? resolveLocalPath(env.QWEN3_TTS_EXECUTABLE ?? './var/qwen3-tts-venv/bin/python')!
      : espeak
        ? resolveLocalPath(env.ESPEAK_EXECUTABLE ?? '/usr/bin/espeak-ng')!
        : resolveLocalPath(env.PIPER_EXECUTABLE ?? DEFAULT_PIPER_EXECUTABLE)!,
    modelPath:
      espeak || qwen || pocket
        ? null
        : resolveLocalPath(env.PIPER_MODEL_PATH ?? env.TTS_MODEL_PATH ?? DEFAULT_PIPER_MODEL_PATH),
    voice: qwen
      ? 'qwen3-tts-german'
      : pocket
        ? (env.TTS_DEFAULT_VOICE ?? env.POCKET_TTS_VOICE ?? DEFAULT_POCKET_TTS_VOICE)
        : (env.TTS_DEFAULT_VOICE ?? (espeak ? 'de' : DEFAULT_PIPER_VOICE)),
    pocketServerUrl: env.POCKET_TTS_SERVER_URL ?? DEFAULT_POCKET_TTS_SERVER_URL,
    pocketLanguage: env.POCKET_TTS_LANGUAGE ?? DEFAULT_POCKET_TTS_LANGUAGE,
    pocketTemperature: numericSetting(env.POCKET_TTS_TEMPERATURE, DEFAULT_POCKET_TTS_TEMPERATURE, 0, 2),
    pocketDecodeSteps: Math.round(numericSetting(env.POCKET_TTS_DECODE_STEPS, DEFAULT_POCKET_TTS_DECODE_STEPS, 1, 16)),
    qwenModel: env.QWEN3_TTS_MODEL ?? 'Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice',
    qwenModelDirectory: resolveLocalPath(env.QWEN3_TTS_MODEL_DIR),
    qwenLanguage: env.QWEN3_TTS_LANGUAGE ?? 'German',
    qwenSpeaker: env.QWEN3_TTS_SPEAKER ?? 'Ryan',
    qwenInstruct:
      env.QWEN3_TTS_INSTRUCT ??
      'Sprich wie ein ruhiger deutscher Nachrichtensprecher: klar, seriös, neutral und gut verständlich.',
    speed: Number(env.TTS_SPEED ?? (espeak ? 165 : 1)),
    volume: Number(env.TTS_VOLUME ?? (espeak ? 100 : 1)),
    outputGainDb: numericSetting(env.TTS_OUTPUT_GAIN_DB, DEFAULT_TTS_OUTPUT_GAIN_DB, -12, 18),
    ffmpegExecutable: env.FFMPEG_EXECUTABLE ?? 'ffmpeg',
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
  if (engine === 'pocket-tts') {
    return new TtsGenerationError(
      'Pocket TTS ist nicht erreichbar oder hat kein Audio erzeugt. Piper wurde als Fallback versucht; prüfe den Dienst obs-live-studio-pocket-tts.service.',
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

function fallbackKey(engine: string) {
  return `tts:${engine}:fallback`;
}

async function reportTtsFallback(engine: string, fallbackEngine: string, error: unknown) {
  await upsertOperationalNotification({
    level: 'warning',
    component: 'tts',
    dedupeKey: fallbackKey(engine),
    message: `${engine} ist fehlgeschlagen. Das Studio nutzt vorübergehend ${fallbackEngine} als TTS-Fallback.`,
    details: {
      engine,
      fallbackEngine,
      error: error instanceof Error ? error.message : String(error),
    },
  });
}

async function resolveTtsFallback(engine: string) {
  await resolveOperationalNotification(fallbackKey(engine));
}

async function synthesizePrimary(
  text: string,
  config: ReturnType<typeof resolveTtsGenerationConfig>,
  dependencies: TtsGenerationDependencies,
) {
  if (config.engine === 'pocket-tts') {
    return dependencies.synthesizePocketTts(text, {
      outputDirectory: config.outputDirectory,
      serverUrl: config.pocketServerUrl,
      voice: config.voice,
      language: config.pocketLanguage,
      temperature: config.pocketTemperature,
      decodeSteps: config.pocketDecodeSteps,
      speed: config.speed,
      outputGainDb: config.outputGainDb,
      ffmpegExecutable: config.ffmpegExecutable,
      timeoutMs: config.timeoutMs,
    });
  }
  if (config.engine === 'qwen3-tts') {
    return dependencies.synthesizeQwen3Tts(text, {
      outputDirectory: config.outputDirectory,
      executable: config.executable,
      model: config.qwenModel,
      modelDirectory: config.qwenModelDirectory,
      language: config.qwenLanguage,
      speaker: config.qwenSpeaker,
      instruct: config.qwenInstruct,
      outputGainDb: config.outputGainDb,
      ffmpegExecutable: config.ffmpegExecutable,
      timeoutMs: config.timeoutMs,
    });
  }
  if (config.engine === 'espeak-ng') {
    return dependencies.synthesizeEspeak(text, {
      outputDirectory: config.outputDirectory,
      executable: config.executable,
      voice: config.voice,
      speed: config.speed,
      volume: config.volume,
      outputGainDb: config.outputGainDb,
      ffmpegExecutable: config.ffmpegExecutable,
      timeoutMs: config.timeoutMs,
    });
  }
  return dependencies.synthesizePiper(text, {
    outputDirectory: config.outputDirectory,
    piperExecutable: config.executable,
    modelPath: config.modelPath!,
    voice: config.voice,
    speed: config.speed,
    volume: config.volume,
    outputGainDb: config.outputGainDb,
    ffmpegExecutable: config.ffmpegExecutable,
    timeoutMs: config.timeoutMs,
  });
}

async function synthesizePiperFallback(
  text: string,
  config: ReturnType<typeof resolveTtsGenerationConfig>,
  dependencies: TtsGenerationDependencies,
  env: NodeJS.ProcessEnv,
) {
  const modelPath = resolveLocalPath(env.PIPER_MODEL_PATH ?? env.TTS_MODEL_PATH ?? DEFAULT_PIPER_MODEL_PATH)!;
  const executable = resolveLocalPath(env.PIPER_EXECUTABLE ?? DEFAULT_PIPER_EXECUTABLE)!;
  return dependencies.synthesizePiper(text, {
    outputDirectory: config.outputDirectory,
    piperExecutable: executable,
    modelPath,
    voice: env.PIPER_FALLBACK_VOICE ?? DEFAULT_PIPER_VOICE,
    speed: Number(env.TTS_SPEED ?? 1),
    volume: Number(env.TTS_VOLUME ?? 1),
    outputGainDb: config.outputGainDb,
    ffmpegExecutable: config.ffmpegExecutable,
    timeoutMs: Math.max(1_000, Math.min(config.timeoutMs, 120_000)),
  });
}

export async function generateTtsAudio(
  text: string,
  env: NodeJS.ProcessEnv = process.env,
  dependencies: Partial<TtsGenerationDependencies> = defaultDependencies,
) {
  const deps: TtsGenerationDependencies = { ...defaultDependencies, ...dependencies };
  const config = resolveTtsGenerationConfig(env);
  let speech: SpeechFile;
  let effectiveEngine = config.engine;
  let effectiveVoice = config.voice;
  try {
    speech = await synthesizePrimary(text, config, deps);
    await deps.resolveTtsFallback(config.engine).catch(() => undefined);
  } catch (error) {
    if (config.engine !== 'piper') {
      try {
        speech = await synthesizePiperFallback(text, config, deps, env);
        effectiveEngine = 'piper';
        effectiveVoice = env.PIPER_FALLBACK_VOICE ?? DEFAULT_PIPER_VOICE;
        await deps.reportTtsFallback(config.engine, 'piper', error).catch(() => undefined);
      } catch (fallbackError) {
        throw synthesisError(config.engine, fallbackError);
      }
    } else {
      throw synthesisError(config.engine, error);
    }
  }

  try {
    const durationSeconds = await deps.probeAudioDuration(
      speech.file,
      config.ffprobeExecutable,
      Math.min(config.timeoutMs, 30_000),
    );
    return {
      ...speech,
      durationSeconds,
      engine: effectiveEngine,
      configuredEngine: config.engine,
      voice: effectiveVoice,
    };
  } catch (error) {
    throw new TtsGenerationError(
      'Die Audiodatei wurde erzeugt, konnte aber nicht mit FFprobe geprüft werden. Prüfe die FFmpeg-Installation.',
      503,
      { cause: error },
    );
  }
}
