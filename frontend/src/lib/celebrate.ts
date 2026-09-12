import confetti from 'canvas-confetti'
import { cssVar } from '@/stores/theme'

// confetti paints on a canvas → resolve theme tokens to real colours at call time
const brand = () => {
  const colors = ['--color-volt', '--color-mint', '--color-electric', '--color-grape'].map((v) => cssVar(v))
  // white sparkle pieces pop on dark but vanish on the light page
  return document.documentElement.dataset.theme === 'light' ? [...colors, cssVar('--color-sun')] : [...colors, '#ffffff']
}

/** Big two-sided burst — booking confirmed, badge unlocked. */
export function celebrate() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  const end = Date.now() + 700
  const frame = () => {
    confetti({ particleCount: 5, angle: 60, spread: 70, origin: { x: 0, y: 0.7 }, colors: brand(), disableForReducedMotion: true })
    confetti({ particleCount: 5, angle: 120, spread: 70, origin: { x: 1, y: 0.7 }, colors: brand(), disableForReducedMotion: true })
    if (Date.now() < end) requestAnimationFrame(frame)
  }
  frame()
}

/** Small pop from a point (0..1 viewport coords) — payment success, like. */
export function pop(x = 0.5, y = 0.5) {
  confetti({ particleCount: 60, spread: 80, startVelocity: 35, scalar: 0.8, origin: { x, y }, colors: brand(), disableForReducedMotion: true })
}
