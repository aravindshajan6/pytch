import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Ban, CalendarClock } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { Segmented } from '@/components/ui/Segmented'
import { ErrorState, PageLoader } from '@/components/ui/States'
import { formatSlotRange } from '@/lib/format'
import { Can, MaskedPhone } from '../../components/bits'
import { paymentColumns } from '../../components/columns'
import { DataTable } from '../../components/DataTable'
import { DetailHeader } from '../../components/DetailHeader'
import { Callout, ConfirmDialog } from '../../components/Dialogs'
import { KV, Meter, Money, Mono, Panel, StatusChip } from '../../components/ui'
import { adminApi } from '../../lib/api'
import { isApprovalQueued } from '../../lib/http'
import { dateShort, dateTime, inr, titleCase } from '../../lib/format'
import { useCan } from '../../lib/session'
import type { AdminBookingDetail } from '../../lib/types'

export default function BookingDetail() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const can = useCan()
  const [cancelOpen, setCancelOpen] = useState(false)
  const q = useQuery({ queryKey: ['admin', 'bookings', 'detail', id], queryFn: () => adminApi.bookings.get(id), enabled: !!id })

  if (q.isLoading) return <PageLoader />
  if (q.isError || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />
  const { booking: b, lobby, members, payments, conflicts, blocks } = q.data
  const cancellable = ['confirmed', 'pending_payment'].includes(b.status) && new Date(lobby.end_at).getTime() > Date.now()
  const paidMembers = members.filter((m) => m.paid_paise > 0).length

  return (
    <div className="space-y-5">
      <DetailHeader
        back="/bookings"
        backLabel="Bookings"
        title={
          <span className="inline-flex items-center gap-3">
            <Mono className="text-volt">{b.code}</Mono>
            <span className="truncate">{lobby.title}</span>
          </span>
        }
        meta={
          <>
            <StatusChip status={b.status} />
            <Chip size="xs">{titleCase(lobby.mode)}</Chip>
            <Chip size="xs">{titleCase(lobby.visibility)}</Chip>
            <span>
              {lobby.turf_name} · {lobby.pitch_name} · {dateShort(lobby.start_at)} {formatSlotRange(lobby.start_at, lobby.end_at)}
            </span>
          </>
        }
        actions={
          <Can perm="bookings.manage">
            <Button variant="danger" size="sm" disabled={!cancellable} onClick={() => setCancelOpen(true)} title={cancellable ? undefined : 'Only upcoming, active bookings can be cancelled'}>
              <Ban className="h-4 w-4" /> Force-cancel
            </Button>
          </Can>
        }
      />

      {conflicts.some((c) => c.status === 'open') && (
        <Callout tone="sun" title="Open channel conflict" icon={<AlertTriangle className="h-4 w-4" />}>
          An external calendar block overlaps this booking. The venue has been asked to resolve it — first confirmed wins.
        </Callout>
      )}
      {q.data.transferred_from_id && (
        <Callout tone="electric" title="Rain transfer" icon={<CalendarClock className="h-4 w-4" />}>
          This booking was moved from an earlier weather-affected slot.{' '}
          <Link className="underline" to={`/bookings/${q.data.transferred_from_id}`}>
            View original
          </Link>
        </Callout>
      )}

      <div className="grid gap-5 xl:grid-cols-3">
        <Panel title="Booking" className="xl:col-span-2">
          <KV
            cols={3}
            items={[
              ['Sport · format', `${titleCase(lobby.sport)} · ${lobby.format}`],
              ['Kick-off', dateTime(lobby.start_at)],
              ['Ends', dateTime(lobby.end_at)],
              ['Host', b.host_name],
              ['Host phone', <MaskedPhone key="p" phone={b.host_phone} full />],
              ['Spots', <span key="s" className="num">{lobby.total_spots}</span>],
              ['Share per player', <Money key="sh" paise={lobby.share_paise} />],
              ['Pay deadline', dateTime(lobby.pay_deadline)],
              ['Created', dateTime(lobby.created_at)],
              ['Confirmed', dateTime(lobby.confirmed_at)],
              ['Completed', dateTime(lobby.completed_at)],
              ['Lobby status', <StatusChip key="ls" status={lobby.status} />],
            ]}
          />
          {lobby.notes && <p className="mt-4 rounded-xl bg-white/4 p-3 text-sm text-fg/80 ring-1 ring-white/8">{lobby.notes}</p>}
        </Panel>
        <Panel title="Money">
          <div className="space-y-3">
            <div className="flex items-baseline justify-between">
              <span className="text-sm text-muted">Collected</span>
              <span className="text-xl font-semibold">
                <Money paise={b.paid_paise} /> <span className="text-sm text-muted">/ {(b.total_paise / 100).toLocaleString('en-IN')}</span>
              </span>
            </div>
            <Meter value={b.total_paise ? b.paid_paise / b.total_paise : 0} label="Share of pitch fee collected" />
            <div className="text-xs text-muted">
              {paidMembers} of {members.length} members paid
            </div>
          </div>
        </Panel>
      </div>

      <Panel flush title="Lobby members" description={`${members.length} joined`}>
        <DataTable
          rows={members}
          rowKey={(m) => m.user_id}
          maxHeight="max-h-[420px]"
          empty="No members."
          onRowClick={can('users.view') ? (m) => navigate(`/players/${m.user_id}`) : undefined}
          columns={[
            {
              key: 'n',
              header: 'Player',
              cell: (m) => (
                <div>
                  <div className="font-medium">{m.name}</div>
                  <MaskedPhone phone={m.phone} className="text-xs text-muted" />
                </div>
              ),
            },
            { key: 'r', header: 'Role', cell: (m) => <span className="text-xs capitalize">{m.role}</span> },
            { key: 's', header: 'Status', cell: (m) => <StatusChip status={m.status} /> },
            { key: 'share', header: 'Share', align: 'right', cell: (m) => <Money paise={m.share_paise} className="text-muted" />, hideBelow: 'sm' },
            {
              key: 'paid',
              header: 'Paid',
              align: 'right',
              cell: (m) => (
                <div className="text-right">
                  <Money paise={m.paid_paise} />
                  {m.discount_paise > 0 && <div className="num text-[10px] text-volt">−{(m.discount_paise / 100).toLocaleString('en-IN')} coupon</div>}
                </div>
              ),
            },
            { key: 'comp', header: 'Compensated', align: 'right', cell: (m) => (m.compensated_paise ? <Money paise={m.compensated_paise} className="text-grape-soft" /> : <span className="text-subtle">—</span>), hideBelow: 'md' },
            { key: 'j', header: 'Joined', cell: (m) => <span className="text-xs text-muted">{dateTime(m.joined_at)}</span>, hideBelow: 'lg' },
          ]}
        />
      </Panel>

      <Panel flush title="Payments">
        <DataTable
          rows={payments}
          rowKey={(p) => p.id}
          columns={paymentColumns()}
          maxHeight="max-h-[420px]"
          empty="No payments."
          onRowClick={can('payments.view') ? (p) => navigate(`/payments?q=${encodeURIComponent(p.id)}&open=${p.id}`) : undefined}
        />
      </Panel>

      {(blocks.length > 0 || conflicts.length > 0) && (
        <div className="grid gap-5 xl:grid-cols-2">
          <Panel flush title="Slot blocks" description="Other occupancy on this pitch around the booking">
            <DataTable
              rows={blocks}
              rowKey={(x) => x.id}
              empty="None."
              maxHeight="max-h-80"
              columns={[
                { key: 'src', header: 'Source', cell: (x) => <Chip size="xs">{titleCase(x.source)}</Chip> },
                { key: 'w', header: 'When', cell: (x) => <span className="text-xs">{dateShort(x.start_at)} {formatSlotRange(x.start_at, x.end_at)}</span> },
                { key: 'c', header: 'Customer', cell: (x) => <span className="text-xs">{x.customer_name ?? '—'}</span>, hideBelow: 'sm' },
                { key: 's', header: 'Status', cell: (x) => <StatusChip status={x.status} /> },
              ]}
            />
          </Panel>
          <Panel flush title="Channel conflicts">
            <DataTable
              rows={conflicts}
              rowKey={(x) => x.id}
              empty="None."
              maxHeight="max-h-80"
              columns={[
                { key: 'src', header: 'Source', cell: (x) => <Chip size="xs">{titleCase(x.source)}</Chip> },
                { key: 'sum', header: 'Summary', cell: (x) => <span className="text-xs">{x.summary}</span> },
                { key: 's', header: 'Status', cell: (x) => <StatusChip status={x.status} /> },
                { key: 'r', header: 'Resolution', cell: (x) => <span className="text-xs text-muted">{titleCase(x.resolution) || '—'}</span>, hideBelow: 'sm' },
              ]}
            />
          </Panel>
        </div>
      )}

      <CancelDialog detail={q.data} open={cancelOpen} onClose={() => setCancelOpen(false)} />
    </div>
  )
}

