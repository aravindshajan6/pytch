/**
 * PYTCH Admin console contract — canonical JSON shapes.
 * Endpoints: docs/PORTALS_CONTRACT.md §Admin. Base: /api/v1/admin (separate origin, admin signing key).
 * Auth: short-lived bearer access token held IN MEMORY + httpOnly refresh cookie (`pytch_admin_rt`,
 * path /api/v1/admin/auth) with double-submit CSRF (`pytch_admin_csrf` cookie → `X-CSRF-Token` header).
 */
import type { ISODate, ISODateTime, Page, Sport, UUID, UserPublic, WalletTxnKind } from './api'
import type { BlockSource, ProviderOut, ProviderStatus, SettlementDetail, SettlementOut } from './partner'

export type AdminRole = 'super_admin' | 'ops' | 'finance' | 'support' | 'marketing' | 'read_only'

export type AdminPermission =
  | 'analytics.view'
  | 'users.view'
  | 'users.manage'
  | 'wallet.adjust'
  | 'providers.view'
  | 'providers.manage'
  | 'venues.view'
  | 'venues.manage'
  | 'bookings.view'
  | 'bookings.manage'
  | 'payments.view'
  | 'payments.refund'
  | 'payouts.view'
  | 'payouts.manage'
  | 'coupons.view'
  | 'coupons.manage'
  | 'catalog.manage'
  | 'broadcast.send'
  | 'settings.view'
  | 'settings.manage'
  | 'audit.view'
  | 'admins.manage'
  | 'approvals.decide'
  | 'data.export'

/** Extra error codes on admin endpoints (in addition to api.ts ErrorCode) */
export type AdminErrorCode =
  | 'STEP_UP_REQUIRED' // re-enter TOTP, then retry
  | 'MFA_REQUIRED'
  | 'INVALID_CREDENTIALS'
  | 'ACCOUNT_LOCKED'
  | 'INVALID_MFA_CODE'
  | 'IP_NOT_ALLOWED'
  | 'CSRF_FAILED'
  | 'PASSWORD_POLICY'
  | 'APPROVAL_REQUIRED' // action queued for a second admin (details.approval_id)
  | 'SELF_APPROVAL' // maker cannot be checker
  | 'LAST_SUPER_ADMIN'

// ───────────── Auth ─────────────

/** POST /admin/auth/login {email, password} */
export interface AdminLoginResponse {
  mfa_token: string // 5-min token for the next step
  mfa_enrolled: boolean // false → enrollment flow
  must_change_password: boolean
}

/** POST /admin/auth/mfa/enroll/start {mfa_token} */
export interface MfaEnrollStart {
  secret: string // base32, for manual entry
  otpauth_uri: string // render as QR
}

export interface AdminMe {
  id: UUID
  email: string
  name: string
  role: AdminRole
  permissions: AdminPermission[]
  mfa_enrolled: boolean
  must_change_password: boolean
  last_login_at: ISODateTime | null // this (the most recent) sign-in
  last_login_ip: string | null
  previous_login_at: ISODateTime | null // the sign-in before it — what "Previous sign-in" shows
  previous_login_ip: string | null
}

/** POST /admin/auth/mfa/verify {mfa_token, code?, recovery_code?}
 *  POST /admin/auth/mfa/enroll/confirm {mfa_token, code} (adds recovery_codes)
 *  POST /admin/auth/refresh  (cookie + X-CSRF-Token) — sets rotated cookie */
export interface AdminAuth {
  access_token: string
  expires_in: number
  admin: AdminMe
  recovery_codes?: string[] // only on enrollment confirm — show once
}

/** POST /admin/auth/step-up {code} */
export interface StepUpResponse {
  ok: true
  valid_until: ISODateTime
}

export interface AdminSessionOut {
  id: UUID
  ip: string | null
  user_agent: string | null
  created_at: ISODateTime
  last_seen_at: ISODateTime
  expires_at: ISODateTime
  current: boolean
}

// ───────────── Analytics ─────────────

export type AnalyticsRange = '7d' | '30d' | '90d'

export interface Kpi {
  key: string // gmv | net_revenue | take_rate | bookings | …
  label: string
  value: number
  previous: number // same-length previous period
  unit: 'paise' | 'count' | 'pct' | 'ratio'
  hint: string // definition
}

/** GET /admin/analytics/overview?range= */
export interface AnalyticsOverview {
  range: AnalyticsRange
  kpis: Kpi[]
  // gmv, net_revenue (commission − platform-funded discounts), take_rate, bookings, completed_matches,
  // avg_fill_rate, split_completion_rate, cancellation_rate, refunds, new_players, active_players,
  // sos_fill_rate, weather_saves, coupon_spend, credits_outstanding, overbooking_rate
}

