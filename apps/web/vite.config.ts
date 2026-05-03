import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const apiProxyTarget = "http://127.0.0.1:3000";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 5000,
    allowedHosts: true,
    proxy: {
      "/api": {
        target: apiProxyTarget,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
      "/auth": {
        target: apiProxyTarget,
        changeOrigin: true,
      },
      "^/stock(?:/|$)": {
        target: apiProxyTarget,
        changeOrigin: true,
      },
      "/alerts": {
        target: apiProxyTarget,
        changeOrigin: true,
      },
      "/audit-logs": {
        target: apiProxyTarget,
        changeOrigin: true,
      },
      "/suppliers": {
        target: apiProxyTarget,
        changeOrigin: true,
      },
      "/purchases": {
        target: apiProxyTarget,
        changeOrigin: true,
      },
      "/team": {
        target: apiProxyTarget,
        changeOrigin: true,
      },
      "/workspace": {
        target: apiProxyTarget,
        changeOrigin: true,
      },
      "/locations": {
        target: apiProxyTarget,
        changeOrigin: true,
      },
      "/notifications": {
        target: apiProxyTarget,
        changeOrigin: true,
      },
      "/onboarding": {
        target: apiProxyTarget,
        changeOrigin: true,
      },
    },
  },
});
