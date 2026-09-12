/** Typed admin endpoints — docs/PORTALS_CONTRACT.md §Admin. All paths are relative to /api/v1. */
import type { AppMeta, Page } from '@/types/api'
import type {
  AdminAccountOut,
  AdminAuth,
  AdminBookingRow,
  AdminCancelBooking,
  AdminCreateVenue,
  AdminLoginResponse,
  AdminMe,
  AdminPaymentRow,
  AdminProviderDetail,
  AdminProviderRow,
  AdminRole,
  AdminSessionOut,
  AdminSettlementDetail,
  AdminSettlementRow,
  AdminUserDetail,
  AdminUserRow,
  AdminVenueRow,
  AdminVenueUpdate,
  AnalyticsOverview,
  AnalyticsRange,
  ApprovalOut,
  AuditPage,
  BroadcastInput,
  BroadcastOut,
  ChainVerification,
  CohortTable,
  CouponInput,
  CouponOut,
  CouponRedemptionOut,
  CreatedAdmin,
  GenerateSettlements,
  Heatmap,
  MfaEnrollStart,
  PaySettlement,
  ProviderAdminUpdate,
  ProviderReview,
  ReconciliationDay,
  RefundRequest,
  ResetPasswordResult,
  SetUserStatus,
  SettingOut,
  SportCatalogOut,
  SportMix,
  StepUpResponse,
  SystemHealth,
  TimeSeries,
  VenueAnalyticsRow,
  WalletAdjust,
} from '@/types/admin'
import { http, postStepUp } from './http'
import type { AdminBookingDetail, AdminPaymentDetail, BroadcastPreview, WebhookEventRow } from './types'

type Q = Record<string, string | number | boolean | null | undefined>

/** Accept either a bare array or a Page<T> from list endpoints. */
export function toPage<T>(x: T[] | Page<T> | { items: T[] } | undefined, limit = 0, offset = 0): Page<T> {
  if (!x) return { items: [], total: 0, limit, offset }
  if (Array.isArray(x)) return { items: x, total: x.length, limit: limit || x.length, offset }
  const p = x as Partial<Page<T>> & { items: T[] }
  return { items: p.items ?? [], total: p.total ?? p.items?.length ?? 0, limit: p.limit ?? limit, offset: p.offset ?? offset }
}
const list = <T>(path: string, q?: Q) => http.get<T[] | Page<T>>(path, q).then((x) => toPage<T>(x, Number(q?.limit ?? 0), Number(q?.offset ?? 0)))
const items = <T>(path: string, q?: Q) => list<T>(path, q).then((p) => p.items)

export type Metric = 'gmv' | 'bookings' | 'new_players' | 'net_revenue' | 'active_players'

