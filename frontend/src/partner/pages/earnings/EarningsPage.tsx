import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { ArrowRight, Banknote, CalendarClock, CircleDollarSign, HandCoins, Hourglass, Percent, ReceiptText } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States'
import { cn } from '@/lib/cn'
import { formatDateLong, formatINR } from '@/lib/format'
import { partnerApi } from '../../api/endpoints'
import { pk } from '../../api/keys'
import { RevenueChart } from '../../components/charts'
import { KpiTile, PageTitle, Panel, RangeControl, StatusPill } from '../../components/kit'
import { useToday } from '../../hooks'
import { useMembership } from '../../stores/partnerAuth'
import { rangePreset } from '../../lib/time'

export default function EarningsPage() {
  const today = useToday()
  const [[from, to], setRange] = useState(() => rangePreset('30d', today))
  const earnings = useQuery({ queryKey: pk.earnings(from, to), queryFn: () => partnerApi.earnings(from, to), placeholderData: keepPreviousData })
  const m = useMembership()
  // statements span every venue, so the API refuses them to venue-scoped non-owners
  const scoped = !!m && m.turf_ids !== null && m.role !== 'owner'
  const settlements = useQuery({ queryKey: pk.settlements, queryFn: partnerApi.settlements.list, enabled: !scoped })
  const e = earnings.data

  return (
    <div>
      <PageTitle
        title="Earnings"
        subtitle={scoped ? 'Revenue for the venues you manage.' : 'What Pytch owes you, what you collected yourself, and every weekly statement.'}
      />
      <div className="mb-5">
        <RangeControl from={from} to={to} today={today} onChange={(f, t) => setRange([f, t])} />
      </div>

      {earnings.isError ? (
        <ErrorState error={earnings.error} onRetry={() => earnings.refetch()} />
      ) : !e ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-[6.5rem]" />
          ))}
        </div>
      ) : (
        <div className={cn('space-y-5 transition-opacity', earnings.isPlaceholderData && 'opacity-60')}>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
            <KpiTile label="Pytch gross" icon={CircleDollarSign} value={formatINR(e.pytch_gross_paise)} hint="Pitch fees paid by players" />
            <KpiTile label="Commission" icon={Percent} accent="var(--color-grape-soft)" value={formatINR(e.commission_paise)} hint="Pytch’s fee on those" />
            <KpiTile label="Net to you" icon={Banknote} accent="var(--color-mint)" value={formatINR(e.pytch_net_paise)} hint="After commission & taxes" />
            <KpiTile label="Offline revenue" icon={HandCoins} accent="var(--color-electric)" value={formatINR(e.offline_revenue_paise)} hint="Collected by you — no commission" />
            <KpiTile label="Unsettled" icon={Hourglass} accent="var(--color-sun)" value={formatINR(e.unsettled_paise)} hint="Games played — in your next statement" />
            <KpiTile label="Upcoming" icon={CalendarClock} accent="var(--color-sun)" value={formatINR(e.upcoming_paise ?? 0)} hint="Confirmed games still to play — paid after they’re played" />
          </div>

          <div className="grid gap-5 lg:grid-cols-[1.6fr_1fr] [&>*]:min-w-0">
            <RevenueChart series={e.series} title="Revenue by day" subtitle="Pytch bookings vs. offline bookings you logged" height={260} />
            <Panel title="By venue" bodyClassName="pt-2 sm:pt-2">
              {e.by_turf.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted">No bookings in this range.</p>
              ) : (
                <div className="@container">
                  {/* narrow (phones, the side column on laptops): one row per venue — four numeric columns don't fit */}
                  <ul className="divide-y divide-white/6 @md:hidden">
                    {e.by_turf.map((t) => (
                      <li key={t.turf_id} className="py-2.5">
                        <div className="truncate text-sm font-medium">{t.turf_name}</div>
                        <dl className="mt-1 grid grid-cols-3 gap-2 text-xs">
                          <div>
                            <dt className="text-muted">Pytch</dt>
                            <dd className="font-mono tabular-nums">{formatINR(t.pytch_gross_paise)}</dd>
                          </div>
                          <div>
                            <dt className="text-muted">Offline</dt>
                            <dd className="font-mono tabular-nums">{formatINR(t.offline_paise)}</dd>
                          </div>
                          <div>
                            <dt className="text-muted">Bookings</dt>
                            <dd className="font-mono tabular-nums">{t.bookings}</dd>
                          </div>
                        </dl>
                      </li>
                    ))}
                  </ul>
                  <div className="-mx-1 hidden overflow-x-auto @md:block">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-[11px] tracking-wider text-muted uppercase">
                          <th className="px-1 pb-2 font-semibold">Venue</th>
                          <th className="px-1 pb-2 text-right font-semibold">Pytch</th>
                          <th className="px-1 pb-2 text-right font-semibold">Offline</th>
                          <th className="px-1 pb-2 text-right font-semibold">Bookings</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/6">
                        {e.by_turf.map((t) => (
                          <tr key={t.turf_id}>
                            <td className="max-w-40 truncate px-1 py-2.5 font-medium">{t.turf_name}</td>
                            <td className="px-1 py-2.5 text-right font-mono tabular-nums">{formatINR(t.pytch_gross_paise)}</td>
                            <td className="px-1 py-2.5 text-right font-mono tabular-nums">{formatINR(t.offline_paise)}</td>
                            <td className="px-1 py-2.5 text-right font-mono tabular-nums">{t.bookings}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </Panel>
          </div>
        </div>
      )}

      <Panel title="Settlements" subtitle="Weekly statements of Pytch bookings, paid to your bank account." className="mt-5" bodyClassName="pt-2 sm:pt-2">
        {scoped ? (
          <p className="rounded-2xl bg-white/[0.03] p-4 text-sm text-muted ring-1 ring-white/8">
            Statements cover all of the business’s venues, so only the owner (or unscoped managers) can open them. Ask the owner if you need a copy.
          </p>
        ) : settlements.isError ? (
          <ErrorState error={settlements.error} onRetry={() => settlements.refetch()} />
        ) : !settlements.data ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-16" />
            ))}
          </div>
        ) : settlements.data.length === 0 ? (
          <EmptyState icon={<ReceiptText className="mx-auto h-10 w-10 text-muted" />} title="No statements yet" description="Your first statement is generated after your first week of Pytch bookings." className="border-0" />
        ) : (
          <ul className="-mx-2 divide-y divide-white/6">
            {settlements.data.map((s) => (
              <li key={s.id}>
                <Link to={`/partner/earnings/settlements/${s.id}`} className="flex items-center gap-3 rounded-xl px-2 py-3 transition hover:bg-white/5">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/5 ring-1 ring-white/10">
                    <ReceiptText className="h-5 w-5 text-muted" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">
                      {formatDateLong(s.period_start)} – {formatDateLong(s.period_end)}
                    </div>
                    <div className="text-xs text-muted">
                      {s.booking_count} booking{s.booking_count === 1 ? '' : 's'} · gross {formatINR(s.gross_paise)}
                      {s.paid_at ? ` · paid ${formatDateLong(s.paid_at)}` : ''}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="font-mono font-semibold">{formatINR(s.net_payable_paise)}</div>
                    <StatusPill status={s.status} className="mt-1" />
                  </div>
                  <ArrowRight className="hidden h-4 w-4 shrink-0 text-muted sm:block" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  )
}
