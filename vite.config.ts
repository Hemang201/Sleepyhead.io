import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Frontend build for the public site and the admin dashboard.
 *
 * The catalogue is served by the Worker (see worker/), so there is no static
 * game manifest to read at build time any more: the sitemap and every game page
 * are generated from the database at request time.
 *
 * In development the SPA runs on 5173 and proxies the API, the auth routes and
 * game builds to `wrangler dev` on 8787, which is where D1 and R2 are emulated.
 * For a production-shaped check, run `npm run build && npm run dev:full` and use
 * http://localhost:8787 directly.
 */
const WORKER = process.env.WORKER_ORIGIN ?? 'http://localhost:8787';

export default defineConfig({
  plugins: [react()],
  build: {
    target: 'es2022',
    assetsInlineLimit: 2048,
    reportCompressedSize: false,
  },
  server: {
    port: 5173,
    strictPort: false,
    proxy: {
      '/api': { target: WORKER, changeOrigin: false },
      '/play': { target: WORKER, changeOrigin: false },
      '/auth': { target: WORKER, changeOrigin: false },
    },
  },
  preview: { port: 4173, strictPort: false },
});
