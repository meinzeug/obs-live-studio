import { chmod, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { probeAudioDuration, runSubprocess, synthesizeEspeak } from '../packages/tts-engine/src/index.js';

const temporaryDirectories: string[] = [];

async function temporaryDirectory() {
  const directory = await mkdtemp(join(tmpdir(), 'obs-live-studio-tts-'));
  temporaryDirectories.push(directory);
  return directory;
}

async function executableScript(directory: string, name: string, source: string) {
  const file = join(directory, name);
  await writeFile(file, `#!/usr/bin/env node\n${source}`, 'utf8');
  await chmod(file, 0o755);
  return file;
}

afterEach(async () => {
  delete process.env.TTS_TEST_COUNTER;
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('TTS process execution', () => {
  it('turns a missing executable into a normal rejected promise', async () => {
    await expect(
      probeAudioDuration('/tmp/does-not-matter.wav', `missing-ffprobe-${Date.now()}`, 1_000),
    ).rejects.toThrow('ffprobe konnte nicht gestartet werden');
  });

  it('terminates subprocesses that exceed their time limit', async () => {
    await expect(
      runSubprocess(process.execPath, ['-e', 'setTimeout(() => {}, 10_000)'], {
        timeoutMs: 25,
        label: 'Testprozess',
      }),
    ).rejects.toThrow('Testprozess hat das Zeitlimit');
  });

  it('publishes speech atomically and reuses a valid cached file', async () => {
    const directory = await temporaryDirectory();
    const counter = join(directory, 'counter.txt');
    process.env.TTS_TEST_COUNTER = counter;
    const executable = await executableScript(
      directory,
      'fake-espeak.mjs',
      `
import { appendFileSync, writeFileSync } from 'node:fs';
let text = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { text += chunk; });
process.stdin.on('end', () => {
  const args = process.argv.slice(2);
  const output = args[args.indexOf('-w') + 1];
  writeFileSync(output, Buffer.alloc(128, 1));
  appendFileSync(process.env.TTS_TEST_COUNTER, text + '\\n');
});
`,
    );

    const first = await synthesizeEspeak('Guten Tag aus dem Studio.', {
      outputDirectory: directory,
      executable,
      voice: 'de',
      speed: 165,
      volume: 100,
    });
    const second = await synthesizeEspeak('Guten Tag aus dem Studio.', {
      outputDirectory: directory,
      executable,
      voice: 'de',
      speed: 165,
      volume: 100,
    });

    expect(first.cached).toBe(false);
    expect(second).toEqual({ ...first, cached: true });
    expect((await readFile(first.file)).byteLength).toBe(128);
    expect((await readFile(counter, 'utf8')).trim().split('\n')).toHaveLength(1);
    expect((await readdir(directory)).some((entry) => entry.includes('.tmp-'))).toBe(false);
  });

  it('removes temporary output after a failed synthesis', async () => {
    const directory = await temporaryDirectory();
    const executable = await executableScript(
      directory,
      'failing-espeak.mjs',
      `
process.stderr.write('synthetischer Fehler');
process.exit(2);
`,
    );

    await expect(
      synthesizeEspeak('Dieser Text schlägt absichtlich fehl.', {
        outputDirectory: directory,
        executable,
        timeoutMs: 1_000,
      }),
    ).rejects.toThrow('eSpeak NG fehlgeschlagen: synthetischer Fehler');

    const files = await readdir(directory);
    expect(files.some((entry) => entry.endsWith('.wav') || entry.includes('.tmp-'))).toBe(false);
  });
});
