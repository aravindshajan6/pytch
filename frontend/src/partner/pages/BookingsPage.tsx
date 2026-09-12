import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Download, Search, Ticket, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import { EmptyState, ErrorState } from '@/components/ui/States'
import { useIsDesktop } from '@/hooks/useMediaQuery'
import { errorMessage } from '@/lib/api/client'
import { cn } from '@/lib/cn'
import { formatINR, pluralize } from '@/lib/format'
import type { PartnerBookingRow } from '@/types/partner'
import { partnerApi, type BookingsQuery } from '../api/endpoints'
import { pk } from '../api/keys'
import { PageTitle, Pagination, RangeControl, Select, SkeletonRows, SourceBadge, StatusPill, inputCls } from '../components/kit'
import { useToday, useTurfFilter, useVenues } from '../hooks'
import { SOURCES, type AnySource } from '../lib/sources'
import { addDays, dayLabel, hhmmLabel, istDateOf, istTimeOf } from '../lib/time'

const LIMIT = 25
const STATUSES = [
  { value: '', label: 'Any status' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'pending_payment', label: 'Awaiting payment' },
  { value: 'completed', label: 'Completed' },
  { value: 'active', label: 'Active (offline)' },
  { value: 'cancelled', label: 'Cancelled' },
]

function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

