import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, ArrowRight, CalendarClock, CalendarSync, CircleDollarSign, Gauge, Hourglass, IndianRupee, Landmark, Plus, Ticket } from 'lucide-react'
import { motion } from 'motion/react'
import { useState } from 'react'
import { Link } from 'react-router'
import { LinkButton } from '@/components/ui/Button'
import { Segmented } from '@/components/ui/Segmented'
import { ErrorState, Skeleton } from '@/components/ui/States'
import { cn } from '@/lib/cn'
import { formatINR, pluralize } from '@/lib/format'
import type { PartnerDashboard, PeriodStats } from '@/types/partner'
import { partnerApi } from '../api/endpoints'
import { pk } from '../api/keys'
import { ChannelDonut, OccupancyHeatmap, RevenueChart } from '../components/charts'
import { KpiTile, PageTitle, Panel, SourceBadge } from '../components/kit'
import { useToday, useTurfFilter, useVenues } from '../hooks'
import { sourceMeta } from '../lib/sources'
import { addDays, dayLabel, hhmmLabel, istDateOf, istTimeOf } from '../lib/time'
import { useCan, useMembership, usePartnerAuth } from '../stores/partnerAuth'
import { MirrorTodoCard } from '../components/Mirror'

type Period = 'today' | 'week' | 'month'

function greeting() {
  const h = Number(new Intl.DateTimeFormat('en-IN', { hour: 'numeric', hour12: false, timeZone: 'Asia/Kolkata' }).format(new Date()))
  return h < 5 ? 'Late night' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
}

export default function DashboardPage() {
  const [turfId] = useTurfFilter()
  const venues = useVenues()
  const user = usePartnerAuth((s) => s.user)
  const m = useMembership()
  const manager = useCan('manager')
  const owner = useCan('owner')
  const [period, setPeriod] = useState<Period>('today')
  const dash = useQuery({ queryKey: pk.dashboard(turfId), queryFn: () => partnerApi.dashboard(turfId), refetchInterval: 60_000 })
  const venueName = turfId ? venues.data?.find((v) => v.id === turfId)?.name : (venues.data?.length ?? 0) > 1 ? 'all venues' : venues.data?.[0]?.name

  return (
    <div>
      <PageTitle
        eyebrow={m?.provider_name}
        title={`${greeting()}${user?.name && !user.name_is_default ? `, ${user.name.split(' ')[0]}` : ''}`}
        subtitle={venueName ? `Here’s ${venueName} at a glance.` : 'Here’s your business at a glance.'}
        actions={
          <LinkButton to="/partner/calendar" size="md">
            <Plus className="h-4 w-4" /> Walk-in / block
          </LinkButton>
        }
      />

      {dash.isError ? (
        <ErrorState error={dash.error} onRetry={() => dash.refetch()} />
      ) : !dash.data ? (
        <DashboardSkeleton />
      ) : (
        <div className={cn('space-y-5 transition-opacity', dash.isRefetching && 'opacity-90')}>
          <Alerts d={dash.data} manager={manager} owner={owner} />
          <MirrorTodoCard />

          <section aria-label="Key numbers">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-display text-base font-semibold">Performance</h2>
              <Segmented<Period>
                size="sm"
                className="pp-seg shrink-0 [&_button]:whitespace-nowrap"
                value={period}
                onChange={setPeriod}
                options={[
                  { value: 'today', label: 'Today' },
                  { value: 'week', label: 'This week' },
                  { value: 'month', label: 'This month' },
                ]}
              />
            </div>
            <Kpis s={dash.data[period]} period={period} />
          </section>

          <div className="grid gap-5 lg:grid-cols-[1.6fr_1fr] [&>*]:min-w-0">
            <RevenueChart series={dash.data.revenue_series} title="Revenue · last 14 days" subtitle="Pytch payouts vs. money you collected offline" height={300} />
            <Upcoming d={dash.data} />
          </div>

          <div className="grid gap-5 lg:grid-cols-[1.6fr_1fr] [&>*]:min-w-0">
            <OccupancyHeatmap data={dash.data.occupancy_heatmap} />
            <ChannelDonut mix={dash.data.channel_mix} />
          </div>
        </div>
      )}
    </div>
  )
}

