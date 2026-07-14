import { lookup } from 'node:dns/promises';
import ipaddr from 'ipaddr.js';
import argon2 from 'argon2';

const blockedHosts = new Set(['localhost', 'metadata.google.internal']);
const privateRanges = new Set(['private', 'loopback', 'uniqueLocal', 'carrierGradeNat']);

export async function hashPassword(password: string) {
  return argon2.hash(password, { type: argon2.argon2id });
}

export async function verifyPassword(hash: string, password: string) {
  return argon2.verify(hash, password);
}

export function maskSecret(value: string) {
  return value.length <= 8 ? '••••' : `${value.slice(0, 4)}••••${value.slice(-4)}`;
}

export function assertAllowedNetworkAddress(address: string, allowPrivate = false) {
  const ip = ipaddr.process(address);
  const normalized = ip.toString();
  const range = ip.range();

  if (normalized === '169.254.169.254') {
    throw new Error('Cloud-Metadaten-Endpunkte sind blockiert.');
  }
  if (range === 'unicast') return;
  if (allowPrivate && privateRanges.has(range)) return;

  throw new Error(`SSRF-Schutz: ${address} ist nicht öffentlich.`);
}

export async function assertPublicHttpUrl(raw: string, allowPrivate = false) {
  const url = new URL(raw);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Nur HTTP/HTTPS-URLs sind erlaubt.');
  if (url.username || url.password) throw new Error('URLs mit eingebetteten Zugangsdaten sind nicht erlaubt.');

  const hostname = url.hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '');
  if (blockedHosts.has(hostname)) throw new Error('Lokale oder Metadaten-Hosts sind blockiert.');

  const answers = await lookup(hostname, { all: true });
  if (answers.length === 0) throw new Error('Die URL konnte keiner IP-Adresse zugeordnet werden.');
  for (const answer of answers) assertAllowedNetworkAddress(answer.address, allowPrivate);
  return url;
}

export function redactLog<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = { ...obj };
  for (const k of Object.keys(out)) if (/password|secret|token|cookie|key/i.test(k)) out[k] = '[REDACTED]';
  return out as T;
}
