import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { elevenLabsDiagnostic, ShortsPremiumSettingsManager } from '../apps/api/src/shorts-premium.js';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('Shorts premium secret storage', () => {
  it('writes and clears the ElevenLabs key atomically without returning it to the browser', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'shorts-premium-settings-'));
    directories.push(directory);
    const envFile = join(directory, '.env');
    await writeFile(envFile, 'OPENROUTER_API_KEY=sk-or-v1-existing\nCHANNEL_NAME=Test\n', { mode: 0o600 });
    const manager = new ShortsPremiumSettingsManager({ envFile, env: {} });

    await manager.saveApiKey('xi-elevenlabs-secret-value', false);
    const stored = await readFile(envFile, 'utf8');
    expect(stored).toContain('ELEVENLABS_API_KEY=xi-elevenlabs-secret-value');
    expect(stored).toContain('OPENROUTER_API_KEY=sk-or-v1-existing');
    const status = await manager.publicStatus();
    expect(status.elevenlabs.configured).toBe(true);
    expect(status.elevenlabs.apiKeyHint).not.toContain('secret-value');
    expect(JSON.stringify(status)).not.toContain('xi-elevenlabs-secret-value');

    await manager.saveApiKey(undefined, true);
    expect((await manager.publicStatus()).elevenlabs.configured).toBe(false);
    expect(await readFile(envFile, 'utf8')).toContain('ELEVENLABS_API_KEY=');
  });

  it('keeps a restricted ElevenLabs key connected when only models_read is missing', async () => {
    const result = await elevenLabsDiagnostic('xi-restricted-test', async (path) => {
      if (path === '/v1/user/subscription')
        return { tier: 'creator', status: 'active', character_count: 120, character_limit: 10_000 };
      if (path.startsWith('/v2/voices'))
        return {
          voices: [
            {
              voice_id: 'voice-ava',
              name: 'Ava',
              labels: { language: 'de', gender: 'female' },
            },
          ],
        };
      throw Object.assign(
        new Error('The API key you used is missing the permission models_read to execute this operation.'),
        { statusCode: 401, upstreamStatus: 401 },
      );
    });

    expect(result.connected).toBe(true);
    expect(result.voices).toHaveLength(1);
    expect(result.models).toEqual([]);
    expect(result.capabilities.models).toMatchObject({
      available: false,
      state: 'permission-required',
      permission: 'models_read',
    });
    expect(result.warnings.join(' ')).toContain('models_read');
  });

  it('still rejects an actually invalid ElevenLabs key', async () => {
    await expect(
      elevenLabsDiagnostic('xi-invalid-test', async () => {
        throw Object.assign(new Error('Invalid API key'), { statusCode: 401, upstreamStatus: 401 });
      }),
    ).rejects.toMatchObject({ message: 'Invalid API key', statusCode: 401 });
  });

  it('reports a recognized TTS-only ElevenLabs key without crashing on absent metadata', async () => {
    const result = await elevenLabsDiagnostic('xi-tts-only-test', async () => {
      throw Object.assign(new Error('The API key is missing the permission voices_read.'), {
        statusCode: 401,
        upstreamStatus: 401,
      });
    });

    expect(result.connected).toBe(true);
    expect(result.voices).toEqual([]);
    expect(result.models).toEqual([]);
    expect(result.warnings).toHaveLength(3);
  });
});
