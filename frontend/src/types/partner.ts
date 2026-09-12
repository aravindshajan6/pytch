/**
 * PYTCH Partner (service-provider) portal contract — canonical JSON shapes.
 * Endpoints: docs/PORTALS_CONTRACT.md §Partner. Conventions as in ./api.ts (snake_case, paise, UTC ISO).
 * Base: /api/v1/partner (audience "partner"). Acting provider via header `X-Provider-Id`.
 */
import type { ISODate, ISODateTime, OtpRequestResponse, Page, Pitch, Sport, TurfDetail, UUID, UserPublic } from './api'

export type { OtpRequestResponse }

export type ProviderStatus = 'pending' | 'approved' | 'rejected' | 'suspended'
export type PartnerRole = 'owner' | 'manager' | 'staff'
export type BlockKind = 'booking' | 'block'
export type BlockSource =
  | 'walk_in'
  | 'phone'
  | 'playo'
  | 'hudle'
  | 'khelomore'
  | 'other_app'
  | 'ical'
  | 'api'
  | 'maintenance'
export type OfflinePaymentMode = 'cash' | 'upi' | 'card' | 'online_other' | 'unpaid'
export type SettlementStatus = 'draft' | 'approved' | 'paid' | 'failed'

// ───────────── Auth ─────────────

export interface PartnerMembership {
  provider_id: UUID
  provider_name: string
  provider_status: ProviderStatus
  role: PartnerRole
  turf_ids: UUID[] | null // null = all venues
}

export interface PartnerUser {
  id: UUID
  name: string
  phone: string
  avatar_url: string | null
  name_is_default?: boolean // still the generated "Player 1234" → the portal asks for a real name
}

/** PATCH /partner/me — the login's own display name (2–80 chars) */
export interface UpdatePartnerSelf {
  name: string
}

/** POST /partner/auth/otp/verify, /partner/auth/refresh */
export interface PartnerAuth {
  access_token: string
  refresh_token: string
  token_type: 'bearer'
  expires_in: number
  user: PartnerUser
  memberships: PartnerMembership[] // empty → show "apply as a venue partner"
}

/** GET /partner/me */
export interface PartnerMe {
  user: PartnerUser
  memberships: PartnerMembership[]
}

// ───────────── Provider & onboarding ─────────────

export interface ApplicationVenue {
  name: string
  area: string
  address: string
  lat?: number | null
  lng?: number | null
  sports: Sport[]
  pitch_count: number
  has_indoor: boolean
  notes?: string | null
}

/** POST /partner/applications — creates a pending provider with the caller as owner */
export interface ProviderApplication {
  business_name: string
  legal_name?: string | null
  gstin?: string | null // 15 chars, validated
  entity_type?: 'individual' | 'proprietorship' | 'partnership' | 'llp' | 'company' | null // TDS 194-O
  contact_name: string
  contact_email?: string | null
  city: string
  address: string
  venues: ApplicationVenue[] // 1..10
  bank_account_name?: string | null
  bank_ifsc?: string | null
  bank_account_last4?: string | null
  listed_on?: BlockSource[] // other apps they already use (for channel setup)
}

export interface ProviderOut {
  id: UUID
  name: string
  slug: string
  legal_name: string | null
  gstin: string | null
  contact_name: string
  contact_phone: string
  contact_email: string | null
  city: string
  address: string | null
  status: ProviderStatus
  status_reason: string | null
  commission_bps: number
  settlement_cycle: 'weekly' | 'biweekly' | 'monthly'
  bank_account_name: string | null
  bank_account_last4: string | null
  bank_ifsc: string | null
  kyc_verified: boolean
  payouts_on_hold: boolean // a payout-account change is waiting for Pytch finance
  pending_bank_change: PendingBankChange | null
  venue_count: number
  created_at: ISODateTime
}

/** The requested (not yet approved) payout account — never the full account number. */
export interface PendingBankChange {
  account_name: string | null
  ifsc: string | null
  last4: string | null
  requested_at: ISODateTime
}

