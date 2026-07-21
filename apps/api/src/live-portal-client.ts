import { z } from 'zod';

const sourceSchema = z.object({
  id: z.string().min(1).max(160),
  name: z.string().min(1).max(160),
  user: z.string().max(160).nullable().optional(),
  status: z.enum(['live', 'connecting', 'offline', 'error']).default('offline'),
  resolution: z.string().max(40).nullable().optional(),
  audioLevel: z.number().min(0).max(1).nullable().optional(),
  network: z.enum(['good', 'unstable', 'poor', 'offline']).nullable().optional(),
  previewUrl: z.string().url().nullable().optional(),
  startedAt: z.string().nullable().optional(),
  updatedAt: z.string().nullable().optional(),
});

const sourcesResponseSchema = z.object({
  sources: z.array(sourceSchema),
  serverTime: z.string().optional(),
});

const viewerTokenResponseSchema = z.object({
  viewerUrl: z.string().url(),
  expiresAt: z.string().optional(),
});

export type LivePortalSource = z.infer<typeof sourceSchema>;

export class LivePortalClient {
  constructor(
    private readonly cfg: {
      baseUrl?: string;
      serviceToken?: string;
      timeoutMs?: number;
    },
  ) {}

  configured() {
    return Boolean(this.cfg.baseUrl && this.cfg.serviceToken);
  }

  status() {
    return {
      configured: this.configured(),
      baseUrl: this.cfg.baseUrl ?? '',
      tokenConfigured: Boolean(this.cfg.serviceToken),
    };
  }

  async listSources() {
    if (!this.configured())
      return { sources: [] as LivePortalSource[], unavailable: 'Live-Portal ist nicht konfiguriert.' };
    const response = await this.request('/api/service/sources');
    return sourcesResponseSchema.parse(response);
  }

  async createViewer(sourceId: string) {
    if (!this.configured()) throw new Error('Live-Portal ist nicht konfiguriert.');
    return viewerTokenResponseSchema.parse(
      await this.request(`/api/service/sources/${encodeURIComponent(sourceId)}/viewer-token`, {
        method: 'POST',
      }),
    );
  }

  private async request(path: string, init: RequestInit = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.cfg.timeoutMs ?? 8_000);
    try {
      const url = new URL(path, this.cfg.baseUrl);
      const response = await fetch(url, {
        ...init,
        signal: controller.signal,
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${this.cfg.serviceToken}`,
          ...(init.headers ?? {}),
        },
      });
      const text = await response.text();
      const data = text ? JSON.parse(text) : null;
      if (!response.ok) {
        const message =
          data && typeof data === 'object' && 'error' in data
            ? String(data.error)
            : `Live-Portal HTTP ${response.status}`;
        throw new Error(message);
      }
      return data;
    } finally {
      clearTimeout(timer);
    }
  }
}
