import { animate, stagger } from 'animejs'
import { CalendarPlus } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '@/components/ui/Button'
import { celebrate } from '@/lib/celebrate'
import { formatWhen } from '@/lib/format'
import type { LobbyDetail } from '@/types/api'
import { downloadIcs } from '../lib'

const WORDS = ['MATCH', 'ON']

/** The squad status under the stamp — only ever what's true right now. */
function squadLine(l: LobbyDetail): string {
  if (l.paid_spots >= l.total_spots) return `${l.total_spots} players, fully paid`
  // full mode: the host paid the whole pitch, seats keep filling after confirmation
  if (l.mode === 'full') return `Pitch secured · ${l.filled_spots}/${l.total_spots} in`
  return `${l.paid_spots}/${l.total_spots} paid`
}

/** Full-screen one-time celebration when a lobby flips to confirmed. */
export function MatchOnOverlay({ open, lobby, onClose }: { open: boolean; lobby: LobbyDetail; onClose: () => void }) {
  return createPortal(
    <AnimatePresence>{open && <Overlay lobby={lobby} onClose={onClose} />}</AnimatePresence>,
    document.body,
  )
}

function Overlay({ lobby, onClose }: { lobby: LobbyDetail; onClose: () => void }) {
  const stampRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    celebrate()
    const t = setTimeout(celebrate, 900)
    closeRef.current?.focus()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const letters = stampRef.current?.querySelectorAll('.stamp-letter')
    const anim =
      letters && !reduced
        ? animate(letters, {
            // explicit `to` values: StrictMode re-runs this effect, so never tween "to current"
            translateY: { from: -120, to: 0 },
            rotate: { from: () => (Math.random() - 0.5) * 60, to: 0 },
            scale: { from: 2.2, to: 1 },
            opacity: { from: 0, to: 1 },
            delay: stagger(55, { start: 220 }),
            duration: 900,
            ease: 'outElastic(1, .55)',
          })
        : null
    return () => {
      clearTimeout(t)
      anim?.pause()
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  return (
    <motion.div
      role="dialog"
      aria-modal
      aria-label="Match confirmed"
      className="fixed inset-0 z-[1100] flex items-center justify-center overflow-hidden px-6"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.3 } }}
    >
      <div className="absolute inset-0 bg-ink-950/85 backdrop-blur-md" onClick={onClose} />
      <div aria-hidden className="pitch-grid absolute inset-0 opacity-50 [mask-image:radial-gradient(circle,black,transparent_65%)]" />
      {/* shockwaves */}
      {[0, 0.25, 0.5].map((d) => (
        <motion.span
          key={d}
          aria-hidden
          className="absolute h-64 w-64 rounded-full ring-2 ring-volt/60"
          initial={{ scale: 0.2, opacity: 0.9 }}
          animate={{ scale: 4, opacity: 0 }}
          transition={{ duration: 1.6, delay: 0.35 + d, ease: [0.16, 1, 0.3, 1] }}
        />
      ))}
      <div aria-hidden className="absolute h-[420px] w-[420px] rounded-full bg-volt/15 opacity-[var(--glow-strength)] blur-[100px]" />

      <div className="relative flex flex-col items-center text-center">
        <motion.div
          ref={stampRef}
          initial={{ scale: 2.4, rotate: -22, opacity: 0 }}
          animate={{ scale: 1, rotate: -7, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 240, damping: 13, delay: 0.1 }}
          // light: a crisp ink stamp on paper-white; dark: the neon floodlit stamp
          className="rounded-[2rem] border-[5px] border-volt px-6 py-3 shadow-[0_0_0_6px_color-mix(in_srgb,_var(--color-volt)_12%,_transparent),0_0_80px_color-mix(in_srgb,_var(--color-volt)_calc(45%*var(--glow-strength)),_transparent)] sm:px-10 sm:py-5 [[data-theme=light]_&]:bg-snow"
        >
          <div className="flex flex-wrap items-center justify-center gap-x-4 font-display text-5xl leading-none font-black tracking-tight text-volt sm:text-8xl">
            {WORDS.map((w) => (
              <span key={w} className="inline-flex">
                {w.split('').map((ch, i) => (
                  <span key={i} className="stamp-letter inline-block">
                    {ch}
                  </span>
                ))}
              </span>
            ))}
          </div>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.9, duration: 0.5 }} className="mt-10">
          <p className="text-lg font-semibold sm:text-xl">{lobby.title} is locked in.</p>
          <p className="mt-1 text-sm text-muted">
            {formatWhen(lobby.start_at)} · {lobby.turf.name} · {squadLine(lobby)}
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button variant="secondary" size="lg" onClick={() => downloadIcs(lobby)}>
              <CalendarPlus className="h-5 w-5" /> Add to calendar
            </Button>
            <Button ref={closeRef} size="lg" onClick={onClose}>
              Let's go ⚡
            </Button>
          </div>
        </motion.div>
      </div>
    </motion.div>
  )
}
