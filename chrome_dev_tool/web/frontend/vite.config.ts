import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// `npm run dev` proxies /api and /ws to the Go server (default :7681).
// `npm run build` writes to ./dist which the Go binary embeds via web/spa.go.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:7681',
      '/ws': { target: 'ws://localhost:7681', ws: true },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