/** PATCH /partner/provider (owner) */
export interface ProviderUpdate {
  name?: string
  contact_name?: string
  contact_email?: string | null
  address?: string | null
  bank_account_name?: string | null
  bank_ifsc?: string | null
  bank_account_last4?: string | null // bank changes re-flag KYC for admin review
}

// ───────────── Dashboard ─────────────

export interface PeriodStats {
  bookings: number // Pytch + offline
  pytch_bookings: number
  offline_bookings: number
  revenue_paise: number // Pytch gross + offline recorded
  occupancy_pct: number // occupied slots / open slots, 0..100
}

export interface CalendarEventBrief {
  pitch_name: string
  turf_name: string
  start_at: ISODateTime
  end_at: ISODateTime
  kind: 'pytch' | 'block'
  title: string // lobby title or customer name / source label
  source: BlockSource | 'pytch'
}

/** GET /partner/dashboard?turf_id= */
export interface PartnerDashboard {
  today: PeriodStats
  week: PeriodStats
  month: PeriodStats
  upcoming: CalendarEventBrief[] // next 8
  alerts: {
    open_conflicts: number
    failing_feeds: number
    pending_payout_paise: number
    pending_application: boolean // another change requested by THIS provider awaits Pytch approval
    pending_bank_change: boolean
    payouts_on_hold: boolean
  }
  revenue_series: { date: ISODate; pytch_paise: number; offline_paise: number }[] // last 14 days
  occupancy_heatmap: { weekday: number; hour: number; pct: number }[] // weekday 0=Mon, last 8 weeks
  channel_mix: { source: BlockSource | 'pytch'; count: number }[] // games started in the last 30 days (never future)
}

// ───────────── Calendar & blocks ─────────────

export interface PytchOccupancy {
  kind: 'pytch'
  lobby_id: UUID
  booking_code: string
  lobby_title: string
  lobby_status: 'forming' | 'confirmed' | 'completed' | 'expired' | 'cancelled'
  host_name: string
  paid_spots: number
  total_spots: number
  amount_paise: number // pitch fee for this slot
}

export interface BlockOccupancy {
  kind: 'block'
  block_id: UUID
  block_kind: BlockKind
  source: BlockSource
  customer_name: string | null
  customer_phone: string | null
  amount_paise: number
  payment_mode: OfflinePaymentMode | null
  notes: string | null
  external_ref: string | null
  starts_before: boolean // block spans earlier slots too
  ends_after: boolean
}

export interface CalendarCell {
  slot_id: UUID
  pitch_id: UUID
  start_at: ISODateTime
  end_at: ISODateTime
  price_paise: number
  is_peak: boolean
  status: 'available' | 'held' | 'booked' | 'blocked'
  held_until: ISODateTime | null
  occupancy: PytchOccupancy | BlockOccupancy | null
  has_conflict: boolean
}

/** A pitch as the partner sees it (switched-off pitches included). */
export type PartnerPitch = Pitch & {
  is_active: boolean
  upcoming_bookings?: number // GET /partner/venues: games + offline bookings still to play
}

/** GET /partner/calendar?turf_id&from=YYYY-MM-DD&days=1..7 */
export interface CalendarView {
  turf: { id: UUID; name: string; open_time: string; close_time: string }
  pitches: PartnerPitch[] // + switched-off pitches that still have bookings in range (occupied cells only)
  from: ISODate
  days: number
  cells: CalendarCell[]
}

/** POST /partner/blocks — occupy [start_at, end_at) on one pitch (all covered slots must be available) */
export interface CreateBlockRequest {
  pitch_id: UUID
  start_at: ISODateTime
  end_at: ISODateTime
  kind: BlockKind
  source: BlockSource
  customer_name?: string | null
  customer_phone?: string | null
  amount_paise?: number
  payment_mode?: OfflinePaymentMode | null
  notes?: string | null
}

