import { createReadStream } from 'node:fs';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { storeUploadedVideo } from '../packages/media-engine/src/video-upload.js';

const execFileAsync = promisify(execFile);
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function tempDirectory() {
  const directory = await mkdtemp(join(tmpdir(), 'open-tv-video-upload-'));
  temporaryDirectories.push(directory);
  return directory;
}

describe('article video uploads', () => {
  it('accepts an inspected HD video and creates a local preview', async () => {
    const directory = await tempDirectory();
    const source = join(directory, 'source.mp4');
    await execFileAsync(
      process.env.FFMPEG_EXECUTABLE ?? 'ffmpeg',
      [
        '-y',
        '-f',
        'lavfi',
        '-i',
        'color=c=blue:s=1280x720:d=1',
        '-an',
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv420p',
        source,
      ],
      { timeout: 30_000, maxBuffer: 2 * 1024 * 1024 },
    );

    const stored = await storeUploadedVideo({
      stream: createReadStream(source),
      declaredMime: 'video/mp4',
      directory,
      maxDurationSeconds: 5,
    });

    expect(stored).toMatchObject({
      mime: 'video/mp4',
      width: 1280,
      height: 720,
      extension: 'mp4',
    });
    expect(stored.durationSeconds).toBeGreaterThan(0.9);
    expect(stored.derivatives).toEqual([
      expect.objectContaining({ label: 'thumb', mime: 'image/webp', width: 640, height: 360 }),
    ]);
  });

  it('rejects unsupported declared media types before writing a file', async () => {
    const directory = await tempDirectory();
    await expect(
      storeUploadedVideo({
        stream: createReadStream('/dev/null'),
        declaredMime: 'text/plain',
        directory,
      }),
    ).rejects.toThrow(/Nicht unterstützter Video-MIME-Typ/);
  });
});
