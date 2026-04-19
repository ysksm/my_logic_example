import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The Go server runs on :8080. We proxy /api so the UI can fetch
// without CORS during development.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:8080",
    },
  },
});
