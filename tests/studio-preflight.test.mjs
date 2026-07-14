import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runStudioPreflight } from '../scripts/studio-preflight-lib.mjs';

const temporaryDirectories = [];

const secureEnvironment = {
  SESSION_SECRET: 'a'.repeat(64),
  ENCRYPTION_KEY: 'b'.repeat(64),
  DESKTOP_AGENT_TOKEN: 'c'.repeat(64),
  APP_HOST: '127.0.0.1',
  DESKTOP_AGENT_URL: 'http://127.0.0.1:12090',
};

async function createRoot(mode = 0o600) {
  const root = await mkdtemp(join(tmpdir(), 'studio-preflight-'));
  temporaryDirectories.push(root);
  await writeFile(join(root, '.env'), 'SESSION_SECRET=redacted\n', { mode });
  await chmod(join(root, '.env'), mode);
  return root;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('studio preflight', () => {
  it('accepts a protected local-only configuration', async () => {
    const root = await createRoot();
    const report = await runStudioPreflight({
      root,
      scope: 'configuration',
      env: secureEnvironment,
      checkDatabase: false,
    });

    expect(report.ok).toBe(true);
    expect(report.summary.errors).toBe(0);
  });

  it('rejects external API binding unless explicitly allowed', async () => {
    const root = await createRoot();
    const report = await runStudioPreflight({
      root,
      scope: 'configuration',
      env: { ...secureEnvironment, APP_HOST: '0.0.0.0' },
      checkDatabase: false,
    });

    expect(report.ok).toBe(false);
    expect(report.checks).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'app-bind', status: 'error' })]),
    );
  });

  it('rejects environment files readable by other users', async () => {
    const root = await createRoot(0o644);
    const report = await runStudioPreflight({
      root,
      scope: 'configuration',
      env: secureEnvironment,
      checkDatabase: false,
    });

    expect(report.ok).toBe(false);
    expect(report.checks).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'env-file', status: 'error' })]),
    );
  });

  it('never serializes secret values into the report', async () => {
    const root = await createRoot();
    const report = await runStudioPreflight({
      root,
      scope: 'configuration',
      env: secureEnvironment,
      checkDatabase: false,
    });
    const serialized = JSON.stringify(report);

    for (const secret of [
      secureEnvironment.SESSION_SECRET,
      secureEnvironment.ENCRYPTION_KEY,
      secureEnvironment.DESKTOP_AGENT_TOKEN,
    ]) {
      expect(serialized).not.toContain(secret);
    }
  });
});
