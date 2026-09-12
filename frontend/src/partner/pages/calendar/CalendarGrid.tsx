import { AlertTriangle, Ban, Clock, Flame, Plus, Zap } from 'lucide-react'
import { motion } from 'motion/react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useCountdown } from '@/hooks/useCountdown'
import { cn } from '@/lib/cn'
import { alpha } from '@/lib/color'
import { formatINR } from '@/lib/format'
import { SPORTS } from '@/lib/sports'
import { SOURCES, paymentModeLabel } from '../../lib/sources'
import { hhmmLabel, istTimeOf } from '../../lib/time'
import { availableRun, isBlock, isPytch, nowPosition, type Grid, type GridItem, type ViewMode } from './model'

export const ROW_H = 56
const HEAD_H = 52

export interface Selection {
  col: number
  from: number
  to: number
}

interface Props {
  grid: Grid
  mode: ViewMode
  date: string
  now: number
  selection: Selection | null
  flashes: Record<string, number>
  onSelect: (sel: Selection, viaDrag: boolean) => void
  onItem: (item: GridItem) => void
  className?: string
}

const rangeLabel = (start: string, end: string) => `${hhmmLabel(istTimeOf(start))} – ${hhmmLabel(istTimeOf(end))}`

export function CalendarGrid({ grid, mode, date, now, selection, flashes, onSelect, onItem, className }: Props) {
  const scroller = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<Selection | null>(null)
  const dragRef = useRef<Selection | null>(null)
  const cols = grid.columns.length
  const todayCol = grid.columns.findIndex((c) => c.isToday)
  const nowPos = todayCol >= 0 ? nowPosition(grid, grid.columns[todayCol]!.date, now) : null


  // Mouse drag-to-select (touch uses tap + the duration control in the sheet).
  useEffect(() => {
    if (!drag) return
    const up = () => {
      const d = dragRef.current
      dragRef.current = null
      setDrag(null)
      if (d) onSelect({ col: d.col, from: Math.min(d.from, d.to), to: Math.max(d.from, d.to) }, true)
    }
    window.addEventListener('pointerup', up, { once: true })
    return () => window.removeEventListener('pointerup', up)
  }, [drag, onSelect])

  const extendDrag = (col: number, row: number) => {
    const d = dragRef.current
    if (!d || d.col !== col) return
    const lo = Math.min(d.from, row)
    const run = availableRun(grid, col, lo, now)
    const hi = Math.max(d.from, row)
    // only contiguous free cells from the anchor
    const reach = lo + run.length - 1
    if (row < d.from) {
      const runFromRow = availableRun(grid, col, row, now)
      if (row + runFromRow.length - 1 < d.from) return
    } else if (hi > reach) return
    const next = { col, from: d.from, to: row }
    dragRef.current = next
    setDrag(next)
  }

  const active = drag ?? selection
  const inActive = (col: number, row: number) => !!active && active.col === col && row >= Math.min(active.from, active.to) && row <= Math.max(active.from, active.to)

  const colMin = mode === 'day' ? '6.25rem' : '5.5rem'

  // Fill the viewport below the toolbars (legend + mobile bottom nav stay visible). Re-measured on resize and
  // whenever the page above the grid changes size (banners, venue chips…).
  const [height, setHeight] = useState<number | null>(null)
  useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return
    const measure = () => {
      const top = el.getBoundingClientRect().top + window.scrollY
      const reserve = window.innerWidth >= 1280 ? 96 : window.innerWidth >= 1024 ? 64 : 136
      setHeight(Math.max(360, Math.round(window.innerHeight - top - reserve)))
    }
    measure()
    const ro = new ResizeObserver(measure)
    if (el.parentElement) ro.observe(el.parentElement)
    window.addEventListener('resize', measure)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [])

  // Scroll to "now" (today) or the first booking, once per view — after the height is fixed.
  const scrollKey = `${mode}|${date}|${grid.columns[0]?.pitch.id ?? ''}|${grid.rows.length}`
  const lastScroll = useRef<string>('')
  useLayoutEffect(() => {
    const el = scroller.current
    if (!el || !height || lastScroll.current === scrollKey || grid.rows.length === 0) return
    lastScroll.current = scrollKey
    let row = nowPos?.row ?? -1
    if (row < 0) row = grid.items.find((i) => i.kind !== 'available')?.row ?? 0
    el.scrollTop = Math.max(0, (row - 1) * ROW_H)
  }, [scrollKey, grid, nowPos, height])

  return (
    <div
      ref={scroller}
      className={cn('glass relative overflow-auto overscroll-contain rounded-3xl shadow-card', className)}
      style={height ? { height } : undefined}
      role="grid"
      aria-label={mode === 'day' ? 'Day calendar: pitches by hour' : 'Week calendar: days by hour'}
      aria-rowcount={grid.rows.length + 1}
      aria-colcount={cols + 1}
    >
      <div
        className="relative grid select-none"
        style={{
          gridTemplateColumns: `3.5rem repeat(${cols}, minmax(${colMin}, 1fr))`,
          gridTemplateRows: `${HEAD_H}px repeat(${grid.rows.length}, ${ROW_H}px)`,
        }}
      >
        {/* corner */}
        <div className="sticky top-0 left-0 z-40 border-r border-b border-white/8 bg-ink-800/95 backdrop-blur" style={{ gridColumn: 1, gridRow: 1 }} />

        {/* column heads */}
        {grid.columns.map((c, i) => (
          <div
            key={c.key}
            role="columnheader"
            className={cn('sticky top-0 z-30 flex min-w-0 flex-col justify-center border-b border-l border-white/8 bg-ink-800/95 px-2.5 backdrop-blur', c.isToday && mode === 'week' && 'text-volt')}
            style={{ gridColumn: i + 2, gridRow: 1 }}
          >
            <span className="flex min-w-0 items-center gap-1.5 text-[13px] font-semibold">
              {mode === 'day' && <span aria-hidden>{SPORTS[c.pitch.sport]?.emoji}</span>}
              <span className="truncate">{c.label}</span>
              {c.isToday && mode === 'week' && <span className="rounded bg-volt px-1 text-[9px] font-bold text-ink-950 uppercase">Today</span>}
            </span>
            {c.pitch.is_active === false ? (
              <span className="flex min-w-0 items-center gap-1 text-[11px] font-semibold text-sun" title="Switched off — existing bookings stay, nothing new can be booked">
                <Ban className="h-3 w-3 shrink-0" aria-hidden />
                <span className="truncate">
                  <span className="sm:hidden">Closed</span>
                  <span className="hidden sm:inline">Not bookable</span>
                </span>
              </span>
            ) : (
              <span className="truncate text-[11px] text-muted">{c.sub}</span>
            )}
          </div>
        ))}

        {/* time labels */}
        {grid.rows.map((r, i) => (
          <div
            key={r}
            role="rowheader"
            className="sticky left-0 z-20 border-r border-b border-[var(--cal-line)] bg-ink-800/95 pt-1 pr-1.5 text-right font-mono text-[11px] text-muted backdrop-blur"
            style={{ gridColumn: 1, gridRow: i + 2 }}
          >
            {/* the "now" chip replaces the hour label when they'd overlap */}
            <span className={cn(nowPos && nowPos.row === i && nowPos.frac < 0.45 && 'invisible')}>{hhmmLabel(r, true)}</span>
            {nowPos && nowPos.row === i && (
              <span
                className="absolute right-0.5 z-10 -translate-y-1/2 rounded bg-volt px-1 font-mono text-[10px] leading-4 font-bold text-ink-950"
                style={{ top: `${nowPos.frac * 100}%` }}
              >
                {hhmmLabel(istTimeOf(new Date(now)), true).replace(/[ap]$/, '')}
              </span>
            )}
          </div>
        ))}

        {/* empty grid backdrop (closed / missing slots) */}
        {grid.matrix.map((colCells, col) =>
          colCells.map((cell, row) =>
            cell ? null : (
              <div
                key={`x${col}-${row}`}
                className="pp-hatch border-b border-l border-[var(--cal-line)] opacity-60"
                style={{ gridColumn: col + 2, gridRow: row + 2 }}
                aria-label="Closed"
              />
            ),
          ),
        )}

        {/* items */}
        {grid.items.map((item) => {
          const flash = Math.max(0, ...item.cells.map((c) => flashes[c.slot_id] ?? 0))
          if (item.kind === 'available') {
            const cell = item.cells[0]!
            const past = Date.parse(cell.end_at) <= now
            const selected = inActive(item.col, item.row)
            return (
              <AvailableCell
                key={item.id}
                item={item}
                past={past}
                selected={selected}
                flash={flash}
                onPointerDown={(e) => {
                  if (past || e.pointerType !== 'mouse' || e.button !== 0) return
                  e.preventDefault()
                  const s = { col: item.col, from: item.row, to: item.row }
                  dragRef.current = s
                  setDrag(s)
                }}
                onPointerEnter={() => extendDrag(item.col, item.row)}
                onClick={(e) => {
                  if (past) return
                  // mouse clicks are handled by the drag (pointerup); keyboard + touch land here
                  if ((e.nativeEvent as PointerEvent).pointerType === 'mouse' && e.detail > 0) return
                  onSelect({ col: item.col, from: item.row, to: item.row }, false)
                }}
              />
            )
          }
          return <OccupiedBar key={item.id} item={item} flash={flash} now={now} onClick={() => onItem(item)} />
        })}

        {/* now line */}
        {nowPos && (
          <div
            aria-hidden
            className="pointer-events-none relative z-[15]"
            style={{ gridColumn: mode === 'day' ? `2 / ${cols + 2}` : todayCol + 2, gridRow: nowPos.row + 2 }}
          >
            <div className="absolute inset-x-0 h-0.5 bg-volt shadow-[0_0_12px_var(--color-volt)]" style={{ top: `${nowPos.frac * 100}%` }}>
              <span className="absolute -top-[3px] -left-1 h-2 w-2 rounded-full bg-volt" />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function FlashRing({ flash }: { flash: number }) {
  if (!flash) return null
  return (
    <motion.span
      key={flash}
      aria-hidden
      initial={{ opacity: 1 }}
      animate={{ opacity: 0 }}
      transition={{ duration: 1.8, ease: 'easeOut' }}
      className="pointer-events-none absolute inset-0 z-10 rounded-xl bg-volt/25 ring-2 ring-volt"
    />
  )
}

function AvailableCell({
  item,
  past,
  selected,
  flash,
  onPointerDown,
  onPointerEnter,
  onClick,
}: {
  item: GridItem
  past: boolean
  selected: boolean
  flash: number
  onPointerDown: (e: React.PointerEvent) => void
  onPointerEnter: () => void
  onClick: (e: React.MouseEvent) => void
}) {
  const cell = item.cells[0]!
  const label = `${rangeLabel(cell.start_at, cell.end_at)}, free${cell.is_peak ? ', peak' : ''}, ${formatINR(cell.price_paise)}`
  return (
    <button
      type="button"
      role="gridcell"
      aria-label={past ? `${label} (past)` : `${label}. Tap to book or block`}
      aria-disabled={past}
      aria-selected={selected}
      tabIndex={past ? -1 : 0}
      onPointerDown={onPointerDown}
      onPointerEnter={onPointerEnter}
      onClick={onClick}
      className={cn(
        'group relative flex min-w-0 flex-col items-end justify-end border-b border-l border-[var(--cal-line)] p-1.5 text-right transition-colors outline-none focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-volt focus-visible:ring-inset',
        past ? 'cursor-default bg-[var(--cal-past)]' : 'cursor-pointer hover:bg-volt/[0.07] active:bg-volt/15',
        selected && 'pp-selected bg-volt/15 hover:bg-volt/15',
      )}
      style={{ gridColumn: item.col + 2, gridRow: item.row + 2 }}
    >
      <FlashRing flash={flash} />
      {!past && (
        <span
          className={cn(
            'absolute top-1.5 left-1.5 flex h-6 w-6 items-center justify-center rounded-lg bg-volt text-ink-950 transition',
            selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100',
          )}
          aria-hidden
        >
          <Plus className="h-4 w-4" />
        </span>
      )}
      <span className={cn('inline-flex items-center gap-0.5 font-mono text-[11px] leading-none', past ? 'text-subtle/60' : 'text-muted')}>
        {cell.is_peak && <Flame className="h-3 w-3 text-sun" aria-hidden />}
        {formatINR(cell.price_paise, { compact: true })}
      </span>
    </button>
  )
}

function OccupiedBar({ item, flash, now, onClick }: { item: GridItem; flash: number; now: number; onClick: () => void }) {
  const cell = item.cells[0]!
  const occ = cell.occupancy
  const past = Date.parse(item.end) <= now
  const range = rangeLabel(item.start, item.end)

  let color = 'var(--src-maintenance)'
  let Icon = Zap
  let title: string
  let sub = ''
  let hatch = false
  let dashed = false
  let aria: string

  if (isPytch(occ)) {
    color = SOURCES.pytch.color
    Icon = SOURCES.pytch.icon
    title = occ.lobby_title
    sub = `${occ.host_name} · ${occ.paid_spots}/${occ.total_spots} paid`
    dashed = occ.lobby_status === 'forming'
    aria = `Pytch booking ${occ.lobby_title}, ${occ.lobby_status}`
  } else if (isBlock(occ)) {
    const s = SOURCES[occ.source] ?? SOURCES.other_app
    color = s.color
    Icon = s.icon
    hatch = occ.source === 'maintenance' || occ.block_kind === 'block'
    title = occ.customer_name || s.label
    sub =
      occ.block_kind === 'block'
        ? occ.source === 'maintenance'
          ? (occ.notes ?? 'Closed')
          : `Blocked · ${s.label}`
        : [occ.customer_name ? s.label : null, occ.amount_paise ? formatINR(occ.amount_paise) : null, occ.payment_mode ? paymentModeLabel(occ.payment_mode) : null]
            .filter(Boolean)
            .join(' · ')
    aria = `${s.label} ${occ.block_kind === 'block' ? 'block' : 'booking'}${occ.customer_name ? ` for ${occ.customer_name}` : ''}`
  } else if (item.kind === 'held') {
    color = 'var(--color-sun)'
    Icon = Clock
    title = 'Held'
    aria = 'Held: someone is paying on Pytch'
  } else {
    title = cell.status === 'blocked' ? 'Blocked' : 'Booked'
    aria = title
  }

  return (
    <div className="relative z-[5] min-w-0 border-b border-l border-[var(--cal-line)] p-[3px]" style={{ gridColumn: item.col + 2, gridRow: `${item.row + 2} / span ${item.span}` }}>
      <motion.button
        type="button"
        role="gridcell"
        layout="position"
        initial={{ opacity: 0, scale: 0.94 }}
        animate={{ opacity: past ? 0.62 : 1, scale: 1 }}
        transition={{ type: 'spring', stiffness: 420, damping: 32 }}
        whileTap={{ scale: 0.97 }}
        onClick={onClick}
        aria-label={`${range}: ${aria}${item.conflict ? ', sync conflict' : ''}. Open details`}
        className={cn(
          '@container relative flex h-full w-full cursor-pointer flex-col overflow-hidden rounded-xl px-2 py-1.5 text-left transition-[filter] hover:brightness-110 focus-visible:ring-2 focus-visible:ring-volt focus-visible:outline-none',
          (item.conflict || (isPytch(occ) && occ.lobby_status === 'forming')) && 'pr-6 @min-[9.5rem]:pr-2',
          hatch && 'pp-hatch',
          item.kind === 'held' && 'pp-held',
          item.conflict && 'ring-2 ring-flare',
        )}
        style={
          item.kind === 'held'
            ? undefined
            : {
                backgroundColor: alpha(color, hatch ? 0.1 : 0.17),
                boxShadow: `inset 3px 0 0 ${color}${dashed ? `, inset 0 0 0 1px ${alpha(color, 0.5)}` : ''}`,
              }
        }
      >
        <FlashRing flash={flash} />
        <span className="flex min-w-0 items-start gap-1 text-[12px] leading-tight font-semibold text-fg">
          <Icon className="mt-px h-3.5 w-3.5 shrink-0" style={{ color }} aria-hidden />
          <span className={item.span > 1 ? 'line-clamp-2 break-words hyphens-auto' : 'truncate'}>{title}</span>
        </span>
        {item.kind === 'held' ? (
          <HeldLine until={cell.held_until} />
        ) : (
          sub && <span className="mt-0.5 truncate text-[11px] leading-tight text-muted">{sub}</span>
        )}
        {item.span > 1 && <span className="mt-auto truncate font-mono text-[10px] text-muted">{range}</span>}
        {item.conflict && (
          <span className="absolute top-1 right-1 flex h-4 items-center gap-0.5 rounded-md bg-flare px-0.5 text-[9px] leading-4 font-bold text-snow uppercase @min-[9.5rem]:px-1" title="Sync conflict">
            <AlertTriangle className="h-2.5 w-2.5" />
            <span className="hidden @min-[9.5rem]:inline">Conflict</span>
          </span>
        )}
        {isPytch(occ) && occ.lobby_status === 'forming' && !item.conflict && (
          <span className="absolute top-1 right-1 flex h-4 items-center rounded-md bg-electric/20 px-1 text-[9px] leading-4 font-bold text-electric uppercase" title="Game still forming">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-electric @min-[9.5rem]:hidden" />
            <span className="hidden @min-[9.5rem]:inline">Forming</span>
          </span>
        )}
      </motion.button>
    </div>
  )
}

function HeldLine({ until }: { until: string | null }) {
  const c = useCountdown(until)
  return (
    <span className="mt-0.5 flex min-w-0 items-center gap-1 text-[11px] leading-tight text-sun">
      <span className="truncate">Paying on Pytch</span>
      {until && !c.expired && <span className="shrink-0 font-mono">{c.label}</span>}
    </span>
  )
}

export function CalendarGridSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn('glass overflow-hidden rounded-3xl p-3', className)}>
      <div className="grid grid-cols-[3rem_repeat(3,1fr)] gap-1.5">
        {Array.from({ length: 40 }, (_, i) => (
          <div key={i} className={cn('skeleton h-12 rounded-xl', i % 4 === 0 && 'w-10 opacity-50')} />
        ))}
      </div>
    </div>
  )
}
