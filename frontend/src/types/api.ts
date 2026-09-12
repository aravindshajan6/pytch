/**
 * PYTCH API contract — canonical JSON shapes.
 *
 * This file is the single source of truth for request/response bodies.
 * The backend Pydantic schemas mirror these exactly (snake_case on both sides).
 *
 * Conventions
 *  - IDs are UUID strings.
 *  - Timestamps are ISO-8601 strings with offset (UTC). Format in Asia/Kolkata on the client.
 *  - Money is integer paise (`*_paise`). ₹150 === 15000.
 *  - Errors: `{ error: { code, message, details? } }` with an HTTP status.
 */

export type UUID = string
export type ISODateTime = string
export type ISODate = string // YYYY-MM-DD

// ───────────────────────────── Enums ─────────────────────────────

export type Sport = 'football' | 'cricket' | 'badminton' | 'pickleball' | 'basketball'
export type SkillLevel = 'beginner' | 'intermediate' | 'advanced' | 'pro'
export type DominantFoot = 'left' | 'right' | 'both'
export type Tier = 'rookie' | 'regular' | 'skilled' | 'elite'

export type SlotStatus = 'available' | 'held' | 'booked' | 'blocked'
export type BookingStatus = 'pending_payment' | 'confirmed' | 'completed' | 'cancelled' | 'expired'
export type LobbyStatus = 'forming' | 'confirmed' | 'completed' | 'expired' | 'cancelled'
export type LobbyMode = 'split' | 'full'
export type Visibility = 'public' | 'private'
export type MemberRole = 'host' | 'player' | 'sub'
export type MemberStatus = 'joined' | 'paid' | 'left' | 'removed'
export type Team = 'A' | 'B'

export type PaymentStatus = 'created' | 'paid' | 'failed' | 'refunded' | 'cancelled'
export type PaymentPurpose = 'share' | 'full' | 'sub_share' | 'cover_remaining'
export type PaymentProvider = 'mock' | 'razorpay' | 'wallet'
export type WalletTxnKind =
  | 'refund'
  | 'rain_check'
  | 'reimbursement'
  | 'dropout_credit'
  | 'spend'
  | 'bonus'

export type SOSStatus = 'open' | 'filled' | 'expired' | 'cancelled'
export type RecordingStatus = 'scheduled' | 'processing' | 'ready' | 'failed'
export type WeatherSeverity = 'watch' | 'warning'
export type WeatherAlertStatus = 'open' | 'transferred' | 'rain_checked' | 'dismissed' | 'expired'
export type BadgeRarity = 'common' | 'rare' | 'epic' | 'legendary'

export type NotificationType =
  | 'lobby_confirmed'
  | 'lobby_expired'
  | 'lobby_cancelled'
  | 'member_joined'
  | 'member_left'
  | 'payment_received'
  | 'payment_reminder'
  | 'sos'
  | 'sub_found'
  | 'weather_alert'
  | 'match_transferred'
  | 'rating_request'
  | 'recording_ready'
  | 'badge_earned'
  | 'level_up'
  | 'wallet_credit'
  | 'verified_playmaker'

// ───────────────────────────── Common ─────────────────────────────

export interface Page<T> {
  items: T[]
  total: number
  limit: number
  offset: number
}

export interface ApiErrorBody {
  error: { code: ErrorCode; message: string; details?: unknown }
}

export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'RATE_LIMITED'
  | 'INVALID_OTP'
  | 'SLOT_UNAVAILABLE'
  | 'SLOT_LOCKED'
  | 'LOBBY_FULL'
  | 'LOBBY_CLOSED'
  | 'ALREADY_MEMBER'
  | 'NOT_MEMBER'
  | 'NOT_ELIGIBLE'
  | 'PAYMENT_WINDOW_CLOSED'
  | 'ALREADY_PAID'
  | 'PAYMENT_FAILED'
  | 'INVALID_SIGNATURE'
  | 'INSUFFICIENT_CREDITS'
  | 'TOO_LATE'
  | 'RATING_WINDOW_CLOSED'
  | 'SOS_CLOSED'
  | 'LIMIT_REACHED'
  | 'CONFLICT'
  | 'DEMO_DISABLED'
  | 'INTERNAL_ERROR'

// ───────────────────────────── Meta ─────────────────────────────

export interface SportMeta {
  key: Sport
  label: string
  emoji: string
  formats: string[]
}

