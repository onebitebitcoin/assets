import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 50001,
    proxy: {
      "/api": "http://127.0.0.1:50000"
    },
    allowedHosts: ["ubuntu.golden-ghost.ts.net"]
  },
  test: {
    environment: "jsdom",
    setupFiles: "./vitest.setup.js",
    globals: true
  }
});
