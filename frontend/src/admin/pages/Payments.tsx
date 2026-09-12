import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CircleCheck, CircleX, Undo2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import { Segmented } from '@/components/ui/Segmented'
import { ErrorState, PageHeader, Skeleton } from '@/components/ui/States'
import { istDate } from '@/lib/format'
import type { AdminPaymentStatusFilter, SettingOut } from '@/types/admin'
import { Can, JsonTable, MaskedPhone } from '../components/bits'
import { paymentColumns } from '../components/columns'
import { DataTable, Pagination } from '../components/DataTable'
import { Callout } from '../components/Dialogs'
import { Drawer, Field, KV, Money, Mono, Panel, SearchInput, Select, StatusChip, Tabs, TextArea, TextInput, Toolbar } from '../components/ui'
import { adminApi } from '../lib/api'
import { isApprovalQueued } from '../lib/http'
import { isSilentError } from '../lib/errors'
import { errorMessage, isApiError } from '@/lib/api/http'
import { dateTime, inr, rupeesToPaise, shortId, titleCase } from '../lib/format'
import { useDebounced, useUrlState } from '../lib/hooks'
import { useCan } from '../lib/session'
import type { AdminPaymentDetail } from '../lib/types'

type Tab = 'payments' | 'webhooks' | 'reconciliation'
const LIMIT = 25
/** Mirrors the `status` filter of GET /admin/payments (partially refunded = still `paid`, part refunded). */
const PAYMENT_STATUSES: AdminPaymentStatusFilter[] = ['created', 'paid', 'partially_refunded', 'refunded', 'failed', 'cancelled']

export default function Payments() {
  const [f, set] = useUrlState({ tab: 'payments', q: '', status: '', provider: '', from: '', to: '', offset: '0', open: '', date: '' })
  const tab = (['payments', 'webhooks', 'reconciliation'].includes(f.tab) ? f.tab : 'payments') as Tab
  return (
    <div>
      <PageHeader eyebrow="Money" title="Payments" subtitle="Captured shares, refunds, gateway webhooks and daily reconciliation." />
      <Tabs<Tab>
        className="mb-4"
        value={tab}
        onChange={(v) => set({ tab: v, open: '' })}
        tabs={[
          { value: 'payments', label: 'Payments' },
          { value: 'webhooks', label: 'Webhook events' },
          { value: 'reconciliation', label: 'Reconciliation' },
        ]}
      />
      {tab === 'payments' && <PaymentsTab f={f} set={set} />}
      {tab === 'webhooks' && <WebhooksTab />}
      {tab === 'reconciliation' && <ReconciliationTab date={f.date || istDate(-1)} onDate={(d) => set({ date: d })} onOpen={(id) => set({ tab: 'payments', q: id, open: id })} />}
    </div>
  )
}

type Filters = Record<'q' | 'status' | 'provider' | 'from' | 'to' | 'offset' | 'open', string>

function PaymentsTab({ f, set }: { f: Filters; set: (p: Partial<Record<string, string>>, reset?: boolean) => void }) {
  const q = useDebounced(f.q.trim(), 300)
  const offset = Number(f.offset) || 0
  const query = useQuery({
    queryKey: ['admin', 'payments', 'list', { q, status: f.status, provider: f.provider, from: f.from, to: f.to, offset }],
    queryFn: () =>
      adminApi.payments.list({
        q: q || undefined,
        status: f.status || undefined,
        provider: f.provider || undefined,
        from: f.from || undefined,
        to: f.to || undefined,
        limit: LIMIT,
        offset,
      }),
    placeholderData: keepPreviousData,
  })
  return (
    <>
      <Toolbar className="items-end">
        <Field label="Search" className="w-full sm:w-72">
          <SearchInput value={f.q} onChange={(v) => set({ q: v })} placeholder="Player, booking code, payment id" />
        </Field>
        <Field label="Status">
          <Select value={f.status} onChange={(e) => set({ status: e.target.value })} className="w-36">
            <option value="">Any</option>
            {PAYMENT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.replace(/_/g, ' ')}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Via">
          <Select value={f.provider} onChange={(e) => set({ provider: e.target.value })} className="w-32">
            <option value="">Any</option>
            <option value="razorpay">Razorpay</option>
            <option value="wallet">Wallet</option>
            <option value="mock">Mock</option>
          </Select>
        </Field>
        <Field label="From">
          <TextInput type="date" value={f.from} onChange={(e) => set({ from: e.target.value })} className="w-40" />
        </Field>
        <Field label="To">
          <TextInput type="date" value={f.to} min={f.from || undefined} onChange={(e) => set({ to: e.target.value })} className="w-40" />
        </Field>
      </Toolbar>
      <Panel flush>
        {query.isError ? (
          <div className="p-5">
            <ErrorState error={query.error} onRetry={() => query.refetch()} />
          </div>
        ) : (
          <>
            <DataTable
              rows={query.data?.items}
              columns={paymentColumns()}
              rowKey={(p) => p.id}
              loading={query.isLoading}
              dim={query.isPlaceholderData}
              onRowClick={(p) => set({ open: p.id }, false)}
              empty="No payments match these filters."
              caption="Payments"
            />
            <Pagination total={query.data?.total ?? 0} limit={LIMIT} offset={offset} onChange={(o) => set({ offset: String(o) }, false)} />
          </>
        )}
      </Panel>
      <PaymentDrawer id={f.open || null} onClose={() => set({ open: '' }, false)} />
    </>
  )
}