export interface AreaMeta {
  name: string
  lat: number
  lng: number
}

/** GET /meta */
export interface AppMeta {
  app_name: string
  demo_mode: boolean
  payment_provider: 'mock' | 'razorpay'
  razorpay_key_id: string | null
  split_window_minutes: number // 30
  full_hold_minutes: number // 10
  seat_reservation_minutes: number // 10 (joined-but-unpaid)
  sub_discount_pct: number // 20
  sos_window_hours: number // 6
  bench_default_radius_km: number // 5
  rain_transfer_cover_paise: number // 20000
  rain_bonus_paise: number // 2500
  rating_window_hours: number // 48
  max_pinned_clips: number // 3
  max_clip_seconds: number // 60
  sports: SportMeta[]
  areas: AreaMeta[]
  rating_tags: string[]
  city_center: { lat: number; lng: number }
}

// ───────────────────────────── Auth & Users ─────────────────────────────

export interface OtpRequest {
  phone: string // E.164, e.g. +919876543210
}
export interface OtpRequestResponse {
  sent: boolean
  expires_in: number
  dev_code: string | null // only when demo_mode
}
export interface OtpVerify {
  phone: string
  code: string
}
export interface AuthTokens {
  access_token: string
  refresh_token: string
  token_type: 'bearer'
  expires_in: number
  user: UserMe
  is_new_user: boolean
}
export interface RefreshRequest {
  refresh_token: string
}

/** Minimal public view of a player — embedded everywhere. */
export interface UserPublic {
  id: UUID
  name: string
  avatar_url: string | null
  home_area: string | null
  position: string | null
  preferred_sports: Sport[]
  level: number
  tier: Tier
  true_skill: number | null // 0..100, null until rated
  is_verified_playmaker: boolean
}

export interface UserMe extends UserPublic {
  phone: string
  bio: string | null
  self_skill_level: SkillLevel | null
  dominant_foot: DominantFoot | null
  home_lat: number | null
  home_lng: number | null
  xp: number
  wallet_balance_paise: number
  onboarded: boolean
  created_at: ISODateTime
}

/** PATCH /users/me */
export interface UserUpdate {
  name?: string
  bio?: string | null
  avatar_url?: string | null
  position?: string | null
  preferred_sports?: Sport[]
  self_skill_level?: SkillLevel | null
  dominant_foot?: DominantFoot | null
  home_lat?: number | null
  home_lng?: number | null
  home_area?: string | null
  onboarded?: boolean
}

export interface TagCount {
  tag: string
  count: number
}

export interface PlayerStats {
  matches_played: number
  matches_hosted: number
  subs_made: number
  dropouts: number
  no_shows: number
  ratings_received: number
  ratings_given: number
  avg_skill: number | null // 1..5
  avg_fair_play: number | null
  avg_reliability: number | null
  true_skill: number | null
  tier: Tier
  is_verified_playmaker: boolean
  top_tags: TagCount[]
  streak_weeks: number
  xp: number
  level: number
}

/** GET /users/{id}, GET /users/me/profile */
export interface PlayerProfile {
  user: UserPublic
  bio: string | null
  self_skill_level: SkillLevel | null
  dominant_foot: DominantFoot | null
  stats: PlayerStats
  badges: Badge[] // earned only
  pinned_clips: Clip[]
  joined_at: ISODateTime
}

// ───────────────────────────── Turfs / Pitches / Slots ─────────────────────────────

export interface TurfSummary {
  id: UUID
  slug: string
  name: string
  area: string
  address: string
  lat: number
  lng: number
  cover_url: string | null
  sports: Sport[]
  has_indoor: boolean
  has_outdoor: boolean
  has_camera: boolean
  amenities: string[]
  min_price_per_hour_paise: number
  rating_avg: number
  rating_count: number
  distance_km: number | null
  open_lobbies_count: number
}

export interface Pitch {
  id: UUID
  turf_id: UUID
  name: string
  sport: Sport
  format: string // "5v5", "7v7", "singles", "doubles", "nets"
  capacity: number // players for a full game
  is_indoor: boolean
  has_camera: boolean
  camera_price_paise: number
  price_per_hour_paise: number
  peak_price_per_hour_paise: number
}

export interface TurfDetail extends TurfSummary {
  description: string
  photos: string[]
  phone: string | null
  open_time: string // "06:00"
  close_time: string // "23:00"
  pitches: Pitch[]
}

