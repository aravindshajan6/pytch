import { Home, Sun, Users, Video } from 'lucide-react'
import { motion } from 'motion/react'
import { cn } from '@/lib/cn'
import { formatINR } from '@/lib/format'
import { SPORTS } from '@/lib/sports'
import type { Pitch } from '@/types/api'
import { alpha } from '@/lib/color'

/** Swipeable pitch cards (sport, format, indoor/outdoor, camera, price). */
export function PitchSelector({ pitches, value, onChange }: { pitches: Pitch[]; value: string | undefined; onChange: (id: string) => void }) {
  return (
    <div role="radiogroup" aria-label="Choose a pitch" className="no-scrollbar -mx-4 flex snap-x scroll-px-4 gap-3 overflow-x-auto px-4 py-1 sm:mx-0 sm:scroll-px-0 sm:px-0">
      {pitches.map((p) => {
        const active = p.id === value
        const s = SPORTS[p.sport]
        return (
          <motion.button
            key={p.id}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(p.id)}
            whileHover={{ y: -3 }}
            whileTap={{ scale: 0.97 }}
            transition={{ type: 'spring', stiffness: 450, damping: 28 }}
            className={cn(
              'relative w-[220px] shrink-0 cursor-pointer snap-start overflow-hidden rounded-2xl p-4 text-left ring-1 transition-colors',
              active ? 'bg-volt/[0.07] ring-volt/60' : 'bg-white/4 ring-white/8 hover:bg-white/7 [[data-theme=light]_&]:bg-ink-800 [[data-theme=light]_&]:shadow-card',
            )}
          >
            {active && (
              <motion.span
                layoutId="pitch-glow"
                className="pointer-events-none absolute inset-0 rounded-2xl shadow-[inset_0_0_0_1.5px_color-mix(in_srgb,_var(--color-volt)_80%,_transparent),0_0_40px_-10px_color-mix(in_srgb,_var(--color-volt)_calc(60%*var(--glow-strength)),_transparent)]"
                transition={{ type: 'spring', stiffness: 450, damping: 36 }}
              />
            )}
            <div className="flex items-center justify-between gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl text-lg" style={{ background: `${alpha(s.color, 0.1)}` }}>
                {s.emoji}
              </span>
              <div className="flex gap-1">
                {p.has_camera && (
                  <span title="Camera" className="flex h-6 w-6 items-center justify-center rounded-full bg-grape/15 text-[var(--color-grape-soft)]">
                    <Video className="h-3.5 w-3.5" />
                  </span>
                )}
                <span
                  title={p.is_indoor ? 'Indoor' : 'Outdoor'}
                  className={cn(
                    'flex h-6 w-6 items-center justify-center rounded-full',
                    p.is_indoor ? 'bg-electric/15 text-electric' : 'bg-sun/15 text-sun',
                  )}
                >
                  {p.is_indoor ? <Home className="h-3.5 w-3.5" /> : <Sun className="h-3.5 w-3.5" />}
                </span>
              </div>
            </div>
            <div className="mt-3 truncate font-semibold">{p.name}</div>
            <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted">
              {s.label} · {p.format} · <Users className="h-3 w-3" /> {p.capacity}
            </div>
            <div className="mt-3 flex items-baseline gap-2">
              <span className="font-display text-lg font-semibold">{formatINR(p.price_per_hour_paise)}</span>
              <span className="text-xs text-muted">/hr</span>
              {p.peak_price_per_hour_paise > p.price_per_hour_paise && (
                <span className="ml-auto text-[11px] whitespace-nowrap text-sun">🔥 {formatINR(p.peak_price_per_hour_paise)} peak</span>
              )}
            </div>
          </motion.button>
        )
      })}
    </div>
  )
}
