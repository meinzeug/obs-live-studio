export const DEFAULT_AI_HOST_AVATAR_VIDEO_PATHS = [
  './var/media/ai-host/ava-moderator-1.webm',
  './var/media/ai-host/ava-moderator-2.webm',
  './var/media/ai-host/ava-moderator-3.webm',
] as const;

type VideoAvatarMember = {
  id: string;
  avatar_style: string;
};

export function aiHostAvatarVideoUrl(
  member: VideoAvatarMember | null | undefined,
  avatarSequence: string | number = 1,
  variantCount: number = DEFAULT_AI_HOST_AVATAR_VIDEO_PATHS.length,
) {
  if (member?.avatar_style !== 'video') return null;
  const sequence = Math.max(1, Number.parseInt(String(avatarSequence), 10) || 1);
  const variant = ((sequence - 1) % Math.max(1, variantCount)) + 1;
  return `/api/overlay/ai-host/avatar/${encodeURIComponent(member.id)}?variant=${variant}`;
}

export function configuredAiHostAvatarVideoPaths(env: NodeJS.ProcessEnv = process.env) {
  const configured = String(env.AI_HOST_AVATAR_VIDEO_PATHS ?? '')
    .split(',')
    .map((path) => path.trim())
    .filter(Boolean);
  if (configured.length) return configured;
  const legacy = String(env.AI_HOST_AVATAR_VIDEO_PATH ?? '').trim();
  return legacy ? [legacy] : [...DEFAULT_AI_HOST_AVATAR_VIDEO_PATHS];
}
