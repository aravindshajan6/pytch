import { animate } from 'animejs'
import { useReducedMotion } from 'motion/react'
import { useEffect, useMemo, useRef } from 'react'
import { alpha, tokens } from '@/lib/color'
import { cn } from '@/lib/cn'

interface RadarProps {
  center: { lat: number; lng: number }
  radiusKm: number
  blips: { lat: number; lng: number }[]
  active: boolean
  /** `sm` = compact home widget (no labels, fewer ticks). */
  size?: 'sm' | 'lg'
  className?: string
  children?: React.ReactNode
}

interface BlipPos {
  angle: number // degrees clockwise from north
  x: number // % of container
  y: number
}

const KM_PER_DEG_LAT = 110.574
const TICKS = Array.from({ length: 72 }, (_, i) => i * 5)

function toPositions(center: { lat: number; lng: number }, radiusKm: number, blips: { lat: number; lng: number }[]): BlipPos[] {
  const kmPerDegLng = 111.32 * Math.cos((center.lat * Math.PI) / 180)
  return blips.slice(0, 30).map((b) => {
    const dx = (b.lng - center.lng) * kmPerDegLng
    const dy = (b.lat - center.lat) * KM_PER_DEG_LAT
    const frac = Math.min(Math.hypot(dx, dy) / Math.max(radiusKm, 0.1), 0.95)
    const rad = Math.atan2(dx, dy)
    const angle = ((rad * 180) / Math.PI + 360) % 360
    return { angle, x: 50 + Math.sin(rad) * frac * 46, y: 50 - Math.cos(rad) * frac * 46 }
  })
}

/**
 * Live Bench radar: concentric rings, a rotating conic sweep and approximate player
 * blips (server-snapped to ~1 km cells — never exact spots) that ping as the sweep passes over them. One rAF loop drives the sweep
 * (transform only) and fires animejs pings on crossing — no per-frame React work.
 */