function useRefundThreshold() {
  const can = useCan()
  const settings = useQuery({ queryKey: ['admin', 'settings'], queryFn: adminApi.settings.list, enabled: can('settings.view'), staleTime: 5 * 60_000 })
  const s = settings.data?.find((x: SettingOut) => /refund/.test(x.key) && /(approval|threshold)/.test(x.key))
  return typeof s?.value === 'number' ? s.value : null
}

function PaymentDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const q = useQuery({ queryKey: ['admin', 'payments', 'detail', id], queryFn: () => adminApi.payments.get(id!), enabled: !!id })
  const p = q.data
  return (
    <Drawer
      open={!!id}
      onClose={onClose}
      title={p ? `${inr(p.payable_paise)} · ${p.user_name}` : 'Payment'}
      subtitle={
        <span className="font-mono">
          {id}
          {p?.provider_payment_id && <> · {p.provider_payment_id}</>}
        </span>
      }
    >
      {q.isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-24" />
          <Skeleton className="h-40" />
        </div>
      ) : q.isError || !p ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <div className="space-y-6">
          <div className="flex items-center gap-2">
            <StatusChip status={p.status} />
            <span className="text-xs text-muted capitalize">
              {p.provider} · {p.purpose.replace(/_/g, ' ')}
            </span>
          </div>
          <KV
            items={[
              ['Player', p.user_name],
              ['Phone', <MaskedPhone key="ph" phone={p.user_phone} full />],
              ['Game', p.lobby_title ?? '—'],
              ['Booking', p.booking_code ? <Mono key="b">{p.booking_code}</Mono> : '—'],
              ['Share amount', <Money key="a" paise={p.amount_paise} />],
              ['Coupon', p.coupon_code ? <span key="c" className="text-volt">{p.coupon_code} (−{inr(p.discount_paise)})</span> : '—'],
              ['Credits applied', <Money key="cr" paise={p.credits_applied_paise} />],
              ['Charged', <Money key="pay" paise={p.payable_paise} className="font-semibold" />],
              ['Created', dateTime(p.created_at)],
              ['Paid', dateTime(p.paid_at)],
              ...(p.refunded_paise ? ([['Refunded', <Money key="rf" paise={p.refunded_paise} className="text-grape-soft" />]] as [string, React.ReactNode][]) : []),
              ...(p.failure_reason ? ([['Failure', p.failure_reason]] as [string, React.ReactNode][]) : []),
            ]}
          />
          {p.refunds.length > 0 && (
            <div>
              <div className="mb-2 text-xs font-semibold text-muted">Refund history</div>
              <ul className="space-y-2">
                {p.refunds.map((r, i) => (
                  <li key={`${r.ref}-${i}`} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white/4 px-3 py-2 text-xs ring-1 ring-white/8">
                    <span className="min-w-0">
                      <Money paise={r.amount_paise} className="font-semibold" /> → {r.destination === 'credits' ? 'Pytch Credits' : 'original method'}
                      {r.kind === 'cancellation' && <span className="text-sun"> · booking cancelled</span>}
                      {r.approval_id && <span className="text-electric"> · approved request</span>}
                      {r.reason && <span className="text-muted"> · {r.reason}</span>}
                    </span>
                    <span className="text-muted">
                      {r.by ?? ''} {r.at ? dateTime(r.at) : ''}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <Can perm="payments.refund">
            {/* re-keyed when the server's cap changes (after a refund or a 400 with details.refundable_paise) */}
            <RefundForm key={`${p.id}:${p.status}:${p.refundable_paise}`} payment={p} />
          </Can>
        </div>
      )}
    </Drawer>
  )
}

function RefundForm({ payment }: { payment: AdminPaymentDetail }) {
  const qc = useQueryClient()
  const threshold = useRefundThreshold()
  // the server's cap: what the seat still holds (earlier refunds, dropout credits, host reimbursements are out)
  const [serverCap, setServerCap] = useState<number | null>(null)
  const refundable = Math.min(payment.refundable_paise, serverCap ?? Infinity)
  const sourceMax = Math.min(payment.refundable_to_source_paise, refundable)
  const initialDest: 'source' | 'credits' = payment.provider === 'wallet' || sourceMax <= 0 ? 'credits' : 'source'
  const [dest, setDest] = useState<'source' | 'credits'>(initialDest)
  const [amount, setAmount] = useState(String((initialDest === 'source' ? sourceMax : refundable) / 100))
  const [reason, setReason] = useState('')
  const [confirming, setConfirming] = useState(false)
  const paise = rupeesToPaise(amount)
  const max = dest === 'source' ? sourceMax : refundable
  const valid = Number.isFinite(paise) && paise >= 100 && paise <= max && reason.trim().length >= 5
  // the maker–checker threshold is cumulative over every admin refund on this seat
  const cumulative = payment.seat_refunded_paise + (Number.isFinite(paise) ? paise : 0)
  const needsApproval = threshold != null && cumulative > threshold
  const m = useMutation({
    mutationFn: () => adminApi.payments.refund(payment.id, { amount_paise: paise, destination: dest, reason: reason.trim() }),
    meta: { silent: true },
    onSuccess: (res) => {
      if (!isApprovalQueued(res)) toast.success(`Refunded ${inr(paise)} to ${dest === 'credits' ? 'Pytch Credits' : 'the original method'}`)
      setConfirming(false)
      setReason('')
      setServerCap(null)
      qc.invalidateQueries({ queryKey: ['admin', 'payments'] })
    },
    onError: (e) => {
      setConfirming(false)
      const d = isApiError(e) ? (e.details as { refundable_paise?: number; refundable_to_source_paise?: number } | undefined) : undefined
      const cap = d?.refundable_paise ?? d?.refundable_to_source_paise
      if (typeof cap === 'number') {
        setServerCap(d?.refundable_paise ?? refundable)
        setAmount(String(cap / 100))
        qc.invalidateQueries({ queryKey: ['admin', 'payments', 'detail', payment.id] })
      }
      if (!isSilentError(e)) toast.error(errorMessage(e))
    },
  })
  if (payment.status !== 'paid' || refundable <= 0)
    return (
      <p className="rounded-xl bg-white/4 p-3 text-xs text-muted ring-1 ring-white/8">
        {payment.status === 'paid'
          ? 'Nothing left to refund on this seat — the rest already went back (earlier refunds, dropout credit or host reimbursements).'
          : `This payment can’t be refunded (${payment.status.replace(/_/g, ' ')}).`}
      </p>
    )

  return (
    <form
      className="space-y-4 rounded-2xl bg-white/[0.03] p-4 ring-1 ring-white/8"
      onSubmit={(e) => {
        e.preventDefault()
        if (!valid) return
        if (!confirming) setConfirming(true)
        else m.mutate()
      }}
    >
      <div className="flex items-center gap-2 text-sm font-semibold">
        <Undo2 className="h-4 w-4 text-grape-soft" /> Issue a refund
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label={`Amount (₹) · max ${inr(max)}`}
          hint={dest === 'source' && sourceMax < refundable ? `Up to ${inr(sourceMax)} can go back to the original method; the rest only as credits.` : undefined}
          error={Number.isFinite(paise) && paise > max ? 'More than can still be refunded' : undefined}
        >
          <TextInput
            inputMode="decimal"
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value.replace(/[^\d.]/g, ''))
              setConfirming(false)
            }}
            className="num"
          />
        </Field>
        <Field label="Destination">
          <Segmented<'source' | 'credits'>
            value={dest}
            onChange={(v) => {
              setDest(v)
              setConfirming(false)
            }}
            size="sm"
            options={[
              ...(payment.provider !== 'wallet' && sourceMax > 0 ? [{ value: 'source' as const, label: 'Source' }] : []),
              { value: 'credits', label: 'Credits' },
            ]}
          />
        </Field>
      </div>
      <Field label="Reason (audited, shown on the player’s receipt)" required>
        <TextArea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder="e.g. Venue closed for maintenance" />
      </Field>
      {needsApproval && (
        <Callout tone="electric" title="Needs a second admin">
          Refunds on a seat above {inr(threshold!)} in total are queued for maker–checker approval before any money moves
          {payment.seat_refunded_paise > 0 && <> — {inr(payment.seat_refunded_paise)} was already refunded on this seat</>}.
        </Callout>
      )}
      <div className="flex items-center justify-end gap-2">
        {confirming && (
          <Button type="button" variant="ghost" size="sm" onClick={() => setConfirming(false)}>
            Back
          </Button>
        )}
        <Button type="submit" variant={confirming ? 'danger' : 'secondary'} size="sm" disabled={!valid} loading={m.isPending}>
          {confirming ? `Confirm refund of ${inr(paise)}` : 'Review refund'}
        </Button>
      </div>
    </form>
  )
}

