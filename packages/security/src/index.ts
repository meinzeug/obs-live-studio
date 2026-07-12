import { lookup } from 'node:dns/promises';
import ipaddr from 'ipaddr.js';
import argon2 from 'argon2';
const blockedHosts = new Set(['localhost', 'metadata.google.internal']);
export async function hashPassword(password: string) {
  return argon2.hash(password, { type: argon2.argon2id });
}
export async function verifyPassword(hash: string, password: string) {
  return argon2.verify(hash, password);
}
export function maskSecret(value: string) {
  return value.length <= 8 ? '••••' : `${value.slice(0, 4)}••••${value.slice(-4)}`;
}
export async function assertPublicHttpUrl(raw: string, allowPrivate = false) {
  const url = new URL(raw);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Nur HTTP/HTTPS-URLs sind erlaubt.');
  if (blockedHosts.has(url.hostname)) throw new Error('Lokale oder Metadaten-Hosts sind blockiert.');
  const answers = await lookup(url.hostname, { all: true });
  for (const a of answers) {
    const ip = ipaddr.parse(a.address);
    const range = ip.range();
    if (!allowPrivate && ['private', 'loopback', 'linkLocal', 'uniqueLocal', 'unspecified'].includes(range))
      throw new Error(`SSRF-Schutz: ${a.address} ist nicht öffentlich.`);
    if (a.address === '169.254.169.254') throw new Error('Cloud-Metadaten-Endpunkte sind blockiert.');
  }
  return url;
}
export function redactLog<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = { ...obj };
  for (const k of Object.keys(out)) if (/password|secret|token|cookie|key/i.test(k)) out[k] = '[REDACTED]';
  return out as T;
}