/** GET /admin/analytics/timeseries?metric=gmv|bookings|new_players|net_revenue|active_players&range&granularity=day|week */
export interface TimeSeries {
  metric: string
  granularity: 'day' | 'week'
  points: { date: ISODate; value: number }[]
  previous: { date: ISODate; value: number }[] // aligned previous period (for comparison line)
}

/** GET /admin/analytics/cohorts — weekly cohorts by first completed match */
export interface CohortTable {
  cohorts: { week: ISODate; size: number; retention: (number | null)[] }[] // retention[i] = % active in week i (0..8)
}

/** GET /admin/analytics/venues?range= */
export interface VenueAnalyticsRow {
  turf_id: UUID
  turf_name: string
  provider_name: string | null
  bookings: number
  gmv_paise: number
  occupancy_pct: number
  cancellation_pct: number
  conflicts: number
}

/** GET /admin/analytics/heatmap?range= */
export interface Heatmap {
  cells: { weekday: number; hour: number; bookings: number }[]
}

/** GET /admin/analytics/sports?range= */
export interface SportMix {
  rows: { sport: Sport; bookings: number; gmv_paise: number }[]
}

// ───────────── Users (players) ─────────────

export type UserStatus = 'active' | 'suspended' | 'banned'

export interface AdminUserRow {
  id: UUID
  name: string
  phone: string
  status: UserStatus
  home_area: string | null
  level: number
  true_skill: number | null
  matches_played: number
  wallet_balance_paise: number
  is_provider_member: boolean
  created_at: ISODateTime
  last_seen_at: ISODateTime | null
}

export interface AdminUserDetail extends AdminUserRow {
  public: UserPublic
  status_reason: string | null
  suspended_until: ISODateTime | null
  stats: { hosted: number; subs: number; dropouts: number; no_shows: number; ratings_received: number }
  recent_bookings: AdminBookingRow[]
  recent_payments: AdminPaymentRow[]
  wallet: { kind: WalletTxnKind; amount_paise: number; note: string; created_at: ISODateTime }[]
  active_sessions: number
}

/** POST /admin/users/{id}/status */
export interface SetUserStatus {
  status: UserStatus
  reason: string
  until?: ISODateTime | null // suspensions only
}

/** POST /admin/users/{id}/wallet  (support: |amount| ≤ ₹500 and daily caps → 409 LIMIT_REACHED;
 *  credits above the dual-approval threshold → 202 APPROVAL_REQUIRED {approval_id}) */
export interface WalletAdjust {
  amount_paise: number // + credit / − debit
  reason: string
}

/** Payload of a `wallet.adjust` approval request */
export interface WalletAdjustApprovalPayload {
  amount_paise: number
  reason: string
  direction?: 'credit' | 'debit'
  player_name?: string
  balance_paise?: number
}

// ───────────── Providers & venues ─────────────

export interface AdminProviderRow {
  id: UUID
  name: string
  city: string
  status: ProviderStatus
  contact_name: string
  contact_phone: string
  venue_count: number
  commission_bps: number
  gmv_30d_paise: number
  open_conflicts: number
  payouts_on_hold: boolean
  created_at: ISODateTime
}

export interface AdminProviderDetail extends ProviderOut {
  entity_type: string | null
  pan_last4: string | null
  razorpay_account_id: string | null
  payouts_on_hold: boolean
  notes: string | null
  application: Record<string, unknown>
  application_venues: AdminApplicationVenue[]
  members: { name: string | null; phone: string; role: string; status: string }[]
  venues: AdminVenueRow[]
  settlements: SettlementOut[]
  reviewed_by: string | null
  reviewed_at: ISODateTime | null
}

/** One venue of the partner's application (+ the turf onboarded from it, if any) */
export interface AdminApplicationVenue {
  index: number
  name: string
  area: string
  address: string
  lat: number | null
  lng: number | null
  sports: string[]
  pitch_count: number
  has_indoor: boolean
  notes: string | null
  turf_id: UUID | null
  turf_name: string | null
}

export interface AdminPitchInput {
  name: string
  sport: Sport
  format: string
  capacity: number
  is_indoor: boolean
  has_camera: boolean
  camera_price_paise: number
  price_per_hour_paise: number
  peak_price_per_hour_paise: number
}

