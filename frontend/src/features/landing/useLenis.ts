import Lenis from 'lenis'
import { useCallback, useEffect, useRef } from 'react'

/**
 * Lenis smooth scrolling scoped to the component that calls it (the landing
 * page). Skipped for reduced-motion users; fully destroyed on unmount so the
 * app shell keeps native scrolling.
 */
export function useLenis() {
  const lenisRef = useRef<Lenis | null>(null)

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const lenis = new Lenis({ lerp: 0.1, smoothWheel: true, wheelMultiplier: 0.9 })
    lenisRef.current = lenis
    let raf = requestAnimationFrame(function loop(time) {
      lenis.raf(time)
      raf = requestAnimationFrame(loop)
    })
    return () => {
      cancelAnimationFrame(raf)
      lenis.destroy()
      lenisRef.current = null
    }
  }, [])

  /** Smooth-scroll to a selector (falls back to native smooth scrolling). */
  const scrollTo = useCallback((selector: string) => {
    const el = document.querySelector<HTMLElement>(selector)
    if (!el) return
    if (lenisRef.current) lenisRef.current.scrollTo(el, { offset: -72, duration: 1.4 })
    else el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    el.focus({ preventScroll: true })
  }, [])

  return { scrollTo }
}
