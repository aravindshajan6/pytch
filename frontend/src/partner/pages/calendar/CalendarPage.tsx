import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarDays, CalendarRange, ChevronLeft, ChevronRight, RefreshCw, Wrench, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import { Button } from '@/components/ui/Button'
import { Segmented } from '@/components/ui/Segmented'
import { EmptyState, ErrorState } from '@/components/ui/States'
import { cn } from '@/lib/cn'
import { realtime } from '@/lib/realtime'
import type { BlockSource } from '@/types/partner'
import { partnerApi } from '../../api/endpoints'
import { pk } from '../../api/keys'
import { useConcreteTurf, useNow, useToday } from '../../hooks'
import { SOURCES } from '../../lib/sources'
import { addDays, dayLabel, weekStart } from '../../lib/time'
import { useCan, usePartnerUi } from '../../stores/partnerAuth'
import { BulkBlockSheet } from './BulkBlockSheet'
import { CalendarGrid, CalendarGridSkeleton, type Selection } from './CalendarGrid'
import { Legend } from './Legend'
import { availableRun, buildGrid, type GridItem } from './model'
import { OccupancySheet } from './OccupancySheet'
import { QuickBlockSheet, type QuickBlockTarget } from './QuickBlockSheet'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** Subscribe to `pitch:<id>` for every pitch on screen; handler gets slot.updated payloads. */
function usePitchChannels(pitchIds: string[], onSlot: (slotId: string) => void) {
  const ref = useRef(onSlot)
  useEffect(() => {
    ref.current = onSlot
  })
  const key = pitchIds.join(',')
  useEffect(() => {
    if (!key) return
    const channels = key.split(',').map((id) => `pitch:${id}`)
    const unsubs = channels.map((c) => realtime.subscribe(c))
    const unlisten = realtime.addListener((m) => {
      if (m.event === 'slot.updated' && channels.includes(m.channel)) ref.current((m.data as { slot_id: string }).slot_id)
    })
    return () => {
      unlisten()
      unsubs.forEach((u) => u())
    }
  }, [key])
}