/** POST /admin/providers/{id}/venues 🛡 → AdminProviderDetail (turf + pitches + 14 days of slots) */
export interface AdminCreateVenue {
  application_index: number | null
  name: string
  area: string
  address: string
  lat: number // must lie inside the service area
  lng: number
  description?: string
  phone?: string | null
  amenities?: string[]
  open_time: string // "HH:MM"
  close_time: string // "HH:MM" ("00:00" = midnight)
  pitches: AdminPitchInput[]
}

/** POST /admin/providers/{id}/review */
export interface ProviderReview {
  decision: 'approve' | 'reject'
  reason?: string | null
  commission_bps?: number
}

/** PATCH /admin/providers/{id} */
export interface ProviderAdminUpdate {
  commission_bps?: number
  settlement_cycle?: 'weekly' | 'biweekly' | 'monthly'
  notes?: string | null
  razorpay_account_id?: string | null
}

export interface AdminVenueRow {
  id: UUID
  slug: string
  name: string
  area: string
  provider_id: UUID | null
  provider_name: string | null
  pitch_count: number
  sports: Sport[]
  is_active: boolean
  is_featured: boolean
  rating_avg: number
  bookings_30d: number
  upcoming_bookings: number // Pytch games (forming/confirmed) that haven't ended yet
}

/** PATCH /admin/venues/{id} */
export interface AdminVenueUpdate {
  is_active?: boolean
  is_featured?: boolean
  name?: string
  // provider re-assignment: POST /admin/providers/{id}/turfs (step-up) — not part of this PATCH
}

// ───────────── Bookings & payments ─────────────

export interface AdminBookingRow {
  id: UUID
  code: string
  lobby_id: UUID
  lobby_title: string
  turf_name: string
  pitch_name: string
  host_name: string
  host_phone: string
  mode: 'split' | 'full'
  status: string
  start_at: ISODateTime
  total_paise: number
  paid_paise: number
  created_at: ISODateTime
}

export interface AdminPaymentRow {
  id: UUID
  user_name: string
  user_phone: string
  lobby_title: string | null
  booking_code: string | null
  purpose: string
  provider: 'mock' | 'razorpay' | 'wallet'
  amount_paise: number
  discount_paise: number
  credits_applied_paise: number
  payable_paise: number
  status: string
  coupon_code: string | null
  provider_payment_id: string | null
  created_at: ISODateTime
  paid_at: ISODateTime | null
}

export interface AdminPaymentRefund {
  ref: string
  amount_paise: number
  destination: 'credits' | 'source'
  reason: string | null
  by: string | null
  at: ISODateTime | null
  approval_id: string | null
  kind: 'admin_refund' | 'cancellation' // a cancellation's credits, recorded for history
}

/** GET /admin/payments/{id} — row + refund history + the server's refund cap */
export interface AdminPaymentDetail extends AdminPaymentRow {
  user_id: UUID
  lobby_id: UUID | null
  member_id: UUID | null
  provider_order_id: string | null
  failure_reason: string | null
  refunded_paise: number
  refunded_source_paise: number
  refundable_paise: number // what POST …/refund accepts now (capped by what the seat still holds)
  refundable_to_source_paise: number
  seat_refunded_paise: number // admin refunds already issued on this seat (the approval threshold is cumulative)
  refunds: AdminPaymentRefund[]
}

/** GET /admin/payments?status= (partially_refunded = paid with a partial refund) */
export type AdminPaymentStatusFilter = 'created' | 'paid' | 'partially_refunded' | 'failed' | 'refunded' | 'cancelled'

/** POST /admin/payments/{id}/refund  → 200 done, or 202 {approval_id} when above the dual-approval threshold;
 *  400 with details.refundable_paise when more than the seat still holds */
export interface RefundRequest {
  amount_paise: number
  destination: 'credits' | 'source'
  reason: string
}

/** POST /admin/bookings/{id}/cancel */
export interface AdminCancelBooking {
  reason: string
  refund_destination: 'credits' | 'source'
}

export interface ReconciliationDay {
  date: ISODate
  captured_paise: number
  captured_count: number
  refunded_paise: number
  credits_issued_paise: number
  credits_spent_paise: number
  mismatches: { payment_id: UUID; issue: string }[] // e.g. paid payment with no active seat
}

// ───────────── Approvals (maker–checker) ─────────────

export interface ApprovalOut {
  id: UUID
  action: string // payment.refund | provider.bank_change | …
  target_type: string
  target_id: string
  summary: string
  payload: Record<string, unknown>
  status: 'pending' | 'approved' | 'rejected' | 'failed'
  requested_by: string // admin email or provider name
  decided_by: string | null
  decided_at: ISODateTime | null
  decision_note: string | null
  result: Record<string, unknown> | null // what the executor did, or {error, code} when it failed
  created_at: ISODateTime
}

