import type { BlockOccupancy, CalendarCell, CalendarView, PartnerPitch, PytchOccupancy } from '@/types/partner'
import { addDays, dayLabel, istDateOf, istTimeOf } from '../../lib/time'

export type ViewMode = 'day' | 'week'

export interface GridColumn {
  key: string
  pitch: PartnerPitch
  date: string
  label: string
  sub: string
  isToday: boolean
}

export type ItemKind = 'available' | 'held' | 'pytch' | 'block' | 'occupied'

export interface GridItem {
  id: string
  col: number
  row: number
  span: number
  cells: CalendarCell[]
  kind: ItemKind
  conflict: boolean
  start: string
  end: string
  price: number
}

export interface Grid {
  rows: string[] // 'HH:mm' IST start of each row
  rowEnds: string[] // 'HH:mm' IST end of each row
  columns: GridColumn[]
  items: GridItem[]
  /** columns × rows lookup (null = no slot there, e.g. pitch closed) */
  matrix: (CalendarCell | null)[][]
}

const t = (iso: string) => Date.parse(iso)

function kindOf(c: CalendarCell): ItemKind {
  if (c.occupancy?.kind === 'pytch') return 'pytch'
  if (c.occupancy?.kind === 'block') return 'block'
  if (c.status === 'held') return 'held'
  if (c.status === 'available') return 'available'
  return 'occupied'
}

/** Cells covered by the same Pytch lobby or the same block merge into one bar. */
function mergeKey(c: CalendarCell): string | null {
  if (c.occupancy?.kind === 'pytch') return `p:${c.occupancy.lobby_id}`
  if (c.occupancy?.kind === 'block') return `b:${c.occupancy.block_id}`
  return null
}

export function buildGrid(view: CalendarView, mode: ViewMode, weekPitchId: string | null, today: string): Grid {
  const pitches = view.pitches
  let columns: GridColumn[]
  if (mode === 'day') {
    columns = pitches.map((p) => ({
      key: p.id,
      pitch: p,
      date: view.from,
      label: p.name,
      sub: `${p.format}${p.is_indoor ? ' · indoor' : ''}`,
      isToday: view.from === today,
    }))
  } else {
    const pitch = pitches.find((p) => p.id === weekPitchId) ?? pitches[0]
    columns = pitch
      ? Array.from({ length: view.days }, (_, i) => {
          const date = addDays(view.from, i)
          return { key: date, pitch, date, label: dayLabel(date, 'EEE'), sub: dayLabel(date, 'd MMM'), isToday: date === today }
        })
      : []
  }

  const colIndex = new Map<string, number>()
  columns.forEach((c, i) => colIndex.set(mode === 'day' ? c.pitch.id : c.date, i))

  // rows = union of IST start times
  const starts = new Map<string, string>()
  const placed: { col: number; time: string; cell: CalendarCell }[] = []
  for (const cell of view.cells) {
    const key = mode === 'day' ? cell.pitch_id : istDateOf(cell.start_at)
    if (mode === 'week' && cell.pitch_id !== columns[0]?.pitch.id) continue
    const col = colIndex.get(key)
    if (col === undefined) continue
    const time = istTimeOf(cell.start_at)
    if (!starts.has(time)) starts.set(time, istTimeOf(cell.end_at))
    placed.push({ col, time, cell })
  }
  const rows = [...starts.keys()].sort()
  const rowEnds = rows.map((r) => starts.get(r)!)
  const rowIndex = new Map(rows.map((r, i) => [r, i]))

  const matrix: (CalendarCell | null)[][] = columns.map(() => rows.map(() => null))
  for (const p of placed) matrix[p.col]![rowIndex.get(p.time)!] = p.cell

  const items: GridItem[] = []
  matrix.forEach((colCells, col) => {
    let current: GridItem | null = null
    colCells.forEach((cell, row) => {
      if (!cell) {
        current = null
        return
      }
      const key = mergeKey(cell)
      const prev = current as GridItem | null
      if (key && prev && prev.id.startsWith(key) && t(prev.end) === t(cell.start_at)) {
        prev.span += 1
        prev.cells.push(cell)
        prev.end = cell.end_at
        prev.price += cell.price_paise
        prev.conflict ||= cell.has_conflict
        return
      }
      const item: GridItem = {
        id: key ? `${key}#${cell.slot_id}` : `s:${cell.slot_id}`,
        col,
        row,
        span: 1,
        cells: [cell],
        kind: kindOf(cell),
        conflict: cell.has_conflict,
        start: cell.start_at,
        end: cell.end_at,
        price: cell.price_paise,
      }
      items.push(item)
      current = key ? item : null
    })
  })

  return { rows, rowEnds, columns, items, matrix }
}

/** Consecutive, bookable cells in a column starting at `row` (stops at the first occupied/past/missing cell). */
export function availableRun(grid: Grid, col: number, row: number, now: number): CalendarCell[] {
  const out: CalendarCell[] = []
  const cells = grid.matrix[col] ?? []
  for (let r = row; r < cells.length; r++) {
    const c = cells[r]
    if (!c || c.status !== 'available' || t(c.end_at) <= now) break
    const prev = out[out.length - 1]
    if (prev && t(prev.end_at) !== t(c.start_at)) break
    out.push(c)
  }
  return out
}

export const isPytch = (o: CalendarCell['occupancy']): o is PytchOccupancy => o?.kind === 'pytch'
export const isBlock = (o: CalendarCell['occupancy']): o is BlockOccupancy => o?.kind === 'block'

/** Row index + fraction for the current instant (for the "now" line), or null outside the grid. */
export function nowPosition(grid: Grid, date: string, now: number): { row: number; frac: number } | null {
  for (let r = 0; r < grid.rows.length; r++) {
    const s = Date.parse(`${date}T${grid.rows[r]}:00+05:30`)
    let e = Date.parse(`${date}T${grid.rowEnds[r]}:00+05:30`)
    if (e <= s) e += 86400000 // row ending at midnight
    if (now >= s && now < e) return { row: r, frac: (now - s) / (e - s) }
  }
  return null
}
