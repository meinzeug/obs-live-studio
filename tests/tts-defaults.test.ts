import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PIPER_EXECUTABLE,
  DEFAULT_PIPER_MODEL_PATH,
  DEFAULT_PIPER_VOICE,
  DEFAULT_TTS_ENGINE,
} from '../packages/tts-engine/src/index.js';

describe('default speech configuration', () => {
  it('uses Piper with the German Thorsten High voice', () => {
    expect(DEFAULT_TTS_ENGINE).toBe('piper');
    expect(DEFAULT_PIPER_VOICE).toBe('de_DE-thorsten-high');
    expect(DEFAULT_PIPER_MODEL_PATH).toBe('./var/models/piper/de_DE-thorsten-high.onnx');
    expect(DEFAULT_PIPER_EXECUTABLE).toBe('./var/piper-venv/bin/piper');
  });

  it('installs and activates the default voice during a normal setup', async () => {
    const [installer, setup, configure, example, packageJson] = await Promise.all([
      readFile('scripts/install-piper-thorsten-high.mjs', 'utf8'),
      readFile('install.sh', 'utf8'),
      readFile('scripts/configure-env.mjs', 'utf8'),
      readFile('.env.example', 'utf8'),
      readFile('package.json', 'utf8'),
    ]);

    expect(installer).toContain('piper-tts==${piperVersion}');
    expect(installer).toContain('/de/de_DE/thorsten/high');
    expect(installer).toContain('de_DE-thorsten-high.onnx');
    expect(setup).toContain('npm run studio:tts:install');
    expect(configure).toContain("values.set('TTS_ENGINE', 'piper')");
    expect(configure).toContain('de_DE-thorsten-high.onnx');
    expect(example).toContain('TTS_ENGINE=piper');
    expect(example).toContain('TTS_DEFAULT_VOICE=de_DE-thorsten-high');
    expect(example).toContain('PIPER_MODEL_PATH=./var/models/piper/de_DE-thorsten-high.onnx');
    expect(JSON.parse(packageJson).scripts['studio:tts:install']).toContain('install-piper-thorsten-high.mjs');
  });
});
