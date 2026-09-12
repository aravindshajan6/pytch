import { useState } from 'react'
import { cn } from '@/lib/cn'

export interface BarRow {
  key: string
  label: React.ReactNode
  value: number
  display: string
  secondary?: string
}

/**
 * Horizontal bars for nominal categories: ONE hue (categorical slot 1) for every bar — length carries
 * magnitude, so colour isn't spent re-encoding it. Value sits at the bar tip; hover lifts the row.
 */
export function BarList({ rows, dim, emptyText = 'No data yet.' }: { rows: BarRow[]; dim?: boolean; emptyText?: string }) {
  const [hover, setHover] = useState<string | null>(null)
  const max = Math.max(1, ...rows.map((r) => r.value))
  if (!rows.length) return <p className="py-8 text-center text-sm text-muted">{emptyText}</p>
  return (
    <ul className={cn('space-y-2.5 transition-opacity', dim && 'opacity-60')}>
      {rows.map((r) => (
        <li
          key={r.key}
          className="group"
          onMouseEnter={() => setHover(r.key)}
          onMouseLeave={() => setHover(null)}
          tabIndex={0}
          onFocus={() => setHover(r.key)}
          onBlur={() => setHover(null)}
          aria-label={`${typeof r.label === 'string' ? r.label : r.key}: ${r.display}${r.secondary ? `, ${r.secondary}` : ''}`}
        >
          <div className="mb-1 flex items-baseline justify-between gap-3 text-xs">
            <span className="truncate text-fg/90">{r.label}</span>
            {r.secondary && <span className={cn('num text-subtle transition-colors', hover === r.key && 'text-muted')}>{r.secondary}</span>}
          </div>
          <div className="flex items-center gap-2">
            <div className="h-2.5 flex-1">
              <div
                className="h-full rounded-r-[4px] rounded-l-[1px] transition-[width,filter] duration-700"
                style={{
                  width: `${Math.max(1.5, (r.value / max) * 100)}%`,
                  background: 'var(--chart-1)',
                  filter: hover === r.key ? 'brightness(1.18)' : undefined,
                }}
              />
            </div>
            <span className="num w-14 shrink-0 text-right text-xs text-fg">{r.display}</span>
          </div>
        </li>
      ))}
    </ul>
  )
}
