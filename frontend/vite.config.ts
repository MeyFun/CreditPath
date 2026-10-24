import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// API_TARGET позволяет поднять второй стенд рядом, не занимая порт 8000.
// Типы Node не подключены, поэтому объявляем только то, что читаем.
declare const process: { env: Record<string, string | undefined> };
const api = process.env.API_TARGET ?? "http://localhost:8000";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": api,
      "/docs": api,
      "/openapi.json": api
    }
  },
  preview: {
    port: 4173,
    proxy: {
      "/api": api,
      "/docs": api,
      "/openapi.json": api
    }
  },
  build: {
    outDir: "dist",
    sourcemap: false
  }
});
