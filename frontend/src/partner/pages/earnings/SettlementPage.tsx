import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, Info, Landmark, Printer } from 'lucide-react'
import { Link, useParams } from 'react-router'
import { Button } from '@/components/ui/Button'
import { ErrorState, Skeleton } from '@/components/ui/States'
import { cn } from '@/lib/cn'
import { formatDateLong, formatINR, formatWhen } from '@/lib/format'
import type { SettlementDetail } from '@/types/partner'
import { partnerApi } from '../../api/endpoints'
import { pk } from '../../api/keys'
import { CopyField, PageTitle, Panel, StatusPill } from '../../components/kit'

export default function SettlementPage() {
  const { settlementId } = useParams()
  const q = useQuery({ queryKey: pk.settlement(settlementId!), queryFn: () => partnerApi.settlements.get(settlementId!), enabled: !!settlementId })
  const s = q.data
  return (
    <div>
      <Link to="/partner/earnings" className="-ml-2 mb-3 inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm text-muted hover:bg-white/5 hover:text-fg print:hidden">
        <ArrowLeft className="h-4 w-4" /> Earnings
      </Link>
      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !s ? (
        <Skeleton className="h-96 rounded-3xl" />
      ) : (
        <>
          <PageTitle
            eyebrow="Settlement statement"
            title={`${formatDateLong(s.period_start)} – ${formatDateLong(s.period_end)}`}
            subtitle={`${s.booking_count} Pytch booking${s.booking_count === 1 ? '' : 's'} played in this period`}
            actions={
              <>
                <StatusPill status={s.status} />
                <Button variant="secondary" size="sm" className="print:hidden" onClick={() => window.print()}>
                  <Printer className="h-4 w-4" /> Print
                </Button>
              </>
            }
          />
          <div className="grid gap-5 lg:grid-cols-[1fr_1.2fr] [&>*]:min-w-0">
            <Breakdown s={s} />
            <Panel title="Bookings in this statement" bodyClassName="pt-2 sm:pt-2">
              {s.lines.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted">No bookings — only adjustments.</p>
              ) : (
                <div className="-mx-1 overflow-x-auto">
                  <table className="w-full min-w-[32rem] text-sm">
                    <thead>
                      <tr className="text-left text-[11px] tracking-wider text-muted uppercase">
                        <th className="px-1 pb-2 font-semibold">Played</th>
                        <th className="px-1 pb-2 font-semibold">Booking</th>
                        <th className="px-1 pb-2 text-right font-semibold">Gross</th>
                        <th className="px-1 pb-2 text-right font-semibold">Refunds</th>
                        <th className="px-1 pb-2 text-right font-semibold">Discounts</th>
                        <th className="px-1 pb-2 text-right font-semibold">Commission</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/6">
                      {s.lines.map((l) => (
                        <tr key={l.booking_id}>
                          <td className="px-1 py-2.5 whitespace-nowrap">{formatWhen(l.played_at)}</td>
                          <td className="px-1 py-2.5">
                            <div className="font-mono text-xs">{l.booking_code}</div>
                            <div className="max-w-40 truncate text-xs text-muted">{l.turf_name}</div>
                          </td>
                          <td className="px-1 py-2.5 text-right font-mono whitespace-nowrap tabular-nums">{formatINR(l.gross_paise)}</td>
                          <td className="px-1 py-2.5 text-right font-mono text-muted whitespace-nowrap tabular-nums">{l.refunds_paise ? `−${formatINR(l.refunds_paise)}` : '—'}</td>
                          <td className="px-1 py-2.5 text-right font-mono text-muted whitespace-nowrap tabular-nums">{l.provider_discounts_paise ? `−${formatINR(l.provider_discounts_paise)}` : '—'}</td>
                          <td className="px-1 py-2.5 text-right font-mono text-muted whitespace-nowrap tabular-nums">−{formatINR(l.commission_paise)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
          </div>
        </>
      )}
    </div>
  )
}

function Breakdown({ s }: { s: SettlementDetail }) {
  const pct = (bps: number) => `${(bps / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}%`
  const adjustments = s.net_payable_paise - (s.gross_paise - s.refunds_paise - s.provider_discounts_paise - s.commission_paise - s.gst_on_commission_paise - s.tcs_paise - s.tds_paise)
  const rows: { label: string; value: number; explain: string; sign: 1 | -1; strong?: boolean }[] = [
    { label: 'Gross pitch fees', value: s.gross_paise, sign: 1, explain: 'What players paid on Pytch for your pitches in this period.', strong: true },
    { label: 'Refunds you bear', value: s.refunds_paise, sign: -1, explain: 'Money returned to players for cancellations on your side. Weather rain-checks are paid by Pytch, not you.' },
    { label: 'Your promo discounts', value: s.provider_discounts_paise, sign: -1, explain: 'Coupons you chose to fund. Pytch-funded promos never reduce your payout.' },
    { label: `Pytch commission (${pct(s.commission_bps)})`, value: s.commission_paise, sign: -1, explain: 'Our fee for Pytch bookings only — never charged on your walk-ins, phone or other-app bookings.' },
    { label: 'GST on commission (18%)', value: s.gst_on_commission_paise, sign: -1, explain: 'Tax on our commission. If you’re GST-registered you can usually claim it back as input credit.' },
    { label: 'TCS (0.5%)', value: s.tcs_paise, sign: -1, explain: 'Tax collected at source under GST — deposited against your GSTIN; it shows in your GSTR-2X and can be claimed.' },
    { label: 'TDS (0.1%)', value: s.tds_paise, sign: -1, explain: 'Income-tax deducted under s.194-O and deposited against your PAN — adjust it when you file your return (5% if no PAN on file).' },
  ]
  if (adjustments) rows.push({ label: 'Adjustments', value: Math.abs(adjustments), sign: adjustments > 0 ? 1 : -1, explain: 'Manual corrections by Pytch finance (each one is audited).' })

  return (
    <Panel title="How your payout adds up">
      <ol className="space-y-1">
        {rows.map((r) => (
          <li key={r.label} className="rounded-xl px-1 py-2">
            <div className="flex items-baseline justify-between gap-3">
              <span className={cn('text-sm', r.strong ? 'font-semibold' : 'text-fg/85')}>{r.label}</span>
              <span className={cn('shrink-0 font-mono text-sm tabular-nums', r.sign < 0 && r.value > 0 && 'text-muted')}>
                {r.sign < 0 && r.value > 0 ? '−' : ''}
                {formatINR(r.value)}
              </span>
            </div>
            <p className="mt-0.5 text-xs text-muted">{r.explain}</p>
          </li>
        ))}
      </ol>
      <div className="mt-3 flex items-baseline justify-between rounded-2xl bg-volt/10 p-4 ring-1 ring-volt/30">
        <span className="font-semibold">Net paid to you</span>
        <span className="font-mono text-2xl font-bold">{formatINR(s.net_payable_paise)}</span>
      </div>
      {s.status === 'paid' && s.payout_ref && (
        <div className="mt-4">
          <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-muted">
            <Landmark className="h-3.5 w-3.5" /> Bank reference (UTR) · paid {s.paid_at ? formatDateLong(s.paid_at) : ''}
          </div>
          <CopyField value={s.payout_ref} />
        </div>
      )}
      {s.status !== 'paid' && (
        <p className="mt-4 flex items-start gap-2 text-xs text-muted">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {s.status === 'draft' && 'Pytch finance is checking this statement. You’ll be paid once it’s approved — usually within 2 working days.'}
          {s.status === 'approved' && 'Approved and queued for bank transfer.'}
          {s.status === 'failed' && 'The bank transfer failed — usually a bank-detail mismatch. Check Settings → payout account, or contact partner support.'}
        </p>
      )}
      <p className="mt-3 text-[11px] text-muted">Tax rates shown are indicative; your CA can confirm how TCS/TDS credits apply to your business.</p>
    </Panel>
  )
}
