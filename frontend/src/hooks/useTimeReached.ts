import { useEffect, useState } from 'react'

const MAX_TIMEOUT = 2 ** 31 - 1 // setTimeout overflows past ~24.8 days

/**
 * `true` once the wall clock reaches `atMs` (epoch ms). Re-renders exactly once, at the crossing —
 * unlike a ticking countdown — so it's cheap for gating actions on a deadline.
 */
export function useTimeReached(atMs: number | null | undefined): boolean {
  const [reached, setReached] = useState(() => atMs != null && Date.now() >= atMs)
  useEffect(() => {
    if (atMs == null) return setReached(false)
    const left = atMs - Date.now()
    setReached(left <= 0)
    if (left <= 0) return
    let t: ReturnType<typeof setTimeout>
    const arm = () => {
      const ms = atMs - Date.now()
      if (ms <= 0) return setReached(true)
      t = setTimeout(arm, Math.min(ms, MAX_TIMEOUT))
    }
    arm()
    return () => clearTimeout(t)
  }, [atMs])
  return reached
}
