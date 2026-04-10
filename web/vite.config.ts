import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/engine-api': {
        target: 'http://localhost:8765',
        changeOrigin: true,
      },
    },
    allowedHosts: [
      '6f17-116-94-117-97.ngrok-free.app',
      '.ngrok-free.app',
    ],
  },
});
