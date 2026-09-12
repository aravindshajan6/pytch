/**
 * Partner portal endpoints — docs/PORTALS_CONTRACT.md §Partner & §Channels.
 * Shapes: src/types/partner.ts. All paths are relative to /api/v1/partner.
 */
import type { ISODate, Pitch, UUID } from '@/types/api'
import type {
  ApiKeyOut,
  BlockSource,
  BulkBlockRequest,
  MirrorTask,
  BulkBlockResult,
  CalendarView,
  ChannelsOverview,
  CreateBlockRequest,
  CreatedApiKey,
  CreatedWebhook,
  CreateFeedRequest,
  ExportOut,
  FeedOut,
  InviteMemberRequest,
  OtpRequestResponse,
  PartnerAuth,
  PartnerBookingsPage,
  PartnerDashboard,
  PartnerEarnings,
  PartnerMe,
  PartnerMemberOut,
  PartnerMembership,
  PartnerRole,
  PartnerVenue,
  PitchInput,
  ProviderApplication,
  ProviderOut,
  ProviderUpdate,
  SettlementDetail,
  SettlementOut,
  SlotBlockOut,
  SyncConflictOut,
  UpdateBlockRequest,
  UpdatePartnerSelf,
  VenueUpdate,
  WebhookEvent,
} from '@/types/partner'
import { partnerHttp as http } from './client'

export interface BookingsQuery {
  turf_id?: UUID | null
  status?: string | null
  source?: BlockSource | 'pytch' | null
  from?: ISODate | null
  to?: ISODate | null
  q?: string | null
  include_closures?: boolean // maintenance / plain blocks are not bookings: hidden unless asked for
  limit?: number
  offset?: number
}

export type ConflictResolution = 'kept_pytch' | 'moved_external' | 'ignored'

export const partnerApi = {
  auth: {
    requestOtp: (phone: string) => http.post<OtpRequestResponse>('/auth/otp/request', { phone }, { auth: false }),
    verifyOtp: (phone: string, code: string) => http.post<PartnerAuth>('/auth/otp/verify', { phone, code }, { auth: false }),
    logout: () => http.post<{ ok: boolean }>('/auth/logout'),
  },

  me: () => http.get<PartnerMe>('/me'),
  updateMe: (body: UpdatePartnerSelf) => http.patch<PartnerMe>('/me', body),
  apply: (body: ProviderApplication) => http.post<PartnerMembership>('/applications', body),
  provider: () => http.get<ProviderOut>('/provider'),
  updateProvider: (body: ProviderUpdate) => http.patch<ProviderOut>('/provider', body),

  dashboard: (turfId?: UUID | null) => http.get<PartnerDashboard>('/dashboard', { turf_id: turfId }),
  calendar: (turfId: UUID, from: ISODate, days: number) => http.get<CalendarView>('/calendar', { turf_id: turfId, from, days }),

  blocks: {
    create: (body: CreateBlockRequest) => http.post<SlotBlockOut>('/blocks', body),
    update: (id: UUID, body: UpdateBlockRequest) => http.patch<SlotBlockOut>(`/blocks/${id}`, body),
    remove: (id: UUID) => http.delete<void>(`/blocks/${id}`),
    bulk: (body: BulkBlockRequest) => http.post<BulkBlockResult>('/blocks/bulk', body),
  },

  bookings: {
    list: (q: BookingsQuery) => http.get<PartnerBookingsPage>('/bookings', { ...q }),
    exportCsv: (q: BookingsQuery, filename: string) => http.download('/bookings/export.csv', { ...q, limit: undefined, offset: undefined }, filename),
  },

  venues: {
    list: () => http.get<PartnerVenue[]>('/venues'),
    update: (turfId: UUID, body: VenueUpdate) => http.patch<PartnerVenue>(`/venues/${turfId}`, body),
    addPitch: (turfId: UUID, body: PitchInput) => http.post<Pitch>(`/venues/${turfId}/pitches`, body),
    updatePitch: (pitchId: UUID, body: Partial<PitchInput>) => http.patch<Pitch>(`/pitches/${pitchId}`, body),
  },

  earnings: (from: ISODate, to: ISODate) => http.get<PartnerEarnings>('/earnings', { from, to }),
  settlements: {
    list: () => http.get<SettlementOut[]>('/settlements'),
    get: (id: UUID) => http.get<SettlementDetail>(`/settlements/${id}`),
  },

  team: {
    list: () => http.get<PartnerMemberOut[]>('/team'),
    invite: (body: InviteMemberRequest) => http.post<PartnerMemberOut>('/team', body),
    update: (id: UUID, body: { role?: Exclude<PartnerRole, 'owner'>; turf_ids?: UUID[] | null; status?: 'active' | 'removed' }) =>
      http.patch<PartnerMemberOut>(`/team/${id}`, body),
    remove: (id: UUID) => http.delete<void>(`/team/${id}`),
  },

  mirror: {
    list: (status: 'open' | 'done' = 'open') => http.get<MirrorTask[]>('/mirror-tasks', { status }),
    update: (id: UUID, done: boolean) => http.patch<MirrorTask>(`/mirror-tasks/${id}`, { done }),
  },
  channels: {
    overview: () => http.get<ChannelsOverview>('/channels'),
    createFeed: (body: CreateFeedRequest) => http.post<FeedOut>('/channels/feeds', body),
    updateFeed: (id: UUID, body: { name?: string; is_active?: boolean }) => http.patch<FeedOut>(`/channels/feeds/${id}`, body),
    deleteFeed: (id: UUID) => http.delete<void>(`/channels/feeds/${id}`),
    syncFeed: (id: UUID) => http.post<FeedOut>(`/channels/feeds/${id}/sync`),
    rotateExport: (pitchId: UUID) => http.post<ExportOut>(`/channels/exports/${pitchId}`),
    disableExport: (pitchId: UUID) => http.delete<void>(`/channels/exports/${pitchId}`),
    createApiKey: (name: string, scopes: ApiKeyOut['scopes']) => http.post<CreatedApiKey>('/channels/api-keys', { name, scopes }),
    revokeApiKey: (id: UUID) => http.delete<void>(`/channels/api-keys/${id}`),
    createWebhook: (url: string, events: WebhookEvent[]) => http.post<CreatedWebhook>('/channels/webhooks', { url, events }),
    deleteWebhook: (id: UUID) => http.delete<void>(`/channels/webhooks/${id}`),
    testWebhook: (id: UUID) => http.post<{ status_code: number | null; ok: boolean }>(`/channels/webhooks/${id}/test`),
    conflicts: (status?: SyncConflictOut['status']) => http.get<SyncConflictOut[]>('/channels/conflicts', { status }),
    resolveConflict: (id: UUID, resolution: ConflictResolution, note?: string | null) =>
      http.post<SyncConflictOut>(`/channels/conflicts/${id}/resolve`, { resolution, note: note || null }),
  },
}
