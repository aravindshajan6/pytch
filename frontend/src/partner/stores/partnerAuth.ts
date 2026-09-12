import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { PartnerAuth, PartnerMe, PartnerMembership, PartnerUser } from '@/types/partner'

/**
 * Partner-portal session. Persisted under its own key — completely separate from the player
 * session (`pytch-auth`), so a venue owner can be logged into both apps with different tokens.
 */
interface PartnerAuthState {
  accessToken: string | null
  refreshToken: string | null
  user: PartnerUser | null
  memberships: PartnerMembership[]
  /** Acting provider (sent as `X-Provider-Id`). */
  providerId: string | null
  /** The user pressed "Log out" (vs. an expired session): the login page then starts clean, without `?next=`. */
  signedOut: boolean
  setSession: (auth: PartnerAuth) => void
  setMe: (me: PartnerMe) => void
  setProvider: (id: string | null) => void
  logout: (explicit?: boolean) => void
}

function pickProvider(current: string | null, memberships: PartnerMembership[]): string | null {
  if (current && memberships.some((m) => m.provider_id === current)) return current
  return memberships.length === 1 ? memberships[0]!.provider_id : null
}

export const usePartnerAuth = create<PartnerAuthState>()(
  persist(
    (set) => ({
      accessToken: null,
      refreshToken: null,
      user: null,
      memberships: [],
      providerId: null,
      signedOut: false,
      setSession: (a) =>
        set((s) => ({
          accessToken: a.access_token,
          refreshToken: a.refresh_token,
          user: a.user,
          memberships: a.memberships,
          providerId: pickProvider(s.providerId, a.memberships),
          signedOut: false,
        })),
      setMe: (me) => set((s) => ({ user: me.user, memberships: me.memberships, providerId: pickProvider(s.providerId, me.memberships) })),
      setProvider: (providerId) => set({ providerId }),
      logout: (explicit = false) =>
        set({ accessToken: null, refreshToken: null, user: null, memberships: [], providerId: null, signedOut: explicit }),
    }),
    { name: 'pytch-partner-auth' },
  ),
)

/** The membership for the acting provider (null while none is chosen). */
export function useMembership(): PartnerMembership | null {
  return usePartnerAuth((s) => s.memberships.find((m) => m.provider_id === s.providerId) ?? null)
}

const RANK = { staff: 1, manager: 2, owner: 3 } as const

/** Role check mirroring the backend (owner > manager > staff). */
export function useCan(min: keyof typeof RANK): boolean {
  const m = useMembership()
  return !!m && RANK[m.role] >= RANK[min]
}

// ───────────── UI prefs (per device) ─────────────

interface PartnerUiState {
  /** Venue filter per provider (null = all venues). */
  turfByProvider: Record<string, string | null>
  calendarView: 'day' | 'week'
  setTurf: (providerId: string, turfId: string | null) => void
  setCalendarView: (v: 'day' | 'week') => void
}

export const usePartnerUi = create<PartnerUiState>()(
  persist(
    (set) => ({
      turfByProvider: {},
      calendarView: 'day',
      setTurf: (providerId, turfId) => set((s) => ({ turfByProvider: { ...s.turfByProvider, [providerId]: turfId } })),
      setCalendarView: (calendarView) => set({ calendarView }),
    }),
    { name: 'pytch-partner-ui' },
  ),
)
