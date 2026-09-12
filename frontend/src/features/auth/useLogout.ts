import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useState } from 'react'
import { useNavigate } from 'react-router'
import { api } from '@/lib/api/endpoints'
import { realtime } from '@/lib/realtime'
import { setLogoutTarget, useAuth } from '@/stores/auth'
import { clearHomeLocation } from '@/stores/location'

/** Never keep someone staring at a spinner because the network is down — the local sign-out happens regardless. */
const SERVER_LOGOUT_BUDGET_MS = 2500

/**
 * The one way to sign out of the player app:
 * 1. revoke the session server-side (best effort, with the current access token) so a copied token dies too,
 * 2. close the WebSocket, 3. leave the protected page (to `to`, not `/login?next=<this page>`),
 * 4. wipe the auth store + query cache.
 */
export function useLogout(to = '/') {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [pending, setPending] = useState(false)

  const logout = useCallback(async () => {
    if (pending) return
    setPending(true)
    const token = useAuth.getState().accessToken
    if (token) {
      const revoke = api.auth.logout(token).catch(() => undefined) // expired / offline: nothing more we can do
      await Promise.race([revoke, new Promise((r) => setTimeout(r, SERVER_LOGOUT_BUDGET_MS))])
    }
    realtime.disconnect()
    // The guards read this when the token disappears mid-transition, so they follow us instead of
    // bouncing to /login?next=… (the next person to sign in lands on /app).
    setLogoutTarget(to)
    navigate(to, { replace: true })
    useAuth.getState().logout()
    clearHomeLocation()
    qc.clear()
    setPending(false)
  }, [pending, to, navigate, qc])

  return { logout, pending }
}
