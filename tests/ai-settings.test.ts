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
      freeChatDataCollection: 'allow',
      presenterPaidFallback: true,
      dailyBudgetUsd: 1.25,
      maxRequestUsd: 0.025,
    });
    const parsed = dotenv.parse(content);

    expect(before).toMatchObject({ configured: true, freeFirst: true, freeModel: 'openrouter/free' });
    expect(parsed.OPENROUTER_API_KEY).toBe(key);
    expect(parsed.DATABASE_URL).toContain('studio:test');
    expect(saved.paidFallback).toBe(false);
    expect(saved).toMatchObject({ presenterPaidFallback: true, dailyBudgetUsd: 1.25, maxRequestUsd: 0.025 });
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
      freeChatDataCollection: 'deny',
      presenterPaidFallback: true,
      dailyBudgetUsd: 2,
      maxRequestUsd: 0.04,
    });

    expect(inspectKey).toHaveBeenCalledWith(nextKey);
    expect(dotenv.parse(content)).toMatchObject({
      OPENROUTER_API_KEY: nextKey,
      OPENROUTER_PAID_FALLBACK: 'true',
      OPENROUTER_AUTO_PROCESS_INGEST: 'false',
      OPENROUTER_DATA_COLLECTION: 'allow',
      OPENROUTER_FREE_CHAT_DATA_COLLECTION: 'deny',
      OPENROUTER_PRESENTER_PAID_FALLBACK: 'true',
      OPENROUTER_DAILY_BUDGET_USD: '2',
      OPENROUTER_MAX_REQUEST_USD: '0.04',
    });
  });

  it('clears a key without validating an ignored password field', async () => {
    let content = initialEnvironment;
    const inspectKey = vi.fn(async () => keyMetadata);
    const manager = new AiSettingsManager({
      env: { OPENROUTER_API_KEY: key },
      readEnvironmentFile: async () => content,
      writeEnvironmentFile: async (next) => {
        content = next;
      },
      inspectKey,
    });

    const saved = await manager.save({
      apiKey: 'this-value-must-be-ignored',
      clearApiKey: true,
      paidFallback: false,
      autoProcessIngest: false,
      dataCollection: 'deny',
      freeChatDataCollection: 'allow',
    });

    expect(inspectKey).not.toHaveBeenCalled();
    expect(dotenv.parse(content).OPENROUTER_API_KEY).toBe('');
    expect(saved.configured).toBe(false);
  });

  it('builds a deterministic free-first environment configuration', () => {
    const built = buildAiEnvironment(
      { OPENROUTER_API_KEY: key },
      {
        paidFallback: true,
        autoProcessIngest: true,
        dataCollection: 'deny',
        freeChatDataCollection: 'allow',
        presenterPaidFallback: true,
        dailyBudgetUsd: 0.75,
        maxRequestUsd: 0.015,
      },
    );
    expect(built.updates).toMatchObject({
      OPENROUTER_API_KEY: key,
      OPENROUTER_PAID_FALLBACK: 'true',
      OPENROUTER_AUTO_PROCESS_INGEST: 'true',
      OPENROUTER_FREE_CHAT_DATA_COLLECTION: 'allow',
      OPENROUTER_PRESENTER_PAID_FALLBACK: 'true',
      OPENROUTER_DAILY_BUDGET_USD: '0.75',
      OPENROUTER_MAX_REQUEST_USD: '0.015',
    });
  });

  it('rejects an individual request limit above the daily budget', () => {
    expect(() =>
      buildAiEnvironment(
        { OPENROUTER_API_KEY: key },
        {
          paidFallback: true,
          autoProcessIngest: true,
          dataCollection: 'deny',
          presenterPaidFallback: true,
          dailyBudgetUsd: 0.02,
          maxRequestUsd: 0.03,
        },
      ),
    ).toThrow('darf nicht über dem Tagesbudget liegen');
  });

  it('protects settings and connection checks with administrator permission', async () => {
    const app = Fastify();
    installApiErrorHandler(app);
    const manager = new AiSettingsManager({
      env: {},
      readEnvironmentFile: async () => initialEnvironment,
      writeEnvironmentFile: async () => undefined,
      inspectKey: vi.fn(async () => keyMetadata),
      budgetSummary: vi.fn(async (dailyLimitUsd, requestLimitUsd) => ({
        date: '2026-07-21',
        dailyLimitUsd,
        requestLimitUsd,
        spentUsd: 0.12,
        reservedUsd: 0,
        remainingUsd: dailyLimitUsd - 0.12,
        paidRequests: 3,
        blockedRequests: 0,
        lastPaidModel: 'google/gemini-flash',
        lastPaidAt: '2026-07-21T10:00:00.000Z',
      })),
    });
    const requirePermission = vi.fn();
    registerAiSettingsRoutes(app, manager, requirePermission);

    const read = await app.inject({ method: 'GET', url: '/api/ai/settings' });
    const tested = await app.inject({ method: 'POST', url: '/api/ai/settings/test' });
    const budget = await app.inject({ method: 'GET', url: '/api/ai/budget' });

    expect(read.statusCode).toBe(200);
    expect(tested.statusCode).toBe(200);
    expect(budget.statusCode).toBe(200);
    expect(budget.json()).toMatchObject({ available: true, spentUsd: 0.12, paidRequests: 3 });
    expect(read.body).not.toContain(key);
    expect(tested.body).not.toContain(key);
    expect(requirePermission).toHaveBeenCalledTimes(3);
    expect(requirePermission).toHaveBeenNthCalledWith(1, expect.anything(), expect.anything(), 'users:write');
    expect(requirePermission).toHaveBeenNthCalledWith(2, expect.anything(), expect.anything(), 'users:write');
    expect(requirePermission).toHaveBeenNthCalledWith(3, expect.anything(), expect.anything(), 'users:write');
    await app.close();
  });
});