export default function BookingsPage() {
  const today = useToday()
  const desktop = useIsDesktop()
  const venues = useVenues()
  const [globalTurf] = useTurfFilter()
  const [turf, setTurf] = useState<string>(globalTurf ?? '')
  const [from, setFrom] = useState(addDays(today, -6))
  const [to, setTo] = useState(addDays(today, 7))
  const [source, setSource] = useState('')
  const [status, setStatus] = useState('')
  const [q, setQ] = useState('')
  const [closures, setClosures] = useState(false)
  const [offset, setOffset] = useState(0)
  const [exporting, setExporting] = useState(false)
  const dq = useDebounced(q.trim())

  // follow the global venue switcher
  const [lastGlobal, setLastGlobal] = useState(globalTurf)
  if (lastGlobal !== globalTurf) {
    setLastGlobal(globalTurf)
    setTurf(globalTurf ?? '')
  }

  const query: BookingsQuery = {
    turf_id: turf || null,
    from,
    to,
    source: (source || null) as AnySource | null,
    status: status || null,
    q: dq || null,
    include_closures: closures || undefined,
    limit: LIMIT,
    offset,
  }
  const list = useQuery({ queryKey: pk.bookings(query), queryFn: () => partnerApi.bookings.list(query), placeholderData: keepPreviousData })

  const resetPage = <T,>(fn: (v: T) => void) => (v: T) => {
    fn(v)
    setOffset(0)
  }

  const exportCsv = async () => {
    setExporting(true)
    try {
      await partnerApi.bookings.exportCsv(query, `pytch-bookings-${from}-to-${to}.csv`)
      toast.success('Export downloaded')
    } catch (e) {
      toast.error('Export failed', { description: errorMessage(e) })
    } finally {
      setExporting(false)
    }
  }

  const filtered = !!(source || status || dq || turf || closures)

  return (
    <div>
      <PageTitle
        title="Bookings"
        subtitle="Every booking from every channel, in one list."
        actions={
          <Button variant="secondary" onClick={exportCsv} loading={exporting} disabled={!list.data?.total}>
            <Download className="h-4 w-4" /> Export CSV
          </Button>
        }
      />

      {/* filters */}
      <div className="glass mb-4 space-y-3 rounded-3xl p-3 sm:p-4">
        <RangeControl
          from={from}
          to={to}
          today={today}
          presets={['today', '7d', 'next7', '30d', 'mtd', 'last_month']}
          onChange={(f, t) => {
            setFrom(f)
            setTo(t)
            setOffset(0)
          }}
        />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="relative col-span-2 sm:col-span-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted" />
            <input
              type="search"
              value={q}
              onChange={(e) => {
                setQ(e.target.value)
                setOffset(0)
              }}
              placeholder="Name, phone (any format) or code"
              aria-label="Search bookings"
              className={cn(inputCls, 'pl-9 text-sm')}
            />
          </div>
          {(venues.data?.length ?? 0) > 1 && (
            <Select aria-label="Venue" value={turf} onChange={resetPage(setTurf)} options={[{ value: '', label: 'All venues' }, ...(venues.data ?? []).map((v) => ({ value: v.id, label: v.name }))]} className="[&_select]:text-sm" />
          )}
          <Select
            aria-label="Source"
            value={source}
            onChange={resetPage(setSource)}
            options={[{ value: '', label: 'All sources' }, ...(Object.keys(SOURCES) as AnySource[]).map((s) => ({ value: s, label: SOURCES[s].label }))]}
            className="[&_select]:text-sm"
          />
          <Select aria-label="Status" value={status} onChange={resetPage(setStatus)} options={STATUSES} className="[&_select]:text-sm" />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label className="inline-flex min-h-9 cursor-pointer items-center gap-2 text-xs font-semibold text-muted">
            <input
              type="checkbox"
              checked={closures}
              onChange={(e) => {
                setClosures(e.target.checked)
                setOffset(0)
              }}
              className="h-4 w-4 accent-[var(--color-volt)]"
            />
            Show closures (maintenance &amp; blocked hours)
          </label>
          {filtered && (
            <button
              type="button"
              onClick={() => {
                setSource('')
                setStatus('')
                setQ('')
                setTurf('')
                setClosures(false)
                setOffset(0)
              }}
              className="inline-flex min-h-9 cursor-pointer items-center gap-1 text-xs font-semibold text-muted hover:text-fg"
            >
              <X className="h-3.5 w-3.5" /> Clear filters
            </button>
          )}
        </div>
      </div>

      {list.isError ? (
        <ErrorState error={list.error} onRetry={() => list.refetch()} />
      ) : !list.data ? (
        <SkeletonRows rows={8} />
      ) : list.data.items.length === 0 ? (
        <EmptyState
          icon={<Ticket className="mx-auto h-10 w-10 text-muted" />}
          title={filtered ? 'No bookings match these filters' : 'No bookings in this period'}
          description={filtered ? 'Try a wider date range or clear the filters.' : 'Walk-ins and phone bookings you log on the calendar show up here too.'}
          action={
            !filtered && (
              <Link to="/partner/calendar" className="text-sm font-semibold text-volt">
                Open the calendar →
              </Link>
            )
          }
        />
      ) : (
        <div className={cn('transition-opacity', list.isPlaceholderData && 'opacity-60')}>
          <div className="mb-2 text-xs text-muted">
            <span className="font-mono text-fg">{list.data.total}</span> {closures ? 'row' : 'booking'}{list.data.total === 1 ? '' : 's'}{closures ? ' incl. closures' : ''} · {dayLabel(from, 'd MMM')} – {dayLabel(to, 'd MMM')}
          </div>
          {desktop ? <BookingsTable rows={list.data.items} /> : <BookingCards rows={list.data.items} />}
          <Pagination total={list.data.total} limit={LIMIT} offset={offset} onChange={setOffset} />
        </div>
      )}
    </div>
  )
}

const when = (r: PartnerBookingRow) => `${dayLabel(istDateOf(r.start_at), 'EEE d MMM')} · ${hhmmLabel(istTimeOf(r.start_at))}–${hhmmLabel(istTimeOf(r.end_at))}`

/** A closure (maintenance / blocked hours) isn't a booking: no customer, no money — listed only on request. */
const isClosure = (r: PartnerBookingRow) => r.kind === 'offline' && r.block_kind === 'block'
const closedPill = (r: PartnerBookingRow) => (isClosure(r) && r.status === 'active' ? { label: 'Closed', tone: 'neutral' as const } : {})

