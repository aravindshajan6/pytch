import { motion, useReducedMotion } from 'motion/react'
import { useId, useMemo } from 'react'
import { AnimatedNumber } from '@/components/ui/AnimatedNumber'
import { formatDateLong } from '@/lib/format'
import { TIERS } from '@/lib/sports'
import type { Tier } from '@/types/api'

const CX = 120
const CY = 124
const R = 98

const polar = (v: number, r = R) => {
  const a = Math.PI * (1 - v / 100)
  return { x: CX + r * Math.cos(a), y: CY - r * Math.sin(a) }
}

/** Speedometer-style True Skill gauge (0–100) with tier thresholds and a sprung needle. */
export function TrueSkillGauge({ value, tier }: { value: number | null; tier: Tier }) {
  const id = useId()
  const reduce = useReducedMotion()
  const v = value == null ? 0 : Math.min(100, Math.max(0, value))
  const arc = `M ${CX - R} ${CY} A ${R} ${R} 0 0 1 ${CX + R} ${CY}`

  return (
    <div className="relative mx-auto w-full max-w-[280px]">
      <svg viewBox="0 0 240 134" className="w-full" role="img" aria-label={`True Skill ${value == null ? 'not yet rated' : Math.round(v)} out of 100`}>
        <defs>
          <linearGradient id={`${id}-g`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="var(--color-electric)" />
            <stop offset="55%" stopColor="var(--color-volt)" />
            <stop offset="100%" stopColor="var(--color-grape)" />
          </linearGradient>
        </defs>
        <path d={arc} fill="none" stroke="color-mix(in srgb, var(--color-white) 7%, transparent)" strokeWidth="14" strokeLinecap="round" />
        {value != null && (
          <motion.path
            d={arc}
            fill="none"
            stroke={`url(#${id}-g)`}
            strokeWidth="14"
            strokeLinecap="round"
            initial={{ pathLength: reduce ? v / 100 : 0 }}
            animate={{ pathLength: Math.max(0.001, v / 100) }}
            transition={{ type: 'spring', stiffness: 40, damping: 14 }}
            style={{ filter: 'drop-shadow(0 0 8px color-mix(in srgb, var(--color-volt) 35%, transparent))' }}
          />
        )}
        {[{ at: 55 }, { at: 70 }].map((t) => {
          const a = polar(t.at, R - 13)
          const b = polar(t.at, R + 11)
          const l = polar(t.at, R + 21)
          return (
            <g key={t.at}>
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="color-mix(in srgb, var(--color-white) 45%, transparent)" strokeWidth="1.5" />
              <text x={l.x} y={l.y} fontSize="7" fill="color-mix(in srgb, var(--color-white) 45%, transparent)" textAnchor="middle" fontFamily="JetBrains Mono Variable, monospace">
                {t.at}
              </text>
            </g>
          )
        })}
        {value != null && (
          <motion.g
            initial={{ rotate: reduce ? -90 + 1.8 * v : -90 }}
            animate={{ rotate: -90 + 1.8 * v }}
            transition={{ type: 'spring', stiffness: 60, damping: 9 }}
            style={{ transformBox: 'fill-box', originX: 0.5, originY: 0.5 }}
          >
            {/* invisible disc centres the group's bbox on the pivot so it rotates around (CX, CY) */}
            <circle cx={CX} cy={CY} r={R - 22} fill="none" stroke="none" />
            <line x1={CX} y1={CY} x2={CX} y2={CY - R + 22} stroke="var(--color-fg)" strokeWidth="2.5" strokeLinecap="round" />
            <circle cx={CX} cy={CY - R + 22} r="3.5" fill="var(--color-volt)" style={{ filter: 'drop-shadow(0 0 6px var(--color-volt))' }} />
          </motion.g>
        )}
        <circle cx={CX} cy={CY} r="6" style={{ fill: 'var(--color-ink-700)' }} stroke="color-mix(in srgb, var(--color-white) 30%, transparent)" />
      </svg>
      <div className="-mt-1 text-center leading-none">
        {value == null ? (
          <div className="font-display text-3xl font-bold text-muted">NEW</div>
        ) : (
          <AnimatedNumber value={v} className="font-display text-4xl font-bold" />
        )}
      </div>
      <div className="mt-1.5 text-center text-xs font-semibold tracking-[0.2em] uppercase" style={{ color: TIERS[tier].color }}>
        {TIERS[tier].label}
      </div>
    </div>
  )
}

// Catmull-Rom → cubic bezier for a smooth line through all points.
function smoothPath(pts: { x: number; y: number }[]) {
  if (pts.length < 2) return ''
  let d = `M ${pts[0]!.x} ${pts[0]!.y}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i]!
    const p1 = pts[i]!
    const p2 = pts[i + 1]!
    const p3 = pts[i + 2] ?? p2
    const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 }
    const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 }
    d += ` C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${p2.x} ${p2.y}`
  }
  return d
}

/** True Skill history sparkline with animated draw and area glow. */
export function SkillSparkline({ history }: { history: { date: string; true_skill: number }[] }) {
  const id = useId()
  const reduce = useReducedMotion()
  const W = 300
  const H = 92
  const P = 8

  const geo = useMemo(() => {
    if (history.length < 2) return null
    const vals = history.map((h) => h.true_skill)
    const lo = Math.max(0, Math.min(...vals) - 4)
    const hi = Math.min(100, Math.max(...vals) + 4)
    const span = Math.max(1, hi - lo)
    const pts = history.map((h, i) => ({
      x: P + (i / (history.length - 1)) * (W - P * 2),
      y: P + (1 - (h.true_skill - lo) / span) * (H - P * 2),
    }))
    const line = smoothPath(pts)
    const last = pts[pts.length - 1]!
    return { line, area: `${line} L ${last.x} ${H} L ${pts[0]!.x} ${H} Z`, last }
  }, [history])

  if (!geo)
    return (
      <div className="flex h-24 items-center justify-center rounded-2xl border border-dashed border-white/10 text-xs text-subtle">
        Your trend line appears after a couple of rated matches
      </div>
    )

  const first = history[0]!
  const lastVal = history[history.length - 1]!.true_skill
  const delta = lastVal - first.true_skill

  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between text-xs">
        <span className="text-muted">Since {formatDateLong(first.date)}</span>
        <span className={delta >= 0 ? 'font-semibold text-volt' : 'font-semibold text-flare'}>
          {delta >= 0 ? '▲' : '▼'} {Math.abs(delta).toFixed(1)}
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" aria-label="True Skill history">
        <defs>
          <linearGradient id={`${id}-a`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-volt)" stopOpacity="0.28" />
            <stop offset="100%" stopColor="var(--color-volt)" stopOpacity="0" />
          </linearGradient>
          <linearGradient id={`${id}-l`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="var(--color-electric)" />
            <stop offset="100%" stopColor="var(--color-volt)" />
          </linearGradient>
        </defs>
        <motion.path
          d={geo.area}
          fill={`url(#${id}-a)`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: reduce ? 0 : 0.9, duration: 0.6 }}
        />
        <motion.path
          d={geo.line}
          fill="none"
          stroke={`url(#${id}-l)`}
          strokeWidth="2.5"
          strokeLinecap="round"
          initial={{ pathLength: reduce ? 1 : 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 1.3, ease: [0.16, 1, 0.3, 1] }}
        />
        <motion.circle
          cx={geo.last.x}
          cy={geo.last.y}
          r="4"
          fill="var(--color-volt)"
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ delay: reduce ? 0 : 1.2, type: 'spring', stiffness: 400, damping: 14 }}
          style={{ filter: 'drop-shadow(0 0 6px var(--color-volt))' }}
        />
        {!reduce && (
          <motion.circle
            cx={geo.last.x}
            cy={geo.last.y}
            r="4"
            fill="none"
            stroke="var(--color-volt)"
            initial={{ scale: 1, opacity: 0.8 }}
            animate={{ scale: 3, opacity: 0 }}
            transition={{ repeat: Infinity, duration: 1.8, delay: 1.3 }}
            style={{ transformBox: 'fill-box', originX: 0.5, originY: 0.5 }}
          />
        )}
      </svg>
    </div>
  )
}