export function Radar({ center, radiusKm, blips, active, size = 'lg', className, children }: RadarProps) {
  const reduce = useReducedMotion()
  const rootRef = useRef<HTMLDivElement>(null)
  const sweepRef = useRef<HTMLDivElement>(null)
  const dotRefs = useRef<(HTMLSpanElement | null)[]>([])
  const ringRefs = useRef<(HTMLSpanElement | null)[]>([])
  const angleRef = useRef(0)

  const positions = useMemo(() => toPositions(center, radiusKm, blips), [center, radiusKm, blips])
  const posRef = useRef(positions)
  useEffect(() => {
    posRef.current = positions
  }, [positions])

  const period = active ? 3600 : 6500 // ms per revolution

  useEffect(() => {
    const sweep = sweepRef.current
    const root = rootRef.current
    if (!sweep || !root) return
    if (reduce) {
      sweep.style.transform = 'rotate(45deg)'
      return
    }
    let raf = 0
    let last = 0
    let visible = true
    const degPerMs = 360 / period

    const ping = (i: number) => {
      const dot = dotRefs.current[i]
      const ring = ringRefs.current[i]
      if (dot) animate(dot, { scale: [1.9, 1], opacity: [1, 0.5], duration: 2600, ease: 'outExpo' })
      if (ring) animate(ring, { scale: [0.4, 3.2], opacity: [0.9, 0], duration: 1300, ease: 'outQuad' })
    }

    const tick = (t: number) => {
      const dt = last ? Math.min(t - last, 64) : 16
      last = t
      const prev = angleRef.current
      const next = (prev + dt * degPerMs) % 360
      angleRef.current = next
      sweep.style.transform = `rotate(${next}deg)`
      const list = posRef.current
      for (let i = 0; i < list.length; i++) {
        const a = list[i]!.angle
        const crossed = prev <= next ? a > prev && a <= next : a > prev || a <= next
        if (crossed) ping(i)
      }
      raf = requestAnimationFrame(tick)
    }

    const start = () => {
      if (raf || !visible) return
      last = 0
      raf = requestAnimationFrame(tick)
    }
    const stop = () => {
      cancelAnimationFrame(raf)
      raf = 0
    }
    const io = new IntersectionObserver(([e]) => {
      visible = !!e?.isIntersecting
      if (visible) start()
      else stop()
    })
    io.observe(root)
    start()
    return () => {
      io.disconnect()
      stop()
    }
  }, [reduce, period])

  const lg = size === 'lg'
  const tone = active ? tokens.volt : tokens.electric // theme vars: neon on night, deep turf/teal on day
  const t = (a: number) => alpha(tone, a)

  return (
    <div
      ref={rootRef}
      className={cn('relative aspect-square w-full select-none', className)}
      role="img"
      aria-label={`Radar: approximate spots of players on the bench within ${radiusKm} km`}
    >
      {/* disc */}
      <div
        className="absolute inset-0 rounded-full"
        style={{
          background: `radial-gradient(circle at 50% 50%, ${t(active ? 0.12 : 0.06)} 0%, color-mix(in srgb, var(--color-ink-900) 60%, transparent) 55%, color-mix(in srgb, var(--color-ink-950) 95%, transparent) 100%)`,
          boxShadow: `inset 0 0 0 1px ${t(0.25)}, inset 0 0 60px ${t(0.08)}, 0 0 ${active ? 80 : 40}px -20px ${t(0.6)}`,
          transition: 'box-shadow 0.6s, background 0.6s',
        }}
      />

      {/* rings + crosshair + ticks */}
      <svg viewBox="0 0 200 200" className="absolute inset-0 h-full w-full" aria-hidden>
        {[0.25, 0.5, 0.75, 1].map((f, i) => (
          <circle
            key={f}
            cx="100"
            cy="100"
            r={f * 92}
            fill="none"
            style={{ stroke: t(i === 3 ? 0.35 : 0.16) }}
            strokeWidth={i === 3 ? 0.8 : 0.5}
            strokeDasharray={i === 3 ? undefined : '1.5 2.5'}
          />
        ))}
        <line x1="100" y1="8" x2="100" y2="192" style={{ stroke: t(0.1) }} strokeWidth="0.5" />
        <line x1="8" y1="100" x2="192" y2="100" style={{ stroke: t(0.1) }} strokeWidth="0.5" />
        {lg &&
          TICKS.map((deg) => {
            const r1 = 92
            const r2 = deg % 30 === 0 ? 87 : 90
            const rad = (deg * Math.PI) / 180
            return (
              <line
                key={deg}
                x1={100 + Math.sin(rad) * r1}
                y1={100 - Math.cos(rad) * r1}
                x2={100 + Math.sin(rad) * r2}
                y2={100 - Math.cos(rad) * r2}
                style={{ stroke: t(deg % 30 === 0 ? 0.5 : 0.2) }}
                strokeWidth="0.5"
              />
            )
          })}
        {lg &&
          [0.5, 1].map((f) => (
            <text
              key={f}
              x={100 + 3}
              y={100 - f * 92 + 7}
              fontSize="5"
              style={{ fill: t(0.55) }}
              fontFamily="JetBrains Mono Variable, monospace"
            >
              {Math.round(radiusKm * f * 10) / 10} km
            </text>
          ))}
      </svg>

      {/* sweep */}
      <div
        ref={sweepRef}
        aria-hidden
        className="absolute inset-[4%] rounded-full will-change-transform"
        style={{
          background: `conic-gradient(from 0deg, transparent 0deg, transparent 250deg, ${t(0.03)} 280deg, ${t(0.14)} 330deg, ${t(active ? 0.42 : 0.25)} 359deg, transparent 360deg)`,
        }}
      >
        <div
          className="absolute top-0 left-1/2 h-1/2 w-[2px] -translate-x-1/2"
          style={{ background: `linear-gradient(to top, transparent, ${t(0.95)})`, boxShadow: `0 0 12px ${t(0.9)}` }}
        />
      </div>

      {/* blips */}
      {positions.map((p, i) => (
        <span
          key={`${i}-${p.x.toFixed(1)}-${p.y.toFixed(1)}`}
          className="absolute -translate-x-1/2 -translate-y-1/2"
          style={{ left: `${p.x}%`, top: `${p.y}%` }}
          aria-hidden
        >
          <span
            ref={(el) => {
              ringRefs.current[i] = el
            }}
            className="absolute inset-0 rounded-full opacity-0"
            style={{ boxShadow: `0 0 0 1.5px ${t(0.9)}` }}
          />
          <span
            ref={(el) => {
              dotRefs.current[i] = el
            }}
            className={cn('block rounded-full', lg ? 'h-2.5 w-2.5' : 'h-1.5 w-1.5')}
            style={{
              background: tone,
              boxShadow: `0 0 10px ${t(0.9)}`,
              opacity: reduce ? 0.9 : 0.45,
            }}
          />
        </span>
      ))}

      {/* centre: you */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
        {active && !reduce && (
          <>
            <span className="absolute inset-0 animate-pulse-ring rounded-full bg-volt/40" />
            <span className="absolute inset-0 animate-pulse-ring rounded-full bg-volt/30 [animation-delay:1.1s]" />
          </>
        )}
        <div className="relative">{children ?? <span className={cn('block rounded-full bg-fg', lg ? 'h-3 w-3' : 'h-2 w-2')} />}</div>
      </div>
    </div>
  )
}
