import { ArrowRight, CloudRain } from 'lucide-react'
import { motion, useReducedMotion } from 'motion/react'
import { Link } from 'react-router'
import { cn } from '@/lib/cn'
import { formatWhen } from '@/lib/format'
import type { WeatherAlert } from '@/types/api'

const DROPS = Array.from({ length: 14 }, (_, i) => ({
  left: (i * 37) % 100,
  delay: (i * 0.37) % 1.3,
  duration: 0.7 + ((i * 13) % 5) * 0.08,
  h: 10 + ((i * 7) % 3) * 5,
}))

/** Compact weather alert nudge (Home) linking to the alert page. */
export function WeatherAlertBanner({ alert, className }: { alert: WeatherAlert; className?: string }) {
  const reduce = useReducedMotion()
  const warning = alert.severity === 'warning'
  const open = alert.status === 'open'

  return (
    <Link
      to={`/app/weather/${alert.id}`}
      className={cn(
        'group relative flex items-center gap-4 overflow-hidden rounded-3xl p-5 ring-1 transition hover:-translate-y-0.5',
        // night: storm-purple / slate sky; day: a light rain-tinted wash on a white card
        '[[data-theme=light]_&]:shadow-card',
        warning
          ? 'bg-gradient-to-br from-[#1a1030] via-ink-800 to-ink-850 ring-flare/35 hover:ring-flare/60 [[data-theme=light]_&]:from-flare/10'
          : 'bg-gradient-to-br from-[#10202a] via-ink-800 to-ink-850 ring-sun/30 hover:ring-sun/55 [[data-theme=light]_&]:from-electric/10',
        className,
      )}
    >
      {!reduce && open && (
        <div aria-hidden className="pointer-events-none absolute inset-0">
          {DROPS.map((d, i) => (
            <motion.span
              key={i}
              className="absolute top-0 w-px bg-gradient-to-b from-transparent to-electric/60"
              style={{ left: `${d.left}%`, height: d.h, rotate: 12 }}
              initial={{ y: -20, opacity: 0 }}
              animate={{ y: 140, opacity: [0, 1, 1, 0] }}
              transition={{ repeat: Infinity, duration: d.duration, delay: d.delay, ease: 'linear' }}
            />
          ))}
        </div>
      )}
      <div
        className={cn(
          'relative flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ring-1',
          warning ? 'bg-flare/15 ring-flare/40' : 'bg-sun/15 ring-sun/40',
        )}
      >
        <CloudRain className={cn('h-6 w-6', warning ? 'text-flare' : 'text-sun')} />
        <span className="absolute -right-1.5 -bottom-1.5 rounded-full bg-ink-950 px-1.5 py-0.5 font-mono text-[10px] font-bold text-electric ring-1 ring-electric/40">
          {Math.round(alert.precipitation_probability)}%
        </span>
      </div>
      <div className="relative min-w-0 flex-1">
        <div
          className={cn(
            'text-[10px] font-bold tracking-[0.18em] uppercase',
            warning ? 'text-flare' : 'text-sun',
          )}
        >
          {warning ? 'Rain warning' : 'Rain watch'} · {alert.turf_name}
        </div>
        <div className="mt-0.5 truncate font-semibold">{alert.summary}</div>
        <div className="truncate text-sm text-muted">
          {alert.lobby_title} · {formatWhen(alert.start_at)}
        </div>
      </div>
      <div className="relative flex shrink-0 items-center gap-1 text-xs font-semibold text-fg/80 group-hover:text-volt">
        <span className="hidden sm:inline">{alert.is_host && open ? 'Options' : 'Details'}</span>
        <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
      </div>
    </Link>
  )
}
