/**
 * Partner charts. Built to the dataviz method:
 *  · colours from validated `--viz-*` slots (resolved with cssVar, re-read on theme change),
 *  · thin marks (bars ≤ 24px, 4px rounded data-end, square baseline, 2px surface gap in stacks),
 *  · hairline recessive grid, one y-axis, legend for ≥ 2 series, hover tooltip on every mark,
 *  · a table view for every chart (tooltips enhance, never gate).
 */
import { Table2, BarChart3 } from 'lucide-react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Bar, BarChart, BarStack, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { cn } from '@/lib/cn'
import { formatINR } from '@/lib/format'
import { cssVar, useResolvedTheme } from '@/stores/theme'
import type { PartnerDashboard } from '@/types/partner'
import { CHANNEL_GROUPS, sourceMeta } from '../lib/sources'
import { dayLabel, hourLabel } from '../lib/time'

function usePalette() {
  const theme = useResolvedTheme()
  return useMemo(
    () => ({
      theme,
      s1: cssVar('--viz-1') || '#7aa300',
      s2: cssVar('--viz-2') || '#149fc4',
      surface: cssVar('--viz-surface') || '#0c1210',
      grid: cssVar('--viz-grid') || '#1c2622',
      axis: cssVar('--viz-axis') || '#6b7a74',
      slot: (v: string) => cssVar(v) || '#888',
    }),
    [theme],
  )
}

// ───────────── Frame ─────────────

export function ChartCard({
  title,
  subtitle,
  legend,
  table,
  children,
  className,
  actions,
}: {
  title: string
  subtitle?: string
  legend?: React.ReactNode
  table: React.ReactNode
  children: React.ReactNode
  className?: string
  actions?: React.ReactNode
}) {
  const [asTable, setAsTable] = useState(false)
  return (
    <section className={cn('glass flex min-w-0 flex-col rounded-3xl p-5 shadow-card sm:p-6', className)}>
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="font-display text-base font-semibold">{title}</h2>
          {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
        </div>
        <div className="flex items-center gap-1.5">
          {actions}
          <button
            type="button"
            onClick={() => setAsTable((t) => !t)}
            aria-pressed={asTable}
            aria-label={asTable ? 'Show chart' : 'Show as table'}
            title={asTable ? 'Show chart' : 'Show as table'}
            className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg text-muted ring-1 ring-white/10 transition hover:bg-white/8 hover:text-fg"
          >
            {asTable ? <BarChart3 className="h-4 w-4" /> : <Table2 className="h-4 w-4" />}
          </button>
        </div>
      </header>
      {legend && !asTable && <div className="mt-3">{legend}</div>}
      <div className="pp-chart mt-3 flex min-w-0 flex-1 flex-col">{asTable ? <div className="max-h-80 overflow-auto">{table}</div> : children}</div>
    </section>
  )
}

export function LegendItem({ color, label, value, shape = 'rect' }: { color: string; label: string; value?: React.ReactNode; shape?: 'rect' | 'line' }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted">
      <span className={shape === 'line' ? 'h-0.5 w-3 rounded-full' : 'h-2.5 w-2.5 rounded-[3px]'} style={{ background: color }} aria-hidden />
      {label}
      {value != null && <span className="font-mono text-fg">{value}</span>}
    </span>
  )
}

