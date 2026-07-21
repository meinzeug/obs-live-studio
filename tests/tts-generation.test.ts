import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { generateTtsAudio, resolveTtsGenerationConfig, TtsGenerationError } from '../apps/api/src/tts-generation.js';

function dependencies() {
  return {
    synthesizePocketTts: vi.fn(async () => ({ file: '/tmp/pocket.wav', cached: false })),
    synthesizePiper: vi.fn(async () => ({ file: '/tmp/piper.wav', cached: false })),
    synthesizeEspeak: vi.fn(async () => ({ file: '/tmp/espeak.wav', cached: false })),
    synthesizeQwen3Tts: vi.fn(async () => ({ file: '/tmp/qwen.wav', cached: false })),
    probeAudioDuration: vi.fn(async () => 12.34),
    reportTtsFallback: vi.fn(async () => undefined),
    resolveTtsFallback: vi.fn(async () => undefined),
  };
}

describe('API TTS generation', () => {
  it('uses Pocket TTS as the default local provider', async () => {
    const runtime = dependencies();
    const result = await generateTtsAudio('Guten Tag.', {}, runtime);

    expect(runtime.synthesizePocketTts).toHaveBeenCalledWith(
      'Guten Tag.',
      expect.objectContaining({
        serverUrl: 'http://127.0.0.1:8000',
        language: 'german_24l',
        voice: 'lola',
        temperature: 0.7,
        decodeSteps: 4,
      }),
    );
    expect(result).toMatchObject({ engine: 'pocket-tts', configuredEngine: 'pocket-tts' });
  });

  it('falls back to Piper when Pocket TTS fails', async () => {
    const runtime = dependencies();
    runtime.synthesizePocketTts.mockRejectedValueOnce(new Error('Pocket offline'));
    const result = await generateTtsAudio('Guten Tag.', { TTS_ENGINE: 'pocket-tts' }, runtime);

    expect(runtime.synthesizePiper).toHaveBeenCalled();
    expect(runtime.reportTtsFallback).toHaveBeenCalledWith('pocket-tts', 'piper', expect.any(Error));
    expect(result).toMatchObject({ engine: 'piper', configuredEngine: 'pocket-tts' });
  });

  it('uses the caller environment for the Piper fallback voice', async () => {
    const runtime = dependencies();
    runtime.synthesizePocketTts.mockRejectedValueOnce(new Error('Pocket offline'));

    await generateTtsAudio(
      'Guten Tag.',
      {
        TTS_ENGINE: 'pocket-tts',
        PIPER_FALLBACK_VOICE: 'de_DE-eva_k-x_low',
      },
      runtime,
    );

    expect(runtime.synthesizePiper).toHaveBeenCalledWith(
      'Guten Tag.',
      expect.objectContaining({ voice: 'de_DE-eva_k-x_low' }),
    );
  });

  it('uses Piper Thorsten with the configured timeout and probes the result', async () => {
    const runtime = dependencies();
    const result = await generateTtsAudio(
      'Guten Tag.',
      {
        TTS_ENGINE: 'piper',
        PIPER_EXECUTABLE: './piper',
        PIPER_MODEL_PATH: './thorsten.onnx',
        TTS_DEFAULT_VOICE: 'de_DE-thorsten-high',
        TTS_TIMEOUT_MS: '45000',
      },
      runtime,
    );

    expect(runtime.synthesizePiper).toHaveBeenCalledWith(
      'Guten Tag.',
      expect.objectContaining({
        piperExecutable: resolve('./piper'),
        modelPath: resolve('./thorsten.onnx'),
        voice: 'de_DE-thorsten-high',
        timeoutMs: 45_000,
      }),
    );
    expect(runtime.probeAudioDuration).toHaveBeenCalledWith('/tmp/piper.wav', undefined, 30_000);
    expect(result).toMatchObject({ engine: 'piper', durationSeconds: 12.34 });
  });

  it('keeps explicitly configured eSpeak installations working', async () => {
    const runtime = dependencies();
    const result = await generateTtsAudio(
      'Guten Tag.',
      { TTS_ENGINE: 'espeak-ng', ESPEAK_EXECUTABLE: '/usr/bin/espeak-ng', TTS_DEFAULT_VOICE: 'de' },
      runtime,
    );

    expect(runtime.synthesizeEspeak).toHaveBeenCalledWith(
      'Guten Tag.',
      expect.objectContaining({ executable: '/usr/bin/espeak-ng', voice: 'de' }),
    );
    expect(runtime.synthesizePiper).not.toHaveBeenCalled();
    expect(result.engine).toBe('espeak-ng');
  });

  it('supports Qwen3-TTS German presets', async () => {
    const runtime = dependencies();
    const result = await generateTtsAudio(
      'Guten Tag.',
      {
        TTS_ENGINE: 'qwen3-tts',
        QWEN3_TTS_EXECUTABLE: './var/qwen3-tts-venv/bin/python',
        QWEN3_TTS_MODEL: 'Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice',
        QWEN3_TTS_MODEL_DIR: './var/models/qwen3-tts/Qwen3-TTS-12Hz-0.6B-CustomVoice',
        QWEN3_TTS_LANGUAGE: 'German',
      },
      runtime,
    );

    expect(runtime.synthesizeQwen3Tts).toHaveBeenCalledWith(
      'Guten Tag.',
      expect.objectContaining({
        executable: resolve('./var/qwen3-tts-venv/bin/python'),
        model: 'Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice',
        modelDirectory: resolve('./var/models/qwen3-tts/Qwen3-TTS-12Hz-0.6B-CustomVoice'),
        language: 'German',
      }),
    );
    expect(result.engine).toBe('qwen3-tts');
  });

  it('returns an actionable 503 instead of exposing internal Piper errors', async () => {
    const runtime = dependencies();
    runtime.synthesizePiper.mockRejectedValueOnce(new Error('spawn /home/dennis/private/path ENOENT'));

    await expect(generateTtsAudio('Text', { TTS_ENGINE: 'piper' }, runtime)).rejects.toMatchObject({
      statusCode: 503,
      message: expect.stringContaining('studio:tts:install'),
    });
    await expect(generateTtsAudio('Text', { TTS_ENGINE: 'unsupported' }, dependencies())).rejects.toBeInstanceOf(
      TtsGenerationError,
    );
  });

  it('reports FFprobe failures separately from speech synthesis', async () => {
    const runtime = dependencies();
    runtime.probeAudioDuration.mockRejectedValueOnce(new Error('ffprobe missing'));

    await expect(generateTtsAudio('Text', { TTS_ENGINE: 'piper' }, runtime)).rejects.toMatchObject({
      statusCode: 503,
      message: expect.stringContaining('FFprobe'),
    });
  });

  it('prefers AI for missing speaker text, keeps the rule fallback and shows API errors in the article UI', async () => {
    const [api, page] = await Promise.all([
      readFile('apps/api/src/index.ts', 'utf8'),
      readFile('apps/web/src/pages/ArticleDetailPage.tsx', 'utf8'),
    ]);

    expect(api).toContain('a = await processArticleWithAi(a);');
    expect(api).toContain('a = await processArticle(a);');
    expect(page).toContain('setMsg(error instanceof Error ? error.message : String(error))');
    expect(page).toContain("busy.endsWith('/tts') ? 'TTS wird erzeugt …' : 'TTS erzeugen'");
  });

  it('normalizes legacy engine aliases and rejects unknown engines', () => {
    expect(resolveTtsGenerationConfig({ TTS_ENGINE: 'espeak' }).engine).toBe('espeak-ng');
    expect(resolveTtsGenerationConfig({ TTS_ENGINE: 'qwen3-tts' }).qwenLanguage).toBe('German');
    expect(() => resolveTtsGenerationConfig({ TTS_ENGINE: 'cloud' })).toThrow('wird nicht unterstützt');
  });
});
