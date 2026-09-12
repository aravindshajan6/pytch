import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import '@fontsource-variable/unbounded'
import '../styles/globals.css'
import './admin.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { AdminApp } from './AdminApp'

// Defence in depth: refuse to run inside a frame (clickjacking) even if a header is missing.
if (window.top !== window.self) {
  document.body.textContent = 'PYTCH Admin cannot be embedded.'
} else {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <AdminApp />
    </StrictMode>,
  )
}
