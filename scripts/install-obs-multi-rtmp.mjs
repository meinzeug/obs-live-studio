import { createHash } from 'node:crypto';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const pluginCandidates = [
  '/usr/lib/x86_64-linux-gnu/obs-plugins/obs-multi-rtmp.so',
  '/usr/lib/obs-plugins/obs-multi-rtmp.so',
  '/usr/lib64/obs-plugins/obs-multi-rtmp.so',
];

async function firstExisting(paths) {
  for (const path of paths) {
    try {
      await access(path, constants.R_OK);
      return path;
    } catch {}
  }
  return null;
}

function run(command, args) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} fehlgeschlagen: ${result.stderr || result.stdout}`);
  }
  return result.stdout;
}

function releaseApiUrl(release) {
  if (!release || release === 'latest') {
    return 'https://api.github.com/repos/sorayuki/obs-multi-rtmp/releases/latest';
  }
  return `https://api.github.com/repos/sorayuki/obs-multi-rtmp/releases/tags/${encodeURIComponent(release)}`;
}

function selectAsset(release) {
  const architecture = process.arch === 'x64' ? 'x86_64' : process.arch === 'arm64' ? 'aarch64' : process.arch;
  const suffix = `-${architecture}-ubuntu-gnu.tar.xz`;
  const asset = release.assets?.find((item) => item.name?.endsWith(suffix));
  if (!asset) {
    throw new Error(`Keine offizielle obs-multi-rtmp-Version für ${architecture} und Ubuntu gefunden`);
  }
  const url = new URL(asset.browser_download_url);
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'github.com' ||
    !url.pathname.startsWith('/sorayuki/obs-multi-rtmp/releases/download/')
  ) {
    throw new Error('Unerwartete Download-Adresse für obs-multi-rtmp');
  }
  return asset;
}

function validateArchiveListing(listing) {
  const entries = listing
    .split('\n')
    .map((entry) => entry.trim().replace(/^\.\//, ''))
    .filter(Boolean);
  if (!entries.length) throw new Error('Das Plugin-Archiv ist leer');
  for (const entry of entries) {
    if (
      entry.startsWith('/') ||
      entry.split('/').includes('..') ||
      (!entry.startsWith('lib/') && !entry.startsWith('share/'))
    ) {
      throw new Error(`Unzulässiger Archivpfad: ${entry}`);
    }
  }
}

const existing = await firstExisting(pluginCandidates);
if (existing && process.env.OBS_MULTI_RTMP_FORCE_INSTALL !== 'true') {
  console.log(`obs-multi-rtmp ist bereits installiert: ${existing}`);
  process.exit(0);
}
if (process.platform !== 'linux') {
  throw new Error('Die automatische obs-multi-rtmp-Installation unterstützt nur Linux');
}

const releaseRef = process.env.OBS_MULTI_RTMP_RELEASE ?? 'latest';
const releaseResponse = await fetch(releaseApiUrl(releaseRef), {
  headers: {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'obs-live-studio-installer',
    'X-GitHub-Api-Version': '2022-11-28',
  },
});
if (!releaseResponse.ok) {
  throw new Error(`GitHub-Release konnte nicht geladen werden: ${releaseResponse.status}`);
}
const release = await releaseResponse.json();
const asset = selectAsset(release);
if (!Number.isInteger(asset.size) || asset.size <= 0 || asset.size > 100_000_000) {
  throw new Error('Unerwartete Größe des Plugin-Archivs');
}

const download = await fetch(asset.browser_download_url, {
  headers: { 'User-Agent': 'obs-live-studio-installer' },
});
if (!download.ok) {
  throw new Error(`Plugin-Download fehlgeschlagen: ${download.status}`);
}
const bytes = Buffer.from(await download.arrayBuffer());
if (bytes.length !== asset.size) {
  throw new Error('Plugin-Download ist unvollständig');
}
const configuredDigest = String(process.env.OBS_MULTI_RTMP_SHA256 ?? '')
  .trim()
  .toLowerCase();
const releaseDigest = asset.digest?.startsWith('sha256:') ? asset.digest.slice('sha256:'.length).toLowerCase() : '';
const expectedDigest = configuredDigest || releaseDigest;
if (!/^[a-f0-9]{64}$/.test(expectedDigest)) {
  throw new Error('Für das Plugin-Archiv fehlt ein vertrauenswürdiger SHA-256-Digest');
}
const actualDigest = createHash('sha256').update(bytes).digest('hex');
if (actualDigest !== expectedDigest) throw new Error('SHA-256-Prüfung des Plugins ist fehlgeschlagen');

const temporaryDirectory = await mkdtemp(join(tmpdir(), 'obs-multi-rtmp-'));
const archive = join(temporaryDirectory, asset.name);
try {
  await writeFile(archive, bytes, { mode: 0o600 });
  const listing = run('tar', ['-tJf', archive]);
  validateArchiveListing(listing);
  run('sudo', ['tar', '--no-same-owner', '-xJf', archive, '-C', '/usr']);

  const installed = await firstExisting(pluginCandidates);
  if (!installed) {
    throw new Error('obs-multi-rtmp wurde entpackt, aber OBS findet das Plugin nicht');
  }
  const dependencies = run('ldd', [installed]);
  if (dependencies.includes('not found')) {
    throw new Error(`obs-multi-rtmp hat fehlende Laufzeitabhängigkeiten:\n${dependencies}`);
  }
  console.log(`obs-multi-rtmp ${release.tag_name ?? releaseRef} wurde installiert: ${installed}`);
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
