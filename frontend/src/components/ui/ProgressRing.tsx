import { motion } from 'motion/react'
import { useId } from 'react'
import { alpha } from '@/lib/color'

interface ProgressRingProps {
  value: number // 0..1
  size?: number
  stroke?: number
  from?: string
  to?: string
  track?: string
  children?: React.ReactNode
}

/** Animated SVG ring with gradient stroke and centred content. */
export function ProgressRing({
  value,
  size = 160,
  stroke = 12,
  from = 'var(--color-volt)',
  to = 'var(--color-mint)',
  track = 'color-mix(in srgb, var(--color-white) 7%, transparent)',
  children,
}: ProgressRingProps) {
  const id = useId()
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const clamped = Math.min(1, Math.max(0, value))
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={from} />
            <stop offset="100%" stopColor={to} />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} stroke={track} strokeWidth={stroke} fill="none" />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={`url(#${id})`}
          strokeWidth={stroke}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: c * (1 - clamped) }}
          transition={{ type: 'spring', stiffness: 60, damping: 18 }}
          style={{ filter: `drop-shadow(0 0 10px ${alpha(from, 0.4)})` }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">{children}</div>
    </div>
  )
}

export function ProgressBar({ value, className = '', tone = 'volt' }: { value: number; className?: string; tone?: 'volt' | 'flare' | 'electric' | 'sun' }) {
  const colors = {
    volt: 'from-volt to-mint',
    flare: 'from-flare to-grape',
    electric: 'from-electric to-mint',
    sun: 'from-sun to-flare',
  }
  return (
    <div className={`h-2 w-full overflow-hidden rounded-full bg-white/8 ${className}`}>
      <motion.div
        className={`h-full rounded-full bg-gradient-to-r ${colors[tone]}`}
        initial={{ width: 0 }}
        animate={{ width: `${Math.min(100, Math.max(0, value * 100))}%` }}
        transition={{ type: 'spring', stiffness: 70, damping: 20 }}
      />
    </div>
  )
}