export const adminApi = {
  meta: () => http.raw.get<AppMeta>('/meta', undefined, { auth: false }),

  auth: {
    login: (email: string, password: string) => http.anon<AdminLoginResponse>('/admin/auth/login', { email, password }),
    enrollStart: (mfa_token: string) => http.anon<MfaEnrollStart>('/admin/auth/mfa/enroll/start', { mfa_token }),
    enrollConfirm: (mfa_token: string, code: string) => http.anon<AdminAuth>('/admin/auth/mfa/enroll/confirm', { mfa_token, code }),
    verify: (mfa_token: string, body: { code?: string; recovery_code?: string }) =>
      http.anon<AdminAuth>('/admin/auth/mfa/verify', { mfa_token, ...body }),
    stepUp: (code: string) => postStepUp<StepUpResponse>(code),
    me: () => http.get<AdminMe>('/admin/auth/me'),
    changePassword: (current_password: string, new_password: string) =>
      http.post<{ ok: boolean }>('/admin/auth/password', { current_password, new_password }),
    sessions: () => http.get<AdminSessionOut[]>('/admin/auth/sessions'),
    revokeSession: (id: string) => http.delete<void>(`/admin/auth/sessions/${id}`),
  },

  analytics: {
    overview: (range: AnalyticsRange) => http.get<AnalyticsOverview>('/admin/analytics/overview', { range }),
    timeseries: (metric: Metric, range: AnalyticsRange, granularity: 'day' | 'week' = 'day') =>
      http.get<TimeSeries>('/admin/analytics/timeseries', { metric, range, granularity }),
    cohorts: () => http.get<CohortTable>('/admin/analytics/cohorts'),
    venues: (range: AnalyticsRange) => http.get<VenueAnalyticsRow[]>('/admin/analytics/venues', { range }),
    heatmap: (range: AnalyticsRange) => http.get<Heatmap>('/admin/analytics/heatmap', { range }),
    sports: (range: AnalyticsRange) => http.get<SportMix>('/admin/analytics/sports', { range }),
  },

  users: {
    list: (q: Q) => list<AdminUserRow>('/admin/users', q),
    get: (id: string) => http.get<AdminUserDetail>(`/admin/users/${id}`),
    setStatus: (id: string, body: SetUserStatus) => http.post<AdminUserDetail>(`/admin/users/${id}/status`, body),
    wallet: (id: string, body: WalletAdjust) => http.post<unknown>(`/admin/users/${id}/wallet`, body),
    logoutAll: (id: string) => http.post<unknown>(`/admin/users/${id}/logout-all`),
    /** PII export — data.export + step-up; audited server-side. */
    exportCsv: (q: Q, filename: string) => http.download('/admin/users/export.csv', q, filename),
  },

  providers: {
    list: (q: Q) => items<AdminProviderRow>('/admin/providers', q),
    get: (id: string) => http.get<AdminProviderDetail>(`/admin/providers/${id}`),
    review: (id: string, body: ProviderReview) => http.post<AdminProviderDetail>(`/admin/providers/${id}/review`, body),
    setStatus: (id: string, body: { status: 'approved' | 'suspended'; reason: string }) =>
      http.post<AdminProviderDetail>(`/admin/providers/${id}/status`, body),
    update: (id: string, body: ProviderAdminUpdate) => http.patch<AdminProviderDetail>(`/admin/providers/${id}`, body),
    /** 🛡 the provider's complete venue list — its venues missing from `turf_ids` are unassigned */
    assignTurfs: (id: string, turf_ids: string[]) => http.post<AdminProviderDetail>(`/admin/providers/${id}/turfs`, { turf_ids }),
    /** 🛡 onboard a venue (turf + pitches + 14 days of slots), usually from an application entry */
    createVenue: (id: string, body: AdminCreateVenue) => http.post<AdminProviderDetail>(`/admin/providers/${id}/venues`, body),
  },

  venues: {
    list: (q: Q) => items<AdminVenueRow>('/admin/venues', q),
    update: (id: string, body: AdminVenueUpdate) => http.patch<AdminVenueRow>(`/admin/venues/${id}`, body),
    updatePitch: (id: string, body: { is_active: boolean }) => http.patch<unknown>(`/admin/pitches/${id}`, body),
  },

  bookings: {
    list: (q: Q) => list<AdminBookingRow>('/admin/bookings', q),
    get: (id: string) => http.get<AdminBookingDetail>(`/admin/bookings/${id}`),
    cancel: (id: string, body: AdminCancelBooking) => http.post<unknown>(`/admin/bookings/${id}/cancel`, body),
  },

  payments: {
    list: (q: Q) => list<AdminPaymentRow>('/admin/payments', q),
    get: (id: string) => http.get<AdminPaymentDetail>(`/admin/payments/${id}`),
    refund: (id: string, body: RefundRequest) => http.post<unknown>(`/admin/payments/${id}/refund`, body),
    webhookEvents: (q: Q) => list<WebhookEventRow>('/admin/payments/webhook-events', q),
    reconciliation: (date: string) => http.get<ReconciliationDay>('/admin/payments/reconciliation', { date }),
  },

  approvals: {
    list: (status: string) => items<ApprovalOut>('/admin/approvals', { status }),
    approve: (id: string, note?: string) => http.post<ApprovalOut>(`/admin/approvals/${id}/approve`, { note: note || null }),
    reject: (id: string, note: string) => http.post<ApprovalOut>(`/admin/approvals/${id}/reject`, { note }),
  },

  settlements: {
    list: (q: Q) => items<AdminSettlementRow>('/admin/settlements', q),
    generate: (body: GenerateSettlements) => http.post<AdminSettlementRow[] | { created?: number }>('/admin/settlements/generate', body),
    get: (id: string) => http.get<AdminSettlementDetail>(`/admin/settlements/${id}`),
    approve: (id: string) => http.post<AdminSettlementRow>(`/admin/settlements/${id}/approve`),
    pay: (id: string, body: PaySettlement) => http.post<AdminSettlementRow>(`/admin/settlements/${id}/pay`, body),
    fail: (id: string, reason: string) => http.post<AdminSettlementRow>(`/admin/settlements/${id}/fail`, { reason }),
    exportCsv: (id: string, filename: string) => http.download(`/admin/settlements/${id}/export.csv`, undefined, filename),
  },

  coupons: {
    list: (q: Q) => items<CouponOut>('/admin/coupons', q),
    create: (body: CouponInput) => http.post<CouponOut>('/admin/coupons', body),
    update: (id: string, body: Partial<CouponInput>) => http.patch<CouponOut>(`/admin/coupons/${id}`, body),
    disable: (id: string) => http.post<CouponOut>(`/admin/coupons/${id}/disable`),
    redemptions: (id: string) => items<CouponRedemptionOut>(`/admin/coupons/${id}/redemptions`),
  },

  catalog: {
    sports: () => items<SportCatalogOut>('/admin/catalog/sports'),
    put: (key: string, body: Omit<SportCatalogOut, 'key'>) => http.put<SportCatalogOut>(`/admin/catalog/sports/${encodeURIComponent(key)}`, body),
  },

  broadcasts: {
    list: () => items<BroadcastOut>('/admin/broadcasts'),
    preview: (segment: BroadcastInput['segment']) => http.post<BroadcastPreview>('/admin/broadcasts/preview', { segment }),
    send: (body: BroadcastInput) => http.post<BroadcastOut>('/admin/broadcasts', body),
  },

  settings: {
    list: () => items<SettingOut>('/admin/settings'),
    // body schema is strict ({value} only) — the operator's reason travels as a header for the audit trail
    put: (key: string, value: SettingOut['value'], reason: string) =>
      http.send<SettingOut>('PUT', `/admin/settings/${encodeURIComponent(key)}`, { value }, { 'X-Admin-Reason': encodeURIComponent(reason) }),
  },

  audit: {
    list: (q: Q) => http.get<AuditPage>('/admin/audit', q).then((x) => toPage(x, Number(q.limit ?? 0), Number(q.offset ?? 0))),
    targetTypes: () => http.get<string[]>('/admin/audit/target-types'),
    verify: () => http.get<ChainVerification>('/admin/audit/verify'),
  },

  team: {
    list: () => items<AdminAccountOut>('/admin/team'),
    create: (body: { email: string; name: string; role: AdminRole }) => http.post<CreatedAdmin>('/admin/team', body),
    update: (id: string, body: { role?: AdminRole; is_active?: boolean }) => http.patch<AdminAccountOut>(`/admin/team/${id}`, body),
    resetMfa: (id: string) => http.post<unknown>(`/admin/team/${id}/reset-mfa`),
    /** 🛡 super admin only — temporary password shown once; their sessions are revoked */
    resetPassword: (id: string) => http.post<ResetPasswordResult>(`/admin/team/${id}/reset-password`),
    revokeSessions: (id: string) => http.post<unknown>(`/admin/team/${id}/revoke-sessions`),
  },

  system: {
    health: () => http.get<SystemHealth>('/admin/system/health'),
  },
}

/** Query-key roots — everything under ['admin'] is wiped on logout. */
export const qk = {
  me: ['admin', 'me'] as const,
  meta: ['admin', 'meta'] as const,
  health: ['admin', 'system', 'health'] as const,
  approvals: (status: string) => ['admin', 'approvals', status] as const,
}
