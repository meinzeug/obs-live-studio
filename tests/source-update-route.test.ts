import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { installSourceUrlValidationHook, type SourceUrlPolicy } from '../apps/api/src/source-url-policy.js';

const sourceId = '11111111-1111-4111-8111-111111111111';

function policy(validateStoredSourceUrl = vi.fn(async () => undefined)): SourceUrlPolicy {
  return {
    allowPrivate: false,
    allowPrivateUrl: () => false,
    validateStoredSourceUrl,
  };
}

describe('validated source updates', () => {
  it('persists a validated UUID update once and skips the legacy route', async () => {
    const app = Fastify();
    const legacy = vi.fn();
    const updateSource = vi.fn(async (id, input) => ({ id, ...input }));
    const validateStoredSourceUrl = vi.fn(async () => undefined);
    installSourceUrlValidationHook(app, {
      policy: policy(validateStoredSourceUrl),
      canValidate: () => true,
      updateSource,
    });
    app.put('/api/sources/:id', async () => {
      legacy();
      return { legacy: true };
    });

    const response = await app.inject({
      method: 'PUT',
      url: `/api/sources/${sourceId}`,
      payload: { name: 'Neue Quelle', url: 'https://example.org/new.xml', userAgent: null },
    });

    expect(response.statusCode).toBe(200);
    expect(validateStoredSourceUrl).toHaveBeenCalledWith('https://example.org/new.xml');
    expect(updateSource).toHaveBeenCalledWith(sourceId, {
      name: 'Neue Quelle',
      url: 'https://example.org/new.xml',
      userAgent: null,
    });
    expect(legacy).not.toHaveBeenCalled();
    await app.close();
  });

  it('maps a missing source to HTTP 404 without running the legacy route', async () => {
    const app = Fastify();
    const legacy = vi.fn();
    installSourceUrlValidationHook(app, {
      policy: policy(),
      canValidate: () => true,
      updateSource: async () => {
        throw new Error('Quelle nicht gefunden');
      },
    });
    app.put('/api/sources/:id', async () => {
      legacy();
      return { legacy: true };
    });

    const response = await app.inject({
      method: 'PUT',
      url: `/api/sources/${sourceId}`,
      payload: { name: 'Fehlt' },
    });

    expect(response.statusCode).toBe(404);
    expect(legacy).not.toHaveBeenCalled();
    await app.close();
  });
});
