/**
 * Query keys for the partner portal. Everything lives under ['partner', …] so switching the acting
 * provider or logging out can drop the whole partner cache in one call.
 */
import type { UUID } from '@/types/api'
import type { BookingsQuery } from './endpoints'

export const pk = {
  all: ['partner'] as const,
  me: ['partner', 'me'] as const,
  provider: ['partner', 'provider'] as const,
  dashboard: (turfId: UUID | null) => ['partner', 'dashboard', turfId ?? 'all'] as const,
  calendarAll: ['partner', 'calendar'] as const,
  calendar: (turfId: UUID, from: string, days: number) => ['partner', 'calendar', turfId, from, days] as const,
  bookingsAll: ['partner', 'bookings'] as const,
  bookings: (q: BookingsQuery) => ['partner', 'bookings', q] as const,
  venues: ['partner', 'venues'] as const,
  earnings: (from: string, to: string) => ['partner', 'earnings', from, to] as const,
  settlements: ['partner', 'settlements'] as const,
  settlement: (id: UUID) => ['partner', 'settlements', id] as const,
  team: ['partner', 'team'] as const,
  channels: ['partner', 'channels'] as const,
  mirror: (status: 'open' | 'done') => ['partner', 'mirror', status] as const,
  mirrorAll: ['partner', 'mirror'] as const,
  conflicts: (status?: string) => ['partner', 'channels', 'conflicts', status ?? 'all'] as const,
}
