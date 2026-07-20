import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const apiTarget = process.env.API_PROXY_TARGET ?? 'http://127.0.0.1:12000';
const webPort = Number(process.env.WEB_PORT ?? 12001);
const proxy = {
  '/api': { target: apiTarget, changeOrigin: false, ws: true },
  '/media': { target: apiTarget, changeOrigin: false },
  '^/overlay(?:/|$)': { target: apiTarget, changeOrigin: false },
  '/health': { target: apiTarget, changeOrigin: false },
  '/test-feed.xml': { target: apiTarget, changeOrigin: false },
};

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: webPort,
    strictPort: true,
    proxy,
  },
  preview: {
    host: '127.0.0.1',
    port: webPort,
    strictPort: true,
    proxy,
  },
});