export interface SlotBlockOut {
  id: UUID
  pitch_id: UUID
  pitch_name: string
  turf_name: string
  start_at: ISODateTime
  end_at: ISODateTime
  kind: BlockKind
  source: BlockSource
  status: 'active' | 'conflicted' | 'cancelled' // conflicted: imported booking that couldn't claim a slot
  customer_name: string | null
  customer_phone: string | null
  amount_paise: number
  payment_mode: OfflinePaymentMode | null
  notes: string | null
  external_ref: string | null
  created_by_name: string | null
  created_at: ISODateTime
}

/** PATCH /partner/blocks/{id} */
export interface UpdateBlockRequest {
  customer_name?: string | null
  customer_phone?: string | null
  amount_paise?: number
  payment_mode?: OfflinePaymentMode | null
  notes?: string | null
}

/** POST /partner/blocks/bulk — e.g. maintenance every Monday 6–8 AM for a month */
export interface BulkBlockRequest {
  pitch_ids: UUID[]
  date_from: ISODate
  date_to: ISODate // inclusive, max 62 days
  time_from: string // "06:00"
  time_to: string // "08:00"
  weekdays: number[] // 0=Mon … 6=Sun
  kind: BlockKind
  source: BlockSource
  notes?: string | null
}

export interface BulkBlockResult {
  created: number // blocks (one per run of consecutive free hours)
  slots: number // hours those blocks cover
  skipped: { slot_id: UUID; start_at: ISODateTime; reason: string; label: string }[] // label: "Walk-in booking" …
}

// ───────────── Bookings list ─────────────

export interface PartnerBookingRow {
  id: UUID // booking id (pytch) or block id (offline)
  kind: 'pytch' | 'offline'
  ref: string // booking code or short block id
  turf_name: string
  pitch_name: string
  start_at: ISODateTime
  end_at: ISODateTime
  customer_name: string
  customer_phone: string | null // masked for pytch bookings: "+91 98••• ••210"
  players: number | null
  source: BlockSource | 'pytch'
  amount_paise: number
  payment_status: 'paid' | 'partially_paid' | 'pending' | 'unpaid' | 'refunded'
  status: string // pytch: booking status; offline: active|cancelled
  lobby_id: UUID | null
  block_kind: BlockKind | null // offline: 'block' = closure (only listed with include_closures)
}

/** GET /partner/bookings?turf_id&status&source&from&to&q&include_closures&limit&offset  (CSV: /partner/bookings/export.csv) */
export type PartnerBookingsPage = Page<PartnerBookingRow>

// ───────────── Venues & pitches ─────────────

/** GET /partner/venues → own venues (TurfDetail from api.ts) */
export type PartnerVenue = Omit<TurfDetail, 'pitches'> & { is_active: boolean; pitch_count_active: number; pitches: PartnerPitch[] }

/** PATCH /partner/venues/{turf_id} */
export interface VenueUpdate {
  name?: string
  description?: string
  address?: string
  phone?: string | null
  amenities?: string[]
  photos?: string[]
  cover_url?: string | null
  open_time?: string // "06:00"
  close_time?: string // "23:00"
}

/** POST /partner/venues/{turf_id}/pitches · PATCH /partner/pitches/{id} */
export interface PitchInput {
  name: string
  sport: Sport
  format: string
  capacity: number
  is_indoor: boolean
  has_camera: boolean
  camera_price_paise: number
  price_per_hour_paise: number
  peak_price_per_hour_paise: number
  is_active?: boolean
  apply_to_future_slots?: boolean // PATCH: re-price future *available* slots
}

// ───────────── Earnings & settlements ─────────────

export interface SettlementOut {
  id: UUID
  period_start: ISODate
  period_end: ISODate
  booking_count: number
  gross_paise: number
  refunds_paise: number
  provider_discounts_paise: number
  commission_bps: number
  commission_paise: number
  gst_on_commission_paise: number
  tcs_paise: number
  tds_paise: number
  net_payable_paise: number
  status: SettlementStatus
  paid_at: ISODateTime | null
  payout_ref: string | null
}

export interface SettlementLineOut {
  booking_id: UUID
  booking_code: string
  turf_name: string
  played_at: ISODateTime
  gross_paise: number
  refunds_paise: number
  provider_discounts_paise: number
  commission_paise: number
}

