import { create } from 'zustand'
import { isApiError } from '@/lib/api/http'

/** A suspended/banned player's standing, from a `403 ACCOUNT_SUSPENDED` (`details.reason`, `details.until`). */
export interface Suspension {
  message: string // "This account is suspended" | "This account is banned"
  reason: string | null
  until: string | null // ISO; null = indefinite (or banned)
}

interface SuspensionState {
  suspension: Suspension | null
  set: (s: Suspension) => void
  clear: () => void
}

/** In-memory on purpose: after a reload the player is simply signed out; the next login attempt tells them again. */
export const useSuspension = create<SuspensionState>()((set) => ({
  suspension: null,
  set: (suspension) => set({ suspension }),
  clear: () => set({ suspension: null }),
}))

export function suspensionFrom(error: unknown): Suspension | null {
  if (!isApiError(error, 'ACCOUNT_SUSPENDED')) return null
  const d = (error.details ?? {}) as { reason?: string | null; until?: string | null }
  return { message: error.message, reason: d.reason ?? null, until: d.until ?? null }
}
