import { describe, expect, it, vi } from 'vitest';
import { buildTtsEnvironment, TTS_PRESETS, TtsSettingsManager } from '../apps/api/src/tts-settings.js';

describe('TTS settings management', () => {
  it('builds Piper and Qwen3-TTS environment updates from presets', () => {
    const defaultPiper = buildTtsEnvironment({}, { presetId: 'piper-de-dii-high' });
    expect(defaultPiper.updates).toMatchObject({
      TTS_PRESET_ID: 'piper-de-dii-high',
      TTS_ENGINE: 'piper',
      TTS_DEFAULT_VOICE: 'de_DE-dii-high',
      PIPER_MODEL_PATH: './var/models/piper/de_DE-dii-high.onnx',
    });
    expect(TTS_PRESETS[0]).toMatchObject({
      id: 'piper-de-dii-high',
      license: 'CC BY-NC-SA 4.0',
      commercialUse: false,
    });

    const piper = buildTtsEnvironment({}, { presetId: 'piper-de-thorsten-medium' });
    expect(piper.updates).toMatchObject({
      TTS_PRESET_ID: 'piper-de-thorsten-medium',
      TTS_ENGINE: 'piper',
      TTS_DEFAULT_VOICE: 'de_DE-thorsten-medium',
      PIPER_MODEL_PATH: './var/models/piper/de_DE-thorsten-medium.onnx',
    });

    const qwen = buildTtsEnvironment(
      { TTS_DEFAULT_VOICE: 'de_DE-thorsten-high' },
      { presetId: 'qwen3-tts-06b-german-customvoice' },
    );
    expect(qwen.updates).toMatchObject({
      TTS_PRESET_ID: 'qwen3-tts-06b-german-customvoice',
      TTS_ENGINE: 'qwen3-tts',
      TTS_DEFAULT_VOICE: 'qwen3-tts-german',
      TTS_TIMEOUT_MS: '300000',
      QWEN3_TTS_MODEL: 'Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice',
      QWEN3_TTS_LANGUAGE: 'German',
    });
  });

  it('saves the selected preset and starts an install job when dependencies are missing', async () => {
    let environmentFile = '';
    const runtimeEnvironment: NodeJS.ProcessEnv = {};
    const manager = new TtsSettingsManager({
      env: runtimeEnvironment,
      readEnvironmentFile: async () => environmentFile,
      writeEnvironmentFile: async (content) => {
        environmentFile = content;
      },
      commandAvailable: async () => false,
      fileUsable: async () => false,
      spawnInstall: vi.fn(async (_preset, onLog) => {
        onLog('installed');
      }),
    });

    const result = await manager.save({ presetId: 'piper-de-thorsten-medium' });

    expect(environmentFile).toContain('TTS_PRESET_ID=piper-de-thorsten-medium');
    expect(runtimeEnvironment.TTS_ENGINE).toBe('piper');
    expect(['running', 'completed']).toContain(result.job?.status);
    await vi.waitFor(async () => expect((await manager.get()).job?.status).toBe('completed'));
  });
});
