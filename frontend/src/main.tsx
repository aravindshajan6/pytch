import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import '@fontsource-variable/unbounded'
import 'leaflet/dist/leaflet.css'
import './styles/globals.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router'
import { router } from './app/router'
import { reloadForFreshBuild } from './lib/chunkReload'

// A lazy route's chunk (or its CSS) 404s after a redeploy → reload once onto the new build. If the guard
// says no (offline / just reloaded), the import error reaches the router's friendly `RouteError` instead.
window.addEventListener('vite:preloadError', (e) => {
  if (reloadForFreshBuild()) e.preventDefault()
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
