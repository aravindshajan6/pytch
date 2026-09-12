import { createTimeline, stagger, svg } from 'animejs'
import { ArrowLeft, Home } from 'lucide-react'
import { motion } from 'motion/react'
import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router'
import { Logo } from '@/components/layout/Logo'
import { Button, LinkButton } from '@/components/ui/Button'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { useAuth } from '@/stores/auth'

/** "Offside!" 404 — a looping VAR replay (animejs timeline) of a player caught beyond the last defender. */
export default function NotFoundPage() {
  const authed = useAuth((s) => !!s.accessToken)
  const navigate = useNavigate()
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)')

  useEffect(() => {
    const prev = document.title
    document.title = 'Offside! · PYTCH'
    return () => void (document.title = prev)
  }, [])

  return (
    <main className="relative flex min-h-dvh flex-col items-center overflow-hidden bg-ink-900 px-5 py-6">
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute top-[-20%] left-1/2 h-[40rem] w-[40rem] -translate-x-1/2 rounded-full bg-flare/[0.08] blur-[120px]" />
        <div className="absolute right-[-10%] bottom-[-20%] h-[30rem] w-[30rem] rounded-full bg-volt/[0.06] blur-[120px]" />
        <div className="pitch-grid absolute inset-0 [mask-image:radial-gradient(ellipse_at_center,black_20%,transparent_70%)]" />
        <div className="noise absolute inset-0" />
      </div>

      <header className="relative w-full max-w-5xl">
        <Logo to={authed ? '/app' : '/'} />
      </header>

      <div className="relative flex w-full max-w-2xl flex-1 flex-col items-center justify-center py-10 text-center">
        <div className="flex items-center font-display text-[clamp(5.5rem,24vw,11rem)] leading-none font-black tracking-tighter" aria-hidden>
          <motion.span initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ type: 'spring', stiffness: 200, damping: 16 }}>
            4
          </motion.span>
          <motion.span
            initial={{ x: '-60vw', rotate: -720 }}
            animate={{ x: 0, rotate: 0 }}
            transition={{ type: 'spring', stiffness: 60, damping: 12, delay: 0.15 }}
            className="mx-1 inline-flex"
          >
            <Ball spinning={!reduced} />
          </motion.span>
          <motion.span initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ type: 'spring', stiffness: 200, damping: 16, delay: 0.1 }}>
            4
          </motion.span>
        </div>

        <div className="mt-4 flex items-center gap-3">
          <Flag />
          <h1 className="text-4xl font-black sm:text-5xl">
            <span className="text-gradient-flare">Offside!</span>
          </h1>
        </div>
        <p className="mt-4 max-w-md text-fg/70">
          This page is beyond the last defender — the linesman’s flag is up and VAR agrees. Let’s get you back onside.
        </p>

        <VarReplay reduced={reduced} />

        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <LinkButton to={authed ? '/app' : '/'} size="lg">
            <Home className="h-5 w-5" /> Back onside
          </LinkButton>
          <Button variant="secondary" size="lg" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-5 w-5" /> Go back
          </Button>
        </div>
      </div>
    </main>
  )
}

function Ball({ spinning }: { spinning: boolean }) {
  return (
    <motion.svg
      viewBox="0 0 100 100"
      className="h-[0.78em] w-[0.78em] drop-shadow-[0_0_30px_color-mix(in_srgb,_var(--color-volt)_45%,_transparent)]"
      animate={spinning ? { rotate: 360 } : undefined}
      transition={{ duration: 6, repeat: Infinity, ease: 'linear', delay: 1.4 }}
    >
      <defs>
        <radialGradient id="nf-ball" cx="35%" cy="30%" r="75%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="55%" stopColor="#dce6df" />
          <stop offset="100%" stopColor="#5b6b64" />
        </radialGradient>
      </defs>
      <circle cx="50" cy="50" r="46" fill="url(#nf-ball)" stroke="var(--color-volt)" strokeWidth="2.5" />
      <polygon points="50,32 67,44 61,64 39,64 33,44" fill="#0a1411" stroke="var(--color-volt)" strokeWidth="1.6" />
      {[0, 72, 144, 216, 288].map((a) => {
        const r = (a * Math.PI) / 180
        return (
          <g key={a}>
            <line x1={50 + 18 * Math.sin(r)} y1={49 - 18 * Math.cos(r)} x2={50 + 36 * Math.sin(r)} y2={49 - 36 * Math.cos(r)} stroke="var(--color-volt)" strokeWidth="1.4" />
            <circle cx={50 + 39 * Math.sin(r + 0.63)} cy={50 - 39 * Math.cos(r + 0.63)} r="5.5" fill="#0a1411" />
          </g>
        )
      })}
    </motion.svg>
  )
}

