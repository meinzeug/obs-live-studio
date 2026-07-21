import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runCompleteStudioPreflight } from '../scripts/complete-studio-preflight.mjs';
import { inspectTtsRuntime, resolveTtsRuntime } from '../scripts/tts-runtime-status.mjs';

const temporaryDirectories = [];

async function temporaryRoot() {
  const root = await mkdtemp(join(tmpdir(), 'obs-live-studio-tts-health-'));
  temporaryDirectories.push(root);
  return root;
}

async function createPiperRuntime(root, options = {}) {
  const executable = join(root, 'var/piper-venv/bin/piper');
  const model = join(root, 'var/models/piper/de_DE-dii-high.onnx');
  await mkdir(join(root, 'var/piper-venv/bin'), { recursive: true });
  await mkdir(join(root, 'var/models/piper'), { recursive: true });
  await writeFile(executable, '#!/bin/sh\nexit 0\n');
  await chmod(executable, 0o755);
  await writeFile(model, Buffer.alloc(options.modelBytes ?? 1024 * 1024 + 1, 1));
  await writeFile(
    `${model}.json`,
    options.config ??
      JSON.stringify({
        language: { code: 'de' },
        audio: { sample_rate: 22_050 },
        num_speakers: 1,
      }),
  );
  return { executable, model };
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('TTS runtime health', () => {
  it('resolves blank values to Pocket TTS German defaults', () => {
    const runtime = resolveTtsRuntime(
      {
        TTS_ENGINE: '',
        POCKET_TTS_EXECUTABLE: '',
        POCKET_TTS_SERVER_URL: '',
        TTS_DEFAULT_VOICE: '',
      },
      '/srv/studio',
    );

    expect(runtime.engine).toBe('pocket-tts');
    expect(runtime.voice).toBe('lola');
    expect(runtime.executable).toBe('/srv/studio/var/pocket-tts-venv/bin/pocket-tts');
    expect(runtime.pocketServerUrl).toBe('http://127.0.0.1:8000');
    expect(runtime.pocketLanguage).toBe('german_24l');
    expect(runtime.modelPath).toBeNull();
    expect(runtime.minimumModelBytes).toBe(50 * 1024 * 1024);
  });

  it('accepts a complete Dii High installation', async () => {
    const root = await temporaryRoot();
    await createPiperRuntime(root);

    const report = await inspectTtsRuntime({
      root,
      env: { TTS_ENGINE: 'piper', PIPER_MIN_MODEL_BYTES: String(1024 * 1024) },
      commandAvailable: async (command) => command === 'ffprobe' || command.endsWith('/piper'),
    });

    expect(report.ok).toBe(true);
    expect(report.summary).toEqual({ total: 5, passed: 5, errors: 0 });
    expect(report.model).toEqual(
      expect.objectContaining({
        language: 'de',
        quality: 'high',
        sampleRate: 22_050,
        speakers: 1,
        sizeBytes: 1024 * 1024 + 1,
      }),
    );
  });

  it('accepts an explicitly configured eSpeak runtime without Piper files', async () => {
    const report = await inspectTtsRuntime({
      root: '/srv/studio',
      env: {
        TTS_ENGINE: 'espeak-ng',
        ESPEAK_EXECUTABLE: 'espeak-ng',
        TTS_DEFAULT_VOICE: 'de',
      },
      commandAvailable: async (command) => ['espeak-ng', 'ffprobe'].includes(command),
    });

    expect(report.ok).toBe(true);
    expect(report.checks.map((check) => check.id)).toEqual(['tts-engine', 'tts-executable', 'tts-ffprobe']);
    expect(report.modelPath).toBeNull();
  });

  it('accepts an explicitly configured Qwen3-TTS German runtime', async () => {
    const root = await temporaryRoot();
    await mkdir(join(root, 'var/qwen3-tts-venv/bin'), { recursive: true });
    await mkdir(join(root, 'var/models/qwen3-tts/Qwen3-TTS-12Hz-0.6B-CustomVoice'), { recursive: true });
    await mkdir(join(root, 'var/models/qwen3-tts/Qwen3-TTS-Tokenizer-12Hz'), { recursive: true });
    await writeFile(join(root, 'var/qwen3-tts-venv/bin/python'), '#!/bin/sh\nexit 0\n');
    await chmod(join(root, 'var/qwen3-tts-venv/bin/python'), 0o755);
    await writeFile(join(root, 'var/models/qwen3-tts/Qwen3-TTS-12Hz-0.6B-CustomVoice/config.json'), '{}');
    await writeFile(join(root, 'var/models/qwen3-tts/Qwen3-TTS-Tokenizer-12Hz/config.json'), '{}');

    const report = await inspectTtsRuntime({
      root,
      env: {
        TTS_ENGINE: 'qwen3-tts',
        QWEN3_TTS_MODEL: 'Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice',
        QWEN3_TTS_LANGUAGE: 'German',
      },
      commandAvailable: async (command) => command === 'ffprobe' || command.endsWith('/python'),
    });

    expect(report.ok).toBe(true);
    expect(report.engine).toBe('qwen3-tts');
    expect(report.checks.map((check) => check.id)).toEqual([
      'tts-engine',
      'tts-executable',
      'tts-ffprobe',
      'tts-qwen-model',
      'tts-qwen-tokenizer',
    ]);
    expect(report.model).toEqual(expect.objectContaining({ language: 'German', quality: '0.6B' }));
  });

  it('rejects a missing executable and a truncated model', async () => {
    const root = await temporaryRoot();
    const { executable } = await createPiperRuntime(root, { modelBytes: 512 });
    await rm(executable);

    const report = await inspectTtsRuntime({
      root,
      env: { TTS_ENGINE: 'piper', PIPER_MIN_MODEL_BYTES: String(1024 * 1024) },
      commandAvailable: async (command) => command === 'ffprobe',
    });

    expect(report.ok).toBe(false);
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'tts-executable', status: 'error' }),
        expect.objectContaining({ id: 'tts-model', status: 'error' }),
      ]),
    );
  });

  it('rejects invalid model metadata and unsupported engines', async () => {
    const root = await temporaryRoot();
    await createPiperRuntime(root, { config: '{not-json' });

    const invalidConfig = await inspectTtsRuntime({
      root,
      env: { TTS_ENGINE: 'piper', PIPER_MIN_MODEL_BYTES: String(1024 * 1024) },
      commandAvailable: async () => true,
    });
    const unsupported = await inspectTtsRuntime({
      root,
      env: { TTS_ENGINE: 'cloud-voice' },
    });

    expect(invalidConfig.checks).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'tts-model-config', status: 'error' })]),
    );
    expect(invalidConfig.model).toBeNull();
    expect(unsupported.checks).toEqual([expect.objectContaining({ id: 'tts-engine', status: 'error' })]);
  });

  it('wires the status check into installation and the service preflight', async () => {
    const [packageJson, installScript, preflightScript] = await Promise.all([
      readFile('package.json', 'utf8'),
      readFile('install.sh', 'utf8'),
      readFile('scripts/studio-preflight.mjs', 'utf8'),
    ]);
    const scripts = JSON.parse(packageJson).scripts;

    expect(scripts['studio:tts:status']).toContain('tts-runtime-status.mjs');
    expect(installScript).toContain('npm run studio:tts:status -- --json');
    expect(preflightScript).toContain('./complete-studio-preflight.mjs');
  });

  it('replaces the old shallow TTS preflight result and recomputes the summary', async () => {
    const report = await runCompleteStudioPreflight({
      scope: 'api',
      basePreflight: async () => ({
        ok: true,
        scope: 'api',
        checkedAt: '2026-07-14T00:00:00.000Z',
        summary: { total: 2, passed: 2, disabled: 0, errors: 0 },
        checks: [
          { id: 'database-url', status: 'ok', message: 'Datenbank okay' },
          { id: 'tts-model', status: 'ok', message: 'Alte flache Prüfung' },
        ],
      }),
      ttsInspector: async () => ({
        ok: false,
        engine: 'piper',
        voice: 'de_DE-thorsten-high',
        model: null,
        checks: [
          { id: 'tts-engine', status: 'ok', message: 'Piper' },
          { id: 'tts-executable', status: 'error', message: 'Piper fehlt' },
        ],
      }),
      streamingInspector: async () => ({
        ok: true,
        studio: null,
        primary: null,
        additionalTargets: [],
        checks: [],
      }),
    });

    expect(report.ok).toBe(false);
    expect(report.summary).toEqual({
      total: 3,
      passed: 2,
      disabled: 0,
      errors: 1,
    });
    expect(report.checks.some((check) => check.message === 'Alte flache Prüfung')).toBe(false);
    expect(report.tts).toEqual({
      ok: false,
      engine: 'piper',
      voice: 'de_DE-thorsten-high',
      model: null,
    });
  });
});
