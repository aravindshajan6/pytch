import { animate, stagger, svg } from 'animejs'
import { useEffect, useRef } from 'react'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { cn } from '@/lib/cn'

export interface RevealLine {
  text: string
  className?: string
  /** draw a hand-scribbled underline under this line */
  underline?: boolean
}

/**
 * Headline whose letters rise out of per-glyph masks with an animejs stagger,
 * followed by an SVG underline "drawn" in with animejs' drawable helper.
 * Screen readers get the plain sentence via aria-label.
 */
export function RevealText({
  lines,
  as: Tag = 'h1',
  className,
  delay = 150,
}: {
  lines: RevealLine[]
  as?: 'h1' | 'h2'
  className?: string
  delay?: number
}) {
  const ref = useRef<HTMLHeadingElement>(null)
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)')

  useEffect(() => {
    const root = ref.current
    if (reduced || !root) return
    const chars = root.querySelectorAll<HTMLElement>('[data-char]')
    const total = chars.length
    const letters = animate(chars, {
      translateY: ['115%', '0%'],
      rotate: [10, 0],
      opacity: [0, 1],
      duration: 1100,
      delay: stagger(34, { start: delay }),
      ease: 'outExpo',
    })
    const paths = root.querySelectorAll<SVGPathElement>('[data-scribble]')
    const drawables = paths.length ? svg.createDrawable(paths) : []
    const underline = drawables.length
      ? animate(drawables, { draw: ['0 0', '0 1'], duration: 900, delay: delay + total * 34 + 150, ease: 'inOutQuad' })
      : null
    return () => {
      letters.revert()
      underline?.revert()
    }
  }, [reduced, delay])

  return (
    <Tag ref={ref} className={className} aria-label={lines.map((l) => l.text).join(' ')}>
      {lines.map((line, li) => {
        const words = line.text.split(' ')
        return (
          <span key={li} aria-hidden className={cn('relative block w-fit', line.className)}>
            {words.map((word, wi) => (
              <span key={wi} className="inline-block whitespace-nowrap">
                {[...word].map((ch, ci) => (
                  <span key={ci} className="-mb-[0.12em] inline-block overflow-hidden pb-[0.12em] align-bottom">
                    <span data-char className={cn('inline-block origin-bottom-left will-change-transform', !reduced && 'opacity-0')}>
                      {ch}
                    </span>
                  </span>
                ))}
                {wi < words.length - 1 && <span className="inline-block w-[0.3em]" />}
              </span>
            ))}
            {line.underline && (
              <svg
                className="pointer-events-none absolute -bottom-[0.18em] left-0 h-[0.3em] w-full overflow-visible"
                viewBox="0 0 300 20"
                preserveAspectRatio="none"
                fill="none"
              >
                <path
                  data-scribble
                  d="M3 14 C 60 4, 120 4, 170 10 S 260 17, 297 6"
                  stroke="currentColor"
                  strokeWidth="4"
                  strokeLinecap="round"
                  // hidden until animejs' drawable takes over (it writes these same attributes)
                  strokeDasharray={reduced ? undefined : '0 2000'}
                  pathLength={1000}
                />
              </svg>
            )}
          </span>
        )
      })}
    </Tag>
  )
}
