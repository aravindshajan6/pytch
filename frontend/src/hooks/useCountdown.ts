import { useEffect, useState } from 'react'

export interface CountdownParts {
  totalMs: number
  /** whole days left */
  days: number
  /** total hours left (not modulo a day) */
  hours: number
  minutes: number
  seconds: number
  expired: boolean
  /** "29:59", "1:05:09", or — beyond 48 h, where a ticking clock reads as noise — "5d 11h" */
  label: string
}

const LONG_MS = 48 * 3600 * 1000

function parts(target: number | null): CountdownParts {
  const totalMs = target == null ? 0 : Math.max(0, target - Date.now())
  const s = Math.floor(totalMs / 1000)
  const hours = Math.floor(s / 3600)
  const days = Math.floor(hours / 24)
  const minutes = Math.floor((s % 3600) / 60)
  const seconds = s % 60
  const pad = (n: number) => n.toString().padStart(2, '0')
  return {
    totalMs,
    days,
    hours,
    minutes,
    seconds,
    expired: target != null && totalMs === 0,
    label:
      totalMs > LONG_MS
        ? `${days}d ${hours % 24}h`
        : hours > 0
          ? `${hours}:${pad(minutes)}:${pad(seconds)}`
          : `${pad(minutes)}:${pad(seconds)}`,
  }
}

/** Live countdown to an ISO timestamp (ticks every second). */
export function useCountdown(iso: string | null | undefined): CountdownParts {
  const target = iso ? new Date(iso).getTime() : null
  const [state, setState] = useState(() => parts(target))
  useEffect(() => {
    setState(parts(target))
    if (target == null) return
    const id = setInterval(() => setState(parts(target)), 1000)
    return () => clearInterval(id)
  }, [target])
  return state
}
