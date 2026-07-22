import { realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { PROJECT_ROOT } from './project-root.js';

export type AutonomousHandoutPathResult =
  | { status: 'ready'; path: string; size: number }
  | { status: 'invalid' }
  | { status: 'missing' }
  | { status: 'storage-unavailable' };

function isInsideDirectory(directory: string, candidate: string): boolean {
  const difference = relative(directory, candidate);
  return difference === '' || (difference !== '..' && !difference.startsWith(`..${sep}`) && !isAbsolute(difference));
}

export function resolveAutonomousHandoutCandidate(
  filePath: string,
  projectRoot = PROJECT_ROOT,
): { allowedRoot: string; path: string } | null {
  const allowedRoot = resolve(projectRoot, 'var/media/autonomous-studio/handouts');
  const path = isAbsolute(filePath) ? resolve(filePath) : resolve(projectRoot, filePath);
  return isInsideDirectory(allowedRoot, path) ? { allowedRoot, path } : null;
}

/**
 * Resolve council handouts relative to the repository root, regardless of the
 * API workspace's cwd, and reject symlinks escaping the protected directory.
 */
export async function validateAutonomousHandoutPath(
  filePath: string,
  projectRoot = PROJECT_ROOT,
): Promise<AutonomousHandoutPathResult> {
  const candidate = resolveAutonomousHandoutCandidate(filePath, projectRoot);
  if (!candidate) return { status: 'invalid' };

  const [rootResult, pathResult] = await Promise.allSettled([
    realpath(candidate.allowedRoot),
    realpath(candidate.path),
  ]);
  if (rootResult.status === 'rejected') return { status: 'storage-unavailable' };
  if (pathResult.status === 'rejected') return { status: 'missing' };
  if (!isInsideDirectory(rootResult.value, pathResult.value)) return { status: 'invalid' };

  const info = await stat(pathResult.value).catch(() => null);
  if (!info?.isFile()) return { status: 'missing' };
  return { status: 'ready', path: pathResult.value, size: info.size };
}
