import { motion, useMotionTemplate, useMotionValue, type HTMLMotionProps } from 'motion/react'
import { cn } from '@/lib/cn'

interface CardProps extends HTMLMotionProps<'div'> {
  /** Mouse-follow spotlight glow on hover. */
  spotlight?: boolean
  interactive?: boolean
  glow?: 'volt' | 'flare' | 'electric' | 'sun' | 'grape'
}

const GLOW: Record<NonNullable<CardProps['glow']>, string> = {
  volt: '200 255 46',
  flare: '255 61 127',
  electric: '61 217 255',
  sun: '255 176 32',
  grape: '139 92 255',
}

export function Card({ className, spotlight, interactive, glow = 'volt', children, ...props }: CardProps) {
  const x = useMotionValue(-200)
  const y = useMotionValue(-200)
  const bg = useMotionTemplate`radial-gradient(420px circle at ${x}px ${y}px, rgb(${GLOW[glow]} / 0.10), transparent 45%)`

  return (
    <motion.div
      onMouseMove={
        spotlight
          ? (e) => {
              const r = e.currentTarget.getBoundingClientRect()
              x.set(e.clientX - r.left)
              y.set(e.clientY - r.top)
            }
          : undefined
      }
      onMouseLeave={spotlight ? () => (x.set(-200), y.set(-200)) : undefined}
      whileHover={interactive ? { y: -3 } : undefined}
      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
      className={cn(
        'glass relative overflow-hidden rounded-3xl shadow-card',
        interactive && 'cursor-pointer transition-colors hover:border-white/15',
        className,
      )}
      {...props}
    >
      {spotlight && <motion.div aria-hidden className="pointer-events-none absolute inset-0" style={{ background: bg }} />}
      {children as React.ReactNode}
    </motion.div>
  )
}