function WebhooksTab() {
  const [provider, setProvider] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const q = useQuery({ queryKey: ['admin', 'payments', 'webhooks', provider], queryFn: () => adminApi.payments.webhookEvents({ provider: provider || undefined, limit: 100 }) })
  return (
    <Panel flush title="Gateway webhook events" description="Deduplicated by event id; newest first. Click a row for the payload." actions={
      <Select value={provider} onChange={(e) => setProvider(e.target.value)} className="w-36">
        <option value="">All providers</option>
        <option value="razorpay">Razorpay</option>
        <option value="mock">Mock</option>
      </Select>
    }>
      {q.isError ? (
        <div className="p-5">
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        </div>
      ) : (
        <DataTable
          rows={q.data?.items}
          loading={q.isLoading}
          rowKey={(w) => String(w.id)}
          expanded={open}
          onRowClick={(w) => setOpen((o) => (o === String(w.id) ? null : String(w.id)))}
          renderExpanded={(w) => <JsonTable value={w.payload ?? {}} />}
          empty="No webhook events received yet."
          columns={[
            { key: 'when', header: 'Received', cell: (w) => <span className="text-xs whitespace-nowrap text-muted">{dateTime(w.created_at)}</span> },
            { key: 'prov', header: 'Provider', cell: (w) => <span className="text-xs capitalize">{w.provider}</span> },
            { key: 'ev', header: 'Event', cell: (w) => <Mono className="text-xs">{w.event}</Mono> },
            { key: 'id', header: 'Event id', cell: (w) => <Mono className="text-xs text-muted">{shortId(w.id)}…</Mono>, hideBelow: 'sm' },
          ]}
        />
      )}
    </Panel>
  )
}

