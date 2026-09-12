import { useId } from 'react'
import { useChartTheme } from './theme'

/** Tiny trend line: previous period in the de-emphasis grey, current period in the accent. */
export function Sparkline({ values, previous, className, height = 36 }: { values: number[]; previous?: number[]; className?: string; height?: number }) {
  const t = useChartTheme()
  const id = useId()
  const w = 120
  const h = height
  const all = [...values, ...(previous ?? [])]
  if (values.length < 2) return null
  const max = Math.max(...all, 1)
  const min = Math.min(...all, 0)
  const span = max - min || 1
  const pts = (arr: number[]) =>
    arr.map((v, i) => [(i / Math.max(1, arr.length - 1)) * (w - 4) + 2, h - 3 - ((v - min) / span) * (h - 6)] as const)
  const path = (p: readonly (readonly [number, number])[]) => p.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join('')
  const cur = pts(values)
  const last = cur[cur.length - 1]!
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className={className} aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={t.accent} stopOpacity={0.14} />
          <stop offset="100%" stopColor={t.accent} stopOpacity={0} />
        </linearGradient>
      </defs>
      {previous && previous.length > 1 && (
        <path d={path(pts(previous))} fill="none" stroke={t.prev} strokeWidth={1.25} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" opacity={0.7} />
      )}
      <path d={`${path(cur)}L${last[0]},${h}L${cur[0]![0]},${h}Z`} fill={`url(#${id})`} />
      <path d={path(cur)} fill="none" stroke={t.accent} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}
