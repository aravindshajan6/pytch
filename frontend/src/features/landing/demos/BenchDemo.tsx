import { Check, MapPin, Zap } from 'lucide-react'
import { AnimatePresence, motion, useInView } from 'motion/react'
import { useRef } from 'react'
import { AnimatedNumber } from '@/components/ui/AnimatedNumber'
import { Chip } from '@/components/ui/Chip'
import { useLoop } from './useLoop'

const SWEEP = 3.2
/** angle (deg, clockwise from north) + radius (0..1) — fuzzed positions, never exact locations */
const BLIPS = [
  { a: 18, r: 0.36 },
  { a: 52, r: 0.74 },
  { a: 88, r: 0.26 },
  { a: 112, r: 0.55 },
  { a: 148, r: 0.84 },
  { a: 176, r: 0.62 },
  { a: 198, r: 0.32 },
  { a: 232, r: 0.66 },
  { a: 262, r: 0.82 },
  { a: 296, r: 0.46 },
  { a: 326, r: 0.72 },
  { a: 348, r: 0.2 },
]

/** Live Bench: radar sweep with pulsing blips, then an SOS slides in at 20% off. */
export function BenchDemo() {
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { amount: 0.35 })
  const t = useLoop(inView, 7, 1500, 2)
  const phase = t === 0 || t === 6 ? 'idle' : t <= 3 ? 'sos' : 'accepted'

  return (
    <div ref={ref} className="relative mx-auto w-full max-w-md">
      <div className="glass relative overflow-hidden rounded-3xl p-5 sm:p-6">
        <div className="flex items-center justify-between">
          <Chip tone="flare" size="md" dot>
            You’re live on the bench
          </Chip>
          <span className="text-xs text-muted">auto-off in 1:48</span>
        </div>

        {/* radar */}
        <div className="relative mx-auto mt-6 aspect-square w-full max-w-[18rem]">
          <div className="absolute inset-0 rounded-full bg-[radial-gradient(circle,color-mix(in_srgb,_var(--color-flare)_10%,_transparent),transparent_70%)] ring-1 ring-flare/25" />
          {[0.33, 0.66].map((s) => (
            <div key={s} className="absolute rounded-full ring-1 ring-white/8" style={{ inset: `${(1 - s) * 50}%` }} />
          ))}
          <div className="absolute inset-y-0 left-1/2 w-px bg-white/6" />
          <div className="absolute inset-x-0 top-1/2 h-px bg-white/6" />
          <span className="absolute top-1 left-1/2 -translate-x-1/2 text-[9px] font-semibold tracking-widest text-subtle">5 KM</span>

          {inView && (
            <>
              <motion.div
                aria-hidden
                className="absolute inset-0 rounded-full"
                style={{
                  background:
                    'conic-gradient(from 0deg, transparent 0deg, transparent 270deg, color-mix(in srgb, var(--color-flare) 4%, transparent) 300deg, color-mix(in srgb, var(--color-flare) 38%, transparent) 358deg, transparent 360deg)',
                }}
                animate={{ rotate: 360 }}
                transition={{ duration: SWEEP, repeat: Infinity, ease: 'linear' }}
              >
                <span className="absolute top-0 left-1/2 h-1/2 w-px -translate-x-1/2 bg-gradient-to-b from-flare to-flare/0" />
              </motion.div>
              {BLIPS.map((b, i) => {
                const rad = (b.a * Math.PI) / 180
                return (
                  <motion.span
                    key={i}
                    className="absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-flare shadow-[0_0_12px_color-mix(in_srgb,_var(--color-flare)_90%,_transparent)]"
                    style={{ left: `${50 + b.r * 46 * Math.sin(rad)}%`, top: `${50 - b.r * 46 * Math.cos(rad)}%` }}
                    initial={{ opacity: 0.2, scale: 0.7 }}
                    animate={{ opacity: [0.2, 1, 0.2], scale: [0.7, 1.35, 0.7] }}
                    transition={{ duration: SWEEP, times: [0, 0.03, 0.7], repeat: Infinity, delay: (b.a / 360) * SWEEP, ease: 'easeOut' }}
                  />
                )
              })}
            </>
          )}

          {/* centre: the match */}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
            <span className="absolute inset-0 animate-pulse-ring rounded-full bg-volt/40" />
            <span className="relative flex h-9 w-9 items-center justify-center rounded-full bg-volt text-ink-950 shadow-glow-volt">
              <MapPin className="h-4 w-4" />
            </span>
          </div>
        </div>

        <div className="mt-5 text-center">
          <div className="font-display text-3xl">
            <AnimatedNumber value={12} /> <span className="text-base text-muted">players</span>
          </div>
          <div className="text-sm text-muted">on the bench within 5 km of your game</div>
        </div>

        {/* SOS card */}
        <AnimatePresence>
          {phase !== 'idle' && (
            <motion.div
              key="sos"
              initial={{ y: '110%', opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: '110%', opacity: 0 }}
              transition={{ type: 'spring', stiffness: 260, damping: 26 }}
              className="absolute inset-x-3 bottom-3 rounded-2xl bg-ink-800/95 p-4 shadow-glow-flare ring-1 ring-flare/40 backdrop-blur-xl sm:inset-x-4 sm:bottom-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-xs font-bold tracking-wide text-flare">🚨 SOS · 1 SPOT · 1.2 KM</div>
                  <div className="mt-1 font-semibold">Kaloor Arena · 7v7</div>
                  <div className="text-xs text-muted">Kicks off in 25 min — someone dropped</div>
                </div>
                <div className="text-right">
                  <div className="font-display text-xl">₹120</div>
                  <div className="text-xs text-muted line-through">₹150</div>
                </div>
              </div>
              <div className="mt-3 flex items-center gap-2">
                <AnimatePresence mode="wait" initial={false}>
                  {phase === 'sos' ? (
                    <motion.div key="cta" className="flex flex-1 gap-2" exit={{ opacity: 0, scale: 0.95 }}>
                      <span className="relative flex h-10 flex-1 items-center justify-center rounded-xl bg-flare text-sm font-semibold text-snow">
                        <span className="absolute inset-0 animate-pulse-ring rounded-xl ring-2 ring-flare" />
                        Accept · 20% off
                      </span>
                      <span className="flex h-10 items-center rounded-xl px-4 text-sm text-muted ring-1 ring-white/10">Pass</span>
                    </motion.div>
                  ) : (
                    <motion.div
                      key="ok"
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className="flex h-10 flex-1 items-center justify-between rounded-xl bg-mint/15 px-3 text-sm font-semibold text-mint ring-1 ring-mint/40"
                    >
                      <span className="flex items-center gap-2">
                        <Check className="h-4 w-4" /> Seat reserved · pay in 4:59
                      </span>
                      <motion.span
                        initial={{ y: 8, opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        transition={{ delay: 0.3 }}
                        className="flex items-center gap-1 text-xs text-volt"
                      >
                        <Zap className="h-3.5 w-3.5" /> +150 XP
                      </motion.span>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <p className="mt-4 text-center text-xs text-subtle">The dropout covers the 20% — no platform subsidy, no guilt trips.</p>
    </div>
  )
}
