/**
 * Typed endpoint functions — one per route in docs/API_CONTRACT.md.
 * Features build TanStack Query hooks on top of these (see `queryKeys`).
 */
import { http } from './client'
import type {
  AcceptSOSResponse,
  AppMeta,
  AuthTokens,
  BenchNearby,
  BenchStatus,
  BenchUpdate,
  Booking,
  Clip,
  CreateBookingRequest,
  CreateBookingResponse,
  CreateClipRequest,
  CreateSOSRequest,
  GamificationMe,
  HourWeather,
  ISODate,
  Leaderboard,
  LobbyDetail,
  LobbyMessage,
  LobbySummary,
  MockCompleteRequest,
  Notification,
  NotificationPage,
  OtpRequestResponse,
  Page,
  Payment,
  PaymentIntent,
  PendingRating,
  PlayerProfile,
  QuickMatchResponse,
  RainCheckResponse,
  RatingSummary,
  RazorpayVerifyRequest,
  Recording,
  SlotDetail,
  Slot,
  SOSRequest,
  Sport,
  SubmitRatingsRequest,
  SubmitRatingsResponse,
  TransferAlternative,
  TurfDetail,
  TurfSummary,
  UserMe,
  UserUpdate,
  UUID,
  Wallet,
  WeatherAlert,
} from '@/types/api'

export interface GeoQuery {
  lat?: number
  lng?: number
}

export interface TurfQuery extends GeoQuery {
  radius_km?: number
  sport?: Sport
  indoor?: boolean
  has_camera?: boolean
  q?: string
  sort?: 'distance' | 'price' | 'rating'
  limit?: number
  offset?: number
}

export interface LobbyQuery extends GeoQuery {
  sport?: Sport
  radius_km?: number
  date?: ISODate
  include_ineligible?: boolean
  limit?: number
  offset?: number
}

