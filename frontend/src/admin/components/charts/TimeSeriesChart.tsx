import { Table2 } from 'lucide-react'
import { useId, useMemo, useState } from 'react'
import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { cn } from '@/lib/cn'
import type { TimeSeries } from '@/types/admin'
import { dayLabel } from '../../lib/format'
import { useChartTheme } from './theme'

/** 0 → a clean round maximum in ~4 steps (1/2/2.5/5 × 10ⁿ), whatever the unit. */
function niceTicks(max: number, steps = 4): number[] {
  if (max <= 0) return [0, 1]
  const raw = max / steps
  const exp = 10 ** Math.floor(Math.log10(raw))
  const f = raw / exp
  const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * exp
  const n = Math.ceil(max / step)
  return Array.from({ length: n + 1 }, (_, i) => Math.round(i * step))
}

interface Row {
  i: number
  date: string
  label: string
  value: number
  prev: number | null
  prevDate: string | null
}

/**
 * Current period (accent area) vs the aligned previous period (grey line) on ONE shared axis —
 * same metric, same unit, so no dual axis. Crosshair tooltip lists both; table view twin included.
 */
export function TimeSeriesChart({
  series,
  format,
  axisFormat,
  height = 280,
  dim,
  metricLabel,
}: {
  series: TimeSeries | undefined
  format: (v: number) => string
  axisFormat?: (v: number) => string
  height?: number
  dim?: boolean
  metricLabel: string
}) {
  const t = useChartTheme()
  const gid = useId().replace(/:/g, '')
  const [table, setTable] = useState(false)

  const rows: Row[] = useMemo(
    () =>
      (series?.points ?? []).map((p, i) => ({
        i,
        date: p.date,
        label: dayLabel(p.date),
        value: p.value,
        prev: series?.previous[i]?.value ?? null,
        prevDate: series?.previous[i]?.date ?? null,
      })),
    [series],
  )

  const total = rows.reduce((s, r) => s + r.value, 0)
  const prevTotal = rows.reduce((s, r) => s + (r.prev ?? 0), 0)
  const ticks = useMemo(() => niceTicks(Math.max(0, ...rows.map((r) => Math.max(r.value, r.prev ?? 0)))), [rows])

  return (
    <div className={cn('transition-opacity', dim && 'opacity-60')}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-4 text-muted" aria-label="Legend">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-0.5 w-4 rounded-full" style={{ background: t.accent }} /> This period
            <span className="num text-fg">{format(total)}</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-0.5 w-4 rounded-full" style={{ background: t.prev }} /> Previous period
            <span className="num text-fg/70">{format(prevTotal)}</span>
          </span>
        </div>
        <button
          type="button"
          onClick={() => setTable((v) => !v)}
          aria-pressed={table}
          className={cn(
            'inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-lg px-2 text-xs ring-1 transition',
            table ? 'bg-volt/12 text-volt ring-volt/30' : 'text-muted ring-white/10 hover:text-fg',
          )}
        >
          <Table2 className="h-3.5 w-3.5" /> Table
        </button>
      </div>

      {table ? (
        <div className="overflow-auto rounded-xl ring-1 ring-white/8" style={{ maxHeight: height }}>
          <table className="w-full text-xs">
            <caption className="sr-only">{metricLabel} by day, this period vs previous</caption>
            <thead className="sticky top-0 bg-ink-800 text-[10px] tracking-wider text-subtle uppercase">
              <tr>
                <th className="px-3 py-2 text-left font-semibold">Date</th>
                <th className="px-3 py-2 text-right font-semibold">This period</th>
                <th className="px-3 py-2 text-right font-semibold">Previous</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.date} className="border-t border-white/5">
                  <td className="px-3 py-1.5">{r.label}</td>
                  <td className="num px-3 py-1.5 text-right">{format(r.value)}</td>
                  <td className="num px-3 py-1.5 text-right text-muted">{r.prev == null ? '—' : format(r.prev)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={{ height }} role="img" aria-label={`${metricLabel}: ${format(total)} this period vs ${format(prevTotal)} previous period`}>
          {rows.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-muted">No data for this range yet.</div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id={`g-${gid}`} x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor={t.accent} stopOpacity={0.16} />
                    <stop offset="100%" stopColor={t.accent} stopOpacity={0.01} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke={t.grid} strokeWidth={1} />
                <XAxis
                  dataKey="label"
                  tickLine={false}
                  axisLine={{ stroke: t.axis }}
                  tick={{ fill: t.muted, fontSize: 11 }}
                  minTickGap={24}
                  tickMargin={8}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  tick={{ fill: t.muted, fontSize: 11, fontFamily: 'var(--font-mono)' }}
                  tickFormatter={axisFormat ?? format}
                  width={56}
                  ticks={ticks}
                  domain={[0, ticks[ticks.length - 1]!]}
                  interval={0}
                />
                <Tooltip
                  cursor={{ stroke: t.axis, strokeWidth: 1 }}
                  content={(p) => {
                    const r = p.payload?.[0]?.payload as Row | undefined
                    if (!p.active || !r) return null
                    const d = r.prev != null && r.prev !== 0 ? ((r.value - r.prev) / Math.abs(r.prev)) * 100 : null
                    return (
                      <div className="glass-strong min-w-44 rounded-xl px-3 py-2.5 text-xs shadow-2xl">
                        <div className="mb-1.5 font-medium text-muted">{r.label}</div>
                        <div className="flex items-center justify-between gap-4">
                          <span className="inline-flex items-center gap-1.5 text-muted">
                            <span className="h-0.5 w-3 rounded-full" style={{ background: t.accent }} /> This period
                          </span>
                          <span className="num text-sm font-semibold text-fg">{format(r.value)}</span>
                        </div>
                        <div className="mt-1 flex items-center justify-between gap-4">
                          <span className="inline-flex items-center gap-1.5 text-muted">
                            <span className="h-0.5 w-3 rounded-full" style={{ background: t.prev }} />
                            {r.prevDate ? dayLabel(r.prevDate) : 'Previous'}
                          </span>
                          <span className="num text-fg/80">{r.prev == null ? '—' : format(r.prev)}</span>
                        </div>
                        {d != null && (
                          <div className="mt-1.5 border-t border-white/8 pt-1.5 text-right text-muted">
                            <span className="num text-fg">
                              {d >= 0 ? '+' : '−'}
                              {Math.abs(d).toFixed(1)}%
                            </span>{' '}
                            vs previous
                          </div>
                        )}
                      </div>
                    )
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="prev"
                  stroke={t.prev}
                  strokeWidth={1.5}
                  dot={false}
                  activeDot={{ r: 3.5, fill: t.prev, stroke: t.surface, strokeWidth: 2 }}
                  isAnimationActive={false}
                  connectNulls
                />
                <Area
                  type="monotone"
                  dataKey="value"
                  stroke={t.accent}
                  strokeWidth={2}
                  fill={`url(#g-${gid})`}
                  dot={false}
                  activeDot={{ r: 4.5, fill: t.accent, stroke: t.surface, strokeWidth: 2 }}
                  animationDuration={700}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </div>
      )}
    </div>
  )
}