function TableView({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-[11px] tracking-wider text-muted uppercase">
          {head.map((h, i) => (
            <th key={h} className={cn('pb-2 font-semibold', i > 0 && 'text-right')}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y divide-white/6">
        {rows.map((r, i) => (
          <tr key={i}>
            {r.map((c, j) => (
              <td key={j} className={cn('py-1.5', j > 0 && 'text-right font-mono tabular-nums')}>
                {c}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

interface TipRow {
  color: string
  label: string
  value: string
}

function TooltipBox({ title, rows, footer }: { title: string; rows: TipRow[]; footer?: string }) {
  return (
    <div className="glass-strong min-w-40 rounded-xl px-3 py-2.5 text-xs shadow-card">
      <div className="mb-1.5 font-semibold text-fg">{title}</div>
      {rows.map((r) => (
        <div key={r.label} className="flex items-center justify-between gap-4 py-0.5">
          <span className="flex items-center gap-1.5 text-muted">
            <span className="h-0.5 w-3 rounded-full" style={{ background: r.color }} />
            {r.label}
          </span>
          <span className="font-mono font-semibold text-fg">{r.value}</span>
        </div>
      ))}
      {footer && <div className="mt-1.5 border-t border-white/8 pt-1.5 text-muted">{footer}</div>}
    </div>
  )
}

// ───────────── Revenue (stacked columns) ─────────────

type RevenuePoint = { date: string; pytch_paise: number; offline_paise: number }

export function RevenueChart({ series, title = 'Revenue', subtitle, height = 240 }: { series: RevenuePoint[]; title?: string; subtitle?: string; height?: number }) {
  const p = usePalette()
  const data = series.map((d) => ({ ...d, label: dayLabel(d.date, series.length > 20 ? 'd' : 'd MMM'), pytch: d.pytch_paise / 100, offline: d.offline_paise / 100 }))
  const totals = series.reduce((a, d) => ({ pytch: a.pytch + d.pytch_paise, offline: a.offline + d.offline_paise }), { pytch: 0, offline: 0 })
  const empty = totals.pytch + totals.offline === 0
  return (
    <ChartCard
      title={title}
      subtitle={subtitle}
      legend={
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          <LegendItem color={p.s1} label="Pytch online" value={formatINR(totals.pytch, { compact: true })} />
          <LegendItem color={p.s2} label="Offline (walk-in, phone, apps)" value={formatINR(totals.offline, { compact: true })} />
        </div>
      }
      table={
        <TableView
          head={['Date', 'Pytch', 'Offline', 'Total']}
          rows={series.map((d) => [dayLabel(d.date, 'EEE d MMM'), formatINR(d.pytch_paise), formatINR(d.offline_paise), formatINR(d.pytch_paise + d.offline_paise)])}
        />
      }
    >
      {empty ? (
        <div className="flex items-center justify-center text-sm text-muted" style={{ height }}>
          No revenue recorded in this period yet.
        </div>
      ) : (
        <div className="flex-1" style={{ minHeight: height }} role="img" aria-label={`${title}: Pytch ${formatINR(totals.pytch)}, offline ${formatINR(totals.offline)}`}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }} barCategoryGap="22%">
              <CartesianGrid vertical={false} stroke={p.grid} strokeWidth={1} />
              <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: p.grid }} tick={{ fill: p.axis, fontSize: 11 }} interval="preserveStartEnd" minTickGap={12} />
              <YAxis
                tickLine={false}
                axisLine={false}
                width={48}
                tick={{ fill: p.axis, fontSize: 11, fontFamily: 'var(--font-mono)' }}
                tickFormatter={(v: number) => formatINR(v * 100, { compact: true })}
              />
              <Tooltip
                cursor={{ fill: p.theme === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(14,42,26,0.05)' }}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null
                  const d = payload[0]!.payload as (typeof data)[number]
                  return (
                    <TooltipBox
                      title={dayLabel(d.date, 'EEE, d MMM')}
                      rows={[
                        { color: p.s1, label: 'Pytch', value: formatINR(d.pytch_paise) },
                        { color: p.s2, label: 'Offline', value: formatINR(d.offline_paise) },
                      ]}
                      footer={`Total ${formatINR(d.pytch_paise + d.offline_paise)}`}
                    />
                  )
                }}
              />
              <BarStack radius={[4, 4, 0, 0]}>
                <Bar dataKey="pytch" name="Pytch" fill={p.s1} stroke={p.surface} strokeWidth={2} maxBarSize={24} isAnimationActive />
                <Bar dataKey="offline" name="Offline" fill={p.s2} stroke={p.surface} strokeWidth={2} maxBarSize={24} isAnimationActive />
              </BarStack>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </ChartCard>
  )
}

// ───────────── Channel mix (donut, ≤ 6 folded groups) ─────────────

export function ChannelDonut({ mix }: { mix: PartnerDashboard['channel_mix'] }) {
  const p = usePalette()
  const groups = CHANNEL_GROUPS.map((g) => ({
    ...g,
    color: p.slot(g.color),
    count: mix.filter((m) => sourceMeta(m.source).group === g.key || (m.source === 'pytch' && g.key === 'pytch')).reduce((n, m) => n + m.count, 0),
  })).filter((g) => g.count > 0)
  const total = groups.reduce((n, g) => n + g.count, 0)
  const [hover, setHover] = useState<number | null>(null)
  const pct = (n: number) => (total ? Math.round((n / total) * 100) : 0)
  const shown = hover != null ? groups[hover] : null
  return (
    <ChartCard
      title="Channel mix"
      subtitle="Bookings by where they came from · last 30 days"
      table={<TableView head={['Channel', 'Bookings', 'Share']} rows={groups.map((g) => [g.label, g.count, `${pct(g.count)}%`])} />}
    >
      {total === 0 ? (
        <div className="flex h-48 items-center justify-center text-sm text-muted">No bookings in the last 30 days.</div>
      ) : (
        <div className="flex flex-col items-center gap-4 sm:flex-row lg:flex-col xl:flex-row">
          <div className="relative h-44 w-44 shrink-0" role="img" aria-label={`Channel mix: ${groups.map((g) => `${g.label} ${pct(g.count)}%`).join(', ')}`}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={groups}
                  dataKey="count"
                  nameKey="label"
                  innerRadius="68%"
                  outerRadius="100%"
                  paddingAngle={0}
                  stroke={p.surface}
                  strokeWidth={2}
                  startAngle={90}
                  endAngle={-270}
                  onMouseEnter={(_, i) => setHover(i)}
                  onMouseLeave={() => setHover(null)}
                  isAnimationActive
                >
                  {groups.map((g, i) => (
                    <Cell key={g.key} fill={g.color} opacity={hover == null || hover === i ? 1 : 0.35} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
              <span className="text-2xl font-semibold">{shown ? `${pct(shown.count)}%` : total}</span>
              <span className="max-w-24 text-[11px] leading-tight text-muted">{shown ? shown.label : 'bookings'}</span>
            </div>
          </div>
          <ul className="w-full min-w-0 space-y-1.5">
            {groups.map((g, i) => (
              <li
                key={g.key}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
                className={cn('flex items-center justify-between gap-3 rounded-lg px-2 py-1 text-sm transition', hover === i && 'bg-white/5')}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: g.color }} />
                  <span className="truncate">{g.label}</span>
                </span>
                <span className="shrink-0 font-mono text-xs text-muted tabular-nums">
                  <span className="text-fg">{g.count}</span> · {pct(g.count)}%
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </ChartCard>
  )
}

// ───────────── Occupancy heatmap (weekday × hour, sequential one-hue) ─────────────

const WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/**
 * A horizontal scroller that says there's more: fades the edge(s) with hidden content (`.pp-scroll-cue`) and, once
 * per `focusKey`, scrolls column `focus` (of `count` equal columns after a fixed `lead` px) into the middle.
 */
function useScrollCue(focus: number, count: number, lead: number, focusKey: string) {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || count === 0) return
    const colW = (el.scrollWidth - lead) / count
    el.scrollLeft = Math.max(0, lead + colW * (focus + 0.5) - el.clientWidth / 2)
  }, [focusKey]) // eslint-disable-line react-hooks/exhaustive-deps -- only when the data set changes
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => {
      const more = [el.scrollLeft > 4 && 'left', el.scrollLeft + el.clientWidth < el.scrollWidth - 4 && 'right'].filter(Boolean).join(' ')
      el.parentElement?.setAttribute('data-more', more)
    }
    update()
    el.addEventListener('scroll', update, { passive: true })
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => {
      el.removeEventListener('scroll', update)
      ro.disconnect()
    }
  }, [count])
  return ref
}

export function OccupancyHeatmap({ data }: { data: PartnerDashboard['occupancy_heatmap'] }) {
  const hours = [...new Set(data.map((d) => d.hour))].sort((a, b) => a - b)
  const map = new Map(data.map((d) => [`${d.weekday}-${d.hour}`, d.pct]))
  const [tip, setTip] = useState<{ wd: number; h: number } | null>(null)
  const peak = data.reduce((m, d) => (d.pct > m.pct ? d : m), { weekday: 0, hour: 0, pct: -1 })
  // scale to the busiest cell (rounded up to a clean step) so quiet venues still show their pattern
  const maxPct = Math.max(0, ...data.map((d) => d.pct))
  const top = [10, 20, 25, 40, 50, 75, 100].find((n) => maxPct <= n) ?? 100
  const fill = (pct: number) => `color-mix(in oklab, var(--heat-hi) ${Math.max(4, Math.round((Math.min(pct, top) / top) * 100))}%, var(--viz-surface))`
  const tipPct = tip ? (map.get(`${tip.wd}-${tip.h}`) ?? 0) : null
  // phones only fit ~8 hours: open on the busiest hour (evenings, usually) instead of the early morning
  const load = hours.map((h) => data.reduce((n, d) => (d.hour === h ? n + d.pct : n), 0))
  const busiest = load.some((v) => v > 0) ? load.indexOf(Math.max(...load)) : Math.max(0, hours.indexOf(18))
  const scroller = useScrollCue(busiest, hours.length, 36, `${hours.join(',')}|${busiest}`)
  return (
    <ChartCard
      title="When you’re busy"
      subtitle="Share of open slots booked · last 8 weeks"
      table={
        <TableView
          head={['Day', ...hours.map((h) => hourLabel(h))]}
          rows={WD.map((w, wd) => [w, ...hours.map((h) => `${Math.round(map.get(`${wd}-${h}`) ?? 0)}%`)])}
        />
      }
      legend={
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
          <span className="flex items-center gap-2">
            0%
            <span className="h-2 w-28 rounded-full" style={{ background: 'linear-gradient(90deg, color-mix(in oklab, var(--heat-hi) 4%, var(--viz-surface)), var(--heat-hi))' }} />
            {top}%
          </span>
          <span aria-live="polite" className="min-h-4">
            {tip ? (
              <>
                {WD[tip.wd]} {hourLabel(tip.h, false)} · <b className="font-mono text-fg">{Math.round(tipPct ?? 0)}%</b> booked
              </>
            ) : peak.pct >= 0 ? (
              <>
                Busiest: {WD[peak.weekday]} {hourLabel(peak.hour, false)} · <b className="font-mono text-fg">{Math.round(peak.pct)}%</b>
              </>
            ) : null}
          </span>
        </div>
      }
    >
      {hours.length === 0 ? (
        <div className="flex h-40 items-center justify-center text-sm text-muted">Not enough history yet.</div>
      ) : (
        <>
          <div className="pp-scroll-cue -mx-1 [--cue:var(--glass-strong-to)]">
            <div ref={scroller} className="overflow-x-auto px-1" role="region" aria-label="Occupancy by weekday and hour" tabIndex={0}>
              <div className="grid min-w-[30rem] gap-[2px]" style={{ gridTemplateColumns: `2.25rem repeat(${hours.length}, minmax(0, 1fr))` }} onMouseLeave={() => setTip(null)}>
                <span />
                {hours.map((h, i) => (
                  <span key={h} className="pb-1 text-center font-mono text-[11px] text-muted">
                    {i % 2 === 0 ? hourLabel(h) : ''}
                  </span>
                ))}
                {WD.map((w, wd) => (
                  <div key={w} className="contents">
                    <span className="flex items-center text-[11px] text-muted">{w}</span>
                    {hours.map((h) => {
                      const v = map.get(`${wd}-${h}`) ?? 0
                      const on = tip?.wd === wd && tip.h === h
                      return (
                        <button
                          key={h}
                          type="button"
                          aria-label={`${w} ${hourLabel(h, false)}: ${Math.round(v)}% booked`}
                          onMouseEnter={() => setTip({ wd, h })}
                          onFocus={() => setTip({ wd, h })}
                          onBlur={() => setTip(null)}
                          className={cn('h-6 cursor-default rounded-[4px] transition outline-none sm:h-7', on && 'ring-2 ring-fg')}
                          style={{ background: fill(v) }}
                        />
                      )
                    })}
                  </div>
                ))}
              </div>
            </div>
          </div>
          <p className="mt-2 text-center text-[11px] text-muted sm:hidden" aria-hidden>
            ← Swipe for other hours →
          </p>
        </>
      )}
    </ChartCard>
  )
}