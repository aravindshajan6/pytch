import { formatInTimeZone } from 'date-fns-tz'
import { motion } from 'motion/react'
import { useEffect, useMemo, useRef } from 'react'
import { cn } from '@/lib/cn'
import { TZ, istDate } from '@/lib/format'

interface Day {
  date: string
  top: string
  num: string
  month: string
}

function buildDays(n: number): Day[] {
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.now() + i * 86400000)
    return {
      date: istDate(i),
      top: i === 0 ? 'Today' : i === 1 ? 'Tmrw' : formatInTimeZone(d, TZ, 'EEE'),
      num: formatInTimeZone(d, TZ, 'd'),
      month: formatInTimeZone(d, TZ, 'MMM'),
    }
  })
}

/** Horizontal, snap-scrolling 14-day picker with a springy selected pill. */
export function DateStrip({ value, onChange, days = 14 }: { value: string; onChange: (d: string) => void; days?: number }) {
  const list = useMemo(() => buildDays(days), [days])
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const c = ref.current
    const el = c?.querySelector<HTMLElement>(`[data-date="${value}"]`)
    if (!c || !el) return
    // scroll only the strip horizontally (scrollIntoView would also jump the page)
    c.scrollTo({ left: el.offsetLeft - c.clientWidth / 2 + el.clientWidth / 2, behavior: 'smooth' })
    if (c.contains(document.activeElement)) el.focus({ preventScroll: true })
  }, [value])

  return (
    <div
      ref={ref}
      role="radiogroup"
      aria-label="Pick a day"
      className="no-scrollbar relative -mx-4 flex snap-x snap-mandatory scroll-px-4 gap-2 overflow-x-auto px-4 py-1 sm:mx-0 sm:scroll-px-0 sm:px-0"
      onKeyDown={(e) => {
        const i = list.findIndex((d) => d.date === value)
        if (e.key === 'ArrowRight' && i < list.length - 1) onChange(list[i + 1]!.date)
        if (e.key === 'ArrowLeft' && i > 0) onChange(list[i - 1]!.date)
      }}
    >
      {list.map((d, i) => {
        const active = d.date === value
        const showMonth = i === 0 || d.num === '1'
        return (
          <button
            key={d.date}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            data-date={d.date}
            onClick={() => onChange(d.date)}
            className={cn(
              'relative flex h-[76px] w-16 shrink-0 cursor-pointer snap-start flex-col items-center justify-center rounded-2xl transition-colors',
              active ? 'text-ink-950' : 'bg-white/4 text-fg/80 ring-1 ring-white/8 hover:bg-white/8 [[data-theme=light]_&]:bg-ink-800 [[data-theme=light]_&]:shadow-card',
            )}
          >
            {active && (
              <motion.span
                layoutId="date-pill"
                className="absolute inset-0 rounded-2xl bg-volt shadow-glow-volt"
                transition={{ type: 'spring', stiffness: 520, damping: 34 }}
              />
            )}
            <span className={cn('relative text-[10px] font-bold tracking-wider uppercase', active ? 'text-ink-950/70' : 'text-muted')}>
              {d.top}
            </span>
            <span className="relative font-display text-xl leading-tight font-semibold">{d.num}</span>
            <span className={cn('relative text-[10px] font-medium', active ? 'text-ink-950/70' : 'text-subtle', !showMonth && !active && 'opacity-0')}>
              {d.month}
            </span>
          </button>
        )
      })}
    </div>
  )
}
