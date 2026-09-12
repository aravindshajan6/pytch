import { formatInTimeZone } from 'date-fns-tz'
import { ArrowRight, Flame } from 'lucide-react'
import { motion } from 'motion/react'
import { Link } from 'react-router'
import { useCountdown } from '@/hooks/useCountdown'
import { cn } from '@/lib/cn'
import { TZ, formatINR, formatSlotRange } from '@/lib/format'
import { weatherEmoji } from '@/lib/sports'
import type { HourWeather, Slot } from '@/types/api'

const PERIODS = [
  { key: 'morning', label: 'Morning', emoji: '🌅', test: (h: number) => h < 12 },
  { key: 'afternoon', label: 'Afternoon', emoji: '☀️', test: (h: number) => h >= 12 && h < 17 },
  { key: 'evening', label: 'Evening', emoji: '🌆', test: (h: number) => h >= 17 && h < 21 },
  { key: 'night', label: 'Night', emoji: '🌙', test: (h: number) => h >= 21 },
]

const istHour = (iso: string) => Number(formatInTimeZone(new Date(iso), TZ, 'H'))

export function SlotGrid({
  slots,
  flashes,
  onBook,
}: {
  slots: Slot[]
  flashes: Record<string, number>
  onBook: (s: Slot) => void
}) {
  let index = 0
  return (
    <div className="space-y-6">
      {PERIODS.map((p) => {
        const list = slots.filter((s) => p.test(istHour(s.start_at)))
        if (!list.length) return null
        const free = list.filter((s) => s.status === 'available' || s.open_lobby_id).length
        return (
          <section key={p.key} aria-label={p.label}>
            <div className="mb-2.5 flex items-center justify-between">
              <h4 className="flex items-center gap-2 font-sans text-xs font-bold tracking-[0.18em] text-muted uppercase">
                <span className="text-sm">{p.emoji}</span> {p.label}
              </h4>
              <span className="text-[11px] text-subtle">{free} open</span>
            </div>
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-4">
              {list.map((s) => (
                <motion.div
                  key={s.id}
                  initial={{ opacity: 0, y: 14, scale: 0.96 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{ delay: Math.min(index++, 16) * 0.025, type: 'spring', stiffness: 320, damping: 26 }}
                >
                  <SlotTile slot={s} flash={flashes[s.id]} onBook={onBook} />
                </motion.div>
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}

const base = 'relative flex h-full min-h-[96px] w-full flex-col justify-between gap-2 overflow-hidden rounded-2xl p-3 text-left'

function SlotTile({ slot, flash, onBook }: { slot: Slot; flash?: number; onBook: (s: Slot) => void }) {
  const range = formatSlotRange(slot.start_at, slot.end_at)
  const flashEl = flash ? (
    <motion.span
      key={flash}
      aria-hidden
      initial={{ opacity: 1 }}
      animate={{ opacity: 0 }}
      transition={{ duration: 1.6, ease: 'easeOut' }}
      className="pointer-events-none absolute inset-0 rounded-2xl bg-volt/20 ring-2 ring-volt"
    />
  ) : null

  const top = (strike = false) => (
    <div className="flex items-start justify-between gap-1.5">
      <span className={cn('font-display text-sm font-semibold', strike && 'line-through decoration-white/40')}>{range}</span>
      {slot.weather && <WeatherChip w={slot.weather} />}
    </div>
  )
  const price = (
    <span className="inline-flex items-center gap-1 font-mono text-[13px] font-semibold">
      {formatINR(slot.price_paise)}
      {slot.is_peak && <Flame aria-label="Peak hour" className="h-3.5 w-3.5 text-sun" />}
    </span>
  )

  if (slot.open_lobby_id) {
    return (
      <Link
        to={`/app/lobby/${slot.open_lobby_id}`}
        aria-label={`${range}: game forming — join`}
        className={cn(
          base,
          'group bg-volt/[0.06] shadow-[0_0_28px_-12px_color-mix(in_srgb,_var(--color-volt)_calc(80%*var(--glow-strength)),_transparent)] ring-1 ring-volt/60 transition hover:-translate-y-0.5 hover:bg-volt/10',
        )}
      >
        {flashEl}
        {top()}
        <span className="flex items-center gap-1.5 text-[11px] font-bold text-volt">
          <span className="h-1.5 w-1.5 animate-blink rounded-full bg-volt" />
          Game forming · Join
          <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
        </span>
      </Link>
    )
  }

  if (slot.status === 'available') {
    return (
      <motion.button
        type="button"
        onClick={() => onBook(slot)}
        whileHover={{ y: -3 }}
        whileTap={{ scale: 0.96 }}
        transition={{ type: 'spring', stiffness: 500, damping: 28 }}
        aria-label={`Book ${range}, ${formatINR(slot.price_paise)}${slot.is_peak ? ', peak hour' : ''}`}
        className={cn(base, 'group glass cursor-pointer transition-[border-color,box-shadow] hover:border-volt/45 hover:shadow-[0_10px_30px_-12px_color-mix(in_srgb,_var(--color-volt)_calc(45%*var(--glow-strength)),_transparent)]')}
      >
        {flashEl}
        {top()}
        <span className="flex items-center justify-between">
          {price}
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-volt text-ink-950 opacity-0 transition-all duration-200 group-hover:opacity-100 group-focus-visible:opacity-100">
            <ArrowRight className="h-3.5 w-3.5" />
          </span>
        </span>
      </motion.button>
    )
  }

  if (slot.status === 'held') {
    return (
      <div className={cn(base, 'bg-sun/[0.05] ring-1 ring-sun/40')} aria-label={`${range}: someone is checking out`}>
        {flashEl}
        <span aria-hidden className="pointer-events-none absolute inset-0 animate-pulse bg-sun/[0.06]" />
        {top()}
        <HeldLine until={slot.held_until} />
      </div>
    )
  }

  return (
    <div className={cn(base, 'bg-white/[0.02] opacity-50 ring-1 ring-white/5')} aria-label={`${range}: booked`}>
      {flashEl}
      {top(true)}
      {/* booked on Pytch or blocked by the venue (walk-in, other app, maintenance) — both read as taken */}
      <span className="text-[11px] font-semibold text-subtle">Booked</span>
    </div>
  )
}

function HeldLine({ until }: { until: string | null }) {
  const c = useCountdown(until)
  return (
    <span className="relative flex items-start gap-1.5 text-[11px] leading-tight font-semibold text-sun">
      <span className="relative mt-0.5 flex h-2 w-2 shrink-0">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-sun opacity-70" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-sun" />
      </span>
      <span className="min-w-0 flex-1">Someone's checking out</span>
      {until && !c.expired && <span className="shrink-0 font-mono text-[10px] text-sun/70">{c.label}</span>}
    </span>
  )
}

function WeatherChip({ w }: { w: HourWeather }) {
  const severe = w.precipitation_probability >= 80 || w.precipitation_mm >= 5
  return (
    <span
      title={`${Math.round(w.temperature_c)}°C · ${w.precipitation_probability}% rain`}
      className={cn(
        'inline-flex shrink-0 items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold',
        !w.is_risky ? 'bg-white/5 text-muted' : severe ? 'bg-flare/15 text-flare ring-1 ring-flare/40' : 'bg-sun/15 text-sun ring-1 ring-sun/40',
      )}
    >
      <span>{weatherEmoji(w.weather_code, w.is_risky)}</span>
      {w.precipitation_probability}%
    </span>
  )
}

export function SlotGridSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-4">
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="skeleton h-[96px] rounded-2xl" />
      ))}
    </div>
  )
}
