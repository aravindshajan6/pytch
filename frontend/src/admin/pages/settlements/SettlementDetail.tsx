import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Banknote, CheckCircle2, FileDown, XCircle } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import { Segmented } from '@/components/ui/Segmented'
import { ErrorState, PageLoader } from '@/components/ui/States'
import type { AdminSettlementDetail } from '@/types/admin'
import { Can } from '../../components/bits'
import { SettlementBreakdown } from '../../components/charts/SettlementBreakdown'
import { DataTable } from '../../components/DataTable'
import { DetailHeader } from '../../components/DetailHeader'
import { Callout, ConfirmDialog } from '../../components/Dialogs'
import { Attribution, Field, Money, Mono, Panel, StatusChip, TextInput } from '../../components/ui'
import { errorMessage } from '@/lib/api/http'
import { adminApi } from '../../lib/api'
import { isSilentError } from '../../lib/errors'
import { bpsToPct, dateShort, dateTime, inr, titleCase } from '../../lib/format'
import { useCan, useSession } from '../../lib/session'

/** Bank references for manual payouts: NEFT UTR 16, RTGS UTR 22, IMPS RRN 12 — mirrors settlements/service.py `_UTR`. */
const UTR_RE = /^[A-Za-z0-9]{12,22}$/

export default function SettlementDetail() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const can = useCan()
  const me = useSession((s) => s.me)
  const [dialog, setDialog] = useState<'approve' | 'pay' | 'fail' | null>(null)
  const q = useQuery({ queryKey: ['admin', 'settlements', 'detail', id], queryFn: () => adminApi.settlements.get(id), enabled: !!id })

  if (q.isLoading) return <PageLoader />
  if (q.isError || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />
  const s = q.data
  const generatedByMe = !!me && !!s.generated_by && s.generated_by.toLowerCase().includes(me.email.toLowerCase())
  // maker–checker also between approval and payout: the approver can't pay (the server refuses it)
  const approvedByMe = !!me && !!s.approved_by && s.approved_by.toLowerCase() === me.email.toLowerCase()
  // a manual transfer that bounced after being recorded as paid can still be marked failed (Route transfers can't)
  const canFail = s.status === 'approved' || (s.status === 'paid' && s.payout_method === 'manual_neft')

  return (
    <div className="space-y-5">
      <DetailHeader
        back="/settlements"
        backLabel="Settlements"
        title={s.provider_name}
        meta={
          <>
            <StatusChip status={s.status} />
            <span>
              {dateShort(s.period_start)} – {dateShort(s.period_end)} · {s.booking_count} bookings · commission {bpsToPct(s.commission_bps)}
            </span>
          </>
        }
        actions={
          <>
            <Can perm="data.export">
              <Button
                variant="secondary"
                size="sm"
                onClick={() =>
                  adminApi.settlements
                    .exportCsv(s.id, `settlement-${s.provider_name.replace(/\W+/g, '-')}-${s.period_start}.csv`)
                    .catch((e) => !isSilentError(e) && toast.error(errorMessage(e)))
                }
              >
                <FileDown className="h-4 w-4" /> CSV
              </Button>
            </Can>
            <Can perm="payouts.manage">
              {s.status === 'draft' && (
                <Button size="sm" disabled={generatedByMe} title={generatedByMe ? 'The approver must be different from the admin who generated it' : undefined} onClick={() => setDialog('approve')}>
                  <CheckCircle2 className="h-4 w-4" /> Approve
                </Button>
              )}
              {canFail && (
                <Button variant="outline" size="sm" onClick={() => setDialog('fail')}>
                  <XCircle className="h-4 w-4" /> {s.status === 'paid' ? 'Mark bounced' : 'Mark failed'}
                </Button>
              )}
              {s.status === 'approved' && (
                <Button size="sm" disabled={approvedByMe} title={approvedByMe ? 'The admin who approved a statement can’t also pay it' : undefined} onClick={() => setDialog('pay')}>
                  <Banknote className="h-4 w-4" /> Pay {inr(s.net_payable_paise)}
                </Button>
              )}
            </Can>
          </>
        }
      />

      {generatedByMe && s.status === 'draft' && (
        <Callout tone="electric" title="You generated this statement">
          Another admin with payout rights must approve it (four-eyes rule).
        </Callout>
      )}
      {approvedByMe && s.status === 'approved' && can('payouts.manage') && (
        <Callout tone="electric" title="You approved this statement">
          Another admin with payout rights must send the payout (four-eyes rule).
        </Callout>
      )}

      <div className="grid gap-5 xl:grid-cols-5">
        <Panel title="Statement" description="How gross becomes net payable" className="xl:col-span-3">
          <SettlementBreakdown s={s} />
        </Panel>
        <Panel title="Payout" className="xl:col-span-2">
          <div className="text-xs text-muted">Net payable</div>
          <div className="mt-1 text-4xl font-semibold tracking-tight">{inr(s.net_payable_paise)}</div>
          <dl className="mt-5 space-y-2.5 text-sm">
            {(
              [
                ['Status', <StatusChip key="s" status={s.status} />],
                ['Method', s.payout_method ? titleCase(s.payout_method) : '—'],
                ['Reference / UTR', s.payout_ref ? <Mono key="r">{s.payout_ref}</Mono> : '—'],
                ['Paid at', dateTime(s.paid_at)],
              ] as [string, React.ReactNode][]
            ).map(([k, v]) => (
              <div key={k} className="flex items-center justify-between gap-3">
                <dt className="text-muted">{k}</dt>
                <dd className="text-right">{v}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-5 border-t border-white/6 pt-3">
            <Attribution
              items={[
                ['Generated by', s.generated_by],
                ['Approved by', s.approved_by],
              ]}
            />
          </div>
          {can('providers.view') && (
            <Link to={`/providers/${s.provider_id}`} className="mt-3 inline-block text-xs font-medium text-volt hover:underline">
              View provider →
            </Link>
          )}
        </Panel>
      </div>

      <Panel flush title="Statement lines" description="One line per settled booking">
        <DataTable
          rows={s.lines}
          rowKey={(l) => l.booking_id}
          maxHeight="max-h-[520px]"
          empty="No lines."
          onRowClick={can('bookings.view') ? (l) => navigate(`/bookings/${l.booking_id}`) : undefined}
          columns={[
            { key: 'code', header: 'Booking', cell: (l) => <Mono className="font-semibold">{l.booking_code}</Mono> },
            { key: 'turf', header: 'Venue', cell: (l) => <span className="text-sm">{l.turf_name}</span>, hideBelow: 'sm' },
            { key: 'played', header: 'Played', cell: (l) => <span className="text-xs text-muted">{dateTime(l.played_at)}</span>, sortValue: (l) => l.played_at, hideBelow: 'md' },
            { key: 'gross', header: 'Gross', align: 'right', cell: (l) => <Money paise={l.gross_paise} />, sortValue: (l) => l.gross_paise },
            { key: 'ref', header: 'Refunds', align: 'right', cell: (l) => (l.refunds_paise ? <Money paise={-l.refunds_paise} className="text-flare" /> : <span className="text-subtle">—</span>), hideBelow: 'sm' },
            { key: 'disc', header: 'Venue disc.', align: 'right', cell: (l) => (l.provider_discounts_paise ? <Money paise={-l.provider_discounts_paise} /> : <span className="text-subtle">—</span>), hideBelow: 'lg' },
            { key: 'comm', header: 'Commission', align: 'right', cell: (l) => <Money paise={-l.commission_paise} className="text-muted" /> },
          ]}
        />
      </Panel>

      <ActionDialogs s={s} dialog={dialog} onClose={() => setDialog(null)} />
    </div>
  )
}

function ActionDialogs({ s, dialog, onClose }: { s: AdminSettlementDetail; dialog: 'approve' | 'pay' | 'fail' | null; onClose: () => void }) {
  const qc = useQueryClient()
  const [method, setMethod] = useState<'razorpay_route' | 'manual_neft'>('manual_neft')
  const [utr, setUtr] = useState('')
  const utrValid = method === 'razorpay_route' || UTR_RE.test(utr.trim())
  const done = (msg: string) => {
    toast.success(msg)
    qc.invalidateQueries({ queryKey: ['admin', 'settlements'] })
    onClose()
  }
  const approve = useMutation({ mutationFn: () => adminApi.settlements.approve(s.id), onSuccess: () => done('Statement approved — ready to pay') })
  const pay = useMutation({
    mutationFn: () => adminApi.settlements.pay(s.id, { method, reference: method === 'manual_neft' ? utr.trim() : null }),
    onSuccess: () => done(method === 'razorpay_route' ? 'Route transfer initiated' : 'Marked as paid'),
  })
  const fail = useMutation({ mutationFn: (reason: string) => adminApi.settlements.fail(s.id, reason), onSuccess: () => done('Marked as failed') })

  return (
    <>
      <ConfirmDialog
        open={dialog === 'approve'}
        onClose={onClose}
        title="Approve this statement?"
        description={`Locks the figures for ${s.provider_name}: net payable ${inr(s.net_payable_paise)}. You can’t be the admin who generated it.`}
        tone="primary"
        confirmLabel="Approve statement"
        loading={approve.isPending}
        onConfirm={() => approve.mutate()}
      />
      <ConfirmDialog
        open={dialog === 'pay'}
        onClose={onClose}
        title={`Pay ${inr(s.net_payable_paise)} to ${s.provider_name}?`}
        description="Money leaves the platform account. This needs your authenticator code."
        confirmLabel={`Pay ${inr(s.net_payable_paise)}`}
        confirmDisabled={!utrValid}
        loading={pay.isPending}
        onConfirm={() => pay.mutate()}
      >
        <div>
          <div className="mb-1.5 text-xs font-medium text-muted">Payout method</div>
          <Segmented<'razorpay_route' | 'manual_neft'>
            value={method}
            onChange={setMethod}
            size="sm"
            options={[
              { value: 'razorpay_route', label: 'Razorpay Route' },
              { value: 'manual_neft', label: 'Manual NEFT' },
            ]}
          />
        </div>
        {method === 'manual_neft' ? (
          <Field
            label="UTR / bank reference"
            required
            error={utr && !utrValid ? '12–22 letters or digits' : undefined}
            hint="From the bank’s confirmation — NEFT UTR (16), RTGS UTR (22) or IMPS reference (12)."
          >
            <TextInput value={utr} onChange={(e) => setUtr(e.target.value.toUpperCase())} className="font-mono tracking-wider" autoFocus spellCheck={false} />
          </Field>
        ) : (
          <p className="text-xs text-muted">Transfers to the provider’s linked Route account; settles T+2 by default.</p>
        )}
      </ConfirmDialog>
      <ConfirmDialog
        open={dialog === 'fail'}
        onClose={onClose}
        title={s.status === 'paid' ? 'Mark this payout as bounced?' : 'Mark payout as failed?'}
        description={
          s.status === 'paid'
            ? `Use when the bank returned the manual transfer (UTR ${s.payout_ref ?? '—'}). The statement goes back to failed; a different admin must re-approve it before it’s paid again.`
            : 'Use when a transfer bounced or was reversed. The statement can be re-approved and paid again.'
        }
        confirmLabel="Mark failed"
        reason
        loading={fail.isPending}
        onConfirm={(r) => fail.mutate(r)}
      />
    </>
  )
}