function Kpis({ s, period }: { s: PeriodStats; period: Period }) {
  const label = period === 'today' ? 'today' : period === 'week' ? 'this week' : 'this month'
  const offlineShare = s.bookings ? Math.round((s.offline_bookings / s.bookings) * 100) : 0
  return (
    <motion.div key={period} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <KpiTile label="Bookings" icon={Ticket} value={s.bookings.toLocaleString('en-IN')} hint={`${s.pytch_bookings} Pytch · ${s.offline_bookings} offline`} />
      <KpiTile label="Revenue" icon={IndianRupee} accent="var(--color-mint)" value={formatINR(s.revenue_paise)} hint={`All channels, ${label}`} />
      <div className="relative min-w-0 overflow-hidden rounded-2xl bg-white/4 p-4 ring-1 ring-white/8">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold tracking-wider text-muted uppercase">Occupancy</span>
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-electric/12 text-electric">
            <Gauge className="h-4 w-4" />
          </span>
        </div>
        <div className="mt-1.5 font-mono text-xl font-semibold sm:text-2xl">{Math.round(s.occupancy_pct)}%</div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-electric/15" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(s.occupancy_pct)} aria-label="Occupancy">
          <motion.div className="h-full rounded-full bg-electric" initial={{ width: 0 }} animate={{ width: `${Math.min(100, s.occupancy_pct)}%` }} transition={{ type: 'spring', stiffness: 80, damping: 20 }} />
        </div>
      </div>
      <KpiTile label="Offline share" icon={CalendarClock} accent="var(--color-grape-soft)" value={`${offlineShare}%`} hint="Walk-ins, phone & other apps" />
    </motion.div>
  )
}

function Alerts({ d, manager, owner }: { d: PartnerDashboard; manager: boolean; owner: boolean }) {
  const a = d.alerts
  const items = [
    (a.pending_bank_change || a.payouts_on_hold) && {
      key: 'bank',
      tone: 'warn' as const,
      icon: Landmark,
      title: a.pending_bank_change ? 'Payout account change pending review' : 'Payouts on hold',
      text: owner
        ? 'Payouts are on hold until Pytch finance verifies the new account — usually within a working day.'
        : 'Payouts are on hold while Pytch verifies a new payout account. Nothing to do on your side.',
      to: manager ? '/partner/settings' : undefined,
      cta: 'Settings',
    },
    a.open_conflicts > 0 && {
      key: 'conflicts',
      tone: 'bad' as const,
      icon: AlertTriangle,
      title: `${pluralize(a.open_conflicts, 'sync conflict')} to resolve`,
      text: manager ? 'An imported booking overlaps a Pytch booking.' : 'An imported booking overlaps a Pytch booking — your manager resolves it in Channels.',
      to: manager ? '/partner/channels#conflicts' : undefined,
      cta: 'Resolve',
    },
    a.failing_feeds > 0 && {
      key: 'feeds',
      tone: 'warn' as const,
      icon: CalendarSync,
      title: `${pluralize(a.failing_feeds, 'calendar feed')} failing`,
      text: 'Imported bookings may be out of date.',
      to: manager ? '/partner/channels#import' : undefined,
      cta: 'Check feeds',
    },
    a.pending_payout_paise > 0 && {
      key: 'payout',
      tone: 'info' as const,
      icon: CircleDollarSign,
      title: `${formatINR(a.pending_payout_paise)} payout pending`,
      text: a.payouts_on_hold ? 'Paid out once the payout-account change is approved.' : 'Arrives with your next weekly settlement.',
      to: manager ? '/partner/earnings' : undefined,
      cta: 'Earnings',
    },
    a.pending_application && {
      key: 'app',
      tone: 'info' as const,
      icon: Hourglass,
      title: 'A change is waiting for Pytch approval',
      text: 'Requested by your business — we’ll notify you once it’s reviewed.',
      to: undefined,
      cta: '',
    },
  ].filter(Boolean) as { key: string; tone: 'bad' | 'warn' | 'info'; icon: typeof AlertTriangle; title: string; text: string; to?: string; cta: string }[]
  if (!items.length) return null
  const tone = { bad: 'bg-flare/8 ring-flare/30 [&_svg]:text-flare', warn: 'bg-sun/8 ring-sun/30 [&_svg]:text-sun', info: 'bg-electric/8 ring-electric/25 [&_svg]:text-electric' }
  return (
    <section aria-label="Alerts" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {items.map((i, n) => {
        const body = (
          <>
            <i.icon className="mt-0.5 h-5 w-5 shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold">{i.title}</div>
              <div className="text-xs text-muted">{i.text}</div>
            </div>
            {i.to && <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 opacity-60" />}
          </>
        )
        return (
          <motion.div key={i.key} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: n * 0.05 }}>
            {i.to ? (
              <Link to={i.to} className={cn('flex h-full items-start gap-3 rounded-2xl p-4 ring-1 transition hover:brightness-110', tone[i.tone])}>
                {body}
              </Link>
            ) : (
              <div className={cn('flex h-full items-start gap-3 rounded-2xl p-4 ring-1', tone[i.tone])}>{body}</div>
            )}
          </motion.div>
        )
      })}
    </section>
  )
}

