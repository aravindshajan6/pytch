import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef } from 'react'
import { useCountdown } from '@/hooks/useCountdown'
import { cn } from '@/lib/cn'

const glyphWidth = (ch: string) => (ch === ':' ? '0.45em' : ch === ' ' ? '0.3em' : '0.62em')

/** Split-flap style ticking countdown ("12:04", or "5d 11h" when far out). Turns flare-red under `urgentMs`. */
export function Countdown({
  to,
  className,
  urgentMs = 5 * 60 * 1000,
  onExpire,
}: {
  to: string | null | undefined
  className?: string
  urgentMs?: number
  onExpire?: () => void
}) {
  const c = useCountdown(to)
  const urgent = c.totalMs > 0 && c.totalMs < urgentMs
  const expireRef = useRef(onExpire)
  expireRef.current = onExpire
  useEffect(() => {
    if (c.expired) expireRef.current?.()
  }, [c.expired])
  return (
    <span role="timer" aria-label={c.label} className={cn('inline-flex font-mono tabular-nums', urgent ? 'text-flare' : 'text-fg', className)}>
      {c.label.split('').map((ch, i) => (
        <span key={i} aria-hidden className="relative inline-block overflow-hidden" style={{ width: glyphWidth(ch) }}>
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={ch + i}
              className="inline-block w-full text-center"
              initial={{ y: '-100%', opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: '100%', opacity: 0 }}
              transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            >
              {ch}
            </motion.span>
          </AnimatePresence>
        </span>
      ))}
    </span>
  )
}
