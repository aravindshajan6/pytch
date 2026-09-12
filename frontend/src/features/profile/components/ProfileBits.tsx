import { Check, Circle } from 'lucide-react'
import { motion, useReducedMotion } from 'motion/react'
import { AnimatedNumber } from '@/components/ui/AnimatedNumber'
import { ProgressRing } from '@/components/ui/ProgressRing'
import { cn } from '@/lib/cn'
import type { GamificationMe, TagCount, VerifiedCriterion } from '@/types/api'
import { alpha, tokens } from '@/lib/color'

/** Level + XP progress bar. */
export function XpBar({ g }: { g: GamificationMe }) {
  const into = Math.max(0, g.xp - g.level_xp_start)
  const need = Math.max(1, g.next_level_xp - g.level_xp_start)
  return (
    <div className="flex items-center gap-4">
      <div className="relative flex h-16 w-16 shrink-0 items-center justify-center">
        <svg viewBox="0 0 64 64" className="absolute inset-0 h-full w-full" aria-hidden>
          <polygon points="32,3 58,17.5 58,46.5 32,61 6,46.5 6,17.5" fill="color-mix(in srgb, var(--color-volt) 12%, transparent)" stroke="var(--color-volt)" strokeWidth="2" />
        </svg>
        <div className="relative text-center leading-none">
          <div className="text-[8px] font-bold tracking-widest text-muted">LVL</div>
          <div className="font-display text-xl font-bold text-volt">{g.level}</div>
        </div>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-sm font-semibold">
            <AnimatedNumber value={g.xp} /> XP
          </span>
          <span className="text-xs text-muted">
            {(need - into).toLocaleString('en-IN')} to level {g.level + 1}
          </span>
        </div>
        <div className="relative mt-2 h-3 overflow-hidden rounded-full bg-white/8">
          <motion.div
            className="relative h-full overflow-hidden rounded-full bg-gradient-to-r from-volt to-mint"
            initial={{ width: 0 }}
            animate={{ width: `${Math.min(100, Math.max(2, g.progress * 100))}%` }}
            transition={{ type: 'spring', stiffness: 60, damping: 18 }}
          >
            <span className="absolute inset-0 bg-[linear-gradient(90deg,transparent,color-mix(in_srgb,_var(--color-snow)_45%,_transparent),transparent)] bg-[length:200%_100%] animate-shimmer" />
          </motion.div>
        </div>
        <div className="mt-1.5 text-[11px] text-subtle">
          <span className="font-semibold text-volt">+{g.weekly_xp.toLocaleString('en-IN')}</span> this week
        </div>
      </div>
    </div>
  )
}

/** Weekly streak flame — flickers when alive, grey when not. */
export function StreakFlame({ weeks }: { weeks: number }) {
  const reduce = useReducedMotion()
  const live = weeks > 0
  return (
    <div className="flex items-center gap-3">
      <div className="relative flex h-14 w-14 items-center justify-center">
        {live && <span aria-hidden className="absolute inset-1 rounded-full bg-sun/30 blur-xl" />}
        <motion.span
          className={cn('relative text-4xl', !live && 'opacity-40 grayscale')}
          animate={live && !reduce ? { scale: [1, 1.12, 0.96, 1.08, 1], rotate: [-3, 3, -2, 2, 0], y: [0, -2, 0, -1, 0] } : undefined}
          transition={{ repeat: Infinity, duration: 1.6, ease: 'easeInOut' }}
          style={{ transformOrigin: '50% 90%' }}
        >
          🔥
        </motion.span>
      </div>
      <div>
        <div className="font-display text-2xl leading-none font-bold">
          {weeks}
          <span className="ml-1 text-sm font-semibold text-muted">wk</span>
        </div>
        <div className="mt-1 text-xs text-muted">{live ? 'Weekly streak — play this week to keep it' : 'Play this week to start a streak'}</div>
      </div>
    </div>
  )
}

