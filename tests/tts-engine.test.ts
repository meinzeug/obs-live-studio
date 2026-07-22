import { chmod, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  probeAudioDuration,
  probeAudioSignal,
  runSubprocess,
  synthesizeElevenLabs,
  synthesizeEspeak,
} from '../packages/tts-engine/src/index.js';

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

  it('reads the audible signal level reported by FFmpeg', async () => {
    const directory = await temporaryDirectory();
    const ffmpeg = await executableScript(
      directory,
      'fake-ffmpeg-level.mjs',
      `
process.stderr.write('[Parsed_volumedetect] mean_volume: -21.4 dB\\n[Parsed_volumedetect] max_volume: -4.8 dB\\n');
`,
    );

    await expect(probeAudioSignal('/tmp/speech.wav', ffmpeg, 1_000)).resolves.toEqual({
      meanDb: -21.4,
      peakDb: -4.8,
    });
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

  it('applies optional non-blocking output gain after synthesis', async () => {
    const directory = await temporaryDirectory();
    const executable = await executableScript(
      directory,
      'fake-espeak-gain.mjs',
      `
import { writeFileSync } from 'node:fs';
process.stdin.resume();
process.stdin.on('end', () => {
  const args = process.argv.slice(2);
  const output = args[args.indexOf('-w') + 1];
  writeFileSync(output, Buffer.concat([Buffer.from('quiet-wav:'), Buffer.alloc(96, 1)]));
});
`,
    );
    const ffmpeg = await executableScript(
      directory,
      'fake-ffmpeg.mjs',
      `
import { writeFileSync } from 'node:fs';
const output = process.argv.at(-1);
writeFileSync(output, Buffer.concat([Buffer.from('boosted-wav:'), Buffer.alloc(96, 2)]));
`,
    );

    const speech = await synthesizeEspeak('Bitte lauter ausgeben.', {
      outputDirectory: directory,
      executable,
      ffmpegExecutable: ffmpeg,
      outputGainDb: 7,
      timeoutMs: 1_000,
    });

    expect(await readFile(speech.file, 'utf8')).toContain('boosted-wav:');
  });

  it('uses the official ElevenLabs TTS endpoint and never includes the API key in the cache identity', async () => {
    const directory = await temporaryDirectory();
    const ffmpeg = await executableScript(
      directory,
      'fake-elevenlabs-ffmpeg.mjs',
      `
import { writeFileSync } from 'node:fs';
writeFileSync(process.argv.at(-1), Buffer.concat([Buffer.from('normalized-wav:'), Buffer.alloc(96, 4)]));
`,
    );
    const mockedFetch = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      void input;
      void init;
      return new Response(Buffer.concat([Buffer.from('fake-mp3:'), Buffer.alloc(96, 3)]), {
        status: 200,
        headers: { 'content-type': 'audio/mpeg', 'request-id': 'request-123', 'character-cost': '32' },
      });
    });
    const options = {
      outputDirectory: directory,
      apiKey: 'xi-secret-first',
      voiceId: 'voice-female-de',
      modelId: 'eleven_multilingual_v2',
      outputFormat: 'mp3_44100_128',
      stability: 0.55,
      similarityBoost: 0.78,
      style: 0.2,
      speakerBoost: true,
      ffmpegExecutable: ffmpeg,
      fetchImpl: mockedFetch as unknown as typeof fetch,
    };

    const first = await synthesizeElevenLabs('Das ist eine hochwertige deutsche Hörprobe.', options);
    const second = await synthesizeElevenLabs('Das ist eine hochwertige deutsche Hörprobe.', {
      ...options,
      apiKey: 'xi-secret-rotated',
    });

    expect(mockedFetch).toHaveBeenCalledTimes(1);
    const [url, request] = mockedFetch.mock.calls[0]!;
    expect(String(url)).toBe('https://api.elevenlabs.io/v1/text-to-speech/voice-female-de?output_format=mp3_44100_128');
    expect((request?.headers as Record<string, string>)['xi-api-key']).toBe('xi-secret-first');
    expect(JSON.parse(String(request?.body))).toMatchObject({
      model_id: 'eleven_multilingual_v2',
      voice_settings: { stability: 0.55, similarity_boost: 0.78, style: 0.2, use_speaker_boost: true },
    });
    expect(first).toMatchObject({ cached: false, requestId: 'request-123', characterCost: 32 });
    expect(second.cached).toBe(true);
    expect(await readFile(first.file, 'utf8')).toContain('normalized-wav:');
  });
});
