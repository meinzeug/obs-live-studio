import { Writable } from 'node:stream';
import Fastify, { LogController } from 'fastify';
import { describe, expect, it } from 'vitest';
import { installApiErrorHandler } from '../apps/api/src/error-handler.js';
import {
  decideApiRequestLog,
  installApiRequestLogging,
  resolveApiRequestLoggingConfig,
} from '../apps/api/src/request-logging.js';

function logCollector() {
  const entries: Array<Record<string, unknown>> = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      for (const line of String(chunk).split('\n').filter(Boolean)) {
        entries.push(JSON.parse(line) as Record<string, unknown>);
      }
      callback();
    },
  });
  return { entries, stream };
}

describe('API request logging', () => {
  it('uses production-friendly sampled defaults and validates numeric bounds', () => {
    expect(resolveApiRequestLoggingConfig({})).toEqual({
      mode: 'sampled',
      sampleRate: 0.01,
      slowRequestMs: 2_000,
    });
    expect(
      resolveApiRequestLoggingConfig({
        API_REQUEST_LOGGING: 'off',
        API_REQUEST_LOG_SAMPLE_RATE: '4',
        API_SLOW_REQUEST_MS: '1',
      }),
    ).toEqual({
      mode: 'errors',
      sampleRate: 1,
      slowRequestMs: 100,
    });
  });

  it('suppresses normal polling successes and samples them only at the configured rate', () => {
    const input = {
      method: 'GET',
      url: '/api/obs/status?fresh=1',
      statusCode: 200,
      durationMs: 20,
      config: { mode: 'sampled' as const, sampleRate: 0.1, slowRequestMs: 2_000 },
    };
    expect(decideApiRequestLog({ ...input, random: 0.9 })).toBeNull();
    expect(decideApiRequestLog({ ...input, random: 0.05 })).toEqual({
      level: 'info',
      reason: 'sampled-poll',
    });
    expect(
      decideApiRequestLog({
        ...input,
        url: '/api/broadcast/playlists',
        random: 0.9,
      }),
    ).toBeNull();
    expect(
      decideApiRequestLog({
        ...input,
        url: '/api/youtube-shorts',
        random: 0.9,
      }),
    ).toBeNull();
  });

  it('always logs errors and slow requests even when successful polling logs are disabled', () => {
    const config = { mode: 'errors' as const, sampleRate: 0, slowRequestMs: 500 };
    expect(
      decideApiRequestLog({
        method: 'GET',
        url: '/api/obs/status',
        statusCode: 503,
        durationMs: 20,
        config,
      }),
    ).toEqual({ level: 'error', reason: 'server-error' });
    expect(
      decideApiRequestLog({
        method: 'GET',
        url: '/api/obs/status',
        statusCode: 200,
        durationMs: 750,
        config,
      }),
    ).toEqual({ level: 'warn', reason: 'slow' });
  });

  it('emits no access log for a healthy poll but retains the full server error log', async () => {
    const collector = logCollector();
    const app = Fastify({
      logger: { level: 'info', stream: collector.stream },
      logController: new LogController({ disableRequestLogging: true }),
    });
    installApiRequestLogging(
      app,
      { mode: 'sampled', sampleRate: 0, slowRequestMs: 2_000 },
      () => 1,
    );
    installApiErrorHandler(app);
    app.get('/api/obs/status', async () => ({ connected: true }));
    app.get('/api/live/status', async () => {
      throw new Error('OBS connection failed');
    });

    expect((await app.inject({ method: 'GET', url: '/api/obs/status' })).statusCode).toBe(200);
    expect(collector.entries).toEqual([]);

    expect((await app.inject({ method: 'GET', url: '/api/live/status' })).statusCode).toBe(500);
    expect(
      collector.entries.some(
        (entry) => entry.msg === 'API request failed' && JSON.stringify(entry).includes('OBS connection failed'),
      ),
    ).toBe(true);
    expect(
      collector.entries.some(
        (entry) =>
          entry.msg === 'API request completed with server error' &&
          entry.statusCode === 500 &&
          entry.path === '/api/live/status',
      ),
    ).toBe(true);
    expect(collector.entries.some((entry) => entry.msg === 'incoming request')).toBe(false);
    expect(collector.entries.some((entry) => entry.msg === 'request completed')).toBe(false);
    await app.close();
  });
});
