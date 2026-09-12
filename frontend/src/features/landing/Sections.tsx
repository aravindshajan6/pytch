import { ArrowRight, Heart, Search, Sparkles, Trophy, Users } from 'lucide-react'
import { motion, useMotionValue, useReducedMotion, useScroll, useSpring, useTransform } from 'motion/react'
import { useRef } from 'react'
import { Link } from 'react-router'
import { LogoMark } from '@/components/layout/Logo'
import { AnimatedNumber } from '@/components/ui/AnimatedNumber'
import { Avatar } from '@/components/ui/Avatar'
import { buttonVariants } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { cn } from '@/lib/cn'
import { useAuth } from '@/stores/auth'
import { STATS_ROW_A, STATS_ROW_B, TESTIMONIALS } from './data'

const EASE = [0.16, 1, 0.3, 1] as const

// ───────────────────────────── Stats marquee ─────────────────────────────

function Highlight({ text }: { text: string }) {
  // numbers glow volt, the rest stays neutral
  const parts = text.split(/([₹\d][\d,.%+]*)/g)
  return (
    <>
      {parts.map((p, i) =>
        /^[₹\d]/.test(p) ? (
          <span key={i} className="text-volt">
            {p}
          </span>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  )
}

function MarqueeRow({ items, reverse, className, duration }: { items: string[]; reverse?: boolean; className?: string; duration: string }) {
  const group = (hidden: boolean) => (
    <ul aria-hidden={hidden || undefined} className="flex shrink-0 items-center">
      {items.map((it) => (
        <li key={it} className="flex items-center gap-8 pr-8 whitespace-nowrap">
          <Highlight text={it} />
          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-white/20" />
        </li>
      ))}
    </ul>
  )
  return (
    <div className="group relative overflow-hidden [mask-image:linear-gradient(90deg,transparent,black_8%,black_92%,transparent)]">
      <div
        className={cn('flex w-max animate-marquee group-hover:[animation-play-state:paused]', className)}
        style={{ animationDuration: duration, animationDirection: reverse ? 'reverse' : 'normal' }}
      >
        {group(false)}
        {group(true)}
      </div>
    </div>
  )
}

export function StatsMarquee() {
  return (
    <section id="stats" tabIndex={-1} aria-label="PYTCH in numbers" className="relative border-y border-white/6 bg-ink-850/70 py-6 outline-none">
      <MarqueeRow items={STATS_ROW_A} duration="48s" className="font-display text-lg font-semibold sm:text-2xl" />
      <MarqueeRow items={STATS_ROW_B} duration="60s" reverse className="mt-3 text-sm text-muted" />
    </section>
  )
}

// ───────────────────────────── How it works ─────────────────────────────

const STEPS = [
  {
    icon: Search,
    title: 'Find or start a game',
    body: 'Live slots at 140+ turfs, or tap Quick Match to drop into a game that’s already forming near you.',
    tag: '≈ 30 seconds',
  },
  {
    icon: Users,
    title: 'Everyone pays their share',
    body: 'One link. Each player pays their exact share. Fills in 30 minutes — or every rupee comes back as credits.',
    tag: 'Zero chasing',
  },
  {
    icon: Trophy,
    title: 'Play, rate, level up',
    body: 'Rate your squad anonymously after the whistle. Earn True Skill, XP, badges and a highlight reel.',
    tag: '+100 XP per game',
  },
]

export function HowItWorks() {
  const ref = useRef<HTMLElement>(null)
  const reduced = useReducedMotion()
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start 75%', 'end 60%'] })
  const draw = useSpring(useTransform(scrollYProgress, [0, 1], [0, 1]), { stiffness: 80, damping: 24 })

  return (
    <section ref={ref} id="how" tabIndex={-1} aria-labelledby="how-title" className="relative py-24 outline-none sm:py-32">
      <div className="mx-auto max-w-6xl px-5 sm:px-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.7, ease: EASE }}
          className="mx-auto max-w-2xl text-center"
        >
          <div className="text-xs font-bold tracking-[0.22em] text-volt uppercase">How it works</div>
          <h2 id="how-title" className="mt-4 text-[clamp(2rem,5vw,3.2rem)] leading-[1.05] font-bold">
            Kick-off in three taps.
          </h2>
          <p className="mt-4 text-fg/65 sm:text-lg">No group-chat admin. No IOUs. Just football (and cricket, badminton, pickleball, hoops).</p>
        </motion.div>

        <div className="relative mt-16">
          {/* connector: horizontal on desktop, vertical on mobile — drawn as you scroll */}
          <svg aria-hidden className="absolute top-10 left-[16.6%] hidden h-2 w-[66.8%] overflow-visible lg:block" viewBox="0 0 100 2" preserveAspectRatio="none">
            <line x1="0" y1="1" x2="100" y2="1" stroke="color-mix(in srgb, var(--color-white) 8%, transparent)" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeDasharray="4 6" />
            <motion.line x1="0" y1="1" x2="100" y2="1" stroke="var(--color-volt)" strokeWidth="2" vectorEffect="non-scaling-stroke" style={{ pathLength: reduced ? 1 : draw }} />
          </svg>
          <svg aria-hidden className="absolute top-10 bottom-10 left-[1.95rem] w-2 overflow-visible lg:hidden" viewBox="0 0 2 100" preserveAspectRatio="none">
            <line x1="1" y1="0" x2="1" y2="100" stroke="color-mix(in srgb, var(--color-white) 8%, transparent)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
            <motion.line x1="1" y1="0" x2="1" y2="100" stroke="var(--color-volt)" strokeWidth="2" vectorEffect="non-scaling-stroke" style={{ pathLength: reduced ? 1 : draw }} />
          </svg>

          <ol className="relative grid gap-10 lg:grid-cols-3 lg:gap-8">
            {STEPS.map((s, i) => (
              <motion.li
                key={s.title}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-10% 0px' }}
                transition={{ duration: 0.7, delay: i * 0.12, ease: EASE }}
                className="flex gap-5 lg:flex-col lg:items-center lg:text-center"
              >
                <div className="relative shrink-0">
                  <motion.div
                    whileHover={{ rotate: -8, scale: 1.06 }}
                    className="relative flex h-16 w-16 items-center justify-center rounded-2xl bg-ink-800 ring-1 ring-volt/30 shadow-glow-volt lg:h-20 lg:w-20"
                  >
                    <s.icon className="h-7 w-7 text-volt lg:h-8 lg:w-8" />
                    <span className="absolute -top-2 -right-2 flex h-6 w-6 items-center justify-center rounded-full bg-volt font-display text-xs font-bold text-ink-950">
                      {i + 1}
                    </span>
                  </motion.div>
                </div>
                <div>
                  <h3 className="text-lg font-semibold sm:text-xl">{s.title}</h3>
                  <p className="mt-2 max-w-xs text-sm leading-relaxed text-fg/65">{s.body}</p>
                  <span className="mt-3 inline-block rounded-full bg-white/5 px-3 py-1 text-xs font-medium text-fg/75 ring-1 ring-white/10">{s.tag}</span>
                </div>
              </motion.li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  )
}

// ───────────────────────────── Social proof ─────────────────────────────

export function SocialProof() {
  return (
    <section id="players" tabIndex={-1} aria-labelledby="players-title" className="relative py-24 outline-none sm:py-32">
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />
      <div className="mx-auto max-w-6xl px-5 sm:px-8">
        <div className="flex flex-col items-start justify-between gap-8 lg:flex-row lg:items-end">
          <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.7, ease: EASE }}>
            <div className="text-xs font-bold tracking-[0.22em] text-volt uppercase">Players</div>
            <h2 id="players-title" className="mt-4 max-w-2xl text-[clamp(2rem,5vw,3.2rem)] leading-[1.05] font-bold">
              Kochi’s Thursday-night games run on PYTCH.
            </h2>
          </motion.div>
          <dl className="grid w-full grid-cols-2 gap-3 sm:grid-cols-4 lg:w-auto">
            {[
              { v: 18400, l: 'players', f: (n: number) => `${Math.round(n).toLocaleString('en-IN')}+` },
              { v: 142, l: 'turfs', f: (n: number) => Math.round(n).toString() },
              { v: 94, l: 'splits filled', f: (n: number) => `${Math.round(n)}%` },
              { v: 4.9, l: 'avg rating', f: (n: number) => n.toFixed(1) },
            ].map((s) => (
              <div key={s.l} className="flex flex-col-reverse rounded-2xl bg-white/4 px-4 py-3 ring-1 ring-white/8 lg:min-w-36">
                <dt className="text-xs text-muted">{s.l}</dt>
                <dd className="font-display text-xl text-fg sm:text-2xl">
                  <AnimatedNumber value={s.v} format={s.f} duration={1.8} />
                </dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="mt-14 grid gap-5 md:grid-cols-3">
          {TESTIMONIALS.map((t, i) => (
            <Card
              key={t.player.id}
              spotlight
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-8% 0px' }}
              transition={{ duration: 0.7, delay: i * 0.1, ease: EASE }}
              whileHover={{ y: -4 }}
              className="flex flex-col p-6"
            >
              <figure className="flex flex-1 flex-col">
              <div aria-hidden className="font-display text-5xl leading-none text-volt/40">“</div>
              <blockquote className="-mt-3 flex-1 text-[15px] leading-relaxed text-fg/85">{t.quote}</blockquote>
              <figcaption className="mt-6 flex items-center gap-3">
                <Avatar user={t.player} size="md" ring />
                <div className="flex-1">
                  <div className="text-sm font-semibold">{t.player.name}</div>
                  <div className="text-xs text-muted">{t.area}</div>
                </div>
                <span className="rounded-lg bg-white/6 px-2 py-0.5 font-mono text-xs ring-1 ring-white/10">
                  <span className="text-[10px] font-bold text-muted">TS </span>
                  {t.ts}
                </span>
              </figcaption>
              </figure>
            </Card>
          ))}
        </div>
        <p className="mt-6 text-center text-xs text-subtle">Stories are illustrative of the product flow.</p>
      </div>
    </section>
  )
}

// ───────────────────────────── Final CTA ─────────────────────────────

function MagneticLink({ to, children, className }: { to: string; children: React.ReactNode; className?: string }) {
  const x = useMotionValue(0)
  const y = useMotionValue(0)
  const sx = useSpring(x, { stiffness: 250, damping: 18 })
  const sy = useSpring(y, { stiffness: 250, damping: 18 })
  return (
    <motion.div
      className="inline-block p-3"
      onPointerMove={(e) => {
        if (e.pointerType !== 'mouse') return
        const r = e.currentTarget.getBoundingClientRect()
        x.set((e.clientX - r.left - r.width / 2) * 0.3)
        y.set((e.clientY - r.top - r.height / 2) * 0.4)
      }}
      onPointerLeave={() => {
        x.set(0)
        y.set(0)
      }}
    >
      <motion.div style={{ x: sx, y: sy }}>
        <Link to={to} className={className}>
          {children}
        </Link>
      </motion.div>
    </motion.div>
  )
}

export function FinalCta() {
  const authed = useAuth((s) => !!s.accessToken)
  return (
    <section aria-labelledby="cta-title" className="relative px-4 py-20 sm:px-8 sm:py-28">
      <motion.div
        initial={{ opacity: 0, y: 40, scale: 0.97 }}
        whileInView={{ opacity: 1, y: 0, scale: 1 }}
        viewport={{ once: true, margin: '-10% 0px' }}
        transition={{ duration: 0.9, ease: EASE }}
        className="relative mx-auto max-w-5xl overflow-hidden rounded-[2rem] p-px"
      >
        <motion.div
          aria-hidden
          className="absolute inset-[-60%] bg-[conic-gradient(from_0deg,var(--color-volt),var(--color-mint),var(--color-electric),var(--color-grape),var(--color-flare),var(--color-volt))] opacity-70"
          animate={{ rotate: 360 }}
          transition={{ duration: 10, repeat: Infinity, ease: 'linear' }}
        />
        <div className="relative overflow-hidden rounded-[calc(2rem-1px)] bg-ink-900 px-6 py-16 text-center sm:px-12 sm:py-24">
          <div aria-hidden className="pitch-grid absolute inset-0 opacity-70 [mask-image:radial-gradient(ellipse_at_center,black_20%,transparent_70%)]" />
          <div aria-hidden className="absolute -top-32 left-1/2 h-72 w-[36rem] -translate-x-1/2 rounded-full bg-volt/15 blur-[90px]" />
          <div className="relative">
            <motion.div
              animate={{ rotate: [0, 360] }}
              transition={{ duration: 12, repeat: Infinity, ease: 'linear' }}
              className="mx-auto mb-6 w-fit"
              aria-hidden
            >
              <LogoMark className="h-12 w-12" />
            </motion.div>
            <h2 id="cta-title" className="mx-auto max-w-3xl text-[clamp(2.1rem,6vw,4rem)] leading-[1.02] font-black">
              Your next game is <span className="text-gradient-volt">30 minutes</span> away.
            </h2>
            <p className="mx-auto mt-5 max-w-lg text-fg/65 sm:text-lg">Sign in with your phone number. No passwords, no app store, no ₹1,500 on your card.</p>
            <div className="mt-8 flex flex-col items-center justify-center gap-1 sm:flex-row">
              <MagneticLink to={authed ? '/app' : '/login'} className={cn(buttonVariants({ size: 'lg' }), 'group px-9')}>
                {authed ? 'Open the app' : 'Start playing — free'}
                <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-1" />
              </MagneticLink>
              {!authed && (
                <Link to="/login?demo=1" className={cn(buttonVariants({ variant: 'secondary', size: 'lg' }))}>
                  <Sparkles className="h-4 w-4 text-volt" /> Try the demo account
                </Link>
              )}
            </div>
          </div>
        </div>
      </motion.div>
    </section>
  )
}

// ───────────────────────────── Footer ─────────────────────────────

export function LandingFooter({ onJump }: { onJump: (selector: string) => void }) {
  const cols = [
    {
      title: 'Product',
      links: [
        { label: 'Split payments', href: '#split' },
        { label: 'Live bench', href: '#bench' },
        { label: 'True Skill', href: '#skill' },
        { label: 'Highlights', href: '#highlights' },
        { label: 'Weather-smart', href: '#weather' },
      ],
    },
    {
      title: 'Play',
      links: [
        { label: 'Log in', to: '/login' },
        { label: 'Try the demo', to: '/login?demo=1' },
        { label: 'How it works', href: '#how' },
      ],
    },
    {
      title: 'Venues',
      links: [
        { label: 'Own a turf? Partner with Pytch', to: '/partner/login' },
        { label: 'Partner login', to: '/partner/login' },
      ],
    },
  ]
  return (
    <footer className="relative overflow-hidden border-t border-white/6 pt-16">
      <div className="mx-auto grid max-w-6xl gap-12 px-5 sm:px-8 md:grid-cols-[1.5fr_1fr_1fr_1fr]">
        <div>
          <div className="flex items-center gap-2.5">
            <LogoMark />
            <span className="font-display text-xl font-bold">
              PYT<span className="text-volt">C</span>H
            </span>
          </div>
          <p className="mt-4 max-w-xs text-sm leading-relaxed text-muted">
            Turf booking, split payments and matchmaking for Kochi. Built for the people who actually turn up.
          </p>
          <p className="mt-6 flex items-center gap-1.5 text-xs text-subtle">
            Made with <Heart className="h-3 w-3 fill-flare text-flare" /> and a lot of 5-a-side in Kochi, Kerala
          </p>
        </div>
        {cols.map((c) => (
          <nav key={c.title} aria-label={c.title}>
            <div className="text-xs font-bold tracking-[0.2em] text-fg/60 uppercase">{c.title}</div>
            <ul className="mt-4 space-y-2.5">
              {c.links.map((l) => (
                <li key={l.label}>
                  {'to' in l && l.to ? (
                    <Link to={l.to} className="text-sm text-muted transition hover:text-volt">
                      {l.label}
                    </Link>
                  ) : (
                    <a
                      href={'href' in l ? l.href : '#'}
                      onClick={(e) => {
                        e.preventDefault()
                        if ('href' in l && l.href) onJump(l.href)
                      }}
                      className="text-sm text-muted transition hover:text-volt"
                    >
                      {l.label}
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      <div className="mx-auto mt-14 flex max-w-6xl flex-col items-start justify-between gap-2 px-5 text-xs text-subtle sm:flex-row sm:px-8">
        <span>© {new Date().getFullYear()} PYTCH. All rights reserved.</span>
        <span>Payments by Razorpay · Weather by Open-Meteo</span>
      </div>
      <div
        aria-hidden
        className="pointer-events-none mt-6 -mb-[0.2em] text-center font-display text-[24vw] leading-[0.8] font-black tracking-tighter text-transparent select-none"
        style={{ backgroundImage: 'linear-gradient(to bottom, color-mix(in srgb, var(--color-volt) 12%, transparent), transparent 85%)', WebkitBackgroundClip: 'text', backgroundClip: 'text' }}
      >
        PYTCH
      </div>
    </footer>
  )
}
