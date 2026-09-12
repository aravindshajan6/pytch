import { BadgeCheck } from 'lucide-react'
import {
  animate,
  motion,
  useMotionTemplate,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
} from 'motion/react'
import { useEffect, useRef } from 'react'
import { Avatar } from '@/components/ui/Avatar'
import { cn } from '@/lib/cn'
import { useResolvedTheme } from '@/stores/theme'
import { TIERS, sportInfo } from '@/lib/sports'
import type { PlayerStats, UserPublic } from '@/types/api'
import { attr, FRAMES, positionCode } from '../lib'

type Size = 'sm' | 'md' | 'lg'

const S: Record<Size, { w: string; ovr: string; meta: string; avatar: 'xl' | '2xl'; name: string; attr: string; label: string; pad: string; gap: string }> = {
  sm: { w: 'w-[210px]', ovr: 'text-4xl', meta: 'text-[10px]', avatar: 'xl', name: 'text-sm', attr: 'text-sm', label: 'text-[8px]', pad: 'p-3', gap: 'gap-y-1' },
  md: { w: 'w-[260px]', ovr: 'text-5xl', meta: 'text-xs', avatar: '2xl', name: 'text-base', attr: 'text-lg', label: 'text-[9px]', pad: 'p-4', gap: 'gap-y-1.5' },
  lg: { w: 'w-[296px] sm:w-[320px]', ovr: 'text-5xl sm:text-6xl', meta: 'text-xs', avatar: '2xl', name: 'text-base sm:text-lg', attr: 'text-lg sm:text-xl', label: 'text-[9px] sm:text-[10px]', pad: 'p-4 sm:p-5', gap: 'gap-y-1 sm:gap-y-1.5' },
}

export interface PlayerCardProps {
  user: UserPublic
  stats?: PlayerStats | null
  size?: Size
  className?: string
}

/**
 * FIFA-style collectible player card with pointer-driven 3D tilt, moving glare,
 * tier-coloured frame (elite = holo) and holographic foil for Verified Playmakers.
 * Idles with a gentle wobble; everything static under reduced motion.
 */
