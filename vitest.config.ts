import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';
export default defineConfig({
  test: {
    include: ['tests/**/*.test.{ts,mjs}'],
    exclude: process.env.VITEST_INCLUDE_INTEGRATION === 'true' ? [] : ['tests/integration/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@ans/shared-types': resolve(__dirname, 'packages/shared-types/src/index.ts'),
      '@ans/security/auth': resolve(__dirname, 'packages/security/src/auth.ts'),
      '@ans/security': resolve(__dirname, 'packages/security/src/index.ts'),
      '@ans/news-parser': resolve(__dirname, 'packages/news-parser/src/index.ts'),
      '@ans/content-processing': resolve(__dirname, 'packages/content-processing/src/index.ts'),
      '@ans/ai-provider': resolve(__dirname, 'packages/ai-provider/src/index.ts'),
      '@ans/source-connectors': resolve(__dirname, 'packages/source-connectors/src/index.ts'),
      '@ans/database/article-media': resolve(__dirname, 'packages/database/src/article-media.ts'),
      '@ans/database/ai-staff': resolve(__dirname, 'packages/database/src/ai-staff.ts'),
      '@ans/database/ai-presenters': resolve(__dirname, 'packages/database/src/ai-presenters.ts'),
      '@ans/database/ai-usage': resolve(__dirname, 'packages/database/src/ai-usage.ts'),
      '@ans/database/broadcast-formats': resolve(__dirname, 'packages/database/src/broadcast-formats.ts'),
      '@ans/database/youtube-shorts': resolve(__dirname, 'packages/database/src/youtube-shorts.ts'),
      '@ans/database/tiktok-shorts': resolve(__dirname, 'packages/database/src/tiktok-shorts.ts'),
      '@ans/database/notifications': resolve(__dirname, 'packages/database/src/notifications.ts'),
      '@ans/database/source-health': resolve(__dirname, 'packages/database/src/source-health-store.ts'),
      '@ans/database/source-updates': resolve(__dirname, 'packages/database/src/source-update-store.ts'),
      '@ans/database/auth': resolve(__dirname, 'packages/database/src/auth.ts'),
      '@ans/database': resolve(__dirname, 'packages/database/src/index.ts'),
      '@ans/obs-controller': resolve(__dirname, 'packages/obs-controller/src/index.ts'),
      '@ans/broadcast-engine': resolve(__dirname, 'packages/broadcast-engine/src/index.ts'),
      '@ans/media-engine/discovery': resolve(__dirname, 'packages/media-engine/src/discovery-v2.ts'),
      '@ans/media-engine/video-upload': resolve(__dirname, 'packages/media-engine/src/video-upload.ts'),
      '@ans/media-engine/workflow': resolve(__dirname, 'packages/media-engine/src/workflow.ts'),
      '@ans/media-engine': resolve(__dirname, 'packages/media-engine/src/index.ts'),
      '@ans/overlay-engine': resolve(__dirname, 'packages/overlay-engine/src/index.ts'),
      '@ans/tts-engine': resolve(__dirname, 'packages/tts-engine/src/index.ts'),
    },
  },
});
