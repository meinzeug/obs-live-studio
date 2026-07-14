import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { auditReadmeContracts } from '../scripts/readme-contracts-lib.mjs';

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('README implementation contracts', () => {
  it('matches every advertised core capability to its implementation', async () => {
    const report = await auditReadmeContracts({ root: resolve('.') });

    expect(report.ok).toBe(true);
    expect(report.failed).toBe(0);
    expect(report.contracts).toBeGreaterThanOrEqual(20);
  });

  it('fails closed when advertised implementation files are absent', async () => {
    const root = await mkdtemp(join(tmpdir(), 'readme-contracts-'));
    temporaryDirectories.push(root);
    await writeFile(join(root, 'README.md'), '# Incomplete Studio\n', 'utf8');
    await writeFile(join(root, 'package.json'), '{"scripts":{}}\n', 'utf8');

    const report = await auditReadmeContracts({ root });

    expect(report.ok).toBe(false);
    expect(report.failed).toBeGreaterThan(0);
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'reproducible-install', ok: false }),
        expect.objectContaining({ id: 'package-runtime-scripts', ok: false }),
      ]),
    );
  });
});
