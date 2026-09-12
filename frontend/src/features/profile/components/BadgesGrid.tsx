import { Lock } from 'lucide-react'
import { motion, useReducedMotion } from 'motion/react'
import { useState } from 'react'
import { Sheet } from '@/components/ui/Sheet'
import { cn } from '@/lib/cn'
import { formatDateLong } from '@/lib/format'
import type { Badge } from '@/types/api'
import { RARITY } from '../lib'
import { alpha } from '@/lib/color'

/** Badge collection: earned glow by rarity, locked ones greyed with a lock. Tap for details. */
export function BadgesGrid({ badges, showLocked = true }: { badges: Badge[]; showLocked?: boolean }) {
  const [open, setOpen] = useState<Badge | null>(null)
  const list = showLocked ? badges : badges.filter((b) => b.earned_at)
  const sorted = [...list].sort((a, b) => Number(!!b.earned_at) - Number(!!a.earned_at))

  return (
    <>
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 xl:grid-cols-6">
        {sorted.map((b, i) => (
          <BadgeTile key={b.code} badge={b} index={i} onClick={() => setOpen(b)} />
        ))}
      </div>
      <Sheet open={!!open} onClose={() => setOpen(null)} size="sm">
        {open && <BadgeDetail badge={open} />}
      </Sheet>
    </>
  )
}

function BadgeTile({ badge, index, onClick }: { badge: Badge; index: number; onClick: () => void }) {
  const reduce = useReducedMotion()
  const earned = !!badge.earned_at
  const r = RARITY[badge.rarity]
  return (
    <motion.button
      type="button"
      onClick={onClick}
      initial={{ opacity: 0, scale: 0.8, y: 10 }}
      whileInView={{ opacity: 1, scale: 1, y: 0 }}
      viewport={{ once: true, margin: '-40px' }}
      transition={{ delay: Math.min(index, 12) * 0.03, type: 'spring', stiffness: 380, damping: 24 }}
      whileHover={{ y: -4 }}
      whileTap={{ scale: 0.94 }}
      aria-label={`${badge.name} — ${earned ? 'earned' : 'locked'}`}
      className={cn(
        'group relative flex aspect-square cursor-pointer flex-col items-center justify-center gap-1.5 overflow-hidden rounded-2xl p-2 text-center ring-1 transition-colors',
        earned ? 'bg-white/5' : 'bg-white/[0.02] ring-white/6',
      )}
      style={earned ? { boxShadow: `inset 0 0 0 1px ${alpha(r.color, 0.4)}, 0 10px 30px -12px ${alpha(r.color, 0.53)}` } : undefined}
    >
      {earned && badge.rarity === 'legendary' && !reduce && (
        <span
          aria-hidden
          className="absolute -inset-1/2 animate-sweep opacity-40"
          style={{ background: `conic-gradient(from 0deg, transparent 0deg, ${r.color} 40deg, transparent 90deg)`, animationDuration: '4s' }}
        />
      )}
      {earned && <span aria-hidden className="absolute inset-[2px] rounded-[0.9rem] bg-ink-800" />}
      <span
        className={cn('relative text-3xl transition-transform group-hover:scale-110 sm:text-4xl', !earned && 'opacity-30 grayscale')}
        style={earned ? { filter: `drop-shadow(0 0 12px ${alpha(r.color, 0.67)})` } : undefined}
      >
        {badge.icon}
      </span>
      <span className={cn('relative line-clamp-2 text-[10px] leading-tight font-semibold sm:text-[11px]', earned ? 'text-fg' : 'text-subtle')}>
        {badge.name}
      </span>
      {!earned && <Lock className="absolute top-2 right-2 h-3.5 w-3.5 text-subtle" />}
    </motion.button>
  )
}

function BadgeDetail({ badge }: { badge: Badge }) {
  const earned = !!badge.earned_at
  const r = RARITY[badge.rarity]
  return (
    <div className="flex flex-col items-center pb-2 text-center">
      <motion.div
        initial={{ scale: 0.3, rotate: -30 }}
        animate={{ scale: 1, rotate: 0 }}
        transition={{ type: 'spring', stiffness: 260, damping: 13 }}
        className="relative flex h-28 w-28 items-center justify-center rounded-full"
        style={{
          background: earned ? `radial-gradient(circle, ${alpha(r.color, 0.2)}, transparent 70%)` : 'color-mix(in srgb, var(--color-white) 3%, transparent)',
          boxShadow: earned ? `0 0 0 2px ${alpha(r.color, 0.53)}, 0 0 60px -10px ${r.color}` : 'inset 0 0 0 1px color-mix(in srgb, var(--color-white) 10%, transparent)',
        }}
      >
        <span className={cn('text-6xl', !earned && 'opacity-30 grayscale')}>{badge.icon}</span>
        {!earned && (
          <span className="absolute -right-1 -bottom-1 flex h-9 w-9 items-center justify-center rounded-full bg-ink-700 ring-1 ring-white/15">
            <Lock className="h-4 w-4 text-muted" />
          </span>
        )}
      </motion.div>
      <span
        className="mt-5 rounded-full px-2.5 py-0.5 text-[11px] font-bold tracking-[0.15em] uppercase"
        style={{ color: r.color, background: `${alpha(r.color, 0.12)}`, boxShadow: `inset 0 0 0 1px ${alpha(r.color, 0.33)}` }}
      >
        {r.label}
      </span>
      <h3 className="mt-3 text-2xl font-bold">{badge.name}</h3>
      <p className="mt-2 max-w-xs text-sm text-muted">{badge.description}</p>
      <p className="mt-4 text-xs text-subtle">
        {earned ? `Unlocked ${formatDateLong(badge.earned_at!)}` : 'Locked — keep playing to unlock it.'}
      </p>
    </div>
  )
}
