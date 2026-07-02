import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app/App'
// Self-hosted faces (offline-safe, precached). Two deliberate laboratory voices:
//  - Big Shoulders Display: condensed, industrial signage — the engraved
//    equipment nameplate. Used for the wordmark and display headings only.
//  - Martian Mono: a technical, grid-built monospace for every calibrated
//    readout, silkscreen label, and number (dB / Hz / parameter values).
import '@fontsource/big-shoulders-display/600.css'
import '@fontsource/big-shoulders-display/700.css'
import '@fontsource/big-shoulders-display/900.css'
import '@fontsource/martian-mono/400.css'
import '@fontsource/martian-mono/500.css'
import '@fontsource/martian-mono/600.css'
import '@fontsource/martian-mono/700.css'
import './styles/global.css'

const rootEl = document.getElementById('root')
if (!rootEl) throw new Error('mspectr: #root element not found')

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Register the service worker for offline support. Network-first navigation is
// handled inside the worker; failures here are non-fatal (e.g. unsupported, or
// blocked in private mode).
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {
      /* offline support unavailable — app still works online */
    })
  })
}
