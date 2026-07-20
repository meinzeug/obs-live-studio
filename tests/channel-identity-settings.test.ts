import { describe, expect, it, vi } from 'vitest';
import { ChannelIdentitySettingsManager } from '../apps/api/src/channel-identity-settings.js';

function managerFixture(overrides: Record<string, unknown> = {}) {
  let document = [
    'CHANNEL_NAME=ArgumentationsKette',
    'STUDIO_NAME=ArgumentationsKette Studio',
    'CHANNEL_LOGO_PATH=/tmp/test-logo.png',
    'CHANNEL_LOGO_SHA256=abc',
    'CHANNEL_LOGO_ENABLED=true',
    'CHANNEL_LOGO_VISIBILITY=broadcast',
    'CHANNEL_LOGO_POSITION=top-right',
    'CHANNEL_LOGO_WIDTH=180',
    'CHANNEL_LOGO_OPACITY=90',
    'CHANNEL_LOGO_MARGIN=40',
    '',
  ].join('\n');
  const afterChange = vi.fn(async () => undefined);
  const persistIdentity = vi.fn(async () => undefined);
  const manager = new ChannelIdentitySettingsManager({
    env: {},
    envFile: '/tmp/channel-identity-test.env',
    logoDirectory: '/tmp/channel-identity-logos',
    readEnvironmentFile: async () => document,
    writeEnvironmentFile: async (next) => {
      document = next;
    },
    afterChange,
    persistIdentity,
    runtimeState: async () => ({ streamActive: false, broadcastActive: true }),
    ...overrides,
  });
  return { manager, afterChange, persistIdentity, document: () => document };
}

describe('channel identity settings', () => {
  it('persists editable station identity and OBS logo placement', async () => {
    const fixture = managerFixture();
    const result = await fixture.manager.save({
      channelName: 'Argumentationskette News',
      studioName: 'Argumentationskette Studio',
      logoEnabled: true,
      logoVisibility: 'streaming-or-broadcast',
      logoPosition: 'bottom-left',
      logoWidth: 220,
      logoOpacity: 84,
      logoMargin: 56,
    });

    expect(result.settings).toMatchObject({
      channelName: 'Argumentationskette News',
      logoPosition: 'bottom-left',
      logoVisibility: 'streaming-or-broadcast',
      logoWidth: 220,
    });
    expect(fixture.document()).toContain("CHANNEL_NAME='Argumentationskette News'");
    expect(fixture.document()).toContain('CHANNEL_LOGO_POSITION=bottom-left');
    expect(fixture.persistIdentity).toHaveBeenCalledWith({
      channelName: 'Argumentationskette News',
      studioName: 'Argumentationskette Studio',
    });
    expect(fixture.afterChange).toHaveBeenCalledOnce();
  });

  it('evaluates the configured broadcast visibility without exposing the logo path', async () => {
    const fixture = managerFixture();
    const runtime = await fixture.manager.publicRuntime();
    expect(runtime).toMatchObject({
      channelName: 'ArgumentationsKette',
      logoConfigured: true,
      logoVisibility: 'broadcast',
      broadcastActive: true,
      streamActive: false,
      visible: true,
    });
    expect(runtime.logoUrl).toBe('/api/channel/logo?v=abc');
    expect(runtime).not.toHaveProperty('logoPath');
  });

  it('keeps saved settings when OBS cannot be updated immediately', async () => {
    const fixture = managerFixture({
      afterChange: async () => {
        throw new Error('OBS offline');
      },
    });
    const result = await fixture.manager.save({
      channelName: 'Neuer Kanal',
      studioName: 'Neues Studio',
      logoEnabled: true,
      logoVisibility: 'always',
      logoPosition: 'top-left',
      logoWidth: 160,
      logoOpacity: 100,
      logoMargin: 20,
    });
    expect(result.warning).toContain('OBS offline');
    expect(fixture.document()).toContain("CHANNEL_NAME='Neuer Kanal'");
  });
});
