/**
 * Admin session state.
 *
 * SECURITY: the access token lives ONLY in this module's closure — never in localStorage,
 * sessionStorage, IndexedDB, cookies readable by JS, the zustand store (devtools) or React state.
 * The refresh token is an httpOnly SameSite=Strict cookie the page cannot read at all.
 * A reload therefore loses the access token by design; boot performs a silent cookie refresh.
 */
import { create } from 'zustand'
import type { AdminAuth, AdminMe, AdminPermission } from '@/types/admin'
import { queryClient } from './queryClient'

let accessToken: string | null = null
let accessExpiresAt = 0

export const getAccessToken = () => accessToken
export const accessTokenExpiresAt = () => accessExpiresAt

/**
 * booting  – silent refresh in flight
 * anon     – no session → login screen
 * pending  – token issued but the sign-in flow isn't finished (recovery codes / forced password change)
 * authed   – full console access
 */
export type SessionStatus = 'booting' | 'anon' | 'pending' | 'authed'

interface SessionState {
  status: SessionStatus
  me: AdminMe | null
  /** Explanation shown on the login screen after an automatic sign-out. */
  notice: string | null
  /** Environment banner from GET /meta (demo_mode). */
  demo: boolean
}

export const useSession = create<SessionState>()(() => ({ status: 'booting', me: null, notice: null, demo: false }))

/** Store a fresh token pair result. `complete=false` keeps the login flow on screen. */
export function applyAuth(auth: AdminAuth, complete = true) {
  accessToken = auth.access_token
  accessExpiresAt = Date.now() + Math.max(30, auth.expires_in) * 1000
  const blocked = auth.admin.must_change_password || !auth.admin.mfa_enrolled
  useSession.setState({
    me: auth.admin,
    status: complete && !blocked ? 'authed' : 'pending',
    ...(complete && !blocked ? { notice: null } : {}),
  })
}

export function setMe(me: AdminMe) {
  useSession.setState({ me })
}

export function completeSignIn() {
  if (!accessToken) return
  useSession.setState({ status: 'authed', notice: null })
}

/** Forget everything in memory (token, profile, every cached query). */
export function wipeSession(notice: string | null = null) {
  accessToken = null
  accessExpiresAt = 0
  queryClient.cancelQueries()
  queryClient.clear()
  useSession.setState({ status: 'anon', me: null, notice })
}

export const hasPerm = (me: AdminMe | null | undefined, p: AdminPermission) => !!me?.permissions.includes(p)

/** `const can = useCan(); can('payments.refund')` — UI hint only; the server enforces every permission. */
export function useCan() {
  const me = useSession((s) => s.me)
  return (p: AdminPermission) => hasPerm(me, p)
}
