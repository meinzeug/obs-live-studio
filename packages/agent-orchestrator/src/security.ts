import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { UntrustedEvidence } from './types.js';

const INJECTION_SIGNALS = [
  /ignore (all|any|the|previous) (instructions|rules|prompts)/i,
  /(system|developer)\s*(prompt|message|instructions?)/i,
  /(reveal|print|show|dump).{0,24}(secret|token|password|api.?key|environment)/i,
  /(execute|run).{0,20}(shell|command|bash|powershell|sql)/i,
  /(disable|bypass|skip).{0,20}(approval|quorum|review|budget|safety)/i,
  /BEGIN[_ ](SYSTEM|DEVELOPER|INSTRUCTIONS)/i,
] as const;

export function createCapabilityToken() {
  const token = randomBytes(32).toString('base64url');
  return { token, tokenHash: hashCapabilityToken(token) };
}

export function hashCapabilityToken(token: string) {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function capabilityTokenMatches(token: string, expectedHash: string) {
  const actual = Buffer.from(hashCapabilityToken(token), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function detectPromptInjection(value: string) {
  const matches = INJECTION_SIGNALS.flatMap((pattern) => {
    const match = value.match(pattern);
    return match?.[0] ? [match[0].slice(0, 120)] : [];
  });
  return { suspicious: matches.length > 0, signals: matches };
}

export function boundEvidence(input: UntrustedEvidence): UntrustedEvidence & { injectionSignals: string[] } {
  const content = input.content.replace(/\u0000/g, '').slice(0, 24_000);
  const detection = detectPromptInjection(content);
  return {
    ...input,
    title: input.title.replace(/\s+/g, ' ').trim().slice(0, 240),
    content,
    trustScore: Math.max(0, Math.min(100, Math.round(input.trustScore))),
    untrusted: input.untrusted || detection.suspicious,
    injectionSignals: detection.signals,
  };
}

export function stablePayloadHash(value: unknown) {
  return createHash('sha256').update(stableJson(value), 'utf8').digest('hex');
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

export function redactAgentPayload(value: unknown, depth = 0): unknown {
  if (depth > 8) return '[DEPTH_LIMIT]';
  if (Array.isArray(value)) return value.slice(0, 100).map((entry) => redactAgentPayload(entry, depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, 100)
        .map(([key, entry]) => [
          key,
          /(secret|token|password|authorization|cookie|api.?key)/i.test(key)
            ? '[REDACTED]'
            : redactAgentPayload(entry, depth + 1),
        ]),
    );
  }
  if (typeof value === 'string')
    return value.replace(/\b(sk-|ghp_|github_pat_)[A-Za-z0-9_-]{8,}\b/g, '[REDACTED]').slice(0, 24_000);
  return value;
}
