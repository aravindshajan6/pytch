import { useEffect, useState } from 'react'

export interface CountdownParts {
  totalMs: number
  hours: number
  minutes: number
  seconds: number
  expired: boolean
  /** "29:59" or "1:05:09" */
  label: string
}

function parts(target: number | null): CountdownParts {
  const totalMs = target == null ? 0 : Math.max(0, target - Date.now())
  const s = Math.floor(totalMs / 1000)
  const hours = Math.floor(s / 3600)
  const minutes = Math.floor((s % 3600) / 60)
  const seconds = s % 60
  const pad = (n: number) => n.toString().padStart(2, '0')
  return {
    totalMs,
    hours,
    minutes,
    seconds,
    expired: target != null && totalMs === 0,
    label: hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`,
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