export default function CalendarPage() {
  const qc = useQueryClient()
  const today = useToday()
  const now = useNow(30_000)
  const [params, setParams] = useSearchParams()
  const { turf, venues, setTurfId } = useConcreteTurf()
  const mode = usePartnerUi((s) => s.calendarView)
  const setMode = usePartnerUi((s) => s.setCalendarView)
  const canBulk = useCan('manager')

  const date = DATE_RE.test(params.get('date') ?? '') ? params.get('date')! : today
  const presetSource = (params.get('source') as BlockSource | null) ?? null
  const setDate = (d: string) =>
    setParams(
      (p) => {
        if (d === today) p.delete('date')
        else p.set('date', d)
        return p
      },
      { replace: true },
    )

  const from = mode === 'day' ? date : weekStart(date)
  const days = mode === 'day' ? 1 : 7
  const [weekPitchId, setWeekPitchId] = useState<string | null>(null)

  const cal = useQuery({
    queryKey: pk.calendar(turf?.id ?? '', from, days),
    queryFn: () => partnerApi.calendar(turf!.id, from, days),
    enabled: !!turf,
    refetchInterval: 60_000,
    placeholderData: keepPreviousData,
    staleTime: 10_000,
  })
  const view = cal.data && cal.data.turf.id === turf?.id ? cal.data : undefined

  const grid = useMemo(() => (view ? buildGrid(view, mode, weekPitchId, today) : null), [view, mode, weekPitchId, today])

  // ── live updates ──
  const [flashes, setFlashes] = useState<Record<string, number>>({})
  const flash = useCallback((ids: string[]) => {
    const t = Date.now()
    setFlashes((f) => ({ ...f, ...Object.fromEntries(ids.map((id) => [id, t])) }))
  }, [])
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const refresh = useCallback(() => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current)
    refreshTimer.current = setTimeout(() => qc.invalidateQueries({ queryKey: pk.calendarAll }), 250)
  }, [qc])
  usePitchChannels(
    useMemo(() => view?.pitches.map((p) => p.id) ?? [], [view]),
    (slotId) => {
      flash([slotId])
      refresh()
    },
  )

  // ── selection / sheets ──
  const [selection, setSelection] = useState<Selection | null>(null)
  const [target, setTarget] = useState<QuickBlockTarget | null>(null)
  const [detail, setDetail] = useState<GridItem | null>(null)
  const [bulk, setBulk] = useState(false)

  const onSelect = useCallback(
    (sel: Selection) => {
      if (!grid) return
      const col = grid.columns[sel.col]
      if (!col) return
      const run = availableRun(grid, sel.col, sel.from, Date.now())
      if (!run.length) return
      setSelection(sel)
      setTarget({ pitch: col.pitch, date: col.date, run, count: sel.to - sel.from + 1, presetSource })
    },
    [grid, presetSource],
  )

  const closeTarget = () => {
    setTarget(null)
    setSelection(null)
  }

  const shift = (n: number) => setDate(addDays(date, n * days))

  const detailPitch = detail && grid ? (grid.columns[detail.col]?.pitch ?? null) : null
  const weekPitch = view && mode === 'week' ? (view.pitches.find((p) => p.id === weekPitchId) ?? view.pitches[0]) : null

  if (venues.isError) return <ErrorState error={venues.error} onRetry={() => venues.refetch()} />
  if (venues.data && venues.data.length === 0)
    return <EmptyState className="mt-8" icon={<CalendarDays className="mx-auto h-10 w-10 text-muted" />} title="No venues yet" description="Once Pytch assigns your venues, their calendars show up here." />

  const title =
    mode === 'day'
      ? date === today
        ? 'Today'
        : date === addDays(today, 1)
          ? 'Tomorrow'
          : dayLabel(date, 'EEEE')
      : from === weekStart(today)
        ? 'This week'
        : from === addDays(weekStart(today), 7)
          ? 'Next week'
          : `Week of ${dayLabel(from, 'd MMM')}`

  return (
    <div>
      {/* toolbar */}
      <div className="mb-3 flex items-center gap-2 sm:gap-3">
        <div className="flex min-w-0 items-center gap-1">
          <button type="button" onClick={() => shift(-1)} aria-label={mode === 'day' ? 'Previous day' : 'Previous week'} className="flex h-11 w-9 shrink-0 cursor-pointer items-center justify-center rounded-xl bg-white/5 ring-1 ring-white/10 hover:bg-white/10 sm:w-11">
            <ChevronLeft className="h-5 w-5" />
          </button>
          <label className="relative flex h-11 min-w-0 cursor-pointer flex-col justify-center rounded-xl px-1.5 hover:bg-white/5 sm:px-3">
            <span className="truncate font-sans text-[15px] leading-tight font-bold sm:font-display sm:text-lg">{title}</span>
            <span className="truncate font-mono text-[11px] leading-tight whitespace-nowrap text-muted">
              {mode === 'day' ? (
                <>
                  {dayLabel(date, 'd MMM')}
                  <span className="hidden sm:inline"> {dayLabel(date, 'yyyy')}</span>
                </>
              ) : (
                `${dayLabel(from, 'd MMM')} – ${dayLabel(addDays(from, 6), 'd MMM')}`
              )}
            </span>
            <input
              type="date"
              value={date}
              onChange={(e) => e.target.value && setDate(e.target.value)}
              aria-label="Jump to date"
              className="absolute inset-0 cursor-pointer opacity-0 [&::-webkit-calendar-picker-indicator]:absolute [&::-webkit-calendar-picker-indicator]:inset-0 [&::-webkit-calendar-picker-indicator]:h-full [&::-webkit-calendar-picker-indicator]:w-full [&::-webkit-calendar-picker-indicator]:cursor-pointer"
            />
          </label>
          <button type="button" onClick={() => shift(1)} aria-label={mode === 'day' ? 'Next day' : 'Next week'} className="flex h-11 w-9 shrink-0 cursor-pointer items-center justify-center rounded-xl bg-white/5 ring-1 ring-white/10 hover:bg-white/10 sm:w-11">
            <ChevronRight className="h-5 w-5" />
          </button>
          {date !== today && (
            <button type="button" onClick={() => setDate(today)} className="ml-1 hidden h-9 cursor-pointer rounded-full bg-volt/12 px-3 text-xs font-semibold text-volt ring-1 ring-volt/30 hover:bg-volt/20 sm:block">
              Today
            </button>
          )}
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
          <span className={cn('hidden items-center gap-1.5 text-xs text-muted sm:flex', !cal.isFetching && 'invisible')} aria-live="polite">
            <RefreshCw className="h-3.5 w-3.5 animate-spin" /> Syncing
          </span>
          <Segmented
            size="sm"
            className="pp-seg [&_button]:whitespace-nowrap"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'day', label: <><CalendarDays className="hidden h-3.5 w-3.5 sm:block" /> Day</> },
              { value: 'week', label: <><CalendarRange className="hidden h-3.5 w-3.5 sm:block" /> Week</> },
            ]}
          />
          {canBulk && view?.pitches.some((p) => p.is_active !== false) && (
            <Button variant="secondary" size="sm" className="h-9 px-2.5 sm:px-3" onClick={() => setBulk(true)} aria-label="Bulk block">
              <Wrench className="h-4 w-4" /> <span className="hidden sm:inline">Bulk block</span>
            </Button>
          )}
        </div>
      </div>

      {/* venue tabs (multi-venue accounts) + week pitch picker */}
      {((venues.data?.length ?? 0) > 1 || (mode === 'week' && view && view.pitches.length > 1)) && (
        <div className="no-scrollbar -mx-3 mb-3 flex gap-1.5 overflow-x-auto px-3 sm:mx-0 sm:px-0">
          {(venues.data?.length ?? 0) > 1 &&
            venues.data!.map((v) => (
              <button
                key={v.id}
                type="button"
                onClick={() => setTurfId(v.id)}
                aria-pressed={turf?.id === v.id}
                className={cn(
                  'h-9 shrink-0 cursor-pointer rounded-full px-3.5 text-xs font-semibold transition',
                  turf?.id === v.id ? 'bg-fg text-ink-950' : 'bg-white/5 text-fg/70 ring-1 ring-white/10 hover:bg-white/10',
                )}
              >
                {v.name}
              </button>
            ))}
          {(venues.data?.length ?? 0) > 1 && mode === 'week' && <span className="mx-1 w-px shrink-0 bg-white/10" />}
          {mode === 'week' &&
            view?.pitches.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setWeekPitchId(p.id)}
                aria-pressed={weekPitch?.id === p.id}
                className={cn(
                  'h-9 shrink-0 cursor-pointer rounded-full px-3.5 text-xs font-semibold transition',
                  weekPitch?.id === p.id ? 'bg-volt text-ink-950' : 'bg-white/5 text-fg/70 ring-1 ring-white/10 hover:bg-white/10',
                )}
              >
                {p.name}
                {p.is_active === false && <span className="ml-1 font-normal opacity-75">(off)</span>}
              </button>
            ))}
        </div>
      )}

      {/* phones: quick way back when browsing another week */}
      {weekStart(date) !== weekStart(today) && (
        <button type="button" onClick={() => setDate(today)} className="mb-3 flex h-10 w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-volt/10 text-sm font-semibold text-volt ring-1 ring-volt/30 sm:hidden">
          <CalendarDays className="h-4 w-4" /> Back to today
        </button>
      )}

      {/* day strip */}
      {mode === 'day' && <DayStrip date={date} today={today} onPick={setDate} />}

      <AnimatePresence>
        {presetSource && SOURCES[presetSource] && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            className="mb-3 flex items-center gap-3 rounded-2xl bg-white/5 p-3 text-sm ring-1 ring-white/10"
          >
            {(() => {
              const S = SOURCES[presetSource]
              return <S.icon className="h-5 w-5 shrink-0" style={{ color: S.color }} />
            })()}
            <span className="min-w-0 flex-1">
              <b>Mirroring a {SOURCES[presetSource].label} booking.</b> <span className="text-muted">Tap the slot it was booked for — it’ll be tagged {SOURCES[presetSource].label}.</span>
            </span>
            <button
              type="button"
              onClick={() =>
                setParams((p) => {
                  p.delete('source')
                  return p
                })
              }
              aria-label="Stop mirroring"
              className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted hover:bg-white/8"
            >
              <X className="h-4 w-4" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {cal.isError && !view ? (
        <ErrorState error={cal.error} onRetry={() => cal.refetch()} />
      ) : !grid || !view ? (
        <CalendarGridSkeleton className="h-[calc(100dvh-20rem)] min-h-[24rem]" />
      ) : grid.rows.length === 0 || grid.columns.length === 0 ? (
        <EmptyState
          icon={<CalendarDays className="mx-auto h-10 w-10 text-muted" />}
          title={view.pitches.length === 0 ? 'No pitches at this venue yet' : 'No slots on this day'}
          description={view.pitches.length === 0 ? 'Add a pitch under Venues to start taking bookings.' : 'The venue may be closed, or slots haven’t been opened this far ahead.'}
        />
      ) : (
        <CalendarGrid
          grid={grid}
          mode={mode}
          date={date}
          now={now}
          selection={selection}
          flashes={flashes}
          onSelect={onSelect}
          onItem={setDetail}
          className={cn('transition-opacity', cal.isPlaceholderData && 'opacity-60')}
        />
      )}

      <div className="mt-3 flex flex-wrap items-start justify-between gap-2">
        <Legend />
        <p className="hidden text-xs text-muted lg:block">Tip: drag across free slots to select several hours at once.</p>
      </div>

      <QuickBlockSheet
        target={target}
        onClose={closeTarget}
        onDone={() => {
          const ids = target?.run.map((c) => c.slot_id) ?? []
          closeTarget()
          flash(ids)
          qc.invalidateQueries({ queryKey: pk.calendarAll })
          qc.invalidateQueries({ queryKey: pk.bookingsAll })
          qc.invalidateQueries({ queryKey: ['partner', 'dashboard'] })
        }}
        onConflict={(ids) => {
          flash(ids)
          qc.invalidateQueries({ queryKey: pk.calendarAll })
        }}
      />
      <OccupancySheet
        item={detail}
        pitch={detailPitch}
        onClose={() => setDetail(null)}
        onChanged={() => {
          if (detail) flash(detail.cells.map((c) => c.slot_id))
          qc.invalidateQueries({ queryKey: pk.calendarAll })
          qc.invalidateQueries({ queryKey: pk.bookingsAll })
        }}
        canManageChannels={canBulk}
      />
      {view && (
        <BulkBlockSheet
          open={bulk}
          onClose={() => setBulk(false)}
          pitches={view.pitches.filter((p) => p.is_active !== false)}
          turf={view.turf}
          today={today}
          onDone={() => qc.invalidateQueries({ queryKey: pk.calendarAll })}
        />
      )}
    </div>
  )
}

function DayStrip({ date, today, onPick }: { date: string; today: string; onPick: (d: string) => void }) {
  const start = weekStart(date)
  const list = Array.from({ length: 7 }, (_, i) => addDays(start, i))
  return (
    <div className="mb-3 grid grid-cols-7 gap-1" role="tablist" aria-label="Days of this week">
      {list.map((d) => {
        const active = d === date
        return (
          <button
            key={d}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onPick(d)}
            className={cn(
              'relative flex h-12 cursor-pointer flex-col items-center justify-center rounded-xl text-xs transition',
              active ? 'bg-volt text-ink-950' : 'bg-white/[0.03] text-fg/75 ring-1 ring-white/8 hover:bg-white/8',
              d < today && !active && 'opacity-55',
            )}
          >
            <span className="text-[10px] font-semibold uppercase">{dayLabel(d, 'EEE')}</span>
            <span className="font-mono text-sm font-semibold">{dayLabel(d, 'd')}</span>
            {d === today && !active && <span className="absolute bottom-1 h-1 w-1 rounded-full bg-volt" />}
          </button>
        )
      })}
    </div>
  )
}