export interface SettlementDetail extends SettlementOut {
  lines: SettlementLineOut[]
}

/** GET /partner/earnings?from&to */
export interface PartnerEarnings {
  from: ISODate
  to: ISODate
  pytch_gross_paise: number
  commission_paise: number
  pytch_net_paise: number // after commission & taxes (estimated for unsettled)
  offline_revenue_paise: number // recorded walk-ins etc. (not paid out by Pytch)
  unsettled_paise: number // net of games already played (past the settlement hold), not yet in a statement
  upcoming_paise: number // net of confirmed games still to play / inside the hold
  by_turf: { turf_id: UUID; turf_name: string; pytch_gross_paise: number; offline_paise: number; bookings: number }[]
  series: { date: ISODate; pytch_paise: number; offline_paise: number }[]
}

// ───────────── Team ─────────────

export interface PartnerMemberOut {
  id: UUID
  user: Pick<UserPublic, 'id' | 'name' | 'avatar_url'> | null // null while invited
  phone: string
  role: PartnerRole
  status: 'invited' | 'active' | 'removed'
  turf_ids: UUID[] | null
  created_at: ISODateTime
}

/** POST /partner/team (owner) */
export interface InviteMemberRequest {
  phone: string // E.164
  role: Exclude<PartnerRole, 'owner'>
  turf_ids?: UUID[] | null
}

// ───────────── Channels (multi-app consistency) ─────────────

export interface FeedOut {
  id: UUID
  pitch_id: UUID
  pitch_name: string
  turf_name: string
  name: string
  source: BlockSource
  url_hint: string // never the full secret URL
  is_active: boolean
  last_synced_at: ISODateTime | null
  last_status: 'ok' | 'error' | null
  last_error: string | null
  last_event_count: number
}

/** POST /partner/channels/feeds (validated by fetching once) */
export interface CreateFeedRequest {
  pitch_id: UUID
  name: string
  source: BlockSource
  url: string // https iCal URL
}

export interface ExportOut {
  pitch_id: UUID
  pitch_name: string
  turf_name: string
  ical_url: string | null // null = export disabled
}

export interface ApiKeyOut {
  id: UUID
  name: string
  prefix: string
  scopes: ('availability:read' | 'blocks:write')[]
  last_used_at: ISODateTime | null
  created_at: ISODateTime
  revoked_at: ISODateTime | null
}

export interface CreatedApiKey {
  key: string // shown ONCE
  api_key: ApiKeyOut
}

export type WebhookEvent = 'slot.booked' | 'slot.released' | 'slot.blocked' | 'block.cancelled'

export interface WebhookOut {
  id: UUID
  url: string
  events: WebhookEvent[]
  is_active: boolean
  last_delivery_at: ISODateTime | null
  last_status_code: number | null
  consecutive_failures: number
}

export interface CreatedWebhook {
  secret: string // shown ONCE (HMAC signing secret)
  webhook: WebhookOut
}

export interface SyncConflictOut {
  id: UUID
  pitch_name: string
  turf_name: string
  source: BlockSource
  external_ref: string | null
  external_start_at: ISODateTime
  external_end_at: ISODateTime
  summary: string
  lobby_id: UUID | null
  lobby_title: string | null
  /** what holds the slot (the booking that was there first) */
  holder_kind: 'pytch' | 'block' | null
  lobby_status: PytchOccupancy['lobby_status'] | null
  holder_source: BlockSource | null
  holder_label: string | null // lobby title or "Walk-in booking" / "Maintenance"
  status: 'open' | 'resolved' | 'ignored' | 'obsolete' // obsolete: closed itself (one side is gone)
  resolution: 'kept_pytch' | 'moved_external' | 'ignored' | null
  resolution_note: string | null
  created_at: ISODateTime
}

/** GET /partner/channels */
export interface ChannelsOverview {
  feeds: FeedOut[]
  exports: ExportOut[]
  api_keys: ApiKeyOut[]
  webhooks: WebhookOut[]
  open_conflicts: number
  api_base_url: string // e.g. https://pytch.in/api/v1/channel/v1
}
