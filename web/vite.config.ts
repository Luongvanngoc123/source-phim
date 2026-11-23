import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The browser only ever calls same-origin /api/**. In production the Java gateway forwards it;
// in development this proxy does. Point API_PROXY_TARGET at a local gateway to test that chain.
const apiTarget = process.env.API_PROXY_TARGET ?? "https://cdn1.lvn123.site";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": { target: apiTarget, changeOrigin: true },
    },
  },
});
