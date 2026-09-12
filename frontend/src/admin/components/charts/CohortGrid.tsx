import { useState } from 'react'
import { cn } from '@/lib/cn'
import type { CohortTable } from '@/types/admin'
import { useResolvedTheme } from '@/stores/theme'
import { dayLabel } from '../../lib/format'
import { seqColor } from './theme'

/**
 * Retention triangle: weekly cohorts (by first completed match) × weeks since. Second sequential
 * context on the dashboard, so it takes the second ramp hue (electric) — the heatmap owns volt.
 */
export function CohortGrid({ data, dim }: { data: CohortTable | undefined; dim?: boolean }) {
  const theme = useResolvedTheme()
  const [hover, setHover] = useState<string | null>(null)
  const cohorts = data?.cohorts ?? []
  const weeks = Math.max(9, ...cohorts.map((c) => c.retention.length))
  if (!cohorts.length) return <p className="py-8 text-center text-sm text-muted">Cohorts appear after the first completed matches.</p>

  return (
    <div className={cn('overflow-x-auto transition-opacity', dim && 'opacity-60')}>
      <table className="w-full min-w-[440px] border-separate border-spacing-[2px] text-[11px]">
        <caption className="sr-only">Weekly retention by first-match cohort, percent of cohort active in each following week</caption>
        <thead>
          <tr className="text-[10px] tracking-wider text-subtle uppercase">
            <th className="px-1.5 py-1 text-left font-semibold">Cohort</th>
            <th className="px-1.5 py-1 text-right font-semibold">Players</th>
            {Array.from({ length: weeks }, (_, i) => (
              <th key={i} className="px-1 py-1 text-center font-semibold">
                W{i}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {cohorts.map((c) => (
            <tr key={c.week}>
              <td className="px-1.5 py-1 whitespace-nowrap text-muted">{dayLabel(c.week)}</td>
              <td className="num px-1.5 py-1 text-right text-fg/80">{c.size}</td>
              {Array.from({ length: weeks }, (_, i) => {
                const v = c.retention[i]
                if (v == null) return <td key={i} />
                const t = Math.max(0, Math.min(1, v / 100))
                const strong = t > 0.55
                const id = `${c.week}-${i}`
                return (
                  <td
                    key={i}
                    onMouseEnter={() => setHover(id)}
                    onMouseLeave={() => setHover(null)}
                    title={`${dayLabel(c.week)} cohort · week ${i}: ${v.toFixed(0)}% of ${c.size}`}
                    className={cn('num h-7 rounded-[4px] px-1 text-center transition-[outline]', hover === id && 'outline-2 outline-fg/60')}
                    style={{
                      background: seqColor(t, 'var(--chart-seq-2)'),
                      color: strong ? (theme === 'dark' ? 'var(--color-night)' : 'var(--color-snow)') : 'var(--color-fg)',
                    }}
                  >
                    {v.toFixed(0)}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
