import { Home, Sparkles, Star, Sun, Video } from 'lucide-react'
import { motion } from 'motion/react'
import { Link } from 'react-router'
import { Chip } from '@/components/ui/Chip'
import { TurfArt } from '@/components/ui/TurfArt'
import { cn } from '@/lib/cn'
import { formatINR, formatKm } from '@/lib/format'
import { sportInfo } from '@/lib/sports'
import type { TurfSummary } from '@/types/api'

export function TurfCard({
  turf,
  highlighted,
  onHover,
  compact,
}: {
  turf: TurfSummary
  highlighted?: boolean
  onHover?: (id: string | null) => void
  compact?: boolean
}) {
  const forming = turf.open_lobbies_count
  return (
    <Link
      to={`/app/turfs/${turf.slug}`}
      onMouseEnter={() => onHover?.(turf.id)}
      onMouseLeave={() => onHover?.(null)}
      onFocus={() => onHover?.(turf.id)}
      onBlur={() => onHover?.(null)}
      className="group block rounded-3xl"
      data-turf-id={turf.id}
    >
      <motion.div
        whileHover={{ y: -4 }}
        whileTap={{ scale: 0.985 }}
        transition={{ type: 'spring', stiffness: 400, damping: 28 }}
        className={cn(
          'glass relative overflow-hidden rounded-3xl shadow-card transition-[box-shadow,border-color] duration-300',
          highlighted ? 'border-volt/50 shadow-glow-volt' : 'hover:border-white/15',
        )}
      >
        <TurfArt seed={turf.id} sport={turf.sports[0]} src={turf.cover_url} className={compact ? 'h-24' : 'h-36'}>
          <div className="flex h-full flex-col justify-between p-3">
            <div className="flex items-start justify-between gap-2">
              {forming > 0 ? (
                <span className="relative inline-flex h-6 items-center gap-1.5 rounded-full bg-volt px-2.5 text-[11px] font-bold text-ink-950 shadow-[0_0_24px_-2px_color-mix(in_srgb,_var(--color-volt)_80%,_transparent)]">
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-ink-950 opacity-60" />
                    <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-ink-950" />
                  </span>
                  {forming} game{forming === 1 ? '' : 's'} forming
                </span>
              ) : turf.is_featured ? (
                <span className="inline-flex h-6 items-center gap-1 rounded-full bg-ink-900/70 px-2.5 text-[11px] font-semibold backdrop-blur">
                  <Sparkles className="h-3 w-3 text-sun" /> Featured
                </span>
              ) : (
                <span />
              )}
              {turf.rating_count > 0 && (
                <span className="inline-flex h-6 items-center gap-1 rounded-full bg-ink-900/70 px-2 text-[11px] font-semibold backdrop-blur">
                  <Star className="h-3 w-3 fill-sun text-sun" />
                  {turf.rating_avg.toFixed(1)}
                  <span className="text-muted">({turf.rating_count})</span>
                </span>
              )}
            </div>
            <div className="flex gap-1">
              {turf.sports.map((s) => (
                <span
                  key={s}
                  title={sportInfo(s).label}
                  className="flex h-7 w-7 items-center justify-center rounded-full bg-ink-900/70 text-sm backdrop-blur transition-transform duration-300 group-hover:-translate-y-0.5"
                >
                  {sportInfo(s).emoji}
                </span>
              ))}
            </div>
          </div>
        </TurfArt>
        <div className="p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="truncate text-[15px] font-semibold transition-colors group-hover:text-volt">{turf.name}</h3>
              <p className="mt-0.5 truncate text-xs text-muted">
                {turf.area}
                {turf.distance_km != null && <> · {formatKm(turf.distance_km)}</>}
              </p>
            </div>
            <div className="shrink-0 text-right leading-none">
              <div className="text-[10px] tracking-wider text-subtle uppercase">from</div>
              <div className="mt-1 font-display text-lg font-semibold">
                {formatINR(turf.min_price_per_hour_paise)}
                <span className="text-xs font-normal text-muted">/hr</span>
              </div>
            </div>
          </div>
          {!compact && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {turf.has_indoor && (
                <Chip size="xs" tone="electric">
                  <Home className="h-3 w-3" /> Indoor
                </Chip>
              )}
              {turf.has_outdoor && (
                <Chip size="xs">
                  <Sun className="h-3 w-3" /> Outdoor
                </Chip>
              )}
              {turf.has_camera && (
                <Chip size="xs" tone="grape">
                  <Video className="h-3 w-3" /> Camera
                </Chip>
              )}
            </div>
          )}
        </div>
      </motion.div>
    </Link>
  )
}

export function TurfCardSkeleton() {
  return (
    <div className="glass overflow-hidden rounded-3xl">
      <div className="skeleton h-36" />
      <div className="space-y-2.5 p-4">
        <div className="flex justify-between">
          <div className="skeleton h-4 w-1/2 rounded-lg" />
          <div className="skeleton h-5 w-14 rounded-lg" />
        </div>
        <div className="skeleton h-3 w-1/3 rounded-lg" />
        <div className="flex gap-1.5 pt-1">
          <div className="skeleton h-5 w-16 rounded-full" />
          <div className="skeleton h-5 w-16 rounded-full" />
        </div>
      </div>
    </div>
  )
}
