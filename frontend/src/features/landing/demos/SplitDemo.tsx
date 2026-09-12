import { Check, Lock, Timer } from 'lucide-react'
import { AnimatePresence, motion, useInView } from 'motion/react'
import { useRef } from 'react'
import { Avatar } from '@/components/ui/Avatar'
import { Chip } from '@/components/ui/Chip'
import { ProgressRing } from '@/components/ui/ProgressRing'
import { cn } from '@/lib/cn'
import { useResolvedTheme } from '@/stores/theme'
import { DEMO_PLAYERS } from '../data'
import { mmss, useLoop } from './useLoop'

const SEATS = 10
const METHODS = ['UPI', 'UPI', 'Card', 'UPI', 'Credits', 'UPI', 'Netbanking', 'UPI', 'UPI', 'Card']

/** Split payments: seats fill with avatars, ring closes, timer races, game locks. */
export function SplitDemo() {
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { amount: 0.35 })
  const t = useLoop(inView, 17, 620, 12)
  const paid = Math.min(SEATS, t)
  const confirmed = paid === SEATS
  const secsLeft = Math.max(0, 30 * 60 - 1 - t * 83)
  const last = paid > 0 ? DEMO_PLAYERS[paid - 1] : null
  // resting drop shadow: deep black on the night page, a soft ink shadow on the light one
  const rest = useResolvedTheme() === 'light' ? 'rgb(14 42 26 / 0.22)' : 'rgb(0 0 0 / 0.8)'

  return (
    <div ref={ref} className="relative mx-auto w-full max-w-md">
      <motion.div
        animate={confirmed ? { boxShadow: '0 0 0 1px color-mix(in srgb, var(--color-volt) 50%, transparent), 0 30px 80px -20px color-mix(in srgb, var(--color-volt) 45%, transparent)' } : { boxShadow: `0 0 0 1px color-mix(in srgb, var(--color-white) 6%, transparent), 0 30px 60px -30px ${rest}` }}
        transition={{ duration: 0.6 }}
        className="glass relative overflow-hidden rounded-3xl p-5 sm:p-6"
      >
        {/* header */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[11px] font-semibold tracking-wider text-muted uppercase">Thu · 7:00 PM · 7v7</div>
            <div className="mt-1 font-display text-lg leading-tight">Kaloor Arena</div>
          </div>
          <AnimatePresence mode="wait" initial={false}>
            {confirmed ? (
              <motion.span key="c" initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ opacity: 0 }}>
                <Chip tone="solid" size="md">
                  <Lock className="h-3.5 w-3.5" /> Confirmed
                </Chip>
              </motion.span>
            ) : (
              <motion.span key="s" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <Chip tone="volt" size="md" dot>
                  Split · ₹150 each
                </Chip>
              </motion.span>
            )}
          </AnimatePresence>
        </div>

        {/* ring + seats */}
        <div className="mt-6 flex items-center gap-5">
          <ProgressRing value={paid / SEATS} size={118} stroke={10}>
            {confirmed ? (
              <motion.span
                key="ok"
                initial={{ scale: 0, rotate: -40 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={{ type: 'spring', stiffness: 400, damping: 15 }}
                className="flex h-12 w-12 items-center justify-center rounded-full bg-volt text-ink-950"
              >
                <Check className="h-7 w-7" strokeWidth={3} />
              </motion.span>
            ) : (
              <motion.span key={paid} initial={{ y: 8, opacity: 0.3 }} animate={{ y: 0, opacity: 1 }} className="mb-1 font-display text-2xl leading-none">
                {paid}
                <span className="text-base text-muted">/{SEATS}</span>
              </motion.span>
            )}
            {!confirmed && <span className="text-[10px] font-semibold tracking-wider text-muted uppercase">paid</span>}
          </ProgressRing>
          <div className="grid flex-1 grid-cols-5 gap-2.5">
            {Array.from({ length: SEATS }, (_, i) => {
              const filled = i < paid
              const player = DEMO_PLAYERS[i]!
              return (
                <div key={i} className="relative flex aspect-square items-center justify-center">
                  <span className={cn('absolute inset-0 rounded-full border border-dashed transition-colors', filled ? 'border-transparent' : 'border-white/15')} />
                  {!filled && <span className="text-[9px] font-semibold text-subtle">₹150</span>}
                  <AnimatePresence>
                    {filled && (
                      <motion.span
                        key="a"
                        initial={{ scale: 0, rotate: -35 }}
                        animate={{ scale: 1, rotate: 0 }}
                        exit={{ scale: 0, opacity: 0, transition: { duration: 0.2, delay: i * 0.02 } }}
                        transition={{ type: 'spring', stiffness: 420, damping: 17 }}
                        className="absolute inset-0 flex items-center justify-center"
                      >
                        <Avatar user={player} size="sm" showVerified={false} className="h-full w-full [&>span]:h-full [&>span]:w-full" />
                      </motion.span>
                    )}
                  </AnimatePresence>
                  {i === paid - 1 && !confirmed && (
                    <span className="pointer-events-none absolute inset-0 animate-pulse-ring rounded-full ring-2 ring-volt" />
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* timer */}
        <div className="mt-6 flex items-center justify-between rounded-2xl bg-white/4 px-4 py-3 ring-1 ring-white/8">
          <div className="flex items-center gap-2 text-sm text-muted">
            <Timer className={cn('h-4 w-4', confirmed ? 'text-volt' : 'text-sun')} />
            {confirmed ? 'Slot locked — nobody fronted a rupee' : 'Everyone pays within'}
          </div>
          {!confirmed && <span className="font-mono text-lg font-semibold tabular-nums">{mmss(secsLeft)}</span>}
        </div>

        {/* payment feed */}
        <div className="relative mt-3 h-9 overflow-hidden">
          <AnimatePresence initial={false}>
            {last && !confirmed && (
              <motion.div
                key={paid}
                initial={{ y: 30, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: -30, opacity: 0 }}
                transition={{ type: 'spring', stiffness: 300, damping: 26 }}
                className="absolute inset-0 flex items-center gap-2 text-sm"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-mint" />
                <span className="font-semibold">{last.name.split(' ')[0]}</span>
                <span className="text-muted">paid ₹150 · {METHODS[paid - 1]}</span>
              </motion.div>
            )}
            {confirmed && (
              <motion.div
                key="done"
                initial={{ y: 30, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: -30, opacity: 0 }}
                className="absolute inset-0 flex items-center gap-2 text-sm text-volt"
              >
                🎉 Booking confirmed · 10 players notified
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* sheen when confirmed */}
        <AnimatePresence>
          {confirmed && (
            <motion.div
              key="sheen"
              aria-hidden
              initial={{ x: '-100%' }}
              animate={{ x: '220%' }}
              exit={{ opacity: 0 }}
              transition={{ duration: 1.1, ease: [0.16, 1, 0.3, 1] }}
              style={{ skewX: -12 }}
              className="pointer-events-none absolute inset-y-0 left-0 w-1/2 bg-gradient-to-r from-transparent via-volt/15 to-transparent"
            />
          )}
        </AnimatePresence>
      </motion.div>
      <p className="mt-4 text-center text-xs text-subtle">
        Didn’t fill in 30 minutes? Every share lands back in Pytch Credits — instantly.
      </p>
    </div>
  )
}
