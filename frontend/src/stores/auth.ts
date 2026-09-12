import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { AuthTokens, UserMe } from '@/types/api'

interface AuthState {
  accessToken: string | null
  refreshToken: string | null
  user: UserMe | null
  setSession: (tokens: AuthTokens) => void
  setTokens: (access: string, refresh: string) => void
  setUser: (user: UserMe) => void
  patchUser: (patch: Partial<UserMe>) => void
  logout: () => void
}

/**
 * Where the auth guards send the user after an *intentional* logout (set by `useLogout`), instead of
 * `/login?next=<page they were on>` — the next person to log in on this device should land on /app,
 * not on the previous user's page. Cleared when a new session starts. In-memory only: a reload or an
 * expired session (refresh rejected) still gets the regular `?next=` bounce.
 */
let logoutTarget: string | null = null
export const setLogoutTarget = (to: string | null) => void (logoutTarget = to)
export const getLogoutTarget = () => logoutTarget

export const useAuth = create<AuthState>()(
  persist(
    (set) => ({
      accessToken: null,
      refreshToken: null,
      user: null,
      setSession: (t) => {
        logoutTarget = null
        set({ accessToken: t.access_token, refreshToken: t.refresh_token, user: t.user })
      },
      setTokens: (accessToken, refreshToken) => set({ accessToken, refreshToken }),
      setUser: (user) => set({ user }),
      patchUser: (patch) => set((s) => (s.user ? { user: { ...s.user, ...patch } } : s)),
      logout: () => set({ accessToken: null, refreshToken: null, user: null }),
    }),
    { name: 'pytch-auth' },
  ),
)

export const isAuthed = () => !!useAuth.getState().accessToken
