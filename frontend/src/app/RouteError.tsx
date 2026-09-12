import { RefreshCw, WifiOff } from 'lucide-react'
import { motion } from 'motion/react'
import { useEffect, useState } from 'react'
import { isRouteErrorResponse, useRouteError } from 'react-router'
import { LogoMark } from '@/components/layout/Logo'
import { cn } from '@/lib/cn'
import { isChunkLoadError, reloadForFreshBuild } from '@/lib/chunkReload'

function useOnline() {
  const [online, setOnline] = useState(() => navigator.onLine)
  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])
  return online
}

/**
 * Router `errorElement` — replaces React Router's developer error screen.
 * `page`: full screen (root level, may render outside Providers → no query/store hooks here).
 * `inline`: inside the app shell, so the nav stays usable.
 * A missing JS chunk (stale tab after a redeploy, or offline) reloads once automatically.
 */
export function RouteError({ variant = 'page' }: { variant?: 'page' | 'inline' }) {
  const error = useRouteError()
  const online = useOnline()
  const chunk = isChunkLoadError(error)
  const [reloading, setReloading] = useState(false)

  // stale build: fetch the new one (once); offline: wait for the connection, then do the same
  useEffect(() => {
    if (chunk && online && reloadForFreshBuild()) setReloading(true)
  }, [chunk, online])

  useEffect(() => {
    if (!chunk) console.error(error)
  }, [chunk, error])

  const notFound = isRouteErrorResponse(error) && error.status === 404
  const offline = chunk && !online
  const title = reloading
    ? 'Grabbing the latest version…'
    : offline
      ? "You're offline"
      : chunk
        ? 'PYTCH just got an update'
        : notFound
          ? 'Nothing on this pitch'
          : 'Something went offside'
  const body = offline
    ? "This screen couldn't load without a connection. We'll pick up where you left off as soon as you're back online."
    : chunk
      ? 'A newer version was released while this tab was open. Reload to get it — your session is safe.'
      : notFound
        ? "This page doesn't exist — the link may be old."
        : "An unexpected error stopped this screen from loading. Reloading usually fixes it; if it keeps happening, let us know."
  const home = window.location.pathname.startsWith('/partner') ? '/partner' : '/app'
  const detail = !chunk && import.meta.env.DEV ? (error instanceof Error ? error.stack ?? error.message : JSON.stringify(error, null, 2)) : null

  const card = (
    <motion.div
      initial={{ opacity: 0, y: 16, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
      role="alert"
      className="glass relative w-full max-w-md overflow-hidden rounded-3xl p-6 text-center shadow-card sm:p-8"
    >
      <div aria-hidden className="pitch-grid pointer-events-none absolute inset-0 opacity-40 [mask-image:radial-gradient(ellipse_at_top,black,transparent_70%)]" />
      <div className="relative">
        <div
          className={cn(
            'mx-auto flex h-16 w-16 items-center justify-center rounded-2xl ring-1',
            offline ? 'bg-sun/12 text-sun ring-sun/30' : chunk ? 'bg-volt/12 text-volt ring-volt/30' : 'bg-flare/12 text-flare ring-flare/30',
          )}
        >
          {offline ? (
            <WifiOff className="h-7 w-7" />
          ) : (
            <RefreshCw className={cn('h-7 w-7', reloading && 'animate-spin')} />
          )}
        </div>
        <h1 className="mt-5 text-2xl font-bold">{title}</h1>
        <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted">{body}</p>
        <div className="mt-6 flex flex-col justify-center gap-2 sm:flex-row">
          <button
            type="button"
            onClick={() => window.location.reload()}
            disabled={reloading}
            className="inline-flex h-11 cursor-pointer items-center justify-center gap-2 rounded-xl bg-volt px-5 text-sm font-semibold text-ink-950 shadow-glow-volt transition hover:brightness-110 disabled:opacity-60"
          >
            <RefreshCw className="h-4 w-4" /> Reload
          </button>
          <a
            href={home}
            className="inline-flex h-11 items-center justify-center rounded-xl bg-white/5 px-5 text-sm font-semibold text-fg ring-1 ring-white/10 transition hover:bg-white/10"
          >
            {home === '/partner' ? 'Back to the portal' : 'Back to the app'}
          </a>
        </div>
        {detail && (
          <details className="mt-6 text-left">
            <summary className="cursor-pointer text-xs text-subtle">Error details (dev only)</summary>
            <pre className="mt-2 max-h-48 overflow-auto rounded-xl bg-ink-950/60 p-3 text-[11px] leading-snug whitespace-pre-wrap text-fg/70">{detail}</pre>
          </details>
        )}
      </div>
    </motion.div>
  )

  if (variant === 'inline') return <div className="flex min-h-[60vh] items-center justify-center py-10">{card}</div>

  return (
    <main className="relative flex min-h-dvh flex-col items-center overflow-hidden bg-ink-900 px-5 py-6 text-fg">
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute top-[-20%] left-1/2 h-[36rem] w-[36rem] -translate-x-1/2 rounded-full bg-volt/[0.06] blur-[120px]" />
        <div className="noise absolute inset-0" />
      </div>
      <header className="relative flex w-full max-w-5xl items-center gap-2.5">
        {/* plain <a>: a full load is exactly what a broken bundle needs */}
        <a href="/" className="inline-flex items-center gap-2.5" aria-label="PYTCH home">
          <LogoMark />
          <span className="font-display text-xl font-bold tracking-tight">
            PYT<span className="text-volt">C</span>H
          </span>
        </a>
      </header>
      <div className="relative flex w-full flex-1 items-center justify-center py-10">{card}</div>
    </main>
  )
}
