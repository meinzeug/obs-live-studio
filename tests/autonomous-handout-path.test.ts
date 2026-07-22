import { mkdir, mkdtemp, realpath, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  resolveAutonomousHandoutCandidate,
  validateAutonomousHandoutPath,
} from '../apps/api/src/autonomous-handout-path.js';

describe('autonomous council handout paths', () => {
  it('resolves repository handouts independently from the API process cwd', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ans-handout-'));
    const directory = resolve(root, 'var/media/autonomous-studio/handouts');
    const path = resolve(directory, 'decision-r0.pdf');
    await mkdir(directory, { recursive: true });
    await writeFile(path, 'pdf');

    expect(resolveAutonomousHandoutCandidate(path, root)?.allowedRoot).toBe(directory);
    await expect(validateAutonomousHandoutPath(path, root)).resolves.toMatchObject({
      status: 'ready',
      path: await realpath(path),
      size: 3,
    });
  });

  it('rejects traversal and symlinks escaping the protected handout directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ans-handout-'));
    const directory = resolve(root, 'var/media/autonomous-studio/handouts');
    const outside = resolve(root, 'outside.pdf');
    await mkdir(directory, { recursive: true });
    await writeFile(outside, 'pdf');
    await symlink(outside, resolve(directory, 'escaped.pdf'));

    expect(resolveAutonomousHandoutCandidate(outside, root)).toBeNull();
    await expect(validateAutonomousHandoutPath(resolve(directory, 'escaped.pdf'), root)).resolves.toEqual({
      status: 'invalid',
    });
  });
});