function Flag() {
  return (
    <motion.svg viewBox="0 0 40 48" className="h-10 w-9" aria-hidden initial={{ rotate: -30, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} transition={{ delay: 0.6, type: 'spring' }}>
      <line x1="6" y1="4" x2="6" y2="46" stroke="var(--color-fg)" strokeWidth="3" strokeLinecap="round" />
      <motion.path
        d="M7 5 L36 9 L7 24 Z"
        fill="var(--color-flare)"
        style={{ originX: 0, originY: 0 }}
        animate={{ skewY: [0, -8, 4, -6, 0], scaleX: [1, 0.92, 1.02, 0.95, 1] }}
        transition={{ duration: 1.1, repeat: Infinity, ease: 'easeInOut' }}
      />
      <path d="M7 5 L21 7 L7 14 Z" fill="var(--color-sun)" opacity="0.85" />
    </motion.svg>
  )
}

/** Top-down VAR replay: pass → run → lines drawn → OFFSIDE stamp. Loops. */
function VarReplay({ reduced }: { reduced: boolean }) {
  const ref = useRef<SVGSVGElement>(null)

  useEffect(() => {
    const root = ref.current
    if (!root || reduced) return
    const q = (sel: string) => root.querySelector(sel) as SVGElement
    const lines = svg.createDrawable(root.querySelectorAll('[data-line]'))
    const tl = createTimeline({ loop: true, loopDelay: 1600, defaults: { ease: 'outExpo' } })
    tl.add(q('[data-attacker]'), { translateX: [0, 34], duration: 900, ease: 'inOutSine' })
      .add(q('[data-ball]'), { translateX: [0, 170], translateY: [0, -14], duration: 900, ease: 'inOutQuad' }, '-=700')
      .add(q('[data-freeze]'), { opacity: [0, 1, 0.6], duration: 300 })
      .add(lines, { draw: ['0 0', '0 1'], duration: 700, delay: stagger(180) })
      .add(q('[data-zone]'), { opacity: [0, 0.3], duration: 500 }, '-=300')
      .add(q('[data-stamp]'), { scale: [2.4, 1], opacity: [0, 1], rotate: [-22, -8], duration: 700, ease: 'outBack(2)' })
      .add(q('[data-stamp]'), { opacity: 0, duration: 400, delay: 1400 })
      .add([q('[data-zone]'), q('[data-freeze]')], { opacity: 0, duration: 300 }, '<')
    return () => {
      tl.revert()
    }
  }, [reduced])

  const defenders = [
    { x: 150, y: 50 },
    { x: 238, y: 92 },
    { x: 226, y: 150 },
    { x: 190, y: 120 },
  ]

  return (
    <figure className="mt-8 w-full max-w-lg">
      {/* broadcast-style replay: a dark island in both themes */}
      <svg
        ref={ref}
        data-theme="dark"
        viewBox="0 0 400 200"
        className="w-full overflow-visible rounded-3xl ring-1 ring-white/10 [[data-theme=light]_&]:shadow-[0_24px_50px_-24px_rgb(14_42_26/0.5)]"
        role="img" aria-label="VAR replay: an attacker is caught offside">
        <defs>
          <linearGradient id="nf-grass" x1="0" x2="1">
            <stop offset="0" stopColor="#0c2016" />
            <stop offset="1" stopColor="#0e2619" />
          </linearGradient>
          <clipPath id="nf-clip">
            <rect width="400" height="200" rx="24" />
          </clipPath>
        </defs>
        <g clipPath="url(#nf-clip)">
          <rect width="400" height="200" fill="url(#nf-grass)" />
          {Array.from({ length: 8 }, (_, i) => (
            <rect key={i} x={i * 50} width="25" height="200" fill="color-mix(in srgb, var(--color-white) 2.5%, transparent)" />
          ))}
          <g stroke="color-mix(in srgb, var(--color-fg) 35%, transparent)" strokeWidth="2" fill="none">
            <rect x="12" y="12" width="376" height="176" />
            <line x1="100" y1="12" x2="100" y2="188" />
            <circle cx="100" cy="100" r="28" />
            <rect x="318" y="50" width="70" height="100" />
            <rect x="360" y="78" width="28" height="44" />
          </g>
          {/* offside zone between the last defender and the attacker */}
          <rect data-zone x="238" y="12" width="44" height="176" fill="var(--color-flare)" opacity={reduced ? 0.3 : 0} />
          <rect data-freeze width="400" height="200" fill="color-mix(in srgb, var(--color-electric) 6%, transparent)" opacity={reduced ? 0.6 : 0} />
          <line data-line x1="238" y1="12" x2="238" y2="188" stroke="var(--color-volt)" strokeWidth="2.5" strokeDasharray={reduced ? undefined : '0 2000'} pathLength={1000} />
          <line data-line x1="282" y1="12" x2="282" y2="188" stroke="var(--color-flare)" strokeWidth="2.5" strokeDasharray={reduced ? undefined : '0 2000'} pathLength={1000} />
          {defenders.map((d, i) => (
            <g key={i}>
              <circle cx={d.x} cy={d.y} r="9" fill="var(--color-electric)" />
              <circle cx={d.x} cy={d.y} r="13" fill="none" stroke="color-mix(in srgb, var(--color-electric) 35%, transparent)" strokeWidth="2" />
            </g>
          ))}
          <circle cx="366" cy="100" r="9" fill="var(--color-sun)" />
          <g data-attacker style={reduced ? { transform: 'translateX(34px)' } : undefined}>
            <circle cx="248" cy="70" r="9" fill="var(--color-flare)" />
            <circle cx="248" cy="70" r="13" fill="none" stroke="color-mix(in srgb, var(--color-flare) 45%, transparent)" strokeWidth="2" />
          </g>
          <circle cx="112" cy="84" r="9" fill="var(--color-flare)" opacity="0.9" />
          <circle data-ball cx="112" cy="84" r="4.5" fill="#fff" style={reduced ? { transform: 'translate(170px,-14px)' } : undefined} />
          <g data-stamp opacity={reduced ? 1 : 0} style={{ transformBox: 'fill-box', transformOrigin: 'center' }}>
            <rect x="120" y="76" width="160" height="48" rx="10" fill="color-mix(in srgb, var(--color-ink-900) 80%, transparent)" stroke="var(--color-flare)" strokeWidth="3" />
            <text x="200" y="108" textAnchor="middle" fill="var(--color-flare)" fontFamily="Unbounded Variable, sans-serif" fontWeight="900" fontSize="22" letterSpacing="3">
              OFFSIDE
            </text>
          </g>
          <text x="22" y="32" fill="color-mix(in srgb, var(--color-fg) 55%, transparent)" fontFamily="JetBrains Mono Variable, monospace" fontSize="10" letterSpacing="2">
            VAR · CHECK COMPLETE
          </text>
        </g>
      </svg>
      <figcaption className="mt-2 text-xs text-subtle">Decision: page not found. No appeals.</figcaption>
    </figure>
  )
}
