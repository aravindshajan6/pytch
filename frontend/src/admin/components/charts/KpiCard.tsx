import { ArrowDownRight, ArrowUpRight, Info, Minus } from 'lucide-react'
import { cn } from '@/lib/cn'
import type { Kpi } from '@/types/admin'
import { delta, formatKpi } from '../../lib/format'
import { Sparkline } from './Sparkline'

/** Metrics where an increase is bad news (delta colour flips). */
const UP_IS_BAD = new Set(['cancellation_rate', 'refunds', 'overbooking_rate', 'credits_outstanding'])
const NEUTRAL = new Set(['coupon_spend'])

export function KpiCard({
  kpi,
  rangeLabel,
  trend,
  size = 'md',
}: {
  kpi: Kpi
  rangeLabel: string
  trend?: { values: number[]; previous?: number[] }
  size?: 'md' | 'sm'
}) {
  const d = delta(kpi.value, kpi.previous, kpi.unit)
  const up = d.value != null && d.value > 0.05
  const down = d.value != null && d.value < -0.05
  const good = NEUTRAL.has(kpi.key) ? null : UP_IS_BAD.has(kpi.key) ? down : up
  const bad = NEUTRAL.has(kpi.key) ? null : UP_IS_BAD.has(kpi.key) ? up : down
  const deltaText =
    d.value == null ? 'new' : `${d.value > 0 ? '+' : d.value < 0 ? '−' : ''}${Math.abs(d.value).toFixed(Math.abs(d.value) < 10 ? 1 : 0)}${d.kind === 'pp' ? ' pp' : '%'}`
  const Icon = up ? ArrowUpRight : down ? ArrowDownRight : Minus

  return (
    <div className={cn('glass relative flex min-w-0 flex-col rounded-2xl shadow-card', size === 'md' ? 'p-4' : 'p-3.5')}>
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-xs font-medium text-muted">{kpi.label}</span>
        {kpi.hint && (
          <span className="group relative">
            <Info className="h-3.5 w-3.5 text-subtle" aria-label={kpi.hint} tabIndex={0} />
            <span
              role="tooltip"
              className="glass-strong pointer-events-none absolute top-5 right-0 z-20 w-56 rounded-lg px-2.5 py-2 text-[11px] leading-snug text-fg/85 opacity-0 shadow-xl transition-opacity group-focus-within:opacity-100 group-hover:opacity-100"
            >
              {kpi.hint}
            </span>
          </span>
        )}
      </div>
      <div className="mt-1.5 flex items-end justify-between gap-2">
        <div className={cn('font-sans font-semibold tracking-tight text-fg', size === 'md' ? 'text-2xl' : 'text-xl')} title={formatKpi(kpi, false)}>
          {formatKpi(kpi)}
        </div>
        {trend && trend.values.length > 1 && <Sparkline values={trend.values} previous={trend.previous} className="mb-1 h-8 w-20 shrink-0 sm:w-24" />}
      </div>
      <div className="mt-2 flex items-center gap-1.5 text-[11px]">
        <span
          className={cn(
            'inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 font-semibold whitespace-nowrap',
            good ? 'bg-mint/12 text-mint' : bad ? 'bg-flare/12 text-flare' : 'bg-white/6 text-muted',
          )}
        >
          <Icon className="h-3 w-3" aria-hidden />
          <span className="num">{deltaText}</span>
          <span className="sr-only">{good ? '(improving)' : bad ? '(worsening)' : ''}</span>
        </span>
        <span className="truncate text-subtle">{size === 'md' ? `vs previous ${rangeLabel}` : 'vs prev.'}</span>
      </div>
    </div>
  )
}