export interface HourWeather {
  time: ISODateTime
  temperature_c: number
  precipitation_probability: number // 0..100
  precipitation_mm: number
  weather_code: number // WMO code
  is_risky: boolean
}

export interface Slot {
  id: UUID
  pitch_id: UUID
  start_at: ISODateTime
  end_at: ISODateTime
  price_paise: number
  is_peak: boolean
  status: SlotStatus
  held_until: ISODateTime | null
  open_lobby_id: UUID | null // public joinable lobby on this slot
  weather: HourWeather | null // outdoor pitches, within forecast horizon
}

/** GET /slots/{id} */
export interface SlotDetail {
  slot: Slot
  pitch: Pitch
  turf: TurfSummary
}

// ───────────────────────────── Bookings & Lobbies ─────────────────────────────

/** POST /bookings */
export interface CreateBookingRequest {
  slot_id: UUID
  mode: LobbyMode
  total_spots: number // includes host; 2..pitch.capacity+4
  visibility: Visibility
  title?: string | null
  recorded?: boolean // requires pitch.has_camera
  min_true_skill?: number | null
  verified_only?: boolean
  notes?: string | null
}

export interface Booking {
  id: UUID
  code: string // "PY-7K2Q9X"
  slot_id: UUID
  lobby_id: UUID
  host_id: UUID
  mode: LobbyMode
  status: BookingStatus
  pitch_fee_paise: number
  recording_fee_paise: number
  total_paise: number
  recorded: boolean
  start_at: ISODateTime
  end_at: ISODateTime
  expires_at: ISODateTime | null // hold deadline while pending_payment
  confirmed_at: ISODateTime | null
  created_at: ISODateTime
  transferred_from_id: UUID | null
}

export interface LobbyTurfRef {
  id: UUID
  slug: string
  name: string
  area: string
  lat: number
  lng: number
  cover_url: string | null
}

export interface LobbyPitchRef {
  id: UUID
  name: string
  is_indoor: boolean
  has_camera: boolean
}

export interface LobbySummary {
  id: UUID
  code: string // 6-char invite code
  title: string
  sport: Sport
  format: string
  mode: LobbyMode
  visibility: Visibility
  status: LobbyStatus
  host: UserPublic
  start_at: ISODateTime
  end_at: ISODateTime
  turf: LobbyTurfRef
  pitch: LobbyPitchRef
  total_spots: number
  filled_spots: number // members joined + paid
  paid_spots: number
  spots_left: number
  share_paise: number
  pay_deadline: ISODateTime | null // split mode while forming
  min_true_skill: number | null
  verified_only: boolean
  recorded: boolean
  distance_km: number | null
  avg_true_skill: number | null
  member_avatars: UserPublic[] // first 6 active members
}

export interface LobbyMember {
  user: UserPublic
  role: MemberRole
  status: MemberStatus
  team: Team | null
  share_paise: number // amount owed for this seat (after discount)
  paid_paise: number
  discount_paise: number
  joined_at: ISODateTime
  paid_at: ISODateTime | null
  reserved_until: ISODateTime | null // unpaid seat hold
}

export interface Eligibility {
  can_join: boolean
  reasons: string[] // human readable, e.g. "Needs True Skill 65 — you're 58"
}

export interface LobbyDetail extends LobbySummary {
  booking: Booking
  notes: string | null
  members: LobbyMember[] // active (joined/paid) members
  my_membership: LobbyMember | null
  eligibility: Eligibility
  open_sos: SOSRequest | null
  weather_alert: WeatherAlert | null // open alert only
  recording: RecordingSummary | null
  invite_url: string
  created_at: ISODateTime
}

export interface CreateBookingResponse {
  booking: Booking
  lobby: LobbyDetail
}

export interface LobbyMessage {
  id: UUID
  lobby_id: UUID
  user: UserPublic | null // null for system messages
  kind: 'chat' | 'system'
  body: string
  created_at: ISODateTime
}

export interface QuickMatchResponse {
  lobby: LobbySummary | null
  score: number // 0..100
  reasons: string[] // "Kicks off in 2h", "1.2 km away", "Skill match 92%"
}

// ───────────────────────────── Payments & Wallet ─────────────────────────────

export interface PayRequest {
  use_credits: boolean
}

export interface RazorpayCheckoutOptions {
  key_id: string
  order_id: string
  amount: number
  currency: 'INR'
  name: string
  description: string
  prefill: { name: string; contact: string }
}