// ───────────── Settlements ─────────────

export interface AdminSettlementRow extends SettlementOut {
  provider_id: UUID
  provider_name: string
  adjustments_paise: number
  generated_by: string | null
  approved_by: string | null
  payout_method: 'razorpay_route' | 'manual_neft' | null
}

export type AdminSettlementDetail = SettlementDetail & AdminSettlementRow

/** POST /admin/settlements/generate */
export interface GenerateSettlements {
  period_start: ISODate
  period_end: ISODate
  provider_id?: UUID | null
}

/** POST /admin/settlements/{id}/pay — payer ≠ approver */
export interface PaySettlement {
  method: 'razorpay_route' | 'manual_neft'
  reference?: string | null // manual transfers: bank UTR / reference, 12–22 letters or digits
}

// ───────────── Coupons ─────────────

export interface CouponOut {
  id: UUID
  code: string
  description: string
  discount_type: 'percent' | 'flat'
  percent_off: number | null
  amount_off_paise: number | null
  max_discount_paise: number | null
  min_amount_paise: number
  starts_at: ISODateTime | null
  ends_at: ISODateTime | null
  usage_limit_total: number | null
  usage_limit_per_user: number
  used_count: number
  first_booking_only: boolean
  sports: Sport[]
  turf_ids: UUID[]
  provider_id: UUID | null
  funded_by: 'platform' | 'provider' | 'shared'
  provider_share_pct: number
  is_active: boolean
  total_discount_paise: number
  created_at: ISODateTime
}

export type CouponInput = Omit<CouponOut, 'id' | 'used_count' | 'total_discount_paise' | 'created_at'>

export interface CouponRedemptionOut {
  id: UUID
  user_name: string
  user_phone: string
  payment_id: UUID
  lobby_title: string | null
  discount_paise: number
  status: 'applied' | 'reversed'
  created_at: ISODateTime
}

// ───────────── Catalog, broadcasts, settings ─────────────

export interface SportCatalogOut {
  key: Sport | string
  label: string
  emoji: string
  formats: string[]
  is_active: boolean
  sort_order: number
}

export interface BroadcastSegment {
  areas?: string[]
  sports?: Sport[]
  active_days?: number | null // played/logged in within N days
}

export interface BroadcastInput {
  title: string
  body: string
  url?: string | null // in-app path: /app… or /partner… (segments [A-Za-z0-9_-], optional ?query; no //, .., \)
  segment: BroadcastSegment
}

export interface BroadcastOut extends BroadcastInput {
  id: UUID
  recipient_count: number
  created_by: string | null
  created_at: ISODateTime
}

export interface SettingOut {
  key: string
  value: boolean | number | string | null
  default: boolean | number | string | null
  type: 'bool' | 'int' | 'money' | 'string'
  label: string
  description: string
  updated_by: string | null
  updated_at: ISODateTime | null
}

// ───────────── Audit, team, system ─────────────

export interface AuditEntry {
  id: number
  occurred_at: ISODateTime
  actor_type: 'admin' | 'provider' | 'system' | 'user' | 'api_key'
  actor_label: string
  action: string
  target_type: string | null
  target_id: string | null
  summary: string
  changes: Record<string, unknown>
  ip: string | null
  hash: string
}

export type AuditPage = Page<AuditEntry>

export interface ChainVerification {
  ok: boolean
  checked: number
  broken_at: number | null
}

export interface AdminAccountOut {
  id: UUID
  email: string
  name: string
  role: AdminRole
  is_active: boolean
  mfa_enrolled: boolean
  last_login_at: ISODateTime | null
  locked: boolean
  created_at: ISODateTime
}

/** POST /admin/team → { admin, temporary_password } (shown once; must change at first login) */
export interface CreatedAdmin {
  admin: AdminAccountOut
  temporary_password: string
}

/** POST /admin/team/{id}/reset-password 🛡 (super admin, never yourself) — temporary password shown once */
export interface ResetPasswordResult extends CreatedAdmin {
  sessions_revoked: number
}

/** GET /admin/system/health */
export interface SystemHealth {
  db: boolean
  redis: boolean
  worker_heartbeat_at: ISODateTime | null
  jobs: { name: string; last_run_at: ISODateTime | null }[]
  websocket_connections: number
  pending_webhooks: number
  failing_feeds: number
  open_conflicts: number
  pending_approvals: number
  audit_chain_ok: boolean | null
}

export type { BlockSource }
