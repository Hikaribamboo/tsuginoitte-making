import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const engineProxyTarget = env.ENGINE_PROXY_TARGET || 'http://127.0.0.1:8765';
  const aiProxyTarget = env.AI_PROXY_TARGET || 'http://127.0.0.1:8766';
  console.info(`[vite] /api proxy target: ${engineProxyTarget}`);
  console.info(`[vite] /api/generate-explanations proxy target: ${aiProxyTarget}`);
  const extraAllowedHosts = (env.VITE_ALLOWED_HOSTS || '')
    .split(',')
    .map((host) => host.trim())
    .filter(Boolean);

  return {
    plugins: [react()],
    server: {
      host: true,
      port: 5173,
      strictPort: true,
      proxy: {
        '/api/generate-explanations': {
          target: aiProxyTarget,
          changeOrigin: true,
          configure: (proxy) => {
            proxy.on('error', (error, req) => {
              console.error(`[vite] /api/generate-explanations proxy error target=${aiProxyTarget} url=${req.url}:`, error.message);
            });
          },
        },
        '/api': {
          target: engineProxyTarget,
          changeOrigin: true,
          configure: (proxy) => {
            proxy.on('error', (error, req) => {
              console.error(`[vite] /api proxy error target=${engineProxyTarget} url=${req.url}:`, error.message);
            });
          },
        },
      },
      allowedHosts: [
        '.ngrok-free.app',
        '.ngrok.app',
        '.ngrok.io',
        '.trycloudflare.com',
        ...extraAllowedHosts,
      ],
    },
  };
});
