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

export const useAuth = create<AuthState>()(
  persist(
    (set) => ({
      accessToken: null,
      refreshToken: null,
      user: null,
      setSession: (t) => set({ accessToken: t.access_token, refreshToken: t.refresh_token, user: t.user }),
      setTokens: (accessToken, refreshToken) => set({ accessToken, refreshToken }),
      setUser: (user) => set({ user }),
      patchUser: (patch) => set((s) => (s.user ? { user: { ...s.user, ...patch } } : s)),
      logout: () => set({ accessToken: null, refreshToken: null, user: null }),
    }),
    { name: 'pytch-auth' },
  ),
)

export const isAuthed = () => !!useAuth.getState().accessToken
