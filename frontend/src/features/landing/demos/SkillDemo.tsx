import { BadgeCheck, Check, RotateCw, Star } from 'lucide-react'
import { motion, useInView, useMotionValue, useReducedMotion, useSpring, useTransform } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { AnimatedNumber } from '@/components/ui/AnimatedNumber'
import { Avatar } from '@/components/ui/Avatar'
import { LogoMark } from '@/components/layout/Logo'
import { DEMO_PLAYERS } from '../data'

const PLAYER = DEMO_PLAYERS[1]!
const STATS = [
  { label: 'Skill', value: 4.6 },
  { label: 'Fair play', value: 4.8 },
  { label: 'Reliability', value: 4.9 },
]
const CRITERIA = [
  { label: '8+ ratings', value: '11' },
  { label: '5+ different raters', value: '9' },
  { label: 'Skill ≥ 4.0', value: '4.6' },
  { label: 'Fair play ≥ 4.0', value: '4.8' },
  { label: 'Reliability ≥ 4.0', value: '4.9' },
]

/** True Skill: a FIFA-style card flips to reveal peer-earned stats + the Verified badge stamp. */
export function SkillDemo() {
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { amount: 0.4, once: true })
  const reduced = useReducedMotion()
  const [flipped, setFlipped] = useState(false)
  const [round, setRound] = useState(0)

  useEffect(() => {
    if (!inView) return
    const id = setTimeout(() => setFlipped(true), reduced ? 0 : 450)
    return () => clearTimeout(id)
  }, [inView, reduced])

  // hover tilt
  const rx = useMotionValue(0)
  const ry = useMotionValue(0)
  const srx = useSpring(rx, { stiffness: 200, damping: 20 })
  const sry = useSpring(ry, { stiffness: 200, damping: 20 })
  const glare = useTransform(sry, [-12, 12], [0, 100], { clamp: true })
  const glareBg = useTransform(glare, (x) => `radial-gradient(circle at ${x}% 20%, color-mix(in srgb, var(--color-white) 50%, transparent), transparent 50%)`)
  const flip = () => {
    setFlipped((f) => !f)
    setRound((r) => r + 1)
  }

  return (
    <div ref={ref} className="relative mx-auto grid w-full max-w-lg items-center gap-8 sm:grid-cols-[auto_1fr]">
      <div className="relative mx-auto" style={{ perspective: 1200 }}>
        <motion.div
          style={{ rotateX: srx, rotateY: sry, transformStyle: 'preserve-3d' }}
          onPointerMove={(e) => {
            const r = e.currentTarget.getBoundingClientRect()
            ry.set(((e.clientX - r.left) / r.width - 0.5) * 24)
            rx.set(-((e.clientY - r.top) / r.height - 0.5) * 18)
          }}
          onPointerLeave={() => {
            rx.set(0)
            ry.set(0)
          }}
          className="relative"
        >
          {/* collectible card: a dark island in both themes */}
          <motion.div
            data-theme="dark"
            onClick={flip}
            animate={{ rotateY: flipped ? 180 : 0 }}
            transition={{ type: 'spring', stiffness: 70, damping: 13 }}
            style={{ transformStyle: 'preserve-3d' }}
            className="relative block h-[22rem] w-60 cursor-pointer rounded-[1.75rem] text-left"
          >
            {/* front: card back */}
            <div
              className="absolute inset-0 flex flex-col items-center justify-center overflow-hidden rounded-[1.75rem] bg-[linear-gradient(160deg,#18231f,var(--color-ink-900))] ring-1 ring-white/10"
              style={{ backfaceVisibility: 'hidden' }}
            >
              <div className="pitch-grid absolute inset-0 opacity-60" />
              <LogoMark className="relative h-16 w-16" />
              <div className="relative mt-4 font-display text-sm tracking-[0.3em] text-fg/70">PLAYER CARD</div>
              <div className="relative mt-1 text-xs text-muted">earned, not typed</div>
            </div>
            {/* back: the card */}
            <div
              className="absolute inset-0 overflow-hidden rounded-[1.75rem] bg-[linear-gradient(155deg,#2a2150_0%,#131b2e_45%,#070b0d_100%)] p-5 ring-1 ring-grape/50 shadow-[0_30px_80px_-20px_color-mix(in_srgb,_var(--color-grape)_55%,_transparent)]"
              style={{ backfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}
            >
              <motion.div
                aria-hidden
                className="pointer-events-none absolute inset-0 opacity-40 mix-blend-overlay"
                style={{ background: glareBg }}
              />
              {flipped && <CardFace key={round} />}
            </div>
          </motion.div>
        </motion.div>
        <button
          type="button"
          onClick={flip}
          className="mx-auto mt-3 flex cursor-pointer items-center gap-1.5 text-xs text-muted transition hover:text-fg"
        >
          <RotateCw className="h-3.5 w-3.5" /> Flip card
        </button>
      </div>

      <div className="rounded-3xl bg-white/4 p-5 ring-1 ring-white/8 [[data-theme=light]_&]:bg-ink-800 [[data-theme=light]_&]:shadow-card">
        <div className="text-[11px] font-semibold tracking-wider text-muted uppercase">Verified Playmaker</div>
        <ul className="mt-3 space-y-2.5">
          {CRITERIA.map((c, i) => (
            <motion.li
              key={c.label}
              initial={{ opacity: 0, x: 12 }}
              animate={flipped ? { opacity: 1, x: 0 } : { opacity: 0.35, x: 0 }}
              transition={{ delay: flipped ? 0.8 + i * 0.22 : 0, duration: 0.4 }}
              className="flex items-center gap-2.5 text-sm"
            >
              <motion.span
                animate={flipped ? { scale: [0, 1.3, 1], backgroundColor: 'var(--color-volt)' } : { scale: 1, backgroundColor: 'color-mix(in srgb, var(--color-white) 8%, transparent)' }}
                transition={{ delay: flipped ? 0.8 + i * 0.22 : 0, duration: 0.45 }}
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-ink-950"
              >
                <Check className="h-3 w-3" strokeWidth={3.5} />
              </motion.span>
              <span className="flex-1 text-fg/85">{c.label}</span>
              <span className="font-mono text-xs text-muted">{c.value}</span>
            </motion.li>
          ))}
        </ul>
        <div className="mt-4 flex flex-wrap gap-1.5">
          {['Anonymous', 'Weighted by rater credibility', 'Outliers dampened'].map((t) => (
            <span key={t} className="rounded-full bg-white/5 px-2.5 py-1 text-[10px] text-muted ring-1 ring-white/8">
              {t}
            </span>
          ))}
        </div>
      </div>

      {/* incoming anonymous ratings */}
      {flipped && (
        <div aria-hidden className="pointer-events-none absolute -top-6 left-0 hidden sm:block">
          {['★★★★★ Skill', '+15 XP', 'Playmaker'].map((t, i) => (
            <motion.span
              key={t + round}
              initial={{ opacity: 0, y: 30, scale: 0.8 }}
              animate={{ opacity: [0, 1, 1, 0], y: [30, 0, -10, -40], scale: 1 }}
              transition={{ duration: 3, delay: 0.4 + i * 0.7, times: [0, 0.15, 0.7, 1] }}
              className="absolute flex items-center gap-1 rounded-full bg-grape/25 px-3 py-1 text-xs font-semibold whitespace-nowrap text-[#cdbbff] ring-1 ring-grape/50 backdrop-blur [[data-theme=light]_&]:bg-grape/12 [[data-theme=light]_&]:text-grape"
              style={{ left: `${i * 70}px`, top: `${i * 16}px` }}
            >
              {i === 0 && <Star className="h-3 w-3 fill-current" />}
              {t}
            </motion.span>
          ))}
        </div>
      )}
    </div>
  )
}

