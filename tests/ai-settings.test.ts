import Fastify from 'fastify';
import dotenv from 'dotenv';
import { describe, expect, it, vi } from 'vitest';
import { AiSettingsManager, buildAiEnvironment, registerAiSettingsRoutes } from '../apps/api/src/ai-settings.js';
import { installApiErrorHandler } from '../apps/api/src/error-handler.js';

const key = 'sk-or-v1-private-openrouter-test-key-1234567890';
const initialEnvironment = `# privat\nDATABASE_URL=postgresql://studio:test@localhost/studio\nOPENROUTER_API_KEY=${key}\n`;
const keyMetadata = {
  label: 'OBS Live Studio',
  freeTier: false,
  limit: 25,
  limitRemaining: 20,
  usage: 5,
  expiresAt: null,
};

describe('OpenRouter settings', () => {
  it('preserves an existing key on an empty password field and never exposes it', async () => {
    let content = initialEnvironment;
    const runtimeEnvironment: NodeJS.ProcessEnv = {};
    const manager = new AiSettingsManager({
      env: runtimeEnvironment,
      readEnvironmentFile: async () => content,
      writeEnvironmentFile: async (next) => {
        content = next;
      },
      inspectKey: vi.fn(async () => keyMetadata),
    });

    const before = await manager.get();
    const saved = await manager.save({
      apiKey: '',
      paidFallback: false,
      autoProcessIngest: true,
      dataCollection: 'deny',
    });
    const parsed = dotenv.parse(content);

    expect(before).toMatchObject({ configured: true, freeFirst: true, freeModel: 'openrouter/free' });
    expect(parsed.OPENROUTER_API_KEY).toBe(key);
    expect(parsed.DATABASE_URL).toContain('studio:test');
    expect(saved.paidFallback).toBe(false);
    expect(JSON.stringify(before)).not.toContain(key);
    expect(JSON.stringify(saved)).not.toContain(key);
  });

  it('validates a newly supplied key before committing it', async () => {
    let content = initialEnvironment;
    const inspectKey = vi.fn(async () => keyMetadata);
    const manager = new AiSettingsManager({
      env: {},
      readEnvironmentFile: async () => content,
      writeEnvironmentFile: async (next) => {
        content = next;
      },
      inspectKey,
    });
    const nextKey = 'sk-or-v1-replacement-private-key-abcdefghij';

    await manager.save({
      apiKey: nextKey,
      paidFallback: true,
      autoProcessIngest: false,
      dataCollection: 'allow',
    });

    expect(inspectKey).toHaveBeenCalledWith(nextKey);
    expect(dotenv.parse(content)).toMatchObject({
      OPENROUTER_API_KEY: nextKey,
      OPENROUTER_PAID_FALLBACK: 'true',
      OPENROUTER_AUTO_PROCESS_INGEST: 'false',
      OPENROUTER_DATA_COLLECTION: 'allow',
    });
  });

  it('builds a deterministic free-first environment configuration', () => {
    const built = buildAiEnvironment(
      { OPENROUTER_API_KEY: key },
      {
        paidFallback: true,
        autoProcessIngest: true,
        dataCollection: 'deny',
      },
    );
    expect(built.updates).toMatchObject({
      OPENROUTER_API_KEY: key,
      OPENROUTER_PAID_FALLBACK: 'true',
      OPENROUTER_AUTO_PROCESS_INGEST: 'true',
    });
  });

  it('protects settings and connection checks with administrator permission', async () => {
    const app = Fastify();
    installApiErrorHandler(app);
    const manager = new AiSettingsManager({
      env: {},
      readEnvironmentFile: async () => initialEnvironment,
      writeEnvironmentFile: async () => undefined,
      inspectKey: vi.fn(async () => keyMetadata),
    });
    const requirePermission = vi.fn();
    registerAiSettingsRoutes(app, manager, requirePermission);

    const read = await app.inject({ method: 'GET', url: '/api/ai/settings' });
    const tested = await app.inject({ method: 'POST', url: '/api/ai/settings/test' });

    expect(read.statusCode).toBe(200);
    expect(tested.statusCode).toBe(200);
    expect(read.body).not.toContain(key);
    expect(tested.body).not.toContain(key);
    expect(requirePermission).toHaveBeenCalledTimes(2);
    expect(requirePermission).toHaveBeenNthCalledWith(1, expect.anything(), expect.anything(), 'users:write');
    expect(requirePermission).toHaveBeenNthCalledWith(2, expect.anything(), expect.anything(), 'users:write');
    await app.close();
  });
});
