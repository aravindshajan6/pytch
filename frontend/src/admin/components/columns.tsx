/* Reusable column sets for rows that appear on several pages. */
import type { AdminBookingRow, AdminPaymentRow, AdminSettlementRow } from '@/types/admin'
import type { SettlementOut } from '@/types/partner'
import { MaskedPhone } from './bits'
import type { Column } from './DataTable'
import { Money, Mono, StatusChip } from './ui'
import { dateShort, dateTime } from '../lib/format'

export function bookingColumns(opts: { host?: boolean } = {}): Column<AdminBookingRow>[] {
  return [
    { key: 'code', header: 'Code', cell: (b) => <Mono className="font-semibold text-fg">{b.code}</Mono>, sortValue: (b) => b.code },
    {
      key: 'lobby',
      header: 'Game',
      cell: (b) => (
        <div className="min-w-0 max-w-64">
          <div className="truncate font-medium">{b.lobby_title}</div>
          <div className="truncate text-xs text-muted">
            {b.turf_name} · {b.pitch_name}
          </div>
        </div>
      ),
    },
    ...(opts.host !== false
      ? [
          {
            key: 'host',
            header: 'Host',
            cell: (b: AdminBookingRow) => (
              <div className="min-w-0">
                <div className="truncate text-sm">{b.host_name}</div>
                <MaskedPhone phone={b.host_phone} className="text-xs text-muted" />
              </div>
            ),
            hideBelow: 'lg' as const,
          },
        ]
      : []),
    { key: 'when', header: 'Starts', cell: (b) => <span className="text-xs whitespace-nowrap">{dateTime(b.start_at)}</span>, sortValue: (b) => b.start_at, hideBelow: 'md' },
    { key: 'mode', header: 'Mode', cell: (b) => <span className="text-xs text-muted capitalize">{b.mode}</span>, hideBelow: 'xl' },
    { key: 'status', header: 'Status', cell: (b) => <StatusChip status={b.status} /> },
    {
      key: 'paid',
      header: 'Paid / total',
      align: 'right',
      cell: (b) => (
        <span className="text-xs whitespace-nowrap">
          <Money paise={b.paid_paise} className="text-fg" /> <span className="text-subtle">/</span> <Money paise={b.total_paise} className="text-muted" />
        </span>
      ),
      sortValue: (b) => b.total_paise,
    },
  ]
}

export function settlementColumns(opts: { provider?: boolean } = {}): Column<SettlementOut & Partial<Pick<AdminSettlementRow, 'provider_name' | 'provider_id'>>>[] {
  return [
    {
      key: 'period',
      header: 'Period',
      cell: (s) => (
        <span className="text-sm whitespace-nowrap">
          {dateShort(s.period_start)} – {dateShort(s.period_end)}
        </span>
      ),
      sortValue: (s) => s.period_start,
    },
    ...(opts.provider !== false
      ? [{ key: 'provider', header: 'Provider', cell: (s: SettlementOut & { provider_name?: string }) => <span className="truncate">{s.provider_name ?? '—'}</span>, sortValue: (s: SettlementOut & { provider_name?: string }) => s.provider_name ?? '' }]
      : []),
    { key: 'count', header: 'Bookings', align: 'right', cell: (s) => <span className="num">{s.booking_count}</span>, hideBelow: 'md' },
    { key: 'gross', header: 'Gross', align: 'right', cell: (s) => <Money paise={s.gross_paise} />, sortValue: (s) => s.gross_paise, hideBelow: 'sm' },
    { key: 'comm', header: 'Commission', align: 'right', cell: (s) => <Money paise={s.commission_paise} className="text-muted" />, hideBelow: 'lg' },
    { key: 'net', header: 'Net payable', align: 'right', cell: (s) => <Money paise={s.net_payable_paise} className="font-semibold" />, sortValue: (s) => s.net_payable_paise },
    { key: 'status', header: 'Status', cell: (s) => <StatusChip status={s.status} /> },
  ]
}

export function paymentColumns(opts: { user?: boolean } = {}): Column<AdminPaymentRow>[] {
  return [
    {
      key: 'created',
      header: 'Created',
      cell: (p) => <span className="text-xs whitespace-nowrap text-muted">{dateTime(p.created_at)}</span>,
      sortValue: (p) => p.created_at,
      hideBelow: 'md',
    },
    ...(opts.user !== false
      ? [
          {
            key: 'user',
            header: 'Player',
            cell: (p: AdminPaymentRow) => (
              <div className="min-w-0">
                <div className="truncate text-sm">{p.user_name}</div>
                <MaskedPhone phone={p.user_phone} className="text-xs text-muted" />
              </div>
            ),
          },
        ]
      : []),
    {
      key: 'what',
      header: 'For',
      cell: (p) => (
        <div className="min-w-0 max-w-56">
          <div className="truncate text-sm">{p.lobby_title ?? p.purpose.replace(/_/g, ' ')}</div>
          <div className="truncate text-xs text-muted">
            {p.booking_code && <Mono>{p.booking_code}</Mono>}
            {p.coupon_code && <span className="ml-1.5 text-volt">{p.coupon_code}</span>}
          </div>
        </div>
      ),
      hideBelow: 'sm',
    },
    { key: 'provider', header: 'Via', cell: (p) => <span className="text-xs text-muted capitalize">{p.provider}</span>, hideBelow: 'lg' },
    { key: 'status', header: 'Status', cell: (p) => <StatusChip status={p.status} /> },
    {
      key: 'amount',
      header: 'Payable',
      align: 'right',
      cell: (p) => (
        <div className="text-right">
          <Money paise={p.payable_paise} className="font-medium" />
          {(p.discount_paise > 0 || p.credits_applied_paise > 0) && (
            <div className="num text-[10px] text-subtle">of {p.amount_paise / 100}</div>
          )}
        </div>
      ),
      sortValue: (p) => p.payable_paise,
    },
  ]
}
