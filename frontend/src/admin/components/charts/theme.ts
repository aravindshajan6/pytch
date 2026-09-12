import { useMemo } from 'react'
import { cssVar, useResolvedTheme, type ResolvedTheme } from '@/stores/theme'

export interface ChartTheme {
  mode: ResolvedTheme
  accent: string
  prev: string
  grid: string
  axis: string
  surface: string
  fg: string
  muted: string
  subtle: string
  /** Validated categorical slots, fixed order (see admin.css). */
  series: string[]
}

function read(mode: ResolvedTheme): ChartTheme {
  const v = (n: string, fallback: string) => cssVar(n) || fallback
  return {
    mode,
    accent: v('--chart-accent', '#c8ff2e'),
    prev: v('--chart-prev', '#6b7a74'),
    grid: v('--chart-grid', '#18211e'),
    axis: v('--chart-axis', '#2a3531'),
    surface: v('--chart-surface', '#0e1213'),
    fg: v('--color-fg', '#eaf2ee'),
    muted: v('--color-muted', '#8a9a94'),
    subtle: v('--color-subtle', '#5c6b65'),
    series: [1, 2, 3, 4, 5].map((i) => v(`--chart-${i}`, '#7aa21a')),
  }
}

/** Resolved chart colours from theme tokens; recomputed when the theme flips. */
export function useChartTheme(): ChartTheme {
  const mode = useResolvedTheme()
  return useMemo(() => read(mode), [mode])
}

/** Sequential ramp step for 0..1 intensity, mixed from the surface toward a token hue. */
export const seqColor = (t: number, token = 'var(--chart-seq)') =>
  t <= 0 ? 'color-mix(in srgb, var(--color-white) 4%, transparent)' : `color-mix(in oklab, ${token} ${Math.round(14 + 86 * Math.min(1, t))}%, var(--chart-surface))`
