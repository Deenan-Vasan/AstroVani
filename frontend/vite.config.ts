import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  // Same variable the app uses at runtime. Unset locally, the dev server proxies
  // /api to the local backend; set (e.g. https://astrovani.agoraaidemo.in) it
  // proxies to that deployed backend instead.
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const apiTarget = (env.VITE_API_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');

  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        '/api': { target: apiTarget, changeOrigin: true, secure: true }
      }
    }
  };
});