export const api = {
  meta: () => http.get<AppMeta>('/meta', undefined, { auth: false }),

  auth: {
    requestOtp: (phone: string) => http.post<OtpRequestResponse>('/auth/otp/request', { phone }, { auth: false }),
    verifyOtp: (phone: string, code: string) =>
      http.post<AuthTokens>('/auth/otp/verify', { phone, code }, { auth: false }),
  },

  users: {
    me: () => http.get<UserMe>('/users/me'),
    update: (body: UserUpdate) => http.patch<UserMe>('/users/me', body),
    myProfile: () => http.get<PlayerProfile>('/users/me/profile'),
    profile: (userId: UUID) => http.get<PlayerProfile>(`/users/${userId}`),
  },

  turfs: {
    list: (q: TurfQuery = {}) => http.get<Page<TurfSummary>>('/turfs', { ...q }),
    get: (slug: string, geo: GeoQuery = {}) => http.get<TurfDetail>(`/turfs/${slug}`, { ...geo }),
    slots: (pitchId: UUID, date: ISODate) => http.get<Slot[]>(`/pitches/${pitchId}/slots`, { date }),
    slot: (slotId: UUID) => http.get<SlotDetail>(`/slots/${slotId}`),
  },

  bookings: {
    create: (body: CreateBookingRequest) => http.post<CreateBookingResponse>('/bookings', body),
    get: (id: UUID) => http.get<Booking>(`/bookings/${id}`),
    cancel: (id: UUID) => http.post<LobbyDetail>(`/bookings/${id}/cancel`),
  },

  lobbies: {
    list: (q: LobbyQuery = {}) => http.get<Page<LobbySummary>>('/lobbies', { ...q }),
    quickMatch: (q: GeoQuery & { sport?: Sport }) => http.get<QuickMatchResponse>('/lobbies/quick-match', { ...q }),
    mine: (scope: 'upcoming' | 'past') => http.get<LobbySummary[]>('/lobbies/mine', { scope }),
    get: (id: UUID) => http.get<LobbyDetail>(`/lobbies/${id}`),
    byCode: (code: string) => http.get<LobbyDetail>(`/lobbies/code/${code.toUpperCase()}`),
    join: (id: UUID) => http.post<LobbyDetail>(`/lobbies/${id}/join`),
    leave: (id: UUID) => http.post<LobbyDetail>(`/lobbies/${id}/leave`),
    pay: (id: UUID, use_credits: boolean) => http.post<PaymentIntent>(`/lobbies/${id}/pay`, { use_credits }),
    coverRemaining: (id: UUID, use_credits: boolean) =>
      http.post<PaymentIntent>(`/lobbies/${id}/cover-remaining`, { use_credits }),
    balanceTeams: (id: UUID) => http.post<LobbyDetail>(`/lobbies/${id}/balance-teams`),
    removeMember: (id: UUID, userId: UUID) => http.delete<LobbyDetail>(`/lobbies/${id}/members/${userId}`),
    messages: (id: UUID, before?: string) => http.get<LobbyMessage[]>(`/lobbies/${id}/messages`, { before, limit: 50 }),
    sendMessage: (id: UUID, body: string) => http.post<LobbyMessage>(`/lobbies/${id}/messages`, { body }),
  },

  payments: {
    mine: () => http.get<Payment[]>('/payments/mine'),
    mockComplete: (id: UUID, outcome: MockCompleteRequest['outcome']) =>
      http.post<Payment>(`/payments/${id}/mock/complete`, { outcome }),
    verify: (id: UUID, body: RazorpayVerifyRequest) => http.post<Payment>(`/payments/${id}/verify`, body),
  },

  wallet: {
    get: () => http.get<Wallet>('/wallet'),
  },

  ratings: {
    pending: () => http.get<PendingRating[]>('/ratings/pending'),
    submit: (lobbyId: UUID, body: SubmitRatingsRequest) =>
      http.post<SubmitRatingsResponse>(`/ratings/lobbies/${lobbyId}`, body),
    me: () => http.get<RatingSummary>('/ratings/me'),
  },

  bench: {
    me: () => http.get<BenchStatus>('/bench/me'),
    update: (body: BenchUpdate) => http.put<BenchStatus>('/bench/me', body),
    nearby: (q: GeoQuery & { sport?: Sport; radius_km?: number }) => http.get<BenchNearby>('/bench/nearby', { ...q }),
    sos: () => http.get<SOSRequest[]>('/bench/sos'),
    createSos: (body: CreateSOSRequest) => http.post<SOSRequest>('/bench/sos', body),
    accept: (sosId: UUID) => http.post<AcceptSOSResponse>(`/bench/sos/${sosId}/accept`),
    decline: (sosId: UUID) => http.post<{ ok: boolean }>(`/bench/sos/${sosId}/decline`),
  },

  highlights: {
    recordings: () => http.get<Recording[]>('/highlights/recordings'),
    recording: (id: UUID) => http.get<Recording>(`/highlights/recordings/${id}`),
    createClip: (recordingId: UUID, body: CreateClipRequest) =>
      http.post<Clip>(`/highlights/recordings/${recordingId}/clips`, body),
    deleteClip: (id: UUID) => http.delete<void>(`/highlights/clips/${id}`),
    feed: (q: { sort?: 'trending' | 'recent'; sport?: Sport; limit?: number; offset?: number } = {}) =>
      http.get<Page<Clip>>('/highlights/feed', { ...q }),
    userClips: (userId: UUID) => http.get<Clip[]>(`/highlights/users/${userId}/clips`),
    like: (id: UUID) => http.post<Clip>(`/highlights/clips/${id}/like`),
    unlike: (id: UUID) => http.delete<Clip>(`/highlights/clips/${id}/like`),
    pin: (id: UUID) => http.post<Clip>(`/highlights/clips/${id}/pin`),
    unpin: (id: UUID) => http.delete<Clip>(`/highlights/clips/${id}/pin`),
    view: (id: UUID) => http.post<{ views: number }>(`/highlights/clips/${id}/view`),
  },

  weather: {
    forecast: (lat: number, lng: number, date: ISODate) =>
      http.get<HourWeather[]>('/weather/forecast', { lat, lng, date }, { auth: false }),
    alerts: () => http.get<WeatherAlert[]>('/weather/alerts'),
    alert: (id: UUID) => http.get<WeatherAlert>(`/weather/alerts/${id}`),
    alternatives: (id: UUID) => http.get<TransferAlternative[]>(`/weather/alerts/${id}/alternatives`),
    transfer: (id: UUID, slot_id: UUID) => http.post<LobbyDetail>(`/weather/alerts/${id}/transfer`, { slot_id }),
    rainCheck: (id: UUID) => http.post<RainCheckResponse>(`/weather/alerts/${id}/rain-check`),
    dismiss: (id: UUID) => http.post<WeatherAlert>(`/weather/alerts/${id}/dismiss`),
  },

  notifications: {
    list: (q: { unread_only?: boolean; limit?: number; offset?: number } = {}) =>
      http.get<NotificationPage>('/notifications', { ...q }),
    read: (id: UUID) => http.post<Notification>(`/notifications/${id}/read`),
    readAll: () => http.post<{ updated: number }>('/notifications/read-all'),
  },

  gamification: {
    me: () => http.get<GamificationMe>('/gamification/me'),
    leaderboard: (metric: Leaderboard['metric'], period: Leaderboard['period']) =>
      http.get<Leaderboard>('/leaderboard', { metric, period }),
  },

  dev: {
    fill: (lobbyId: UUID) => http.post<{ ok: boolean }>(`/dev/lobbies/${lobbyId}/fill`),
    complete: (lobbyId: UUID) => http.post<LobbyDetail>(`/dev/lobbies/${lobbyId}/complete`),
    dropout: (lobbyId: UUID) => http.post<LobbyDetail>(`/dev/lobbies/${lobbyId}/dropout`),
    storm: (lobbyId: UUID) => http.post<WeatherAlert>(`/dev/lobbies/${lobbyId}/storm`),
    sosNearMe: () => http.post<SOSRequest>('/dev/sos-near-me'),
  },
}
