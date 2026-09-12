import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { AlertTriangle } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { Segmented } from '@/components/ui/Segmented'
import { PageHeader, Skeleton } from '@/components/ui/States'
import { errorMessage } from '@/lib/api/http'
import { SPORTS } from '@/lib/sports'
import type { AnalyticsRange, Kpi, VenueAnalyticsRow } from '@/types/admin'
import type { Sport } from '@/types/api'
import { BarList } from '../components/charts/BarList'
import { CohortGrid } from '../components/charts/CohortGrid'
import { HeatmapGrid } from '../components/charts/Heatmap'
import { KpiCard } from '../components/charts/KpiCard'
import { TimeSeriesChart } from '../components/charts/TimeSeriesChart'
import { DataTable, type Column } from '../components/DataTable'
import { HealthStrip } from '../components/HealthStrip'
import { Meter, Money, Panel } from '../components/ui'
import { adminApi, qk, type Metric } from '../lib/api'
import { compactNum, inr, pct } from '../lib/format'
import { useUrlState } from '../lib/hooks'
import { useCan, useSession } from '../lib/session'

const RANGES: { value: AnalyticsRange; label: string }[] = [
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: '90d', label: '90 days' },
]

const PRIMARY = ['gmv', 'net_revenue', 'take_rate', 'bookings', 'active_players', 'new_players', 'avg_fill_rate', 'split_completion_rate']
const SERIES_FOR: Record<string, Metric> = {
  gmv: 'gmv',
  bookings: 'bookings',
  net_revenue: 'net_revenue',
  new_players: 'new_players',
  active_players: 'active_players',
}
const METRICS: { value: Metric; label: string; money: boolean }[] = [
  { value: 'gmv', label: 'GMV', money: true },
  { value: 'bookings', label: 'Bookings', money: false },
  { value: 'net_revenue', label: 'Net revenue', money: true },
  { value: 'active_players', label: 'Active players', money: false },
  { value: 'new_players', label: 'New players', money: false },
]

function useSeries(metric: Metric, range: AnalyticsRange, enabled: boolean) {
  const granularity = range === '90d' ? 'week' : 'day'
  return useQuery({
    queryKey: ['admin', 'analytics', 'ts', metric, range, granularity],
    queryFn: () => adminApi.analytics.timeseries(metric, range, granularity),
    enabled,
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  })
}

