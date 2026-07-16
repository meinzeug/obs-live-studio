import { randomUUID } from 'node:crypto';
import { chmod, readFile, rename, unlink, writeFile } from 'node:fs/promises';

const environmentFileQueues = new Map<string, Promise<void>>();

export async function readOptionalEnvironmentFile(path: string) {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '';
    throw error;
  }
}

export async function writePrivateEnvironmentFile(path: string, content: string) {
  const temporary = `${path}.tmp-${process.pid}-${randomUUID()}`;
  try {
    await writeFile(temporary, content, { mode: 0o600 });
    await chmod(temporary, 0o600);
    await rename(temporary, path);
    await chmod(path, 0o600);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

export async function withEnvironmentFileLock<T>(path: string, operation: () => Promise<T>): Promise<T> {
  const previous = environmentFileQueues.get(path) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queued = previous.catch(() => undefined).then(() => current);
  environmentFileQueues.set(path, queued);
  await previous.catch(() => undefined);
  try {
    return await operation();
  } finally {
    release();
    if (environmentFileQueues.get(path) === queued) environmentFileQueues.delete(path);
  }
}
