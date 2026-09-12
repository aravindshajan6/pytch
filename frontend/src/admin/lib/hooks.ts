import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router'

export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

/** Re-render every `ms` (live countdowns, relative times). */
export function useNow(ms = 1000, enabled = true) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!enabled) return
    const id = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(id)
  }, [ms, enabled])
  return now
}

/** Filters kept in the URL (?q=…&status=…) so views are linkable and survive reloads. */
export function useUrlState<K extends string>(defaults: Record<K, string>) {
  const [params, setParams] = useSearchParams()
  const state = Object.fromEntries(Object.entries(defaults).map(([k, d]) => [k, params.get(k) ?? d])) as Record<K, string>
  const set = useCallback(
    (patch: Partial<Record<K, string>>, resetOffset = true) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          for (const [k, v] of Object.entries(patch) as [K, string | undefined][]) {
            if (v === undefined || v === '' || v === defaults[k]) next.delete(k)
            else next.set(k, v)
          }
          if (resetOffset && !('offset' in patch)) next.delete('offset')
          return next
        },
        { replace: true },
      )
    },
    // defaults is a literal at call sites; keys are stable
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [setParams],
  )
  return [state, set] as const
}
