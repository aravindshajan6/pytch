import { CloudRain, Home, ShieldCheck, Umbrella } from 'lucide-react'
import { AnimatePresence, motion, useInView } from 'motion/react'
import { useMemo, useRef } from 'react'
import { AvatarStack } from '@/components/ui/Avatar'
import { Chip } from '@/components/ui/Chip'
import { TurfArt } from '@/components/ui/TurfArt'
import { mulberry32 } from '@/components/three/random'
import { DEMO_PLAYERS } from '../data'
import { useLoop } from './useLoop'

/** Weather-smart: rain lashes an outdoor pitch → one-tap transfer → indoor venue, ₹0 extra. */
export function WeatherDemo() {
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { amount: 0.35 })
  const t = useLoop(inView, 7, 1600, 5)
  const phase: 'rain' | 'alert' | 'moved' = t <= 1 ? 'rain' : t === 2 ? 'alert' : 'moved'

  const drops = useMemo(() => {
    const rnd = mulberry32(11)
    return Array.from({ length: 46 }, () => ({
      left: rnd() * 110 - 5,
      delay: rnd() * 1.2,
      dur: 0.55 + rnd() * 0.4,
      len: 18 + rnd() * 22,
      op: 0.3 + rnd() * 0.5,
    }))
  }, [])

  return (
    <div ref={ref} className="relative mx-auto w-full max-w-md">
      <div className="relative h-[23rem]" style={{ perspective: 1400 }}>
        {/* no initial={false} here: it would freeze every looping animation nested inside */}
        <AnimatePresence mode="wait">
          {phase !== 'moved' ? (
            <motion.div
              key="outdoor"
              initial={{ rotateX: 80, opacity: 0 }}
              animate={{ rotateX: 0, opacity: 1 }}
              exit={{ rotateX: -80, opacity: 0, transition: { duration: 0.45, ease: [0.7, 0, 0.84, 0] } }}
              transition={{ type: 'spring', stiffness: 140, damping: 20 }}
              // media panel: stays a dark island in light mode (stormy pitch + overlaid copy)
              data-theme="dark"
              className="absolute inset-0 origin-center overflow-hidden rounded-3xl ring-1 ring-white/10 [[data-theme=light]_&]:shadow-[0_30px_60px_-30px_rgb(14_42_26/0.45)]"
            >
              <TurfArt seed="marine-drive-open" className="absolute inset-0" />
              <div className="absolute inset-0 bg-gradient-to-b from-[#0a1020]/80 via-ink-950/40 to-ink-950/85" />
              {/* rain */}
              {inView && (
                <div aria-hidden className="absolute inset-0 overflow-hidden" style={{ transform: 'skewX(-14deg)' }}>
                  {drops.map((d, i) => (
                    <motion.span
                      key={i}
                      className="absolute top-0 w-[1.5px] rounded-full bg-gradient-to-b from-transparent to-[#dff3ff]"
                      style={{ left: `${d.left}%`, height: d.len, opacity: d.op }}
                      animate={{ y: [-40, 420] }}
                      transition={{ duration: d.dur, delay: d.delay, repeat: Infinity, ease: 'linear' }}
                    />
                  ))}
                </div>
              )}
              {inView && (
                <motion.div
                  aria-hidden
                  className="absolute inset-0 bg-snow"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: [0, 0, 0.35, 0, 0.18, 0] }}
                  transition={{ duration: 3.2, times: [0, 0.6, 0.63, 0.68, 0.71, 0.78], repeat: Infinity }}
                />
              )}
              <div className="absolute inset-x-4 top-4 flex items-center justify-between">
                <Chip tone="neutral" size="md">
                  Outdoor · 5v5
                </Chip>
                <Chip tone="sun" size="md" dot>
                  <CloudRain className="h-3.5 w-3.5" /> 85% rain · 7 PM
                </Chip>
              </div>
              <div className="absolute inset-x-5 bottom-5">
                <div className="font-display text-xl">Marine Drive Turf</div>
                <div className="text-sm text-fg/70">Tonight · 7:00 PM · 10 players</div>
              </div>

              <AnimatePresence>
                {phase === 'alert' && (
                  <motion.div
                    key="alert"
                    initial={{ y: '100%' }}
                    animate={{ y: 0 }}
                    exit={{ y: '100%' }}
                    transition={{ type: 'spring', stiffness: 260, damping: 28 }}
                    className="glass-strong absolute inset-x-2 bottom-2 rounded-2xl p-4"
                  >
                    <div className="flex items-center gap-2 text-sm font-semibold text-sun">
                      <Umbrella className="h-4 w-4" /> Heavy rain likely (85%) during your 7 PM game
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <span className="relative flex h-10 items-center justify-center gap-1.5 rounded-xl bg-volt text-sm font-semibold text-ink-950">
                        <span className="absolute inset-0 animate-pulse-ring rounded-xl ring-2 ring-volt" />
                        <Home className="h-4 w-4" /> Move indoors
                      </span>
                      <span className="flex h-10 items-center justify-center rounded-xl text-xs text-fg/80 ring-1 ring-white/12">
                        Rain-check · refund + ₹25
                      </span>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          ) : (
            <motion.div
              key="indoor"
              initial={{ rotateX: 80, opacity: 0 }}
              animate={{ rotateX: 0, opacity: 1 }}
              exit={{ rotateX: -80, opacity: 0, transition: { duration: 0.4 } }}
              transition={{ type: 'spring', stiffness: 140, damping: 20 }}
              data-theme="dark"
              className="absolute inset-0 overflow-hidden rounded-3xl shadow-[0_30px_80px_-30px_color-mix(in_srgb,_var(--color-mint)_50%,_transparent)] ring-1 ring-mint/40 [[data-theme=light]_&]:shadow-[0_30px_70px_-30px_rgb(4_120_87/0.55)]"
            >
              <TurfArt seed="kadavanthra-dome" className="absolute inset-0" />
              {/* roof trusses */}
              <svg aria-hidden className="absolute inset-0 h-full w-full" viewBox="0 0 400 300" preserveAspectRatio="none" fill="none">
                {[0, 1, 2, 3, 4].map((i) => (
                  <path key={i} d={`M${-20 + i * 110} 0 Q ${35 + i * 110} 70 ${90 + i * 110} 0`} stroke="color-mix(in srgb, var(--color-white) 12%, transparent)" strokeWidth="2" />
                ))}
                <line x1="0" y1="4" x2="400" y2="4" stroke="color-mix(in srgb, var(--color-white) 15%, transparent)" strokeWidth="3" />
              </svg>
              <div className="absolute inset-0 bg-gradient-to-b from-transparent via-ink-950/30 to-ink-950/90" />
              <div className="absolute inset-x-4 top-4 flex items-center justify-between">
                <Chip tone="electric" size="md">
                  Indoor · 5v5 · 2.1 km
                </Chip>
                <Chip tone="neutral" size="md">
                  ☀️ Dry
                </Chip>
              </div>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <svg viewBox="0 0 52 52" className="h-16 w-16">
                  <motion.circle
                    cx="26"
                    cy="26"
                    r="24"
                    fill="color-mix(in srgb, var(--color-mint) 15%, transparent)"
                    stroke="var(--color-mint)"
                    strokeWidth="2.5"
                    initial={{ pathLength: 0 }}
                    animate={{ pathLength: 1 }}
                    transition={{ duration: 0.6 }}
                  />
                  <motion.path
                    d="M15 27 l8 8 l15 -17"
                    fill="none"
                    stroke="var(--color-mint)"
                    strokeWidth="4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    initial={{ pathLength: 0 }}
                    animate={{ pathLength: 1 }}
                    transition={{ duration: 0.4, delay: 0.45 }}
                  />
                </svg>
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.6 }}
                  className="mt-3 rounded-full bg-mint px-4 py-1.5 font-display text-sm text-ink-950 shadow-[0_0_30px_color-mix(in_srgb,_var(--color-mint)_60%,_transparent)]"
                >
                  Moved indoors · ₹0 extra
                </motion.div>
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.9 }}
                  className="mt-2 flex items-center gap-1.5 text-xs text-fg/75"
                >
                  <ShieldCheck className="h-3.5 w-3.5 text-mint" /> Pytch covered the ₹120 difference
                </motion.div>
              </div>
              <div className="absolute inset-x-5 bottom-5 flex items-end justify-between">
                <div>
                  <div className="font-display text-xl">Kadavanthra Dome</div>
                  <div className="text-sm text-fg/70">Tonight · 7:00 PM · same squad</div>
                </div>
                <motion.div initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 1.1 }} className="text-right">
                  <AvatarStack users={DEMO_PLAYERS.slice(2, 6)} size="xs" total={10} />
                  <div className="mt-1 text-[10px] text-muted">everyone notified</div>
                </motion.div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <p className="mt-4 text-center text-xs text-subtle">Rain guarantee: indoor moves covered up to ₹200. Or rain-check for 100% credits + ₹25.</p>
    </div>
  )
}