function CardFace() {
  return (
    <div className="relative flex h-full flex-col">
      <div className="flex items-start justify-between">
        <div>
          <div className="font-display text-5xl leading-none text-volt">
            <AnimatedNumber value={81} duration={1.6} />
          </div>
          <div className="mt-1 text-[10px] font-bold tracking-[0.2em] text-muted">TRUE SKILL</div>
          <div className="mt-2 inline-flex h-5 items-center rounded-full bg-grape/20 px-2 text-[10px] font-bold tracking-wider text-[var(--color-grape-soft)] ring-1 ring-grape/50">
            ELITE
          </div>
        </div>
        <motion.div initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ delay: 0.3, type: 'spring' }}>
          <Avatar user={PLAYER} size="xl" showVerified={false} className="ring-2 ring-grape/70 ring-offset-2 ring-offset-[#1a1a33] rounded-full" />
        </motion.div>
      </div>
      <div className="mt-4">
        <div className="font-display text-lg leading-tight">{PLAYER.name}</div>
        <div className="text-xs text-muted">MID · Right foot · Kakkanad</div>
      </div>
      <div className="mt-4 space-y-2.5">
        {STATS.map((s, i) => (
          <div key={s.label}>
            <div className="flex justify-between text-[11px]">
              <span className="text-muted">{s.label}</span>
              <span className="font-mono font-semibold">
                <AnimatedNumber value={s.value} format={(n) => n.toFixed(1)} duration={1.4} />
              </span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/10">
              <motion.div
                className="h-full rounded-full bg-gradient-to-r from-grape via-electric to-volt"
                initial={{ width: 0 }}
                animate={{ width: `${(s.value / 5) * 100}%` }}
                transition={{ delay: 0.35 + i * 0.12, duration: 1.1, ease: [0.16, 1, 0.3, 1] }}
              />
            </div>
          </div>
        ))}
      </div>
      <motion.div
        initial={{ scale: 2.4, opacity: 0, rotate: -24 }}
        animate={{ scale: 1, opacity: 1, rotate: -6 }}
        transition={{ delay: 1.5, type: 'spring', stiffness: 380, damping: 16 }}
        className="mt-auto inline-flex items-center gap-1.5 self-start rounded-full bg-gradient-to-r from-volt/25 to-mint/25 px-3 py-1.5 text-xs font-bold text-volt ring-1 ring-volt/50"
      >
        <BadgeCheck className="h-4 w-4" /> Verified Playmaker
      </motion.div>
    </div>
  )
}