function BookingsTable({ rows }: { rows: PartnerBookingRow[] }) {
  return (
    <div className="glass overflow-x-auto rounded-3xl">
      <table className="w-full min-w-[56rem] text-sm">
        <thead>
          <tr className="border-b border-white/8 text-left text-[11px] tracking-wider text-muted uppercase">
            <th className="px-4 py-3 font-semibold">When</th>
            <th className="px-3 py-3 font-semibold">Customer</th>
            <th className="px-3 py-3 font-semibold">Pitch</th>
            <th className="px-3 py-3 font-semibold">Source</th>
            <th className="px-3 py-3 text-right font-semibold">Amount</th>
            <th className="px-3 py-3 font-semibold">Payment</th>
            <th className="px-3 py-3 font-semibold">Status</th>
            <th className="px-4 py-3 font-semibold">Ref</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/6">
          {rows.map((r) => (
            <tr key={`${r.kind}-${r.id}`} className={cn('transition hover:bg-white/[0.03]', isClosure(r) && 'pp-hatch')}>
              <td className="px-4 py-3 whitespace-nowrap">
                <Link to={`/partner/calendar?date=${istDateOf(r.start_at)}`} className="hover:text-volt">
                  {when(r)}
                </Link>
              </td>
              <td className="px-3 py-3">
                {isClosure(r) ? (
                  <div className="font-medium text-muted">Closure</div>
                ) : (
                  <>
                    <div className="max-w-52 truncate font-medium">{r.customer_name}</div>
                    <div className="font-mono text-xs text-muted">
                      {r.customer_phone ?? '—'}
                      {r.players ? ` · ${pluralize(r.players, 'player')}` : ''}
                    </div>
                  </>
                )}
              </td>
              <td className="px-3 py-3">
                <div className="truncate">{r.pitch_name}</div>
                <div className="truncate text-xs text-muted">{r.turf_name}</div>
              </td>
              <td className="px-3 py-3">
                <SourceBadge source={r.source} size="xs" />
              </td>
              <td className="px-3 py-3 text-right font-mono tabular-nums">{isClosure(r) ? '—' : formatINR(r.amount_paise)}</td>
              <td className="px-3 py-3">{isClosure(r) ? <span className="text-xs text-muted">—</span> : <StatusPill status={r.payment_status} />}</td>
              <td className="px-3 py-3">
                <StatusPill status={r.status} {...closedPill(r)} />
              </td>
              <td className="px-4 py-3 font-mono text-xs whitespace-nowrap text-muted">{r.ref}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function BookingCards({ rows }: { rows: PartnerBookingRow[] }) {
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => {
        const s = SOURCES[r.source as AnySource] ?? SOURCES.other_app
        return (
          <li key={`${r.kind}-${r.id}`} className={cn('glass relative overflow-hidden rounded-2xl p-4', isClosure(r) && 'pp-hatch')}>
            <span className="absolute inset-y-0 left-0 w-1" style={{ background: s.color }} aria-hidden />
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className={cn('truncate font-semibold', isClosure(r) && 'text-muted')}>{isClosure(r) ? `Closure · ${r.customer_name}` : r.customer_name}</div>
                <div className="mt-0.5 text-xs text-muted">
                  {when(r)}
                  {r.players ? ` · ${pluralize(r.players, 'player')}` : ''}
                </div>
              </div>
              {!isClosure(r) && (
                <div className="shrink-0 text-right">
                  <div className="font-mono font-semibold">{formatINR(r.amount_paise)}</div>
                  <div className="mt-1">
                    <StatusPill status={r.payment_status} />
                  </div>
                </div>
              )}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <SourceBadge source={r.source} size="xs" />
              <StatusPill status={r.status} {...closedPill(r)} />
              <span className="text-xs text-muted">
                {r.pitch_name} · {r.turf_name}
              </span>
            </div>
            <div className="mt-2 flex items-center justify-between text-xs text-muted">
              {r.customer_phone ? (
                r.kind === 'offline' ? (
                  <a href={`tel:${r.customer_phone}`} className="font-mono text-volt">
                    {r.customer_phone}
                  </a>
                ) : (
                  <span className="font-mono">{r.customer_phone}</span>
                )
              ) : (
                <span />
              )}
              <span className="font-mono whitespace-nowrap">{r.ref}</span>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
