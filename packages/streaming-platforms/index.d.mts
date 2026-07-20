export type StreamingPlatformId = 'youtube' | 'twitch' | 'x' | 'rumble' | 'kick' | 'facebook' | 'linkedin' | 'custom';

export interface StreamingPlatformDefinition {
  id: StreamingPlatformId;
  label: string;
  setupUrl: string | null;
  defaultServer: string | null;
  obsServiceName: string | null;
  serverProvidedByDashboard: boolean;
}

export interface StreamTarget {
  id: string;
  managedId: string;
  name: string;
  platform: StreamingPlatformId;
  server: string;
  key: string;
  channelUrl: string;
  enabled: boolean;
  configured: boolean;
  secure: boolean;
  syncStart: boolean;
  syncStop: boolean;
  obsServiceName: string | null;
}

export type PublicStreamTarget = Omit<StreamTarget, 'key'>;

export interface StudioProfile {
  studioName: string;
  channelName: string;
  logoConfigured: boolean;
  logoUrl: string;
  channelUrl: string;
  primary: PublicStreamTarget;
  additionalTargets: PublicStreamTarget[];
  multistream: boolean;
  supportedPlatforms: StreamingPlatformDefinition[];
}

export const STREAMING_PLATFORMS: StreamingPlatformDefinition[];
export function normalizePlatformId(input: unknown): StreamingPlatformId;
export function platformDefinition(input: unknown): StreamingPlatformDefinition;
export function normalizeStreamServer(input: unknown, options?: { requireRtmps?: boolean }): string;
export function resolvePrimaryStreamTarget(
  env?: NodeJS.ProcessEnv,
  options?: { requireConfigured?: boolean },
): StreamTarget;
export function resolveAdditionalStreamTargets(
  env?: NodeJS.ProcessEnv,
  options?: { requireConfigured?: boolean; includeDisabled?: boolean },
): StreamTarget[];
export function publicStreamTarget(target: StreamTarget): PublicStreamTarget;
export function resolveStudioProfile(env?: NodeJS.ProcessEnv): StudioProfile;
