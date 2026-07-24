/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // The external mr2s-backend only allows CORS from its deployed frontend
    // origins (no localhost), so dev requests go through this proxy. The
    // client uses the "/mr2s-api" prefix so the health endpoint (GET /) and
    // the /api/v1/* endpoints share one base-URL rule; the prefix is
    // stripped before forwarding.
    proxy: {
      '/mr2s-api': {
        target: process.env.VITE_PROXY_TARGET ?? 'https://quantum.yunseong.dev',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/mr2s-api/, ''),
      },
    },
  },
  test: {
    environment: 'node',
  },
})
