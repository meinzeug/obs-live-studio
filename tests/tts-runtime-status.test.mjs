import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
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
  const model = join(root, 'var/models/piper/de_DE-thorsten-high.onnx');
  await mkdir(join(root, 'var/piper-venv/bin'), { recursive: true });
  await mkdir(join(root, 'var/models/piper'), { recursive: true });
  await writeFile(executable, '#!/bin/sh\nexit 0\n');
  await chmod(executable, 0o755);
  await writeFile(model, Buffer.alloc(options.modelBytes ?? 1024 * 1024 + 1, 1));
  await writeFile(
    `${model}.json`,
    options.config ??
      JSON.stringify({
        language: { code: 'de_DE' },
        audio: { sample_rate: 22_050 },
        num_speakers: 1,
      }),
  );
  return { executable, model };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe('TTS runtime health', () => {
  it('resolves blank values to Piper with Thorsten High defaults', () => {
    const runtime = resolveTtsRuntime(
      {
        TTS_ENGINE: '',
        PIPER_EXECUTABLE: '',
        PIPER_MODEL_PATH: '',
        TTS_DEFAULT_VOICE: '',
      },
      '/srv/studio',
    );

    expect(runtime.engine).toBe('piper');
    expect(runtime.voice).toBe('de_DE-thorsten-high');
    expect(runtime.executable).toBe('/srv/studio/var/piper-venv/bin/piper');
    expect(runtime.modelPath).toBe('/srv/studio/var/models/piper/de_DE-thorsten-high.onnx');
  });

  it('accepts a complete Thorsten High installation', async () => {
    const root = await temporaryRoot();
    await createPiperRuntime(root);

    const report = await inspectTtsRuntime({ root, env: {} });

    expect(report.ok).toBe(true);
    expect(report.summary).toEqual({ total: 4, passed: 4, errors: 0 });
    expect(report.model).toEqual(
      expect.objectContaining({
        language: 'de_DE',
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
      commandAvailable: async (command) => command === 'espeak-ng',
    });

    expect(report.ok).toBe(true);
    expect(report.checks.map((check) => check.id)).toEqual(['tts-engine', 'tts-executable']);
    expect(report.modelPath).toBeNull();
  });

  it('rejects a missing executable and a truncated model', async () => {
    const root = await temporaryRoot();
    const { executable } = await createPiperRuntime(root, { modelBytes: 512 });
    await rm(executable);

    const report = await inspectTtsRuntime({ root, env: {} });

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

    const invalidConfig = await inspectTtsRuntime({ root, env: {} });
    const unsupported = await inspectTtsRuntime({
      root,
      env: { TTS_ENGINE: 'cloud-voice' },
    });

    expect(invalidConfig.checks).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'tts-model-config', status: 'error' })]),
    );
    expect(invalidConfig.model).toBeNull();
    expect(unsupported.checks).toEqual([
      expect.objectContaining({ id: 'tts-engine', status: 'error' }),
    ]);
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
    });

    expect(report.ok).toBe(false);
    expect(report.summary).toEqual({ total: 3, passed: 2, disabled: 0, errors: 1 });
    expect(report.checks.some((check) => check.message === 'Alte flache Prüfung')).toBe(false);
    expect(report.tts).toEqual({
      ok: false,
      engine: 'piper',
      voice: 'de_DE-thorsten-high',
      model: null,
    });
  });
});
