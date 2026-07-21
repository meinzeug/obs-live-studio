import { createHash, randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import dotenv from 'dotenv';
import { maskSecret } from '@ans/security';
import {
  exchangeTikTokAuthorizationCode,
  queryTikTokCreatorInfo,
  refreshTikTokAccessToken,
  revokeTikTokToken,
  tikTokAuthorizationUrl,
  TIKTOK_OAUTH_SCOPES,
  type TikTokCreatorInfo,
  type TikTokOAuthConfig,
} from './tiktok-api.js';
import {
  readOptionalEnvironmentFile,
  withEnvironmentFileLock,
  writePrivateEnvironmentFile,
} from './environment-file.js';
import { PROJECT_ROOT } from './project-root.js';
import { updateEnvironmentDocument } from './stream-target-settings.js';

type TikTokProfile = {
  openId: string;
  refreshToken: string;
  scope: string;
  nickname: string;
  username: string;
  avatarUrl: string;
  connectedAt: string;
};

function clean(value: unknown, maximum = 2_048) {
  return typeof value === 'string' ? value.trim().slice(0, maximum) : '';
}

export function readTikTokOAuthProfile(env: NodeJS.ProcessEnv = process.env): TikTokProfile | null {
  const encoded = clean(env.TIKTOK_OAUTH_PROFILE_B64, 16_000);
  if (!encoded) return null;
  try {
    const data = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    const refreshToken = clean(data?.refreshToken);
    const openId = clean(data?.openId, 256);
    if (!refreshToken || !openId) return null;
    return {
      openId,
      refreshToken,
      scope: clean(data?.scope, 1_000),
      nickname: clean(data?.nickname, 180),
      username: clean(data?.username, 180),
      avatarUrl: clean(data?.avatarUrl, 2_000),
      connectedAt: clean(data?.connectedAt, 64) || new Date(0).toISOString(),
    };
  } catch {
    return null;
  }
}

function encodeTikTokOAuthProfile(profile: TikTokProfile | null) {
  return profile ? Buffer.from(JSON.stringify(profile), 'utf8').toString('base64url') : '';
}

export function readTikTokOAuthConfig(env: NodeJS.ProcessEnv = process.env): TikTokOAuthConfig {
  return {
    clientKey: clean(env.TIKTOK_CLIENT_KEY, 500),
    clientSecret: clean(env.TIKTOK_CLIENT_SECRET, 500),
    redirectUri: clean(env.TIKTOK_OAUTH_REDIRECT_URI, 1_000) || 'http://localhost:12001/api/tiktok/oauth/callback',
  };
}

export class TikTokOAuthManager {
  private readonly envFile: string;
  private readonly env: NodeJS.ProcessEnv;
  private readonly oauthStates = new Map<string, { userId: string; expiresAt: number }>();
  private tokenCache: { fingerprint: string; accessToken: string; expiresAt: number } | null = null;

  constructor(options: { envFile?: string; env?: NodeJS.ProcessEnv } = {}) {
    this.envFile = options.envFile ?? resolve(PROJECT_ROOT, '.env');
    this.env = options.env ?? process.env;
  }

  private async environment() {
    const content = await readOptionalEnvironmentFile(this.envFile);
    return { content, env: { ...this.env, ...dotenv.parse(content) } };
  }

  async serverEnvironment() {
    return (await this.environment()).env;
  }

  private apply(updates: Record<string, string>) {
    for (const [key, value] of Object.entries(updates)) this.env[key] = value;
  }

  private async write(updates: Record<string, string>) {
    await withEnvironmentFileLock(this.envFile, async () => {
      const { content } = await this.environment();
      await writePrivateEnvironmentFile(this.envFile, updateEnvironmentDocument(content, updates));
      this.apply(updates);
    });
  }

  async publicStatus() {
    const { env } = await this.environment();
    const config = readTikTokOAuthConfig(env);
    const profile = readTikTokOAuthProfile(env);
    return {
      clientConfigured: Boolean(config.clientKey && config.clientSecret),
      connected: Boolean(config.clientKey && config.clientSecret && profile?.refreshToken),
      clientKeyHint: config.clientKey ? maskSecret(config.clientKey) : '',
      clientSecretHint: config.clientSecret ? maskSecret(config.clientSecret) : '',
      redirectUri: config.redirectUri,
      scopes: [...TIKTOK_OAUTH_SCOPES],
      account: profile
        ? {
            nickname: profile.nickname,
            username: profile.username,
            avatarUrl: profile.avatarUrl,
            connectedAt: profile.connectedAt,
          }
        : null,
    };
  }

  async saveSettings(raw: {
    clientKey?: string;
    clientSecret?: string;
    clearClientSecret?: boolean;
    redirectUri?: string;
  }) {
    const { env } = await this.environment();
    const clientKey = clean(raw.clientKey, 500) || env.TIKTOK_CLIENT_KEY || '';
    const clientSecret = raw.clearClientSecret ? '' : clean(raw.clientSecret, 500) || env.TIKTOK_CLIENT_SECRET || '';
    const identityChanged =
      clientKey !== (env.TIKTOK_CLIENT_KEY || '') || clientSecret !== (env.TIKTOK_CLIENT_SECRET || '');
    await this.write({
      TIKTOK_CLIENT_KEY: clientKey,
      TIKTOK_CLIENT_SECRET: clientSecret,
      TIKTOK_OAUTH_REDIRECT_URI:
        clean(raw.redirectUri, 1_000) ||
        env.TIKTOK_OAUTH_REDIRECT_URI ||
        'http://localhost:12001/api/tiktok/oauth/callback',
      TIKTOK_OAUTH_PROFILE_B64: identityChanged ? '' : env.TIKTOK_OAUTH_PROFILE_B64 || '',
    });
    this.tokenCache = null;
    return this.publicStatus();
  }

  async begin(userId: string) {
    const { env } = await this.environment();
    for (const [state, entry] of this.oauthStates) if (entry.expiresAt < Date.now()) this.oauthStates.delete(state);
    const state = randomBytes(32).toString('base64url');
    this.oauthStates.set(state, { userId, expiresAt: Date.now() + 10 * 60_000 });
    return tikTokAuthorizationUrl(readTikTokOAuthConfig(env), state);
  }

  cancel(state: string) {
    this.oauthStates.delete(state);
  }

  async complete(state: string, code: string) {
    const pending = this.oauthStates.get(state);
    if (!pending || pending.expiresAt < Date.now()) {
      this.oauthStates.delete(state);
      throw Object.assign(new Error('Die TikTok-OAuth-Anfrage ist abgelaufen oder ungültig.'), { statusCode: 400 });
    }
    const { env } = await this.environment();
    const exchanged = await exchangeTikTokAuthorizationCode(readTikTokOAuthConfig(env), code);
    const creator = await queryTikTokCreatorInfo(exchanged.accessToken);
    const profile: TikTokProfile = {
      openId: exchanged.openId,
      refreshToken: exchanged.refreshToken,
      scope: exchanged.scope,
      nickname: creator.nickname,
      username: creator.username,
      avatarUrl: creator.avatarUrl,
      connectedAt: new Date().toISOString(),
    };
    await this.write({ TIKTOK_OAUTH_PROFILE_B64: encodeTikTokOAuthProfile(profile) });
    this.oauthStates.delete(state);
    this.tokenCache = {
      fingerprint: createHash('sha256').update(`${profile.openId}\0${profile.refreshToken}`).digest('hex'),
      accessToken: exchanged.accessToken,
      expiresAt: Date.now() + exchanged.expiresIn * 1_000,
    };
    return { userId: pending.userId, oauth: await this.publicStatus() };
  }

  async accessToken(fetchImpl: typeof fetch = fetch) {
    const { env } = await this.environment();
    const config = readTikTokOAuthConfig(env);
    const profile = readTikTokOAuthProfile(env);
    if (!config.clientKey || !config.clientSecret || !profile?.refreshToken)
      throw Object.assign(new Error('TikTok OAuth ist noch nicht vollständig verbunden.'), { statusCode: 409 });
    const fingerprint = createHash('sha256').update(`${profile.openId}\0${profile.refreshToken}`).digest('hex');
    if (this.tokenCache?.fingerprint === fingerprint && this.tokenCache.expiresAt > Date.now() + 60_000)
      return this.tokenCache.accessToken;
    const refreshed = await refreshTikTokAccessToken(config, profile.refreshToken, fetchImpl);
    const nextProfile = {
      ...profile,
      openId: refreshed.openId || profile.openId,
      refreshToken: refreshed.refreshToken,
      scope: refreshed.scope || profile.scope,
    };
    if (nextProfile.refreshToken !== profile.refreshToken || nextProfile.openId !== profile.openId) {
      await this.write({ TIKTOK_OAUTH_PROFILE_B64: encodeTikTokOAuthProfile(nextProfile) });
    }
    const nextFingerprint = createHash('sha256')
      .update(`${nextProfile.openId}\0${nextProfile.refreshToken}`)
      .digest('hex');
    this.tokenCache = {
      fingerprint: nextFingerprint,
      accessToken: refreshed.accessToken,
      expiresAt: Date.now() + refreshed.expiresIn * 1_000,
    };
    return refreshed.accessToken;
  }

  async creatorInfo(fetchImpl: typeof fetch = fetch): Promise<TikTokCreatorInfo> {
    const accessToken = await this.accessToken(fetchImpl);
    const creator = await queryTikTokCreatorInfo(accessToken, fetchImpl);
    const { env } = await this.environment();
    const profile = readTikTokOAuthProfile(env);
    if (
      profile &&
      (profile.nickname !== creator.nickname ||
        profile.username !== creator.username ||
        profile.avatarUrl !== creator.avatarUrl)
    ) {
      await this.write({
        TIKTOK_OAUTH_PROFILE_B64: encodeTikTokOAuthProfile({
          ...profile,
          nickname: creator.nickname,
          username: creator.username,
          avatarUrl: creator.avatarUrl,
        }),
      });
    }
    return creator;
  }

  async test() {
    const creator = await this.creatorInfo();
    return {
      ok: true as const,
      creator,
      message: `TikTok ist mit „${creator.nickname || creator.username || 'Creator-Konto'}“ verbunden.`,
    };
  }

  async disconnect() {
    try {
      const { env } = await this.environment();
      await revokeTikTokToken(readTikTokOAuthConfig(env), await this.accessToken());
    } catch {
      // Die lokale, widerrufbare Freigabe wird auch bei einem nicht erreichbaren TikTok-Endpunkt sicher entfernt.
    }
    await this.write({ TIKTOK_OAUTH_PROFILE_B64: '' });
    this.tokenCache = null;
    return this.publicStatus();
  }
}
