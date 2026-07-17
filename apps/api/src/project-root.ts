import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function isWorkspaceRoot(directory: string) {
  const packageFile = join(directory, 'package.json');
  if (!existsSync(packageFile)) return false;
  try {
    const parsed = JSON.parse(readFileSync(packageFile, 'utf8'));
    return Boolean(parsed && typeof parsed === 'object' && 'workspaces' in parsed);
  } catch {
    return false;
  }
}

export function resolveProjectRoot(startDirectory = dirname(fileURLToPath(import.meta.url))): string {
  let current = resolve(startDirectory);
  for (;;) {
    if (isWorkspaceRoot(current)) return current;
    const parent = dirname(current);
    if (parent === current) return process.cwd();
    current = parent;
  }
}

/**
 * Absolute path of the repository root. The API can be started from the
 * workspace directory (`npm run start -w @ans/api` sets cwd to `apps/api`),
 * so paths like `.env` or `scripts/*.mjs` must never rely on `process.cwd()`.
 */
export const PROJECT_ROOT = resolveProjectRoot();
