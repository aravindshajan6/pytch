import { Component, lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { cn } from '@/lib/cn'
import { useResolvedTheme } from '@/stores/theme'
import { hasWebGL } from './capabilities'
import type { HeroMood, HeroVariant } from './HeroScene'

const HeroScene = lazy(() => import('./HeroScene'))

/**
 * Mounts the 3D hero lazily and safely:
 *  - skipped entirely for `prefers-reduced-motion` or when WebGL is missing (static art instead)
 *  - three.js chunk is only fetched once the container is near the viewport
 *  - the render loop pauses while the canvas is off-screen or the tab is hidden
 *  - any runtime GL error falls back to the static art (error boundary)
 *  - the scene follows the app theme: dark → floodlit night, light → golden-hour day
 */
export function HeroCanvas({
  variant = 'full',
  className,
  scrollLinked = true,
}: {
  variant?: HeroVariant
  className?: string
  scrollLinked?: boolean
}) {
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)')
  const [supported] = useState(() => typeof window !== 'undefined' && hasWebGL())
  const ref = useRef<HTMLDivElement>(null)
  const [near, setNear] = useState(false)
  const [visible, setVisible] = useState(false)
  const [ready, setReady] = useState(false)
  const [tabVisible, setTabVisible] = useState(() => typeof document === 'undefined' || !document.hidden)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(
      ([entry]) => {
        const v = !!entry?.isIntersecting
        setVisible(v)
        if (v) setNear(true)
      },
      { rootMargin: '200px 0px' },
    )
    io.observe(el)
    const onVis = () => setTabVisible(!document.hidden)
    document.addEventListener('visibilitychange', onVis)
    return () => {
      io.disconnect()
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [])

  const enable3d = supported && !reduced
  const mood: HeroMood = useResolvedTheme() === 'light' ? 'day' : 'night'

  return (
    <div ref={ref} className={cn('absolute inset-0', className)} aria-hidden>
      <HeroFallback variant={variant} dim={ready} mood={mood} />
      {enable3d && near && (
        <GLBoundary>
          <Suspense fallback={null}>
            <div className={cn('absolute inset-0 transition-opacity duration-[1400ms] ease-out', ready ? 'opacity-100' : 'opacity-0')}>
              <HeroScene
                variant={variant}
                active={visible && tabVisible}
                scrollLinked={scrollLinked}
                mood={mood}
                onReady={() => requestAnimationFrame(() => setReady(true))}
              />
            </div>
          </Suspense>
        </GLBoundary>
      )}
    </div>
  )
}

class GLBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    return this.state.failed ? null : this.props.children
  }
}

/**
 * Static stand-in (also the Suspense/no-WebGL/reduced-motion view): floodlit
 * gradient sky (or warm sunlight by day), a perspective pitch drawn in CSS and a flat ball.
 */
export function HeroFallback({ variant = 'full', dim = false, mood = 'night' }: { variant?: HeroVariant; dim?: boolean; mood?: HeroMood }) {
  const day = mood === 'day'
  return (
    <div className={cn('absolute inset-0 overflow-hidden transition-opacity duration-1000', dim && 'opacity-0')}>
      <div
        className={cn(
          'absolute inset-0',
          day
            ? 'bg-[radial-gradient(90%_60%_at_70%_20%,rgb(255_236_190/0.55),transparent_60%),radial-gradient(60%_50%_at_10%_10%,rgb(14_116_144/0.08),transparent_60%)]'
            : 'bg-[radial-gradient(90%_60%_at_70%_20%,rgb(200_255_46/0.14),transparent_60%),radial-gradient(60%_50%_at_10%_10%,rgb(61_217_255/0.10),transparent_60%)]',
        )}
      />
      {variant === 'full' && (
        <div className="absolute inset-x-[-30%] bottom-[-10%] h-[60%] [perspective:600px]">
          <div
            className="pitch-grid absolute inset-0 origin-bottom [transform:rotateX(62deg)]"
            style={{ maskImage: 'linear-gradient(to top, black 30%, transparent 95%)', WebkitMaskImage: 'linear-gradient(to top, black 30%, transparent 95%)' }}
          />
        </div>
      )}
      <div
        className={cn(
          'absolute rounded-full',
          variant === 'full'
            ? 'top-[16%] left-1/2 h-44 w-44 -translate-x-1/2 sm:h-64 sm:w-64 lg:top-[26%] lg:left-[70%]'
            : 'top-1/2 left-1/2 h-56 w-56 -translate-x-1/2 -translate-y-1/2',
        )}
        style={
          day
            ? {
                background: 'radial-gradient(circle at 35% 30%, #ffffff 0%, #f3f6f0 35%, #c3cec6 75%, #8e9c94 100%)',
                boxShadow: '0 30px 60px -20px rgb(14 42 26 / 0.35), inset -18px -26px 50px rgb(14 42 26 / 0.22), 0 0 0 2px rgb(63 125 0 / 0.35)',
              }
            : {
                background: 'radial-gradient(circle at 35% 30%, #ffffff 0%, #dfe9e3 30%, #7d8f86 70%, #1b2622 100%)',
                boxShadow: '0 0 80px 10px rgb(200 255 46 / 0.25), inset -20px -30px 60px rgb(0 0 0 / 0.55), 0 0 0 2px rgb(200 255 46 / 0.4)',
              }
        }
      >
        <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full opacity-80">
          <polygon points="50,33 66,45 60,64 40,64 34,45" fill={day ? '#17231c' : '#0a1411'} stroke={day ? '#3f7d00' : '#c8ff2e'} strokeWidth="1.2" />
          {[0, 72, 144, 216, 288].map((a) => (
            <line
              key={a}
              x1={50 + 17 * Math.sin((a * Math.PI) / 180)}
              y1={49 - 17 * Math.cos((a * Math.PI) / 180)}
              x2={50 + 34 * Math.sin((a * Math.PI) / 180)}
              y2={49 - 34 * Math.cos((a * Math.PI) / 180)}
              stroke={day ? '#3f7d00' : '#c8ff2e'}
              strokeWidth="1"
              opacity="0.8"
            />
          ))}
        </svg>
      </div>
    </div>
  )
}
