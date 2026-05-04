import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// During `npm run dev` we proxy /api and /ws to the Go server (default :7681).
// `npm run build` produces ./dist which the Go server can serve via -ui.
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
