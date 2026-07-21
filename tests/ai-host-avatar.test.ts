import { describe, expect, it } from 'vitest';
import {
  aiHostAvatarVideoUrl,
  configuredAiHostAvatarVideoPaths,
  DEFAULT_AI_HOST_AVATAR_VIDEO_PATHS,
} from '../apps/api/src/ai-host-avatar.js';

describe('AI host video avatar', () => {
  it('uses all three prepared Ava videos as local defaults', () => {
    expect(DEFAULT_AI_HOST_AVATAR_VIDEO_PATHS).toEqual([
      './var/media/ai-host/ava-moderator-1.webm',
      './var/media/ai-host/ava-moderator-2.webm',
      './var/media/ai-host/ava-moderator-3.webm',
    ]);
    expect(configuredAiHostAvatarVideoPaths({})).toEqual(DEFAULT_AI_HOST_AVATAR_VIDEO_PATHS);
  });

  it('rotates video variants and only exposes them for video avatars', () => {
    const moderator = { id: 'moderator', avatar_style: 'video' };
    expect(aiHostAvatarVideoUrl(moderator, 1)).toBe('/api/overlay/ai-host/avatar/moderator?variant=1');
    expect(aiHostAvatarVideoUrl(moderator, 2)).toBe('/api/overlay/ai-host/avatar/moderator?variant=2');
    expect(aiHostAvatarVideoUrl(moderator, 3)).toBe('/api/overlay/ai-host/avatar/moderator?variant=3');
    expect(aiHostAvatarVideoUrl(moderator, 4)).toBe('/api/overlay/ai-host/avatar/moderator?variant=1');
    expect(aiHostAvatarVideoUrl({ id: 'moderator', avatar_style: 'host' })).toBeNull();
    expect(aiHostAvatarVideoUrl(null)).toBeNull();
  });
});
