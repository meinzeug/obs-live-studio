import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
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
} from '../packages/tts-engine/src/index.js';

describe('default speech configuration', () => {
  it('uses Pocket TTS with the German 24L model by default and keeps Piper configured as fallback', () => {
    expect(DEFAULT_TTS_ENGINE).toBe('pocket-tts');
    expect(DEFAULT_POCKET_TTS_LANGUAGE).toBe('german_24l');
    expect(DEFAULT_POCKET_TTS_SERVER_URL).toBe('http://127.0.0.1:8000');
    expect(DEFAULT_POCKET_TTS_VOICE).toBe('anna');
    expect(DEFAULT_POCKET_TTS_CHAT_VOICE).toBe('vera');
    expect(DEFAULT_POCKET_TTS_TEMPERATURE).toBe(0.7);
    expect(DEFAULT_POCKET_TTS_DECODE_STEPS).toBe(4);
    expect(DEFAULT_TTS_OUTPUT_GAIN_DB).toBe(7);
    expect(DEFAULT_PIPER_VOICE).toBe('de_DE-dii-high');
    expect(DEFAULT_PIPER_MODEL_PATH).toBe('./var/models/piper/de_DE-dii-high.onnx');
    expect(DEFAULT_PIPER_EXECUTABLE).toBe('./var/piper-venv/bin/piper');
  });

  it('installs and activates the default voice during a normal setup', async () => {
    const [pocketInstaller, piperInstaller, setup, configure, example, packageJson] = await Promise.all([
      readFile('scripts/install-pocket-tts.sh', 'utf8'),
      readFile('scripts/install-piper-thorsten-high.mjs', 'utf8'),
      readFile('install.sh', 'utf8'),
      readFile('scripts/configure-env.mjs', 'utf8'),
      readFile('.env.example', 'utf8'),
      readFile('package.json', 'utf8'),
    ]);

    expect(pocketInstaller).toContain('pocket-tts>=2.1.0,<3');
    expect(pocketInstaller).toContain('download.pytorch.org/whl/cpu');
    expect(pocketInstaller).toContain('obs-live-studio-pocket-tts.service');
    expect(piperInstaller).toContain('piper-tts==${piperVersion}');
    expect(piperInstaller).toContain('vits-piper-de_DE-dii-high');
    expect(setup).toContain('npm run studio:tts:install');
    expect(configure).toContain("values.set('TTS_ENGINE', 'pocket-tts')");
    expect(configure).toContain('de_DE-dii-high.onnx');
    expect(example).toContain('TTS_ENGINE=pocket-tts');
    expect(example).toContain('POCKET_TTS_LANGUAGE=german_24l');
    expect(example).toContain('TTS_DEFAULT_VOICE=anna');
    expect(example).toContain('AI_CHAT_MODERATOR_TTS_VOICE=vera');
    expect(example).toContain('TTS_OUTPUT_GAIN_DB=7');
    expect(example).toContain('AI_HOST_DUCK_YOUTUBE_VOLUME=0.22');
    expect(example).toContain('PIPER_MODEL_PATH=./var/models/piper/de_DE-dii-high.onnx');
    expect(JSON.parse(packageJson).scripts['studio:tts:install']).toContain('install-pocket-tts.sh');
    expect(JSON.parse(packageJson).scripts['studio:tts:install:piper']).toContain('install-piper-thorsten-high.mjs');
  });
});
