/**
 * Shapes the admin API returns that types/admin.ts doesn't pin down (mirrors backend
 * app/modules/admin/schemas.py). Kept slightly permissive so the UI degrades gracefully.
 */
import type { ISODateTime, UUID } from '@/types/api'
import type { AdminBookingRow, AdminPaymentRow } from '@/types/admin'

export interface AdminLobbyInfo {
  id: UUID
  code: string
  title: string
  sport: string
  format: string
  mode: string
  visibility: string
  status: string
  total_spots: number
  share_paise: number
  start_at: ISODateTime
  end_at: ISODateTime
  pay_deadline: ISODateTime | null
  turf_id: UUID
  turf_name: string
  pitch_id: UUID
  pitch_name: string
  notes: string | null
  created_at: ISODateTime
  confirmed_at: ISODateTime | null
  completed_at: ISODateTime | null
}

export interface AdminLobbyMemberRow {
  user_id: UUID
  name: string
  phone: string
  role: string
  status: string
  share_paise: number
  paid_paise: number
  discount_paise: number
  compensated_paise: number
  joined_at: ISODateTime
  paid_at: ISODateTime | null
  left_at: ISODateTime | null
}

export interface AdminConflictRow {
  id: UUID
  source: string
  external_ref: string | null
  external_start_at: ISODateTime
  external_end_at: ISODateTime
  summary: string
  status: string
  resolution: string | null
  created_at: ISODateTime
}

export interface AdminBlockRow {
  id: UUID
  kind: string
  source: string
  status: string
  start_at: ISODateTime
  end_at: ISODateTime
  customer_name: string | null
}

/** GET /admin/bookings/{id} */
export interface AdminBookingDetail {
  booking: AdminBookingRow
  lobby: AdminLobbyInfo
  members: AdminLobbyMemberRow[]
  payments: AdminPaymentRow[]
  conflicts: AdminConflictRow[]
  blocks: AdminBlockRow[]
  transferred_from_id: UUID | null
}

/** GET /admin/payments/{id} — canonical shape lives in types/admin.ts */
export type { AdminPaymentDetail, AdminPaymentRefund } from '@/types/admin'

/** GET /admin/payments/webhook-events */
export interface WebhookEventRow {
  id: string
  provider: string
  event: string
  created_at: ISODateTime
  payload: Record<string, unknown>
}

export interface BroadcastPreview {
  recipients: number
}
