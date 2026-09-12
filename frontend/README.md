# PYTCH Web (frontend)

React 19 · TypeScript (strict) · Vite 7 · Tailwind CSS 4 · Motion · Three.js / React-Three-Fiber / drei · anime.js · Lenis · Leaflet · TanStack Query · Zustand · Sonner.

## Run
```bash
npm install
npm run dev          # http://localhost:5173 — proxies /api, /ws, /media to http://localhost:8000
npm run build        # typecheck + production bundle in dist/
npm run lint
```
Point the dev proxy elsewhere with `VITE_PROXY_TARGET=http://host:port npm run dev`.

Docker: multi-stage build → nginx serving `dist/` and reverse-proxying `/api`, `/ws` (WebSocket upgrade) and `/media` (range requests) to the `api` service — see `nginx.conf`.

| Build-time env | Default | |
|---|---|---|
| `VITE_API_BASE` | `/api/v1` | REST base |
| `VITE_WS_URL` | same-origin `/ws` | override WebSocket URL |
| `VITE_MAP_TILE_URL` | OpenStreetMap + CSS night filter | e.g. a keyed CARTO `dark_all` URL |

## Layout
```
src/
  app/          router (lazy, code-split routes), providers, RealtimeProvider (WS → cache/toasts), guards
  components/
    ui/         design system: Button, Card, Chip, Avatar, Sheet, ProgressRing, Countdown, Segmented,
                Form controls, States, TurfArt (generative covers), PlayerBits, AnimatedNumber
    layout/     AppShell (sidebar · top bar · mobile bottom nav), Logo
    three/      R3F hero scene (shader football, floodlit pitch, particles)
  features/     landing · auth · home · discover · turf · play · matches · lobby · payments
                bench · ratings · profile · highlights · weather · wallet · notifications · leaderboard · misc
  lib/          api (typed client with token refresh, endpoints, query keys), realtime (WS client + hooks),
                format (₹ / IST), sports, celebrate (confetti)
  stores/       auth (persisted), location
  hooks/        useMe, useMeta, useCountdown, useMediaQuery
  types/api.ts  canonical API contract shared with the backend
```

## Theming (dark · light · system)
- `<html data-theme="dark|light">` is set before first paint (inline script in `index.html`) from the persisted `stores/theme.ts` store; toggles live in the top bar, landing nav, login and Profile → Appearance.
- All colour tokens are CSS variables; `src/styles/globals.css` declares the dark palette and re-declares it under `[data-theme="light"]`, so Tailwind utilities flip automatically. `white/…` utilities are *contrast overlays* (dark ink in light mode); use `snow` / `night` for colours that must never flip.
- **Dark islands:** put `data-theme="dark"` on immersive media (photos with overlaid text, video, 3D/canvas, collectible cards) — e.g. `TurfArt`, the player card, clip players, the weather storm header.
- In TS, use `var(--color-…)` / `tokens` and `alpha(color, a)` from `lib/color.ts` (never append hex alpha digits). Canvas/WebGL read resolved colours via `cssVar()` + `useResolvedTheme()`.

## Conventions
- All server data goes through TanStack Query with keys from `lib/api/queryKeys.ts`; realtime events invalidate those keys.
- Money arrives as integer paise → `formatINR`; timestamps are UTC → format in `Asia/Kolkata` via `lib/format.ts`.
- Heavy code (three.js, Leaflet) is split into lazy chunks; 3D degrades to a static hero without WebGL or with reduced motion.
- Motion respects `prefers-reduced-motion` globally (`MotionConfig reducedMotion="user"`).
