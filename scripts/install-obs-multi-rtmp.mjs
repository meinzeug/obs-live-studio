import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { access, chmod, cp, mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function userPluginDirectory(env = process.env) {
  const configRoot = env.XDG_CONFIG_HOME || join(homedir(), '.config');
  return resolve(env.OBS_MULTI_RTMP_USER_PLUGIN_DIR || join(configRoot, 'obs-studio', 'plugins', 'obs-multi-rtmp'));
}

function pluginCandidates(env = process.env) {
  return [
    String(env.OBS_MULTI_RTMP_PLUGIN_PATH ?? '').trim(),
    join(userPluginDirectory(env), 'bin', '64bit', 'obs-multi-rtmp.so'),
    '/usr/lib/x86_64-linux-gnu/obs-plugins/obs-multi-rtmp.so',
    '/usr/lib/aarch64-linux-gnu/obs-plugins/obs-multi-rtmp.so',
    '/usr/lib/obs-plugins/obs-multi-rtmp.so',
    '/usr/lib64/obs-plugins/obs-multi-rtmp.so',
  ].filter(Boolean);
}

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
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} fehlgeschlagen: ${result.stderr || result.stdout}`);
  }
  return result.stdout;
}

export function releaseApiUrl(release) {
  if (!release || release === 'latest') {
    return 'https://api.github.com/repos/sorayuki/obs-multi-rtmp/releases/latest';
  }
  return `https://api.github.com/repos/sorayuki/obs-multi-rtmp/releases/tags/${encodeURIComponent(release)}`;
}

export function architectureInfo(architecture = process.arch) {
  if (['x64', 'x86_64', 'amd64'].includes(architecture)) {
    return { canonical: 'x86_64', aliases: ['x86_64', 'amd64', 'x64'] };
  }
  if (['arm64', 'aarch64'].includes(architecture)) {
    return { canonical: 'aarch64', aliases: ['aarch64', 'arm64'] };
  }
  return { canonical: architecture, aliases: [architecture] };
}

