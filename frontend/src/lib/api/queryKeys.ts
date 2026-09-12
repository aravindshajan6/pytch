/**
 * Centralised TanStack Query keys. Always build keys through this object so
 * realtime invalidation (RealtimeProvider) and features stay in sync.
 */
import type { UUID } from '@/types/api'
import type { LobbyQuery, TurfQuery } from './endpoints'

export const qk = {
  meta: ['meta'] as const,
  me: ['me'] as const,
  myProfile: ['profile', 'me'] as const,
  profile: (userId: UUID) => ['profile', userId] as const,

  turfs: (q: TurfQuery) => ['turfs', q] as const,
  turf: (slug: string) => ['turf', slug] as const,
  slots: (pitchId: UUID, date: string) => ['slots', pitchId, date] as const,
  slotsAll: ['slots'] as const,
  slot: (slotId: UUID) => ['slot', slotId] as const,

  lobbies: (q: LobbyQuery) => ['lobbies', 'feed', q] as const,
  lobbiesAll: ['lobbies'] as const,
  quickMatch: (sport?: string) => ['lobbies', 'quick', sport ?? 'any'] as const,
  myLobbies: (scope: 'upcoming' | 'past') => ['lobbies', 'mine', scope] as const,
  lobby: (id: UUID) => ['lobby', id] as const,
  lobbyByCode: (code: string) => ['lobby', 'code', code] as const,
  lobbyMessages: (id: UUID) => ['lobby', id, 'messages'] as const,

  wallet: ['wallet'] as const,
  payments: ['payments'] as const,

  pendingRatings: ['ratings', 'pending'] as const,
  ratingSummary: ['ratings', 'me'] as const,

  bench: ['bench', 'me'] as const,
  benchNearby: (lat: number, lng: number, sport?: string) => ['bench', 'nearby', lat, lng, sport] as const,
  sos: ['bench', 'sos'] as const,

  recordings: ['highlights', 'recordings'] as const,
  recording: (id: UUID) => ['highlights', 'recording', id] as const,
  highlightFeed: (sort: string, sport?: string) => ['highlights', 'feed', sort, sport] as const,
  userClips: (userId: UUID) => ['highlights', 'user', userId] as const,

  forecast: (lat: number, lng: number, date: string) => ['weather', 'forecast', lat, lng, date] as const,
  weatherAlerts: ['weather', 'alerts'] as const,
  weatherAlert: (id: UUID) => ['weather', 'alert', id] as const,
  alternatives: (id: UUID) => ['weather', 'alternatives', id] as const,

  notifications: ['notifications'] as const,

  gamification: ['gamification', 'me'] as const,
  leaderboard: (metric: string, period: string) => ['leaderboard', metric, period] as const,
}