function ReconciliationTab({ date, onDate, onOpen }: { date: string; onDate: (d: string) => void; onOpen: (paymentId: string) => void }) {
  const q = useQuery({ queryKey: ['admin', 'payments', 'recon', date], queryFn: () => adminApi.payments.reconciliation(date), placeholderData: keepPreviousData })
  const r = q.data
  const tiles: [string, React.ReactNode, string?][] = r
    ? [
        ['Captured', inr(r.captured_paise), `${r.captured_count} payments`],
        ['Refunded', inr(r.refunded_paise)],
        ['Credits issued', inr(r.credits_issued_paise)],
        ['Credits spent', inr(r.credits_spent_paise)],
      ]
    : []
  return (
    <div className="space-y-4">
      <Toolbar className="items-end">
        <Field label="Day (IST)">
          <TextInput type="date" value={date} max={istDate(0)} onChange={(e) => e.target.value && onDate(e.target.value)} className="w-44" />
        </Field>
      </Toolbar>
      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !r ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      ) : (
        <div className={q.isPlaceholderData ? 'opacity-60 transition-opacity' : ''}>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {tiles.map(([label, value, hint]) => (
              <div key={label} className="glass rounded-2xl p-4 shadow-card">
                <div className="text-xs text-muted">{label}</div>
                <div className="mt-1 text-2xl font-semibold">{value}</div>
                {hint && <div className="mt-1 text-xs text-subtle">{hint}</div>}
              </div>
            ))}
          </div>
          <Panel className="mt-4" title="Mismatches" description="Captured money that doesn’t line up with seats, refunds or ledger entries">
            {r.mismatches.length === 0 ? (
              <div className="flex items-center gap-2 text-sm text-mint">
                <CircleCheck className="h-4 w-4" /> Everything reconciles for {date}.
              </div>
            ) : (
              <ul className="divide-y divide-white/6">
                {r.mismatches.map((m) => (
                  <li key={m.payment_id + m.issue} className="flex items-center justify-between gap-3 py-2.5">
                    <span className="flex items-center gap-2 text-sm">
                      <CircleX className="h-4 w-4 shrink-0 text-flare" /> {titleCase(m.issue)}
                    </span>
                    <button type="button" onClick={() => onOpen(m.payment_id)} className="cursor-pointer font-mono text-xs text-volt hover:underline">
                      {shortId(m.payment_id)}…
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      )}
    </div>
  )
}