function Upcoming({ d }: { d: PartnerDashboard }) {
  const today = useToday()
  return (
    <Panel
      title="Coming up"
      subtitle="Next bookings across channels"
      actions={
        <Link to="/partner/calendar" className="text-xs font-semibold text-volt hover:underline">
          Calendar →
        </Link>
      }
      bodyClassName="pt-2 sm:pt-2"
    >
      {d.upcoming.length === 0 ? (
        <div className="py-8 text-center text-sm text-muted">Nothing booked yet. Share your Pytch venue page or log a walk-in.</div>
      ) : (
        <ul className="-mx-2 divide-y divide-white/6">
          {d.upcoming.map((e, i) => {
            const s = sourceMeta(e.source)
            const date = istDateOf(e.start_at)
            return (
              <li key={i}>
                <Link to={`/partner/calendar?date=${date}`} className="flex items-center gap-3 rounded-xl px-2 py-2.5 transition hover:bg-white/5">
                  <div className="w-14 shrink-0 text-center">
                    <div className="font-mono text-sm font-semibold">{hhmmLabel(istTimeOf(e.start_at), true)}</div>
                    <div className="text-[10px] text-muted uppercase">{date === today ? 'Today' : date === addDays(today, 1) ? 'Tmrw' : dayLabel(date, 'EEE d')}</div>
                  </div>
                  <span className="h-9 w-1 shrink-0 rounded-full" style={{ background: s.color }} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">{e.title}</div>
                    <div className="truncate text-xs text-muted">
                      {e.pitch_name} · {e.turf_name}
                    </div>
                  </div>
                  <SourceBadge source={e.source} size="xs" className="hidden sm:inline-flex" />
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </Panel>
  )
}

function DashboardSkeleton() {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-[6.5rem]" />
        ))}
      </div>
      <div className="grid gap-5 lg:grid-cols-[1.6fr_1fr] [&>*]:min-w-0">
        <Skeleton className="h-80 rounded-3xl" />
        <Skeleton className="h-80 rounded-3xl" />
      </div>
      <div className="grid gap-5 lg:grid-cols-[1.6fr_1fr] [&>*]:min-w-0">
        <Skeleton className="h-72 rounded-3xl" />
        <Skeleton className="h-72 rounded-3xl" />
      </div>
    </div>
  )
}
