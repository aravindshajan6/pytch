import { Table2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { cn } from '@/lib/cn'
import type { Heatmap as HeatmapData } from '@/types/admin'
import { seqColor } from './theme'

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const hourLabel = (h: number) => (h === 0 ? '12a' : h < 12 ? `${h}a` : h === 12 ? '12p' : `${h - 12}p`)
const hourLong = (h: number) => `${h % 12 || 12} ${h < 12 ? 'AM' : 'PM'}`

/** Weekday × hour booking density — one-hue sequential ramp (more = stronger). */
export function HeatmapGrid({ data, dim }: { data: HeatmapData | undefined; dim?: boolean }) {
  const [hover, setHover] = useState<{ d: number; h: number; v: number } | null>(null)
  const [table, setTable] = useState(false)

  const { grid, hours, max, total, peak } = useMemo(() => {
    const cells = data?.cells ?? []
    const m = new Map<string, number>()
    let mx = 0
    let tot = 0
    let pk: { d: number; h: number; v: number } | null = null
    let lo = 24
    let hi = -1
    for (const c of cells) {
      m.set(`${c.weekday}-${c.hour}`, c.bookings)
      mx = Math.max(mx, c.bookings)
      tot += c.bookings
      if (c.bookings > 0) {
        lo = Math.min(lo, c.hour)
        hi = Math.max(hi, c.hour)
      }
      if (!pk || c.bookings > pk.v) pk = { d: c.weekday, h: c.hour, v: c.bookings }
    }
    if (hi < 0) {
      lo = 6
      hi = 23
    }
    lo = Math.min(lo, 6)
    hi = Math.max(hi, 22)
    return { grid: m, hours: Array.from({ length: hi - lo + 1 }, (_, i) => lo + i), max: mx, total: tot, peak: pk }
  }, [data])

  const readout = hover ?? peak
  return (
    <div className={cn('transition-opacity', dim && 'opacity-60')}>
      <div className="mb-3 flex items-center justify-between gap-3 text-xs">
        <div className="min-h-4 text-muted" aria-live="polite">
          {readout && readout.v > 0 ? (
            <>
              <span className="text-fg">
                {DAYS[readout.d]} {hourLong(readout.h)}
              </span>{' '}
              · <span className="num text-fg">{readout.v}</span> bookings{!hover && ' (peak)'}
            </>
          ) : (
            'No bookings in this range'
          )}
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
        <div className="max-h-72 overflow-auto rounded-xl ring-1 ring-white/8">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-ink-800 text-[10px] tracking-wider text-subtle uppercase">
              <tr>
                <th className="px-2 py-2 text-left">Hour</th>
                {DAYS.map((d) => (
                  <th key={d} className="px-2 py-2 text-right">
                    {d}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {hours.map((h) => (
                <tr key={h} className="border-t border-white/5">
                  <td className="px-2 py-1 text-muted">{hourLong(h)}</td>
                  {DAYS.map((_, d) => (
                    <td key={d} className="num px-2 py-1 text-right">
                      {grid.get(`${d}-${h}`) ?? 0}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="overflow-x-auto pb-1">
          <div
            className="grid min-w-[520px] gap-[2px]"
            style={{ gridTemplateColumns: `2.25rem repeat(${hours.length}, minmax(0, 1fr))` }}
            role="img"
            aria-label={`Bookings by weekday and hour. ${total} bookings in range${peak ? `, busiest ${DAYS[peak.d]} ${hourLong(peak.h)}` : ''}.`}
            onMouseLeave={() => setHover(null)}
          >
            <div />
            {hours.map((h) => (
              <div key={h} className="pb-1 text-center text-[9px] text-subtle">
                {h % 2 === 0 ? hourLabel(h) : ''}
              </div>
            ))}
            {DAYS.map((day, d) => (
              <Row key={day} day={day}>
                {hours.map((h) => {
                  const v = grid.get(`${d}-${h}`) ?? 0
                  const active = hover?.d === d && hover?.h === h
                  return (
                    <div
                      key={h}
                      onMouseEnter={() => setHover({ d, h, v })}
                      className={cn('aspect-square min-h-3 rounded-[3px] transition-[outline]', active && 'outline-2 outline-offset-1 outline-fg/70')}
                      style={{ background: seqColor(max ? v / max : 0) }}
                    />
                  )
                })}
              </Row>
            ))}
          </div>
          <div className="mt-3 flex items-center justify-end gap-2 text-[10px] text-subtle">
            <span>0</span>
            <span
              className="h-1.5 w-28 rounded-full"
              style={{ background: `linear-gradient(90deg, ${seqColor(0.02)}, ${seqColor(0.5)}, ${seqColor(1)})` }}
            />
            <span className="num">{max}</span>
          </div>
        </div>
      )}
    </div>
  )
}

function Row({ day, children }: { day: string; children: React.ReactNode }) {
  return (
    <>
      <div className="flex items-center text-[10px] text-muted">{day}</div>
      {children}
    </>
  )
}
