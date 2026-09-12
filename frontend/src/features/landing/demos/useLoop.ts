import { useReducedMotion } from 'motion/react'
import { useEffect, useState } from 'react'

/**
 * A looping step counter that only ticks while `active` (i.e. the demo is on
 * screen). Reduced-motion users get a single representative frame.
 */
export function useLoop(active: boolean, steps: number, ms: number, reducedStep = steps - 1): number {
  const reduced = useReducedMotion()
  const [t, setT] = useState(0)
  useEffect(() => {
    if (!active || reduced) return
    const id = setInterval(() => setT((v) => (v + 1) % steps), ms)
    return () => clearInterval(id)
  }, [active, reduced, steps, ms])
  return reduced ? reducedStep : t
}

export const mmss = (secs: number) =>
  `${Math.floor(secs / 60)
    .toString()
    .padStart(2, '0')}:${Math.floor(secs % 60)
    .toString()
    .padStart(2, '0')}`
