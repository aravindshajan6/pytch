/** Player (audience "app") HTTP client. Shared primitives live in ./http.ts and are re-exported here. */
import { useAuth } from '@/stores/auth'
import { suspensionFrom, useSuspension } from '@/stores/suspension'
import type { AuthTokens } from '@/types/api'
import { buildUrl, createHttpClient, makeTokenRefresher, type ApiError } from './http'

export * from './http'

/** A suspended account: sign out locally and let `SuspendedScreen` explain why (instead of a bare /login bounce). */
function noteSuspension(error?: ApiError) {
  const s = suspensionFrom(error)
  if (!s) return false
  useSuspension.getState().set(s)
  useAuth.getState().logout()
  return true
}

const refreshPlayer = makeTokenRefresher(useAuth, {
  lock: 'pytch-app-refresh',
  url: buildUrl('/auth/refresh'),
  onSuccess: (auth) => useAuth.getState().setSession(auth as AuthTokens),
  onRejected: (error) => {
    if (!noteSuspension(error)) useAuth.getState().logout()
  },
})

export const http = createHttpClient({
  getAccessToken: () => useAuth.getState().accessToken,
  refresh: refreshPlayer,
  onApiError: (error) => void noteSuspension(error),
})