export default function Dashboard() {
  const can = useCan()
  const me = useSession((s) => s.me)
  const allowed = can('analytics.view')
  const [{ range: rangeParam, metric: metricParam }, setUrl] = useUrlState({ range: '30d', metric: 'gmv' })
  const range = (RANGES.some((r) => r.value === rangeParam) ? rangeParam : '30d') as AnalyticsRange
  const metric = (METRICS.some((m) => m.value === metricParam) ? metricParam : 'gmv') as Metric
  const rangeLabel = RANGES.find((r) => r.value === range)!.label

  const health = useQuery({ queryKey: qk.health, queryFn: adminApi.system.health, refetchInterval: 60_000 })
  const overview = useQuery({
    queryKey: ['admin', 'analytics', 'overview', range],
    queryFn: () => adminApi.analytics.overview(range),
    enabled: allowed,
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  })
  const gmv = useSeries('gmv', range, allowed)
  const bookings = useSeries('bookings', range, allowed)
  const net = useSeries('net_revenue', range, allowed)
  const active = useSeries('active_players', range, allowed)
  const newP = useSeries('new_players', range, allowed)
  const seriesMap: Partial<Record<Metric, typeof gmv>> = { gmv, bookings, net_revenue: net, active_players: active, new_players: newP }
  const selected = seriesMap[metric]!

  const heatmap = useQuery({
    queryKey: ['admin', 'analytics', 'heatmap', range],
    queryFn: () => adminApi.analytics.heatmap(range),
    enabled: allowed,
    placeholderData: keepPreviousData,
  })
  const sports = useQuery({
    queryKey: ['admin', 'analytics', 'sports', range],
    queryFn: () => adminApi.analytics.sports(range),
    enabled: allowed,
    placeholderData: keepPreviousData,
  })
  const venues = useQuery({
    queryKey: ['admin', 'analytics', 'venues', range],
    queryFn: () => adminApi.analytics.venues(range),
    enabled: allowed,
    placeholderData: keepPreviousData,
  })
  const cohorts = useQuery({ queryKey: ['admin', 'analytics', 'cohorts'], queryFn: adminApi.analytics.cohorts, enabled: allowed, staleTime: 5 * 60_000 })

  const kpis = overview.data?.kpis ?? []
  const primary = PRIMARY.map((k) => kpis.find((x) => x.key === k)).filter(Boolean) as Kpi[]
  const secondary = kpis.filter((k) => !PRIMARY.includes(k.key))
  const shownPrimary = primary.length ? primary : kpis.slice(0, 8)
  const shownSecondary = primary.length ? secondary : kpis.slice(8)

  const trendFor = (key: string) => {
    const m = SERIES_FOR[key]
    const s = m ? seriesMap[m]?.data : undefined
    return s ? { values: s.points.map((p) => p.value), previous: s.previous.map((p) => p.value) } : undefined
  }

  const metricMeta = METRICS.find((m) => m.value === metric)!
  const fmt = metricMeta.money ? (v: number) => inr(v, Math.abs(v) >= 1_00_000) : (v: number) => Math.round(v).toLocaleString('en-IN')
  const axisFmt = metricMeta.money ? (v: number) => (v === 0 ? '0' : inr(v, true)) : (v: number) => compactNum(v)

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Overview"
        title={`Good ${greeting()}, ${me?.name?.split(' ')[0] ?? 'there'}`}
        subtitle="Marketplace health across Kochi · all figures in IST"
        actions={
          allowed && (
            <Segmented<AnalyticsRange> value={range} onChange={(v) => setUrl({ range: v })} options={RANGES} size="sm" />
          )
        }
      />

      <HealthStrip health={health.data} loading={health.isLoading} />

      {!allowed ? (
        <Panel>
          <p className="text-sm text-muted">Analytics aren’t part of your role. Use the navigation to get to your work queues.</p>
        </Panel>
      ) : overview.isError ? (
        <Panel>
          <div className="flex items-center gap-2 text-sm text-flare">
            <AlertTriangle className="h-4 w-4" /> {errorMessage(overview.error)}
          </div>
        </Panel>
      ) : (
        <>
          <section aria-label="Key metrics" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {overview.isLoading
              ? Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-[118px]" />)
              : shownPrimary.map((k) => <KpiCard key={k.key} kpi={k} rangeLabel={rangeLabel} trend={trendFor(k.key)} />)}
          </section>

          {shownSecondary.length > 0 && (
            <section aria-label="More metrics" className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {shownSecondary.map((k) => (
                <KpiCard key={k.key} kpi={k} rangeLabel={rangeLabel} size="sm" />
              ))}
            </section>
          )}

          <div className="grid gap-5 xl:grid-cols-3">
            <Panel
              className="xl:col-span-2"
              title={`${metricMeta.label} over time`}
              description={`${rangeLabel} by ${range === '90d' ? 'week' : 'day'}, compared with the previous ${rangeLabel}`}
              actions={
                <Segmented<Metric>
                  value={metric}
                  onChange={(v) => setUrl({ metric: v })}
                  size="sm"
                  options={METRICS.map((m) => ({ value: m.value, label: m.label }))}
                  className="max-w-full overflow-x-auto"
                />
              }
            >
              {selected.isLoading ? (
                <Skeleton className="h-[310px]" />
              ) : (
                <TimeSeriesChart series={selected.data} format={fmt} axisFormat={axisFmt} dim={selected.isPlaceholderData} metricLabel={metricMeta.label} />
              )}
            </Panel>

            <Panel title="Sport mix" description={`Bookings in the last ${rangeLabel}`}>
              {sports.isLoading ? (
                <Skeleton className="h-60" />
              ) : (
                <BarList
                  dim={sports.isPlaceholderData}
                  rows={[...(sports.data?.rows ?? [])]
                    .sort((a, b) => b.bookings - a.bookings)
                    .map((r) => ({
                      key: r.sport,
                      label: `${SPORTS[r.sport as Sport]?.emoji ?? ''} ${SPORTS[r.sport as Sport]?.label ?? r.sport}`,
                      value: r.bookings,
                      display: r.bookings.toLocaleString('en-IN'),
                      secondary: inr(r.gmv_paise, true),
                    }))}
                />
              )}
            </Panel>
          </div>

          <div className="grid gap-5 xl:grid-cols-2">
            <Panel title="When people play" description="Bookings by weekday and start hour">
              {heatmap.isLoading ? <Skeleton className="h-56" /> : <HeatmapGrid data={heatmap.data} dim={heatmap.isPlaceholderData} />}
            </Panel>
            <Panel title="Retention cohorts" description="% of each first-match week still playing in the weeks after">
              {cohorts.isLoading ? <Skeleton className="h-56" /> : <CohortGrid data={cohorts.data} />}
            </Panel>
          </div>

          <TopVenues rows={venues.data} loading={venues.isLoading} dim={venues.isPlaceholderData} rangeLabel={rangeLabel} />
        </>
      )}
    </div>
  )
}