function tokenPattern(token) {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[-_.])${escaped}(?=$|[-_.])`, 'i');
}

function assetScore(name, architecture) {
  const isDebianPackage = /\.deb$/i.test(name) && !/\.ddeb$/i.test(name);
  const isTarArchive = /\.tar\.xz$/i.test(name);
  if (!isDebianPackage && !isTarArchive) return null;
  if (/(^|[-_.])(windows|win32|win64|macos|darwin|sources?|src|debug|dbgsym|symbols?)(?=$|[-_.])/i.test(name)) {
    return null;
  }
  if (!architecture.aliases.some((alias) => tokenPattern(alias).test(name))) return null;
  if (!/(ubuntu|debian|linux|gnu)/i.test(name)) return null;

  const lower = name.toLowerCase();
  let score = 100;
  if (isDebianPackage) score += 100;
  if (lower.includes(`${architecture.canonical}-ubuntu-gnu`)) score += 80;
  if (lower.includes(`ubuntu-24.04-${architecture.canonical}`)) score += 70;
  if (lower.includes(`ubuntu-22.04-${architecture.canonical}`)) score += 60;
  if (lower.includes(`${architecture.canonical}-linux-gnu`)) score += 50;
  if (lower.includes(`linux-${architecture.canonical}`)) score += 40;
  if (lower.includes('ubuntu')) score += 20;
  if (lower.includes('linux')) score += 10;
  return score;
}

export function packageKind(name) {
  if (/\.deb$/i.test(name) && !/\.ddeb$/i.test(name)) return 'deb';
  if (/\.tar\.xz$/i.test(name)) return 'tar-xz';
  throw new Error(`Nicht unterstütztes Plugin-Paket: ${name}`);
}

function availableAssetNames(release) {
  return (release.assets ?? [])
    .map((asset) => String(asset?.name ?? '').trim())
    .filter(Boolean)
    .slice(0, 20);
}

export function validateAssetDownloadUrl(asset) {
  const url = new URL(asset.browser_download_url);
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'github.com' ||
    !url.pathname.startsWith('/sorayuki/obs-multi-rtmp/releases/download/')
  ) {
    throw new Error('Unerwartete Download-Adresse für obs-multi-rtmp');
  }
  return url;
}

export function selectAsset(release, requestedArchitecture = process.arch) {
  const architecture = architectureInfo(requestedArchitecture);
  const assets = Array.isArray(release.assets) ? release.assets : [];
  const candidates = assets
    .map((asset) => ({
      asset,
      score: asset?.name ? assetScore(asset.name, architecture) : null,
    }))
    .filter((candidate) => candidate.score !== null)
    .sort((left, right) => right.score - left.score || left.asset.name.localeCompare(right.asset.name));
  const selected = candidates[0]?.asset;
  if (!selected) {
    const available = availableAssetNames(release);
    const details = available.length
      ? ` Gefundene Release-Dateien: ${available.join(', ')}`
      : ' Das Release enthält keine Dateien.';
    throw new Error(
      `Keine offizielle obs-multi-rtmp-Binärdatei für ${architecture.canonical} und Linux gefunden.${details}`,
    );
  }
  validateAssetDownloadUrl(selected);
  return selected;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function expectedAssetDigest(release, asset, configuredDigest = process.env.OBS_MULTI_RTMP_SHA256) {
  const configured = String(configuredDigest ?? '')
    .trim()
    .toLowerCase();
  if (/^[a-f0-9]{64}$/.test(configured)) return configured;

  const apiDigest = String(asset.digest ?? '')
    .trim()
    .toLowerCase();
  if (/^sha256:[a-f0-9]{64}$/.test(apiDigest)) return apiDigest.slice('sha256:'.length);

  const body = String(release.body ?? '');
  const escapedName = escapeRegExp(asset.name);
  const patterns = [
    new RegExp(`${escapedName}\\s*:\\s*([a-f0-9]{64})`, 'i'),
    new RegExp(`([a-f0-9]{64})\\s+[* ]?${escapedName}(?:\\s|$)`, 'i'),
  ];
  for (const pattern of patterns) {
    const match = body.match(pattern);
    if (match) return match[1].toLowerCase();
  }
  return '';
}

export function validateArchiveListing(listing) {
  const entries = listing
    .split('\n')
    .map((entry) => entry.trim().replace(/^\.\//, '').replace(/\/$/, ''))
    .filter(Boolean);
  if (!entries.length) throw new Error('Das Plugin-Archiv ist leer');
  for (const entry of entries) {
    const allowed = entry === 'lib' || entry.startsWith('lib/') || entry === 'share' || entry.startsWith('share/');
    if (entry.startsWith('/') || entry.split('/').includes('..') || !allowed) {
      throw new Error(`Unzulässiger Archivpfad: ${entry}`);
    }
  }
}

async function pathExists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function extractedPluginCandidates(root, architecture) {
  const architectureDirectory = architecture.canonical === 'aarch64' ? 'aarch64-linux-gnu' : 'x86_64-linux-gnu';
  return [
    join(root, 'usr', 'lib', architectureDirectory, 'obs-plugins', 'obs-multi-rtmp.so'),
    join(root, 'usr', 'lib', 'obs-plugins', 'obs-multi-rtmp.so'),
    join(root, 'lib', architectureDirectory, 'obs-plugins', 'obs-multi-rtmp.so'),
    join(root, 'lib', 'obs-plugins', 'obs-multi-rtmp.so'),
  ];
}

function extractedDataCandidates(root) {
  return [
    join(root, 'usr', 'share', 'obs', 'obs-plugins', 'obs-multi-rtmp'),
    join(root, 'share', 'obs', 'obs-plugins', 'obs-multi-rtmp'),
  ];
}

async function extractPackage(archive, assetName, destination) {
  await mkdir(destination, { recursive: true, mode: 0o700 });
  if (packageKind(assetName) === 'deb') {
    run('dpkg-deb', ['--extract', archive, destination]);
    return;
  }
  const listing = run('tar', ['-tJf', archive]);
  validateArchiveListing(listing);
  run('tar', ['--no-same-owner', '-xJf', archive, '-C', destination]);
}

async function installForCurrentUser(extractedRoot, env = process.env) {
  const architecture = architectureInfo();
  const sourceBinary = await firstExisting(extractedPluginCandidates(extractedRoot, architecture));
  const sourceData = await firstExisting(extractedDataCandidates(extractedRoot));
  if (!sourceBinary || !sourceData) {
    throw new Error('Das offizielle Plugin-Paket enthält keine vollständige OBS-Plugin-Struktur');
  }

  const destination = userPluginDirectory(env);
  const parent = resolve(destination, '..');
  const temporaryDestination = join(parent, `.obs-multi-rtmp-install-${process.pid}`);
  const previousDestination = join(parent, `.obs-multi-rtmp-previous-${process.pid}`);
  await mkdir(parent, { recursive: true, mode: 0o700 });
  await rm(temporaryDestination, { recursive: true, force: true });
  await rm(previousDestination, { recursive: true, force: true });
  await mkdir(join(temporaryDestination, 'bin', '64bit'), { recursive: true, mode: 0o755 });
  await cp(sourceBinary, join(temporaryDestination, 'bin', '64bit', 'obs-multi-rtmp.so'));
  await cp(sourceData, join(temporaryDestination, 'data'), { recursive: true });
  await chmod(join(temporaryDestination, 'bin', '64bit', 'obs-multi-rtmp.so'), 0o644);

  const hadPreviousInstallation = await pathExists(destination);
  try {
    if (hadPreviousInstallation) await rename(destination, previousDestination);
    await rename(temporaryDestination, destination);
    await rm(previousDestination, { recursive: true, force: true });
  } catch (error) {
    await rm(temporaryDestination, { recursive: true, force: true }).catch(() => undefined);
    if (hadPreviousInstallation && (await pathExists(previousDestination)) && !(await pathExists(destination))) {
      await rename(previousDestination, destination).catch(() => undefined);
    }
    throw error;
  }
  return join(destination, 'bin', '64bit', 'obs-multi-rtmp.so');
}

export async function installObsMultiRtmp() {
  const existing = await firstExisting(pluginCandidates());
  if (existing && process.env.OBS_MULTI_RTMP_FORCE_INSTALL !== 'true') {
    console.log(`obs-multi-rtmp ist bereits installiert: ${existing}`);
    return;
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
  if (!Number.isInteger(asset.size) || asset.size <= 0 || asset.size > 200_000_000) {
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
  const expectedDigest = expectedAssetDigest(release, asset);
  if (!/^[a-f0-9]{64}$/.test(expectedDigest)) {
    throw new Error(
      `Für ${asset.name} fehlt ein vertrauenswürdiger SHA-256-Digest. ` +
        'Setze bei einem geprüften Release OBS_MULTI_RTMP_SHA256 manuell.',
    );
  }
  const actualDigest = createHash('sha256').update(bytes).digest('hex');
  if (actualDigest !== expectedDigest) throw new Error('SHA-256-Prüfung des Plugins ist fehlgeschlagen');

  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'obs-multi-rtmp-'));
  const archive = join(temporaryDirectory, asset.name);
  const extracted = join(temporaryDirectory, 'extracted');
  try {
    await writeFile(archive, bytes, { mode: 0o600 });
    await extractPackage(archive, asset.name, extracted);
    const installed = await installForCurrentUser(extracted);
    if (!installed) {
      throw new Error('obs-multi-rtmp wurde entpackt, aber OBS findet das Plugin nicht');
    }
    const dependencies = run('ldd', [installed]);
    if (dependencies.includes('not found')) {
      throw new Error(`obs-multi-rtmp hat fehlende Laufzeitabhängigkeiten:\n${dependencies}`);
    }
    console.log(
      `obs-multi-rtmp ${release.tag_name ?? releaseRef} wurde ohne Root-Rechte für den aktuellen Benutzer installiert: ${installed}`,
    );
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

const direct = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (direct) await installObsMultiRtmp();
