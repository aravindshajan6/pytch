import { motion } from 'motion/react'
import { alpha } from '@/lib/color'
import { SOURCES, type AnySource } from '../lib/sources'

const COLS = ['Pitch A', 'Pitch B', 'Court 1']
const ROWS = ['6p', '7p', '8p', '9p', '10p']
const BARS: { col: number; row: number; span: number; source: AnySource; label: string }[] = [
  { col: 0, row: 0, span: 2, source: 'pytch', label: 'Friday 5s' },
  { col: 1, row: 1, span: 1, source: 'walk_in', label: 'Arjun · cash' },
  { col: 2, row: 0, span: 1, source: 'playo', label: 'Playo' },
  { col: 1, row: 3, span: 2, source: 'phone', label: 'Office league' },
  { col: 0, row: 3, span: 1, source: 'pytch', label: 'Open game' },
  { col: 2, row: 2, span: 2, source: 'maintenance', label: 'Relining' },
]

/** Decorative: a tiny live calendar filling up from different channels. */
export function CalendarIllustration() {
  return (
    <div aria-hidden className="glass w-full max-w-md rounded-3xl p-4 shadow-card">
      <div className="mb-3 flex items-center justify-between text-[11px] text-muted">
        <span className="font-semibold text-fg">Tonight</span>
        <span className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-mint" /> Live
        </span>
      </div>
      <div className="grid grid-cols-[2rem_repeat(3,1fr)] gap-1">
        <span />
        {COLS.map((c) => (
          <span key={c} className="truncate pb-1 text-center text-[10px] font-semibold text-muted">
            {c}
          </span>
        ))}
        <div className="relative col-span-4 grid grid-cols-[2rem_repeat(3,1fr)] grid-rows-5 gap-1" style={{ gridTemplateRows: 'repeat(5, 2.1rem)' }}>
          {ROWS.map((r, i) => (
            <span key={r} className="font-mono text-[10px] text-muted" style={{ gridColumn: 1, gridRow: i + 1 }}>
              {r}
            </span>
          ))}
          {ROWS.flatMap((_, r) =>
            COLS.map((_, c) => <span key={`${r}-${c}`} className="rounded-lg bg-white/[0.03] ring-1 ring-white/5" style={{ gridColumn: c + 2, gridRow: r + 1 }} />),
          )}
          {BARS.map((b, i) => {
            const s = SOURCES[b.source]
            return (
              <motion.span
                key={i}
                initial={{ opacity: 0, scaleY: 0.3 }}
                animate={{ opacity: 1, scaleY: 1 }}
                transition={{ delay: 0.5 + i * 0.45, type: 'spring', stiffness: 260, damping: 22 }}
                className={`flex origin-top flex-col justify-center overflow-hidden rounded-lg px-2 ${b.source === 'maintenance' ? 'pp-hatch' : ''}`}
                style={{
                  gridColumn: b.col + 2,
                  gridRow: `${b.row + 1} / span ${b.span}`,
                  backgroundColor: alpha(s.color, 0.16),
                  boxShadow: `inset 3px 0 0 ${s.color}`,
                }}
              >
                <span className="flex items-center gap-1 truncate text-[10px] font-semibold text-fg">
                  <s.icon className="h-3 w-3 shrink-0" style={{ color: s.color }} />
                  {b.label}
                </span>
              </motion.span>
            )
          })}
        </div>
      </div>
    </div>
  )
}
