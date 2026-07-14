import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: process.env.VITEST_INCLUDE_INTEGRATION === 'true' ? [] : ['tests/integration/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@ans/shared-types': resolve(__dirname, 'packages/shared-types/src/index.ts'),
      '@ans/security': resolve(__dirname, 'packages/security/src/index.ts'),
      '@ans/news-parser': resolve(__dirname, 'packages/news-parser/src/index.ts'),
      '@ans/content-processing': resolve(__dirname, 'packages/content-processing/src/index.ts'),
      '@ans/source-connectors': resolve(__dirname, 'packages/source-connectors/src/index.ts'),
      '@ans/database': resolve(__dirname, 'packages/database/src/index.ts'),
      '@ans/database/notifications': resolve(__dirname, 'packages/database/src/notifications.ts'),
      '@ans/database/source-health': resolve(__dirname, 'packages/database/src/source-health-store.ts'),
      '@ans/obs-controller': resolve(__dirname, 'packages/obs-controller/src/index.ts'),
      '@ans/broadcast-engine': resolve(__dirname, 'packages/broadcast-engine/src/index.ts'),
      '@ans/media-engine': resolve(__dirname, 'packages/media-engine/src/index.ts'),
      '@ans/overlay-engine': resolve(__dirname, 'packages/overlay-engine/src/index.ts'),
      '@ans/tts-engine': resolve(__dirname, 'packages/tts-engine/src/index.ts'),
    },
  },
});
