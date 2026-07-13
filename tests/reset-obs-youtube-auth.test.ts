import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const script = join(process.cwd(), 'scripts', 'reset-obs-youtube-auth.mjs');

describe('OBS YouTube authentication reset', () => {
  let root: string;
  let configRoot: string;
  let runtimeRoot: string;
  let procRoot: string;
  let backupRoot: string;
  let profileDir: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'obs-youtube-reset-'));
    configRoot = join(root, 'config');
    runtimeRoot = join(root, 'runtime');
    procRoot = join(root, 'proc');
    backupRoot = join(root, 'backups');
    profileDir = join(configRoot, 'obs-studio', 'basic', 'profiles', 'Test_Studio');
    mkdirSync(profileDir, { recursive: true });
    mkdirSync(procRoot, { recursive: true });
    writeFileSync(
      join(profileDir, 'basic.ini'),
      '[General]\nName=Test Studio\n\n[YouTube]\nRefreshToken=secret\n\n[Auth]\nToken=secret\n\n[Output]\nMode=Simple\n',
    );
    writeFileSync(
      join(profileDir, 'service.json'),
      JSON.stringify({ type: 'rtmp_common', settings: { service: 'YouTube - RTMPS', key: 'old-key' } }),
    );
    const cookieDir = join(configRoot, 'obs-studio', 'plugin_config', 'obs-browser', 'obs_profile_cookies');
    mkdirSync(cookieDir, { recursive: true });
    writeFileSync(join(cookieDir, 'Cookies'), 'old-account-cookie');
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  function environment() {
    return {
      ...process.env,
      XDG_CONFIG_HOME: configRoot,
      XDG_RUNTIME_DIR: runtimeRoot,
      OBS_PROFILE_NAME: 'Test Studio',
      OBS_AUTH_BACKUP_ROOT: backupRoot,
      OBS_PROC_ROOT: procRoot,
      STREAM_SERVER: 'rtmps://example.invalid/live',
    };
  }

  it('backs up and removes the previous account without retaining its stream key', async () => {
    const { stdout } = await execFileAsync(process.execPath, [script], { env: environment() });
    const result = JSON.parse(stdout.trim());
    const profile = readFileSync(join(profileDir, 'basic.ini'), 'utf8');
    const service = JSON.parse(readFileSync(join(profileDir, 'service.json'), 'utf8'));

    expect(profile).toContain('[General]');
    expect(profile).toContain('[Output]');
    expect(profile).not.toContain('[YouTube]');
    expect(profile).not.toContain('[Auth]');
    expect(service.settings).toMatchObject({
      service: 'YouTube - RTMPS',
      server: 'rtmps://example.invalid/live',
      key: '',
      use_auth: false,
    });
    expect(result).toMatchObject({ ok: true, cookiesReset: true, streamKeyConfigured: false });
    expect(readFileSync(join(result.backupDir, 'service.json'), 'utf8')).toContain('old-key');
    expect(existsSync(join(result.backupDir, 'obs_profile_cookies', 'Cookies'))).toBe(true);
    expect(readdirSync(join(configRoot, 'obs-studio', 'plugin_config', 'obs-browser', 'obs_profile_cookies'))).toEqual(
      [],
    );
  });

  it('refuses to edit the profile while an OBS process exists', async () => {
    const processDir = join(procRoot, '4321');
    mkdirSync(processDir, { recursive: true });
    writeFileSync(join(processDir, 'comm'), 'obs\n');

    await expect(execFileAsync(process.execPath, [script], { env: environment() })).rejects.toThrow(/OBS läuft noch/);
    expect(readFileSync(join(profileDir, 'service.json'), 'utf8')).toContain('old-key');
  });
});
