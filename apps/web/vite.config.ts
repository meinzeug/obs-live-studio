import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const apiTarget = process.env.API_PROXY_TARGET ?? 'http://127.0.0.1:12000';
const proxy = {
  '/api': { target: apiTarget, changeOrigin: false, ws: true },
  '^/overlay(?:/|$)': { target: apiTarget, changeOrigin: false },
  '/health': { target: apiTarget, changeOrigin: false },
  '/test-feed.xml': { target: apiTarget, changeOrigin: false },
};

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 12001,
    strictPort: true,
    proxy,
  },
  preview: {
    host: '127.0.0.1',
    port: 12001,
    strictPort: true,
    proxy,
  },
});