/** Returned by POST /lobbies/{id}/pay and /cover-remaining */
export interface PaymentIntent {
  payment_id: UUID
  status: PaymentStatus // 'paid' immediately when fully covered by credits
  provider: PaymentProvider
  purpose: PaymentPurpose
  amount_paise: number // gross amount
  credits_applied_paise: number
  payable_paise: number // amount - credits
  lobby_id: UUID | null
  razorpay: RazorpayCheckoutOptions | null
}

export interface Payment {
  id: UUID
  lobby_id: UUID | null
  purpose: PaymentPurpose
  provider: PaymentProvider
  amount_paise: number
  credits_applied_paise: number
  payable_paise: number
  status: PaymentStatus
  created_at: ISODateTime
  paid_at: ISODateTime | null
}

export interface MockCompleteRequest {
  outcome: 'success' | 'failure'
}

export interface RazorpayVerifyRequest {
  razorpay_order_id: string
  razorpay_payment_id: string
  razorpay_signature: string
}

export interface WalletTxn {
  id: UUID
  amount_paise: number // + credit, − debit
  kind: WalletTxnKind
  note: string
  balance_after_paise: number
  ref_type: string | null
  ref_id: UUID | null
  created_at: ISODateTime
}

/** GET /wallet */
export interface Wallet {
  balance_paise: number
  transactions: WalletTxn[]
}

// ───────────────────────────── Ratings ─────────────────────────────

export interface PendingRating {
  lobby_id: UUID
  title: string
  sport: Sport
  turf_name: string
  start_at: ISODateTime
  closes_at: ISODateTime
  teammates: UserPublic[] // not yet rated by me
}

export interface RatingInput {
  ratee_id: UUID
  skill: number // 1..5
  fair_play: number // 1..5
  reliability: number // 1..5
  showed_up: boolean
  tags: string[] // max 3, from AppMeta.rating_tags
}

export interface SubmitRatingsRequest {
  ratings: RatingInput[]
}

export interface SubmitRatingsResponse {
  submitted: number
  xp_awarded: number
}

export interface VerifiedCriterion {
  key: string
  label: string
  current: number
  target: number
  met: boolean
}

/** GET /ratings/me */
export interface RatingSummary {
  ratings_received: number
  distinct_raters: number
  avg_skill: number | null
  avg_fair_play: number | null
  avg_reliability: number | null
  true_skill: number | null
  tier: Tier
  is_verified_playmaker: boolean
  top_tags: TagCount[]
  history: { date: ISODate; true_skill: number }[]
  verified_progress: { eligible: boolean; criteria: VerifiedCriterion[] }
}

// ───────────────────────────── Bench / SOS ─────────────────────────────

export interface BenchStatus {
  is_active: boolean
  lat: number | null
  lng: number | null
  radius_km: number
  sports: Sport[]
  active_until: ISODateTime | null
  subs_made: number
}

/** PUT /bench/me */
export interface BenchUpdate {
  is_active: boolean
  lat?: number | null
  lng?: number | null
  radius_km?: number
  sports?: Sport[]
  duration_minutes?: number // 30..240, default 120
}

/** GET /bench/nearby */
export interface BenchNearby {
  count: number
  blips: { lat: number; lng: number }[] // fuzzed ±300m, max 30
}

export interface SOSRequest {
  id: UUID
  lobby: LobbySummary
  reason: 'dropout' | 'manual'
  spots_needed: number
  spots_filled: number
  discount_pct: number
  original_share_paise: number
  discounted_share_paise: number
  status: SOSStatus
  expires_at: ISODateTime
  distance_km: number | null
  created_at: ISODateTime
}

/** POST /bench/sos */
export interface CreateSOSRequest {
  lobby_id: UUID
  spots: number
}

/** POST /bench/sos/{id}/accept — reserves a discounted sub seat (5 min). Then pay via POST /lobbies/{id}/pay. */
export interface AcceptSOSResponse {
  lobby: LobbyDetail
}

// ───────────────────────────── Highlights ─────────────────────────────

export interface RecordingSummary {
  id: UUID
  status: RecordingStatus
  thumbnail_url: string | null
  ready_at: ISODateTime | null
}

