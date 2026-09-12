import { useReducedMotion } from 'motion/react'
import { useEffect, useRef } from 'react'
import { cn } from '@/lib/cn'
import { useResolvedTheme } from '@/stores/theme'

// Canvas can't read CSS vars — streak colours per theme (bright on a night sky, slate on a day sky).
const STREAKS = {
  dark: { near: 'rgba(190, 230, 255, 0.5)', far: 'rgba(150, 200, 235, 0.22)' },
  light: { near: 'rgba(46, 82, 122, 0.42)', far: 'rgba(70, 105, 142, 0.2)' },
} as const

/**
 * Canvas particle rain. All drop state lives in one Float32Array; each frame is
 * two batched strokes (far + near layer) — no per-frame allocations. Pauses when
 * off-screen; draws a single static frame for reduced motion. Follows the nearest
 * `data-theme` (so it stays bright inside a dark island) and re-inits on theme change.
 */
export function RainCanvas({ intensity = 0.7, className }: { intensity?: number; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const reduce = useReducedMotion()
  const theme = useResolvedTheme()

  useEffect(() => {
    const canvas = ref.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const streaks = STREAKS[canvas.closest('[data-theme]')?.getAttribute('data-theme') === 'light' ? 'light' : 'dark']
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const count = Math.round(70 + Math.min(1, Math.max(0, intensity)) * 230)
    const drops = new Float32Array(count * 4) // x, y, len, speed
    let w = 0
    let h = 0
    let raf = 0
    let last = 0
    let visible = true
    const wind = 0.22

    const seed = (i: number, anywhere: boolean) => {
      const near = i % 3 === 0
      drops[i * 4] = Math.random() * (w + h * wind)
      drops[i * 4 + 1] = anywhere ? Math.random() * h : -Math.random() * h * 0.3
      drops[i * 4 + 2] = (near ? 18 : 9) * dpr * (0.7 + Math.random() * 0.6)
      drops[i * 4 + 3] = (near ? 1.25 : 0.75) * dpr * (0.8 + Math.random() * 0.4)
    }

    const resize = () => {
      const r = canvas.getBoundingClientRect()
      w = Math.max(1, Math.round(r.width * dpr))
      h = Math.max(1, Math.round(r.height * dpr))
      canvas.width = w
      canvas.height = h
      for (let i = 0; i < count; i++) seed(i, true)
      if (reduce) draw(0)
    }

    const draw = (dt: number) => {
      ctx.clearRect(0, 0, w, h)
      for (let layer = 0; layer < 2; layer++) {
        const near = layer === 1
        ctx.beginPath()
        ctx.strokeStyle = near ? streaks.near : streaks.far
        ctx.lineWidth = (near ? 1.3 : 0.8) * dpr
        for (let i = 0; i < count; i++) {
          if ((i % 3 === 0) !== near) continue
          const o = i * 4
          const len = drops[o + 2]
          drops[o + 1] += drops[o + 3] * dt
          drops[o] -= drops[o + 3] * dt * wind
          if (drops[o + 1] > h + len) seed(i, false)
          const x = drops[o]
          const y = drops[o + 1]
          ctx.moveTo(x, y)
          ctx.lineTo(x - len * wind, y + len)
        }
        ctx.stroke()
      }
    }

    const tick = (t: number) => {
      const dt = last ? Math.min(t - last, 50) : 16
      last = t
      draw(dt)
      raf = requestAnimationFrame(tick)
    }
    const start = () => {
      if (raf || reduce || !visible) return
      last = 0
      raf = requestAnimationFrame(tick)
    }
    const stop = () => {
      cancelAnimationFrame(raf)
      raf = 0
    }

    const ro = new ResizeObserver(resize)
    ro.observe(canvas)
    const io = new IntersectionObserver(([e]) => {
      visible = !!e?.isIntersecting
      if (visible) start()
      else stop()
    })
    io.observe(canvas)
    resize()
    start()
    return () => {
      stop()
      ro.disconnect()
      io.disconnect()
    }
  }, [intensity, reduce, theme])

  return <canvas ref={ref} aria-hidden className={cn('pointer-events-none absolute inset-0 h-full w-full', className)} />
}