export function PlayerCard({ user, stats, size = 'md', className }: PlayerCardProps) {
  const reduce = useReducedMotion()
  const light = useResolvedTheme() === 'light'
  const s = S[size]
  const tier = stats?.tier ?? user.tier
  const verified = stats?.is_verified_playmaker ?? user.is_verified_playmaker
  const ts = stats?.true_skill ?? user.true_skill
  const level = stats?.level ?? user.level
  const f = FRAMES[tier]
  const sport = user.preferred_sports[0] ? sportInfo(user.preferred_sports[0]) : null

  const mx = useMotionValue(0.5)
  const my = useMotionValue(0.5)
  const sx = useSpring(mx, { stiffness: 170, damping: 17, mass: 0.6 })
  const sy = useSpring(my, { stiffness: 170, damping: 17, mass: 0.6 })
  const rotateY = useTransform(sx, [0, 1], [-18, 18])
  const rotateX = useTransform(sy, [0, 1], [15, -15])
  const gx = useTransform(sx, (v) => v * 100)
  const gy = useTransform(sy, (v) => v * 100)
  const glare = useMotionTemplate`radial-gradient(farthest-corner circle at ${gx}% ${gy}%, color-mix(in srgb, var(--color-white) 20%, transparent) 0%, color-mix(in srgb, var(--color-white) 5%, transparent) 30%, transparent 62%)`
  const foilPos = useMotionTemplate`${gx}% ${gy}%`
  const px = useTransform(sx, [0, 1], [-7, 7])
  const py = useTransform(sy, [0, 1], [-5, 5])
  const shX = useTransform(sx, [0, 1], [16, -16])
  const shY = useTransform(sy, [0, 1], [26, 6])
  // On a light page the heavy night-time drop shadow softens to an ink shadow; the card itself stays a dark island.
  const ambient = light ? '0 30px 50px -26px rgb(14 42 26 / 0.55)' : '0 30px 60px -24px rgb(0 0 0 / 0.95)'
  const shadow = useMotionTemplate`${shX}px ${shY}px 50px -14px rgb(${f.tint} / 0.5), ${ambient}`

  // Idle wobble so the card feels alive (stopped while the pointer drives it).
  const hovering = useRef(false)
  const idle = useRef<{ stop: () => void }[]>([])
  const alive = useRef(true)
  const startIdle = () => {
    if (reduce || !alive.current) return
    idle.current.forEach((c) => c.stop())
    idle.current = [
      animate(mx, [0.5, 0.64, 0.4, 0.5], { duration: 7, repeat: Infinity, ease: 'easeInOut' }),
      animate(my, [0.5, 0.4, 0.6, 0.5], { duration: 9, repeat: Infinity, ease: 'easeInOut' }),
    ]
  }
  useEffect(() => {
    alive.current = true
    startIdle()
    return () => {
      alive.current = false
      idle.current.forEach((c) => c.stop())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduce])

  const onMove = (e: React.PointerEvent<HTMLElement>) => {
    if (reduce || e.pointerType === 'touch') return
    const r = e.currentTarget.getBoundingClientRect()
    if (!hovering.current) {
      hovering.current = true
      idle.current.forEach((c) => c.stop())
    }
    mx.set((e.clientX - r.left) / r.width)
    my.set((e.clientY - r.top) / r.height)
  }
  const onLeave = () => {
    if (!hovering.current) return
    hovering.current = false
    mx.set(0.5)
    my.set(0.5)
    setTimeout(() => !hovering.current && startIdle(), 600)
  }

  const attrs: { k: string; v: number | null }[] = [
    { k: 'SKL', v: attr(stats?.avg_skill) },
    { k: 'FPL', v: attr(stats?.avg_fair_play) },
    { k: 'REL', v: attr(stats?.avg_reliability) },
    { k: 'MAT', v: stats?.matches_played ?? null },
    { k: 'SUB', v: stats?.subs_made ?? null },
    { k: 'LVL', v: level },
  ]
  const tags = (stats?.top_tags ?? []).slice(0, 2)

  return (
    // Collectible = dark island: the foil / neon frame is tuned for night and keeps that look in light mode.
    <div data-theme="dark" className={cn('relative shrink-0 select-none', s.w, className)} style={{ perspective: 1100 }}>
      <motion.figure
        aria-label={`Player card: ${user.name}, ${TIERS[tier].label}, True Skill ${ts == null ? 'not yet rated' : Math.round(ts)}${verified ? ', Verified Playmaker' : ''}`}
        onPointerMove={onMove}
        onPointerLeave={onLeave}
        style={reduce ? { boxShadow: shadow } : { rotateX, rotateY, boxShadow: shadow, transformStyle: 'preserve-3d' }}
        className="relative m-0 aspect-[63/88] w-full rounded-[1.6rem] p-[3px] will-change-transform"
      >
        {/* frame */}
        <motion.div
          aria-hidden
          className="absolute inset-0 rounded-[1.6rem]"
          style={{ background: f.frame, backgroundSize: '220% 220%', backgroundPosition: tier === 'elite' ? foilPos : '30% 30%' }}
        />
        {/* body */}
        <div
          className="relative flex h-full w-full flex-col overflow-hidden rounded-[1.45rem]"
          style={{
            background: `radial-gradient(120% 70% at 50% 0%, rgb(${f.tint} / 0.3), transparent 62%), linear-gradient(180deg, #121d19 0%, #070b0a 100%)`,
          }}
        >
          <div aria-hidden className="pitch-grid absolute inset-0 opacity-70" />
          <div
            aria-hidden
            className="absolute inset-0 opacity-40"
            style={{ backgroundImage: `repeating-linear-gradient(135deg, rgb(${f.tint} / 0.05) 0 2px, transparent 2px 12px)` }}
          />

          <div className={cn('relative flex flex-1 flex-col', s.pad)}>
            {/* top row */}
            <div className="flex items-start justify-between">
              <div className="flex flex-col items-center leading-none">
                <span className={cn('font-display font-bold tracking-tight', s.ovr)} style={{ color: f.text, textShadow: `0 0 24px rgb(${f.tint} / 0.6)` }}>
                  {ts == null ? 'NEW' : Math.round(ts)}
                </span>
                <span className={cn('mt-1 font-mono font-bold tracking-widest text-fg/85', s.meta)}>{positionCode(user.position)}</span>
                {sport && <span className="mt-1 text-lg leading-none">{sport.emoji}</span>}
              </div>
              <div className="flex flex-col items-end gap-1.5">
                <span
                  className={cn('rounded-full px-2 py-0.5 font-bold tracking-[0.15em] uppercase', s.label)}
                  style={{ color: f.text, background: `rgb(${f.tint} / 0.14)`, boxShadow: `inset 0 0 0 1px rgb(${f.tint} / 0.4)` }}
                >
                  {TIERS[tier].label}
                </span>
                {verified && (
                  <span className={cn('inline-flex items-center gap-0.5 rounded-full bg-volt/15 px-1.5 py-0.5 font-bold text-volt ring-1 ring-volt/40', s.label)}>
                    <BadgeCheck className="h-3 w-3" /> VERIFIED
                  </span>
                )}
              </div>
            </div>

            {/* portrait */}
            <motion.div className="relative -mt-4 flex justify-center" style={reduce ? undefined : { x: px, y: py }}>
              <span aria-hidden className="absolute top-1/2 left-1/2 h-24 w-24 -translate-x-1/2 -translate-y-1/2 rounded-full blur-2xl" style={{ background: `rgb(${f.tint} / 0.45)` }} />
              <Avatar
                user={user}
                size={s.avatar}
                showVerified={false}
                className={cn('relative rounded-full ring-2 ring-white/20', size === 'lg' && 'max-sm:-my-1.5 max-sm:scale-90')}
              />
            </motion.div>

            {/* name */}
            <div className="relative mt-3 text-center">
              <div className="mx-auto h-px w-4/5" style={{ background: `linear-gradient(90deg, transparent, rgb(${f.tint} / 0.7), transparent)` }} />
              <div className={cn('truncate px-1 py-1.5 font-display font-bold tracking-wide uppercase', s.name)}>{user.name}</div>
              <div className="mx-auto h-px w-4/5" style={{ background: `linear-gradient(90deg, transparent, rgb(${f.tint} / 0.7), transparent)` }} />
            </div>

            {/* attributes */}
            <div className={cn('relative mx-auto mt-2 grid w-fit grid-cols-2 gap-x-7', s.gap)}>
              {attrs.map((a) => (
                <div key={a.k} className="flex items-baseline gap-1.5">
                  <span className={cn('min-w-[1.6em] text-right font-display leading-tight font-bold tabular-nums', s.attr)}>{a.v == null ? '—' : a.v}</span>
                  <span className={cn('font-mono font-semibold tracking-wider text-fg/55', s.label)}>{a.k}</span>
                </div>
              ))}
            </div>

            {/* tags + brand */}
            <div className="relative mt-auto flex items-end justify-between gap-2 pt-2">
              <div className="flex min-w-0 flex-wrap gap-1">
                {tags.map((t) => (
                  <span key={t.tag} className={cn('truncate rounded-full bg-white/8 px-1.5 py-0.5 text-fg/75 ring-1 ring-white/10', s.label)}>
                    {t.tag}
                  </span>
                ))}
              </div>
              <span className={cn('shrink-0 font-display font-black tracking-[0.25em] text-white/25', s.label)}>PYTCH</span>
            </div>
          </div>

          {/* holographic foil */}
          {verified && (
            <motion.div
              aria-hidden
              className="pointer-events-none absolute inset-0 opacity-30 mix-blend-color-dodge"
              style={{
                backgroundImage:
                  'repeating-linear-gradient(115deg, color-mix(in srgb, var(--color-flare) 35%, transparent) 0%, color-mix(in srgb, var(--color-electric) 35%, transparent) 7%, color-mix(in srgb, var(--color-volt) 35%, transparent) 14%, color-mix(in srgb, var(--color-grape) 35%, transparent) 21%, color-mix(in srgb, var(--color-flare) 35%, transparent) 28%)',
                backgroundSize: '300% 300%',
                backgroundPosition: foilPos,
              }}
            />
          )}
          {verified && !reduce && (
            <motion.div
              aria-hidden
              className="pointer-events-none absolute inset-y-0 w-1/2 bg-gradient-to-r from-transparent via-white/10 to-transparent"
              style={{ skewX: -18 }}
              initial={{ x: '-150%' }}
              animate={{ x: '350%' }}
              transition={{ repeat: Infinity, duration: 3.2, repeatDelay: 2.4, ease: 'easeInOut' }}
            />
          )}
          {/* glare */}
          <motion.div aria-hidden className="pointer-events-none absolute inset-0" style={{ background: glare }} />
        </div>
      </motion.figure>
    </div>
  )
}
