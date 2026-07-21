import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ShortsPremiumSettingsManager } from '../apps/api/src/shorts-premium.js';

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
});
