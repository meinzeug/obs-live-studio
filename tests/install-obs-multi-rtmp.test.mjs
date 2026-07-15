import { describe, expect, it } from 'vitest';
import {
  architectureInfo,
  expectedAssetDigest,
  releaseApiUrl,
  selectAsset,
  validateArchiveListing,
  validateAssetDownloadUrl,
} from '../scripts/install-obs-multi-rtmp.mjs';

function asset(name, extra = {}) {
  return {
    name,
    size: 12_345,
    browser_download_url: `https://github.com/sorayuki/obs-multi-rtmp/releases/download/0.7.6.0/${name}`,
    ...extra,
  };
}

describe('obs-multi-rtmp installer release selection', () => {
  it('normalizes Node and Linux architecture names', () => {
    expect(architectureInfo('x64')).toEqual({
      canonical: 'x86_64',
      aliases: ['x86_64', 'amd64', 'x64'],
    });
    expect(architectureInfo('arm64')).toEqual({
      canonical: 'aarch64',
      aliases: ['aarch64', 'arm64'],
    });
  });

  it('selects the current Ubuntu-version-first Linux archive', () => {
    const current = asset('obs-multi-rtmp-0.7.6.0-ubuntu-24.04-x86_64.tar.xz');
    const release = {
      assets: [
        asset('obs-multi-rtmp-0.7.6.0-windows-x64.zip'),
        asset('obs-multi-rtmp-0.7.6.0-sources.tar.xz'),
        current,
      ],
    };

    expect(selectAsset(release, 'x64')).toBe(current);
  });

  it('supports legacy and alternative official Linux naming orders', () => {
    const legacy = asset('obs-multi-rtmp-0.7.5.0-x86_64-ubuntu-gnu.tar.xz');
    const linuxGnu = asset('obs-multi-rtmp-0.7.5.0-x86_64-linux-gnu.tar.xz');
    const linuxFirst = asset('obs-multi-rtmp-0.7.5.0-linux-x64.tar.xz');

    expect(selectAsset({ assets: [legacy] }, 'x64')).toBe(legacy);
    expect(selectAsset({ assets: [linuxGnu] }, 'amd64')).toBe(linuxGnu);
    expect(selectAsset({ assets: [linuxFirst] }, 'x86_64')).toBe(linuxFirst);
  });

  it('supports the official ARM64 aliases', () => {
    const arm = asset('obs-multi-rtmp-0.7.6.0-ubuntu-24.04-aarch64.tar.xz');
    expect(selectAsset({ assets: [arm] }, 'arm64')).toBe(arm);
  });

  it('rejects source archives and reports available release filenames', () => {
    expect(() =>
      selectAsset(
        {
          assets: [
            asset('obs-multi-rtmp-0.7.6.0-sources.tar.xz'),
            asset('obs-multi-rtmp-0.7.6.0-windows-x64.zip'),
          ],
        },
        'x64',
      ),
    ).toThrow(/Gefundene Release-Dateien:.*sources.*windows/);
  });

  it('accepts only the official GitHub release download path', () => {
    expect(() => validateAssetDownloadUrl(asset('plugin-x86_64-linux-gnu.tar.xz'))).not.toThrow();
    expect(() =>
      validateAssetDownloadUrl({
        name: 'plugin-x86_64-linux-gnu.tar.xz',
        browser_download_url: 'https://example.org/plugin.tar.xz',
      }),
    ).toThrow('Unerwartete Download-Adresse');
  });

  it('resolves SHA-256 from configuration, API metadata or the official release body', () => {
    const name = 'obs-multi-rtmp-0.7.6.0-ubuntu-24.04-x86_64.tar.xz';
    const selected = asset(name, { digest: `sha256:${'a'.repeat(64)}` });

    expect(expectedAssetDigest({}, selected, 'B'.repeat(64))).toBe('b'.repeat(64));
    expect(expectedAssetDigest({}, selected, '')).toBe('a'.repeat(64));
    expect(
      expectedAssetDigest(
        { body: `### Checksums\n    ${name}: ${'c'.repeat(64)}` },
        { ...selected, digest: null },
        '',
      ),
    ).toBe('c'.repeat(64));
  });

  it('keeps release URLs and archive paths constrained', () => {
    expect(releaseApiUrl('latest')).toContain('/releases/latest');
    expect(releaseApiUrl('0.7.6.0')).toContain('/releases/tags/0.7.6.0');
    expect(() => validateArchiveListing('./lib/\n./lib/obs-plugins/plugin.so\n./share/obs/locale/de-DE.ini\n')).not.toThrow();
    expect(() => validateArchiveListing('./lib/../etc/passwd\n')).toThrow('Unzulässiger Archivpfad');
    expect(() => validateArchiveListing('./usr/bin/unexpected\n')).toThrow('Unzulässiger Archivpfad');
  });
});