function CancelDialog({ detail, open, onClose }: { detail: AdminBookingDetail; open: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const [dest, setDest] = useState<'credits' | 'source'>('source')
  const m = useMutation({
    mutationFn: (reason: string) => adminApi.bookings.cancel(detail.booking.id, { reason, refund_destination: dest }),
    onSuccess: (res) => {
      if (!isApprovalQueued(res)) toast.success('Booking cancelled — members refunded and notified')
      qc.invalidateQueries({ queryKey: ['admin', 'bookings'] })
      qc.invalidateQueries({ queryKey: ['admin', 'payments'] })
      onClose()
    },
  })
  return (
    <ConfirmDialog
      open={open}
      onClose={onClose}
      title={`Force-cancel ${detail.booking.code}?`}
      description={`Releases the slot, cancels the lobby and refunds every paid member (${inr(detail.booking.paid_paise)} collected). Players are notified.`}
      confirmLabel="Cancel booking & refund"
      reason
      loading={m.isPending}
      onConfirm={(r) => m.mutate(r)}
    >
      <div>
        <div className="mb-1.5 text-xs font-medium text-muted">Refund destination</div>
        <Segmented<'credits' | 'source'>
          value={dest}
          onChange={setDest}
          size="sm"
          options={[
            { value: 'source', label: 'Original payment method' },
            { value: 'credits', label: 'Pytch Credits' },
          ]}
        />
        <p className="mt-1.5 text-xs text-subtle">
          {dest === 'source' ? 'Card/UPI refunds take 5–7 working days. Wallet-paid shares return as credits.' : 'Instant, but credits are non-withdrawable.'}
        </p>
      </div>
    </ConfirmDialog>
  )
}
