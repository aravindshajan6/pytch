import { BadgeCheck } from 'lucide-react'
import { cn } from '@/lib/cn'
import { SPORTS, TIERS } from '@/lib/sports'
import type { Sport, Tier } from '@/types/api'
import { alpha } from '@/lib/color'

export function TierBadge({ tier, className }: { tier: Tier; className?: string }) {
  const t = TIERS[tier]
  return (
    <span
      className={cn('inline-flex h-6 items-center gap-1 rounded-full px-2.5 text-[11px] font-bold tracking-wide uppercase', className)}
      style={{ color: t.color, background: `${alpha(t.color, 0.12)}`, boxShadow: `inset 0 0 0 1px ${alpha(t.color, 0.33)}` }}
    >
      {t.label}
    </span>
  )
}

export function VerifiedBadge({ className, compact }: { className?: string; compact?: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-volt/20 to-mint/20 font-semibold text-volt ring-1 ring-volt/40',
        compact ? 'h-5 px-1.5 text-[10px]' : 'h-7 px-3 text-xs',
        className,
      )}
    >
      <BadgeCheck className={compact ? 'h-3 w-3' : 'h-4 w-4'} />
      {compact ? 'Verified' : 'Verified Playmaker'}
    </span>
  )
}

export function TrueSkillPill({ value, className }: { value: number | null; className?: string }) {
  return (
    <span className={cn('inline-flex items-baseline gap-1 rounded-lg bg-white/6 px-2 py-0.5 ring-1 ring-white/10', className)}>
      <span className="text-[10px] font-bold tracking-wider text-muted">TS</span>
      <span className="font-mono text-sm font-semibold text-fg">{value == null ? '—' : Math.round(value)}</span>
    </span>
  )
}

export function SportBadge({ sport, format, className }: { sport: Sport; format?: string; className?: string }) {
  const s = SPORTS[sport]
  return (
    <span
      className={cn('inline-flex h-6 items-center gap-1 rounded-full px-2.5 text-[11px] font-semibold', className)}
      style={{ color: s.color, background: `${alpha(s.color, 0.09)}`, boxShadow: `inset 0 0 0 1px ${alpha(s.color, 0.25)}` }}
    >
      <span>{s.emoji}</span>
      {s.label}
      {format && <span className="opacity-70">· {format}</span>}
    </span>
  )
}
