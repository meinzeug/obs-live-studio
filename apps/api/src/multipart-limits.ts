const DEFAULT_IMAGE_BYTES = 15 * 1024 * 1024;
const DEFAULT_VIDEO_BYTES = 250 * 1024 * 1024;

function positiveBytes(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function resolveMultipartLimits(env: NodeJS.ProcessEnv = process.env) {
  const imageBytes = positiveBytes(env.MEDIA_MAX_IMAGE_BYTES, DEFAULT_IMAGE_BYTES);
  const videoBytes = positiveBytes(env.MEDIA_MAX_VIDEO_BYTES, DEFAULT_VIDEO_BYTES);
  return {
    fileSize: Math.max(imageBytes, videoBytes),
    files: 1,
    fields: 20,
    parts: 21,
  };
}
