import { Heart, Pin, Scissors } from 'lucide-react'
import { AnimatePresence, motion, useInView } from 'motion/react'
import { useRef } from 'react'
import { TurfArt } from '@/components/ui/TurfArt'
import { useLoop } from './useLoop'

const FRAMES = Array.from({ length: 10 }, (_, i) => `frame-${i * 7 + 3}`)
const TEAM_A = [
  { x: [22, 30, 26, 34], y: [30, 40, 52, 44] },
  { x: [40, 46, 52, 48], y: [62, 50, 58, 66] },
  { x: [55, 62, 70, 66], y: [34, 30, 40, 36] },
  { x: [70, 78, 84, 80], y: [58, 52, 48, 56] },
]
const TEAM_B = [
  { x: [80, 74, 78, 84], y: [30, 36, 28, 34] },
  { x: [62, 56, 64, 70], y: [70, 64, 60, 68] },
  { x: [45, 40, 38, 44], y: [42, 36, 46, 40] },
  { x: [88, 90, 88, 86], y: [46, 50, 52, 48] },
]

/** Highlight reels: live turf-cam frame, filmstrip, range handles snapping to a 12s clip, pin + likes. */
export function HighlightsDemo() {
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { amount: 0.35 })
  const t = useLoop(inView, 5, 1700, 3)
  const trimmed = t >= 1
  const saved = t >= 2
  const sel = trimmed ? { l: 38, r: 58 } : { l: 6, r: 94 }

  return (
    <div ref={ref} className="relative mx-auto w-full max-w-md">
      <div className="glass overflow-hidden rounded-3xl p-3 sm:p-4">
        {/* camera feed (dark island: footage + overlays read the same in both themes) */}
        <div data-theme="dark" className="relative aspect-video overflow-hidden rounded-2xl">
          <TurfArt seed="kaloor-cam-2" className="absolute inset-0" />
          {inView && (
            <div aria-hidden className="absolute inset-0">
              {[...TEAM_A.map((p) => ({ ...p, c: 'bg-volt' })), ...TEAM_B.map((p) => ({ ...p, c: 'bg-electric' }))].map((p, i) => (
                <motion.span
                  key={i}
                  className={`absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full ${p.c} shadow-[0_0_8px_currentColor]`}
                  animate={{ left: p.x.map((v) => `${v}%`), top: p.y.map((v) => `${v}%`) }}
                  transition={{ duration: 4, repeat: Infinity, repeatType: 'mirror', ease: 'easeInOut', delay: i * 0.1 }}
                />
              ))}
              <motion.span
                className="absolute h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-snow shadow-[0_0_10px_white]"
                animate={{ left: ['30%', '47%', '60%', '78%', '95%'], top: ['58%', '44%', '56%', '42%', '50%'] }}
                transition={{ duration: 3, repeat: Infinity, repeatDelay: 1, ease: 'easeInOut' }}
              />
              <motion.span
                className="absolute top-1/2 right-6 -translate-y-1/2 font-display text-2xl font-black text-volt drop-shadow-[0_0_14px_color-mix(in_srgb,_var(--color-volt)_80%,_transparent)]"
                animate={{ opacity: [0, 0, 1, 0], scale: [0.6, 0.6, 1.15, 1.3] }}
                transition={{ duration: 4, times: [0, 0.72, 0.8, 1], repeat: Infinity }}
              >
                GOAL!
              </motion.span>
            </div>
          )}
          <div className="absolute top-3 left-3 flex items-center gap-1.5 rounded-md bg-ink-950/70 px-2 py-1 text-[10px] font-bold tracking-wider backdrop-blur">
            <span className="h-1.5 w-1.5 animate-blink rounded-full bg-flare" /> REC · CAM 2
          </div>
          <div className="absolute right-3 bottom-3 rounded-md bg-ink-950/70 px-2 py-1 font-mono text-[10px] backdrop-blur">
            Kaloor Arena · 7v7
          </div>
        </div>

        {/* filmstrip + trimmer */}
        <div data-theme="dark" className="relative mt-3 h-14 overflow-hidden rounded-xl">
          <div className="absolute inset-0 flex">
            {FRAMES.map((f) => (
              <TurfArt key={f} seed={f} className="h-full flex-1 border-r border-ink-900/80" />
            ))}
          </div>
          {/* dimmed outside of the selection */}
          <motion.div className="absolute inset-y-0 left-0 bg-ink-950/70" animate={{ width: `${sel.l}%` }} transition={{ type: 'spring', stiffness: 120, damping: 20 }} />
          <motion.div className="absolute inset-y-0 right-0 bg-ink-950/70" animate={{ width: `${100 - sel.r}%` }} transition={{ type: 'spring', stiffness: 120, damping: 20 }} />
          <motion.div
            className="absolute inset-y-0 rounded-lg ring-2 ring-volt"
            animate={{ left: `${sel.l}%`, right: `${100 - sel.r}%` }}
            transition={{ type: 'spring', stiffness: 120, damping: 20 }}
          >
            <span className="absolute inset-y-0 -left-1.5 flex w-3 items-center justify-center rounded-l-md bg-volt">
              <span className="h-5 w-0.5 rounded bg-ink-950/60" />
            </span>
            <span className="absolute inset-y-0 -right-1.5 flex w-3 items-center justify-center rounded-r-md bg-volt">
              <span className="h-5 w-0.5 rounded bg-ink-950/60" />
            </span>
            {trimmed && inView && (
              <motion.span
                className="absolute inset-y-1 w-0.5 rounded bg-snow shadow-[0_0_8px_white]"
                initial={{ left: '4%' }}
                animate={{ left: ['4%', '96%'] }}
                transition={{ duration: 1.6, repeat: Infinity, ease: 'linear' }}
              />
            )}
          </motion.div>
        </div>

        <div className="mt-3 flex items-center justify-between gap-3 px-1">
          <div className="flex items-center gap-2 text-sm">
            <Scissors className="h-4 w-4 text-volt" />
            <AnimatePresence mode="wait" initial={false}>
              <motion.span key={trimmed ? 'a' : 'b'} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} className="font-mono">
                {trimmed ? '42:10 → 42:22 · 12s' : 'Drag to trim · max 60s'}
              </motion.span>
            </AnimatePresence>
          </div>
          <motion.span
            key={saved ? 'liked' : 'idle'}
            animate={saved ? { scale: [1, 1.35, 1] } : { scale: 1 }}
            className="flex items-center gap-1 text-sm text-flare"
          >
            <Heart className={`h-4 w-4 ${saved ? 'fill-current' : ''}`} /> {saved ? 134 : 128}
          </motion.span>
        </div>

        <AnimatePresence>
          {saved && (
            <motion.div
              initial={{ opacity: 0, y: 12, height: 0 }}
              animate={{ opacity: 1, y: 0, height: 'auto' }}
              exit={{ opacity: 0, y: 12, height: 0 }}
              transition={{ type: 'spring', stiffness: 260, damping: 26 }}
              className="overflow-hidden"
            >
              <div className="mt-3 flex items-center gap-2 rounded-xl bg-electric/12 px-3 py-2.5 text-sm text-electric ring-1 ring-electric/30">
                <Pin className="h-4 w-4" /> “Top-bins volley” saved · pinned to your profile · +20 XP
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <p className="mt-4 text-center text-xs text-subtle">Recorded match? Add the turf camera at checkout — split with everyone.</p>
    </div>
  )
}
