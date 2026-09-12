/**
 * Admin console build — a separate bundle served from its own origin (nginx :8090).
 * Nothing under src/admin is imported by the public app, so admin code never ships to players.
 */
import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

/** Dev only: serve admin.html (not the player's index.html) for every HTML navigation — SPA fallback. */
const adminHtmlFallback = (): Plugin => ({
  name: 'pytch-admin-html',
  apply: 'serve',
  configureServer(server) {
    server.middlewares.use((req, _res, next) => {
      const url = req.url ?? '/'
      const isAsset = url.startsWith('/@') || url.startsWith('/src/') || url.startsWith('/node_modules/') || url.startsWith('/api/') || /\.[a-z0-9]+(\?|$)/i.test(url.split('?')[0]!)
      if (req.method === 'GET' && !isAsset && (req.headers.accept ?? '').includes('text/html')) req.url = '/admin.html'
      next()
    })
  },
})

const API_TARGET = process.env.VITE_PROXY_TARGET ?? 'http://localhost:8000'
const src = (p: string) => fileURLToPath(new URL(p, import.meta.url))

export default defineConfig({
  plugins: [adminHtmlFallback(), react(), tailwindcss()],
  resolve: {
    // admin code imports only audience-agnostic modules (e.g. @/lib/api/http) — never player stores
    alias: { '@': src('./src') },
  },
  server: {
    port: 5174,
    strictPort: true,
    proxy: { '/api': { target: API_TARGET, changeOrigin: true } },
  },
  preview: { port: 4174 },
  build: {
    outDir: 'dist-admin',
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
    sourcemap: false, // never ship source maps for the admin console
    rollupOptions: {
      input: src('./admin.html'),
      output: {
        manualChunks(id) {
          if (id.includes('vite/preload-helper') || id.includes('commonjsHelpers')) return 'react'
          if (!id.includes('node_modules') || id.endsWith('.css')) return undefined
          const pkg = (re: RegExp) => re.test(id.replace(/\\/g, '/'))
          // recharts is left to Rollup so it only loads with the pages that draw charts
          if (pkg(/\/node_modules\/(motion|framer-motion|motion-dom|motion-utils)\//)) return 'motion'
          if (pkg(/\/node_modules\/(react|react-dom|react-router|scheduler|@tanstack\/react-query|@tanstack\/query-core|zustand)\//)) return 'react'
          return undefined
        },
      },
    },
  },
})
