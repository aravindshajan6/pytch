import { ArrowRight, BadgeCheck, Play, Star } from 'lucide-react'
import { motion, useMotionTemplate, useMotionValue, useScroll, useSpring, useTransform } from 'motion/react'
import { useRef } from 'react'
import { AvatarStack } from '@/components/ui/Avatar'
import { Button, LinkButton } from '@/components/ui/Button'
import { HeroCanvas } from '@/components/three/HeroCanvas'
import { cn } from '@/lib/cn'
import { useAuth } from '@/stores/auth'
import { useResolvedTheme } from '@/stores/theme'
import { DEMO_PLAYERS } from './data'
import { RevealText } from './RevealText'

const EASE = [0.16, 1, 0.3, 1] as const

export function Hero({ onJump }: { onJump: (selector: string) => void }) {
  const authed = useAuth((s) => !!s.accessToken)
  const day = useResolvedTheme() === 'light'
  const ref = useRef<HTMLElement>(null)
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end start'] })
  const fade = useTransform(scrollYProgress, [0, 0.55], [1, 0])
  const lift = useTransform(scrollYProgress, [0, 1], [0, -120])
  const cardsY = useTransform(scrollYProgress, [0, 1], [0, -220])

  // cursor floodlight
  const mx = useMotionValue(-999)
  const my = useMotionValue(-999)
  const sx = useSpring(mx, { stiffness: 120, damping: 20 })
  const sy = useSpring(my, { stiffness: 120, damping: 20 })
  const spot = useMotionTemplate`radial-gradient(520px circle at ${sx}px ${sy}px, color-mix(in srgb, var(--color-volt) 7%, transparent), transparent 60%)`

  return (
    <section
      ref={ref}
      id="top"
      tabIndex={-1}
      onPointerMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect()
        mx.set(e.clientX - r.left)
        my.set(e.clientY - r.top)
      }}
      className="relative isolate flex min-h-[100svh] flex-col overflow-hidden outline-none"
    >
      {/* sky: floodlit night, or a golden-hour afternoon in light mode (the 3D scene switches to its day mood) */}
      {day ? (
        <div
          aria-hidden
          className="absolute inset-0 -z-20 bg-[radial-gradient(55%_45%_at_82%_6%,rgb(255_241_205/0.95),transparent_70%),linear-gradient(180deg,#b9d8ea_0%,#d7e8ef_22%,#f4ead3_40%,var(--color-ink-900)_62%)]"
        />
      ) : (
        <div
          aria-hidden
          className="absolute inset-0 -z-20 bg-[radial-gradient(120%_70%_at_65%_-10%,#15261d_0%,#070c0a_45%,var(--color-ink-900)_75%)]"
        />
      )}
      <HeroCanvas variant="full" className="-z-10" />
      <motion.div aria-hidden className="pointer-events-none absolute inset-0 -z-10" style={{ background: spot }} />
      <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-48 bg-gradient-to-t from-ink-900 via-ink-900/70 to-transparent" />
      <div
        aria-hidden
        className={cn(
          'pointer-events-none absolute inset-y-0 left-0 -z-10 hidden w-[64%] bg-gradient-to-r via-45% to-transparent lg:block',
          day ? 'from-ink-900/90 via-ink-900/70' : 'from-ink-900/95 via-ink-900/80',
        )}
      />
      <div
        aria-hidden
        className={cn(
          'pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-[64%] bg-gradient-to-t to-transparent lg:hidden',
          day ? 'from-ink-900 via-ink-900/90' : 'from-ink-900 via-ink-900/85',
        )}
      />

      <motion.div
        style={{ opacity: fade, y: lift }}
        className="pointer-events-none relative mx-auto flex w-full max-w-6xl flex-1 flex-col justify-end px-5 pt-28 pb-24 sm:px-8 lg:justify-center lg:pb-28"
      >
        <div className="max-w-[40rem] lg:max-w-none">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease: EASE }}
            className="mb-6 inline-flex items-center gap-2 rounded-full bg-white/5 py-1.5 pr-3.5 pl-2 text-xs font-medium text-fg/80 ring-1 ring-white/10 backdrop-blur"
          >
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-volt opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-volt" />
            </span>
            Live in Kochi · 38 games forming right now
          </motion.div>

          <RevealText
            lines={[{ text: 'PLAY MORE.' }, { text: 'CHASE LESS.', className: 'text-volt drop-shadow-[0_0_28px_color-mix(in_srgb,_var(--color-volt)_35%,_transparent)] [[data-theme=light]_&]:drop-shadow-[0_4px_22px_rgb(63_125_0/0.16)]', underline: true }]}
            className="font-display text-[clamp(2.6rem,10.5vw,4.4rem)] leading-[0.95] font-black tracking-[-0.03em] lg:text-[clamp(3.6rem,6vw,5.3rem)]"
          />

          <motion.p
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.9, ease: EASE }}
            className="mt-6 max-w-lg text-[15px] leading-relaxed text-fg/70 sm:text-lg"
          >
            Book a turf, send one link, and everyone pays their own share before the timer runs out. Dropouts get
            replaced from the live bench. Your rating is earned from teammates — not typed into a bio.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 1.05, ease: EASE }}
            className="pointer-events-auto mt-8 flex flex-wrap items-center gap-3"
          >
            <LinkButton to={authed ? '/app' : '/login'} size="lg" className="group h-12 px-5 text-[15px] sm:h-14 sm:px-7 sm:text-base">
              {authed ? 'Open the app' : 'Start playing'}
              <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-1" />
            </LinkButton>
            <Button variant="secondary" size="lg" className="h-12 px-5 text-[15px] sm:h-14 sm:px-7 sm:text-base" onClick={() => onJump('#features')}>
              <Play className="h-4 w-4 fill-current" /> <span className="sm:hidden">How it works</span>
              <span className="hidden sm:inline">See how it works</span>
            </Button>
          </motion.div>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 1, delay: 1.3 }}
            className="mt-8 flex items-center gap-3 text-sm text-muted"
          >
            <AvatarStack users={DEMO_PLAYERS.slice(0, 5)} size="sm" total={DEMO_PLAYERS.length} />
            <div className="leading-tight">
              <div className="flex items-center gap-1 text-fg">
                {Array.from({ length: 5 }, (_, i) => (
                  <Star key={i} className="h-3.5 w-3.5 fill-volt text-volt" />
                ))}
                <span className="ml-1 font-semibold">4.9</span>
              </div>
              <div className="text-xs">18,400+ players in Kochi</div>
            </div>
          </motion.div>
        </div>
      </motion.div>

      {/* floating product chips orbiting the ball (desktop) */}
      <motion.div aria-hidden style={{ y: cardsY, opacity: fade }} className="pointer-events-none absolute inset-0 hidden lg:block">
        <FloatChip className="top-[17%] left-[60%]" delay={1.5} float="0s">
          <div className="text-[10px] font-semibold tracking-wider text-muted uppercase">Split · Thu 7 PM</div>
          <div className="mt-1 flex items-center gap-2">
            <span className="font-display text-lg">₹150</span>
            <span className="text-xs text-muted">each</span>
          </div>
          <div className="mt-2 h-1.5 w-40 overflow-hidden rounded-full bg-white/10">
            <motion.div
              className="h-full rounded-full bg-gradient-to-r from-volt to-mint"
              initial={{ width: '10%' }}
              animate={{ width: '80%' }}
              transition={{ duration: 2.4, delay: 1.9, ease: EASE }}
            />
          </div>
          <div className="mt-1.5 text-[11px] text-fg/70">8/10 paid · 12:40 left</div>
        </FloatChip>
        <FloatChip className="top-[52%] right-[3%]" delay={1.75} float="-2s" tone="flare">
          <div className="flex items-center gap-2 text-xs font-bold text-flare">🚨 SOS · 1 spot</div>
          <div className="mt-1 text-sm">
            <span className="font-display">₹120</span> <span className="text-xs text-muted line-through">₹150</span>
          </div>
          <div className="mt-1 text-[11px] text-fg/70">20% off · kicks off in 25 min</div>
        </FloatChip>
        <FloatChip className="top-[76%] left-[64%]" delay={2} float="-4s">
          <div className="flex items-center gap-3">
            <div className="font-display text-2xl text-volt">78</div>
            <div>
              <div className="text-[10px] font-semibold tracking-wider text-muted uppercase">True Skill</div>
              <div className="flex items-center gap-1 text-xs font-semibold text-volt">
                <BadgeCheck className="h-3.5 w-3.5" /> Verified Playmaker
              </div>
            </div>
          </div>
        </FloatChip>
      </motion.div>

      <motion.button
        type="button"
        onClick={() => onJump('#stats')}
        style={{ opacity: fade }}
        className="absolute bottom-6 left-1/2 hidden -translate-x-1/2 cursor-pointer flex-col items-center gap-2 text-[10px] font-semibold tracking-[0.25em] text-muted uppercase sm:flex"
        aria-label="Scroll to content"
      >
        <span className="flex h-9 w-5 justify-center rounded-full border border-white/20 pt-1.5">
          <motion.span
            className="h-1.5 w-1 rounded-full bg-volt"
            animate={{ y: [0, 12, 0], opacity: [1, 0.2, 1] }}
            transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
          />
        </span>
        Scroll
      </motion.button>
    </section>
  )
}

function FloatChip({
  className,
  children,
  delay,
  float,
  tone = 'volt',
}: {
  className: string
  children: React.ReactNode
  delay: number
  float: string
  tone?: 'volt' | 'flare'
}) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.8, y: 20 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 180, damping: 18, delay }}
      className={`absolute ${className}`}
    >
      <div
        className={`glass-strong animate-float rounded-2xl px-4 py-3 shadow-card ${tone === 'flare' ? 'shadow-glow-flare' : ''}`}
        style={{ animationDelay: float }}
      >
        {children}
      </div>
    </motion.div>
  )
}
