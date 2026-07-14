import { describe, expect, it } from 'vitest';
import {
  assertAllowedNetworkAddress,
  assertPublicHttpUrl,
  maskSecret,
  redactLog,
} from '../packages/security/src/index.js';

describe('security helpers', () => {
  it('masks secrets and redacts logs', () => {
    expect(maskSecret('abcdefghijkl')).toBe('abcd••••ijkl');
    expect(redactLog({ streamKey: 'x', ok: 1 }).streamKey).toBe('[REDACTED]');
  });
});

describe('SSRF protection', () => {
  it('accepts globally routable unicast addresses', () => {
    expect(() => assertAllowedNetworkAddress('8.8.8.8')).not.toThrow();
    expect(() => assertAllowedNetworkAddress('2606:4700:4700::1111')).not.toThrow();
  });

  it('rejects private, carrier-grade NAT and IPv4-mapped loopback addresses by default', () => {
    expect(() => assertAllowedNetworkAddress('10.0.0.1')).toThrow(/nicht öffentlich/);
    expect(() => assertAllowedNetworkAddress('100.64.0.1')).toThrow(/nicht öffentlich/);
    expect(() => assertAllowedNetworkAddress('::ffff:127.0.0.1')).toThrow(/nicht öffentlich/);
  });

  it('allows explicitly configured private networks without allowing link-local metadata ranges', () => {
    expect(() => assertAllowedNetworkAddress('127.0.0.1', true)).not.toThrow();
    expect(() => assertAllowedNetworkAddress('fd00::1', true)).not.toThrow();
    expect(() => assertAllowedNetworkAddress('169.254.169.254', true)).toThrow(/Metadaten/);
    expect(() => assertAllowedNetworkAddress('fe80::1', true)).toThrow(/nicht öffentlich/);
  });

  it('rejects embedded credentials and localhost aliases before DNS resolution', async () => {
    await expect(assertPublicHttpUrl('https://user:password@example.org/feed.xml')).rejects.toThrow(
      /eingebetteten Zugangsdaten/,
    );
    await expect(assertPublicHttpUrl('http://localhost./feed.xml')).rejects.toThrow(/Lokale oder Metadaten-Hosts/);
  });
});
