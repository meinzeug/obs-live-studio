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
  communication: z
    .object({
      control: z.object({
        tally: z.enum(['offline', 'standby', 'preview', 'program']),
        muted: z.boolean(),
        directorName: z.string().nullable(),
        instruction: z.string().nullable(),
        updatedAt: z.string().nullable(),
      }),
      unread: z.object({ streamer: z.number().int().min(0), editorial: z.number().int().min(0) }),
      lastMessageAt: z.string().nullable(),
    })
    .optional(),
});

const sourcesResponseSchema = z.object({
  sources: z.array(sourceSchema),
  serverTime: z.string().optional(),
});

const viewerTokenResponseSchema = z.object({
  viewerUrl: z.string().url(),
  expiresAt: z.string().optional(),
});

const invitationSchema = z.object({
  id: z.string().uuid(),
  displayName: z.string(),
  showTitle: z.string(),
  sourceName: z.string(),
  expiresAt: z.string(),
  acceptedAt: z.string().nullable().optional(),
  sourceId: z.string().uuid().nullable().optional(),
  status: z.enum(['open', 'accepted', 'expired', 'revoked']),
  createdAt: z.string(),
  invitationUrl: z.string().url().optional(),
});

const invitationsResponseSchema = z.object({
  invitations: z.array(invitationSchema),
  serverTime: z.string().optional(),
});

export type LivePortalSource = z.infer<typeof sourceSchema>;
export type LivePortalInvitation = z.infer<typeof invitationSchema>;

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
    const [sourceResponse, communicationResponse] = await Promise.all([
      this.request('/api/service/sources'),
      this.request('/api/service/communication').catch(() => ({ sources: [] })),
    ]);
    const sources = sourcesResponseSchema.parse(sourceResponse);
    const summaries = communicationSummarySchema.parse(communicationResponse);
    const bySource = new Map(summaries.sources.map((summary) => [summary.sourceId, summary]));
    const merged = sources.sources.map((source) => ({ ...source, communication: bySource.get(source.id) }));
    const activeSourceIds = new Set(merged.map((source) => source.id));
    for (const summary of summaries.sources) {
      if (activeSourceIds.has(summary.sourceId)) continue;
      merged.push({
        id: summary.sourceId,
        name: summary.name,
        user: summary.user,
        status: summary.status,
        resolution: null,
        audioLevel: null,
        network: summary.status === 'offline' ? 'offline' : null,
        previewUrl: null,
        startedAt: null,
        updatedAt: summary.updatedAt,
        communication: summary,
      });
    }
    return {
      ...sources,
      sources: merged,
    };
  }

  async createViewer(sourceId: string) {
    if (!this.configured()) throw new Error('Live-Portal ist nicht konfiguriert.');
    return viewerTokenResponseSchema.parse(
      await this.request(`/api/service/sources/${encodeURIComponent(sourceId)}/viewer-token`, {
        method: 'POST',
      }),
    );
  }

  async listInvitations() {
    if (!this.configured())
      return { invitations: [] as LivePortalInvitation[], unavailable: 'Live-Portal ist nicht konfiguriert.' };
    return invitationsResponseSchema.parse(await this.request('/api/service/invitations'));
  }

  async createInvitation(input: {
    displayName: string;
    showTitle: string;
    sourceName?: string;
    expiresInHours?: number;
  }) {
    if (!this.configured()) throw new Error('Live-Portal ist nicht konfiguriert.');
    return invitationSchema.parse(
      await this.request('/api/service/invitations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      }),
    );
  }

  async revokeInvitation(invitationId: string) {
    if (!this.configured()) throw new Error('Live-Portal ist nicht konfiguriert.');
    return invitationSchema.parse(
      await this.request(`/api/service/invitations/${encodeURIComponent(invitationId)}`, {
        method: 'DELETE',
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
