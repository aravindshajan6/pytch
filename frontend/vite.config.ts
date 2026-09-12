import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const API_TARGET = process.env.VITE_PROXY_TARGET ?? 'http://localhost:8000'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: true },
      '/media': { target: API_TARGET, changeOrigin: true },
      '/ws': { target: API_TARGET.replace('http', 'ws'), ws: true },
    },
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        // Same groups as before, plus: Vite/Rollup virtual helpers (e.g. `__vitePreload`) are pinned
        // to the always-loaded `react` chunk. Otherwise Rollup pulls them into the `three` chunk
        // (drei uses dynamic imports), making every page modulepreload three.js + leaflet (~1.3 MB).
        // Global CSS from node_modules (leaflet.css in main.tsx) is left unassigned for the same reason.
        manualChunks(id) {
          if (id.includes('vite/preload-helper') || id.includes('commonjsHelpers')) return 'react'
          if (!id.includes('node_modules') || id.endsWith('.css')) return undefined // leaflet.css stays in the entry CSS
          const pkg = (re: RegExp) => re.test(id.replace(/\\/g, '/'))
          if (pkg(/\/node_modules\/(three|@react-three)\//)) return 'three'
          if (pkg(/\/node_modules\/(leaflet|react-leaflet)\//)) return 'map'
          if (pkg(/\/node_modules\/(motion|framer-motion|motion-dom|motion-utils|animejs)\//)) return 'motion'
          if (pkg(/\/node_modules\/(react|react-dom|react-router|scheduler|@tanstack\/react-query|@tanstack\/query-core|zustand)\//)) return 'react'
          return undefined
        },
      },
    },
  },
})