function TopVenues({ rows, loading, dim, rangeLabel }: { rows: VenueAnalyticsRow[] | undefined; loading: boolean; dim: boolean; rangeLabel: string }) {
  const navigate = useNavigate()
  const can = useCan()
  const [limit, setLimit] = useState(10)
  const sorted = useMemo(() => [...(rows ?? [])].sort((a, b) => b.gmv_paise - a.gmv_paise), [rows])
  const columns: Column<VenueAnalyticsRow>[] = [
    {
      key: 'name',
      header: 'Venue',
      cell: (r) => (
        <div className="min-w-0">
          <div className="truncate font-medium">{r.turf_name}</div>
          <div className="truncate text-xs text-muted">{r.provider_name ?? 'Unassigned'}</div>
        </div>
      ),
      sortValue: (r) => r.turf_name,
    },
    { key: 'bookings', header: 'Bookings', align: 'right', cell: (r) => <span className="num">{r.bookings.toLocaleString('en-IN')}</span>, sortValue: (r) => r.bookings },
    { key: 'gmv', header: 'GMV', align: 'right', cell: (r) => <Money paise={r.gmv_paise} />, sortValue: (r) => r.gmv_paise },
    {
      key: 'occ',
      header: 'Occupancy',
      cell: (r) => (
        <div className="flex min-w-28 items-center gap-2">
          <Meter value={r.occupancy_pct / 100} label={`Occupancy ${pct(r.occupancy_pct)}`} />
          <span className="num w-10 text-right text-xs">{pct(r.occupancy_pct, 0)}</span>
        </div>
      ),
      sortValue: (r) => r.occupancy_pct,
      hideBelow: 'md',
    },
    {
      key: 'cancel',
      header: 'Cancel %',
      align: 'right',
      cell: (r) => <span className={`num ${r.cancellation_pct > 15 ? 'text-flare' : ''}`}>{pct(r.cancellation_pct)}</span>,
      sortValue: (r) => r.cancellation_pct,
      hideBelow: 'sm',
    },
    {
      key: 'conflicts',
      header: 'Conflicts',
      align: 'right',
      cell: (r) => <span className={`num ${r.conflicts > 0 ? 'text-sun' : 'text-muted'}`}>{r.conflicts}</span>,
      sortValue: (r) => r.conflicts,
      hideBelow: 'md',
    },
  ]
  return (
    <Panel
      flush
      title="Top venues"
      description={`Ranked by GMV over the last ${rangeLabel}`}
      actions={
        sorted.length > 10 && (
          <button type="button" onClick={() => setLimit((l) => (l === 10 ? 50 : 10))} className="cursor-pointer text-xs font-medium text-volt hover:underline">
            {limit === 10 ? `Show all ${sorted.length}` : 'Show top 10'}
          </button>
        )
      }
    >
      <DataTable
        rows={loading ? undefined : sorted.slice(0, limit)}
        columns={columns}
        rowKey={(r) => r.turf_id}
        loading={loading}
        dim={dim}
        skeletonRows={6}
        maxHeight=""
        onRowClick={can('venues.view') ? (r) => navigate(`/venues?q=${encodeURIComponent(r.turf_name)}`) : undefined}
        empty="No venue activity in this range."
        caption="Top venues"
      />
    </Panel>
  )
}

function greeting() {
  const h = Number(new Intl.DateTimeFormat('en-IN', { hour: 'numeric', hour12: false, timeZone: 'Asia/Kolkata' }).format(new Date()))
  return h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening'
}