export interface Clip {
  id: UUID
  recording_id: UUID
  owner: UserPublic
  title: string
  start_s: number
  end_s: number
  video_url: string // source footage; play window [start_s, end_s]
  thumbnail_url: string | null
  tags: string[]
  is_pinned: boolean
  likes_count: number
  liked_by_me: boolean
  views: number
  turf_name: string
  sport: Sport
  created_at: ISODateTime
}

export interface Recording {
  id: UUID
  lobby_id: UUID
  status: RecordingStatus
  video_url: string | null
  thumbnail_url: string | null
  duration_s: number | null
  ready_at: ISODateTime | null
  lobby: LobbySummary
  clips: Clip[]
}

/** POST /highlights/recordings/{id}/clips */
export interface CreateClipRequest {
  title: string
  start_s: number
  end_s: number // end - start in (1, 60]
  tags: string[]
}

// ───────────────────────────── Weather ─────────────────────────────

export interface WeatherAlert {
  id: UUID
  lobby_id: UUID
  booking_id: UUID
  lobby_title: string
  turf_name: string
  pitch_name: string
  start_at: ISODateTime
  precipitation_probability: number
  precipitation_mm: number
  summary: string // "Heavy rain likely (85%) during your 7 PM game"
  severity: WeatherSeverity
  status: WeatherAlertStatus
  is_host: boolean
  created_at: ISODateTime
}

export interface TransferAlternative {
  slot: Slot
  pitch: Pitch
  turf: TurfSummary
  distance_km: number
  price_diff_paise: number // new - old (can be negative)
  covered_by_pytch: boolean
}

export interface TransferRequest {
  slot_id: UUID
}

export interface RainCheckResponse {
  refunded_paise_total: number
  lobby: LobbyDetail
}

// ───────────────────────────── Notifications ─────────────────────────────

export interface Notification {
  id: UUID
  type: NotificationType
  title: string
  body: string
  data: Record<string, unknown> // e.g. { lobby_id, sos_id, alert_id, clip_id, url }
  read_at: ISODateTime | null
  created_at: ISODateTime
}

export interface NotificationPage extends Page<Notification> {
  unread_count: number
}

// ───────────────────────────── Gamification ─────────────────────────────

export interface Badge {
  code: string
  name: string
  description: string
  icon: string // emoji
  rarity: BadgeRarity
  earned_at: ISODateTime | null
}

export interface XpEvent {
  amount: number
  reason: string
  created_at: ISODateTime
}

/** GET /gamification/me */
export interface GamificationMe {
  xp: number
  level: number
  level_xp_start: number
  next_level_xp: number
  progress: number // 0..1 within current level
  streak_weeks: number
  weekly_xp: number
  badges: Badge[] // full catalog; earned_at null when locked
  recent_xp: XpEvent[]
}

export interface LeaderboardEntry {
  rank: number
  user: UserPublic
  value: number
}

/** GET /leaderboard */
export interface Leaderboard {
  metric: 'xp' | 'true_skill'
  period: 'week' | 'all'
  entries: LeaderboardEntry[]
  me: LeaderboardEntry | null
}

// ───────────────────────────── Realtime (WebSocket) ─────────────────────────────

export type ClientWsMessage =
  | { op: 'subscribe'; channel: string }
  | { op: 'unsubscribe'; channel: string }
  | { op: 'ping' }

export type LobbyUpdateReason =
  | 'member_joined'
  | 'member_paid'
  | 'member_left'
  | 'member_removed'
  | 'confirmed'
  | 'expired'
  | 'cancelled'
  | 'teams_balanced'
  | 'transferred'
  | 'sos'
  | 'completed'
  | 'weather'
  | 'recording'

export interface WsEventMap {
  'lobby.updated': { lobby_id: UUID; reason: LobbyUpdateReason; actor: UserPublic | null }
  'lobby.message': LobbyMessage
  'slot.updated': { slot_id: UUID; pitch_id: UUID; status: SlotStatus; held_until: ISODateTime | null }
  'notification.new': Notification
  'sos.new': SOSRequest
  'sos.closed': { sos_id: UUID }
  'wallet.updated': { balance_paise: number }
  'badge.earned': Badge
  'level.up': { level: number }
}

export type WsEventName = keyof WsEventMap

export type ServerWsMessage =
  | { type: 'hello'; user_id: UUID }
  | { type: 'pong' }
  | { type: 'error'; message: string }
  | {
      [K in WsEventName]: { type: 'event'; channel: string; event: K; data: WsEventMap[K]; ts: ISODateTime }
    }[WsEventName]