/** Avg rating bars (1–5). */
export function RatingBars({ rows }: { rows: { label: string; value: number | null; color: string }[] }) {
  return (
    <div className="space-y-4">
      {rows.map((r, i) => (
        <div key={r.label}>
          <div className="mb-1.5 flex items-baseline justify-between text-sm">
            <span className="font-medium">{r.label}</span>
            <span className="font-display font-semibold">
              {r.value == null ? '—' : r.value.toFixed(1)}
              <span className="text-xs text-subtle"> / 5</span>
            </span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-white/8">
            <motion.div
              className="h-full rounded-full"
              style={{ background: `linear-gradient(90deg, ${alpha(r.color, 0.53)}, ${r.color})`, boxShadow: `0 0 12px ${alpha(r.color, 0.53)}` }}
              initial={{ width: 0 }}
              whileInView={{ width: `${r.value == null ? 0 : (r.value / 5) * 100}%` }}
              viewport={{ once: true }}
              transition={{ type: 'spring', stiffness: 60, damping: 18, delay: i * 0.1 }}
            />
          </div>
        </div>
      ))}
    </div>
  )
}

/** Tag cloud sized by count. */
export function TagCloud({ tags }: { tags: TagCount[] }) {
  if (!tags.length) return <p className="text-sm text-subtle">No tags yet — teammates add them when they rate you.</p>
  const max = Math.max(...tags.map((t) => t.count))
  return (
    <div className="flex flex-wrap items-center gap-2">
      {tags.map((t, i) => {
        const w = t.count / max
        return (
          <motion.span
            key={t.tag}
            initial={{ opacity: 0, scale: 0.6 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            transition={{ delay: i * 0.05, type: 'spring', stiffness: 400, damping: 20 }}
            className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 font-semibold ring-1"
            style={{
              fontSize: `${12 + w * 6}px`,
              color: w > 0.66 ? 'var(--color-volt)' : w > 0.33 ? 'var(--color-mint)' : 'var(--color-fg)',
              background: alpha(tokens.volt, 0.04 + w * 0.1),
              boxShadow: w > 0.66 ? '0 0 20px -6px color-mix(in srgb, var(--color-volt) 60%, transparent)' : undefined,
              borderColor: 'transparent',
            }}
          >
            {t.tag}
            <span className="font-mono text-[10px] text-muted">×{t.count}</span>
          </motion.span>
        )
      })}
    </div>
  )
}

/** Verified Playmaker checklist with animated progress. */
export function VerifiedProgress({ eligible, criteria, verified }: { eligible: boolean; criteria: VerifiedCriterion[]; verified: boolean }) {
  const met = criteria.filter((c) => c.met).length
  return (
    <div className="flex flex-col gap-6 sm:flex-row sm:items-start">
      <div className="flex shrink-0 flex-col items-center">
        <ProgressRing value={criteria.length ? met / criteria.length : 0} size={120} stroke={10}>
          {verified || eligible ? (
            <span className="text-3xl">✅</span>
          ) : (
            <>
              <span className="font-display text-2xl font-bold">
                {met}/{criteria.length}
              </span>
              <span className="text-[10px] tracking-wider text-muted uppercase">criteria</span>
            </>
          )}
        </ProgressRing>
      </div>
      <ul className="flex-1 space-y-3">
        {criteria.map((c, i) => {
          const over = !c.met && c.current > c.target
          const pct = c.met ? 1 : over ? 1 : c.target ? Math.min(1, c.current / c.target) : 0
          return (
            <motion.li
              key={c.key}
              initial={{ opacity: 0, x: -10 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.06 }}
            >
              <div className="flex items-center gap-2 text-sm">
                {c.met ? (
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-volt text-ink-950">
                    <Check className="h-3 w-3" strokeWidth={3} />
                  </span>
                ) : (
                  <Circle className="h-5 w-5 text-subtle" />
                )}
                <span className={cn('flex-1', c.met ? 'text-fg' : 'text-fg/75')}>{c.label}</span>
                <span className="font-mono text-xs text-muted">
                  {Number.isInteger(c.current) ? c.current : c.current.toFixed(1)}/{c.target}
                </span>
              </div>
              <div className="mt-1.5 ml-7 h-1.5 overflow-hidden rounded-full bg-white/8">
                <motion.div
                  className={cn('h-full rounded-full', c.met ? 'bg-volt' : over ? 'bg-flare' : 'bg-sun')}
                  initial={{ width: 0 }}
                  whileInView={{ width: `${pct * 100}%` }}
                  viewport={{ once: true }}
                  transition={{ type: 'spring', stiffness: 70, damping: 18, delay: 0.1 + i * 0.06 }}
                />
              </div>
            </motion.li>
          )
        })}
      </ul>
    </div>
  )
}
