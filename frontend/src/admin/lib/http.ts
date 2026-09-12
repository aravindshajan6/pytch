/**
 * Admin HTTP client (audience "admin").
 *
 * · Access token: in-memory only (see session.ts) → `Authorization: Bearer`.
 * · Refresh: httpOnly SameSite=Strict cookie `pytch_admin_rt` + double-submit CSRF header read from
 *   the `pytch_admin_csrf` cookie. Refreshes are serialised across tabs with the Web Locks API so two
 *   tabs never present the same (rotating) refresh token — which the server treats as token theft.
 * · STEP_UP_REQUIRED → opens the TOTP prompt, then transparently retries the request once.
 * · 202 APPROVAL_REQUIRED → toast "Sent for second-admin approval" (maker–checker).
 */
import { toast } from 'sonner'
import { ApiError, buildUrl, createHttpClient, isApiError, type Query } from '@/lib/api/http'
import type { AdminAuth } from '@/types/admin'
import { postChannel } from './channel'
import { SESSION_ENDED } from './errors'
import { navigateTo } from './nav'
import { queryClient } from './queryClient'
import { applyAuth, getAccessToken, useSession, wipeSession } from './session'
import { requestStepUp, resetStepUp } from './stepup'

const CSRF_COOKIE = 'pytch_admin_csrf'
const REFRESH_LOCK = 'pytch-admin-refresh'

export function readCookie(name: string): string | null {
  for (const part of document.cookie.split(';')) {
    const [k, ...v] = part.trim().split('=')
    if (k === name) return decodeURIComponent(v.join('='))
  }
  return null
}

const csrfHeaders = (): Record<string, string> => {
  const t = readCookie(CSRF_COOKIE)
  return t ? { 'X-CSRF-Token': t } : {}
}

function withRefreshLock<T>(fn: () => Promise<T>): Promise<T> {
  const locks = (navigator as Navigator & { locks?: LockManager }).locks
  return locks?.request ? (locks.request(REFRESH_LOCK, fn) as Promise<T>) : fn()
}

/** Exchange the refresh cookie for a fresh in-memory access token (rotates the cookie). */
export function refreshSession(complete = true): Promise<AdminAuth | null> {
  // no CSRF cookie ⇒ no session cookie pair was ever issued (same lifetime) — don't even ask
  if (!readCookie(CSRF_COOKIE)) return Promise.resolve(null)
  return withRefreshLock(async () => {
    try {
      const res = await fetch(buildUrl('/admin/auth/refresh'), {
        method: 'POST',
        credentials: 'include',
        cache: 'no-store',
        headers: { Accept: 'application/json', ...csrfHeaders() },
      })
      if (!res.ok) return null
      const auth = (await res.json()) as AdminAuth
      if (!auth?.access_token) return null
      applyAuth(auth, complete && useSession.getState().status !== 'pending')
      return auth
    } catch {
      return null
    }
  })
}

const client = createHttpClient({
  getAccessToken,
  credentials: 'include',
  headers: csrfHeaders,
  refresh: async () => {
    if (!getAccessToken()) return false
    const auth = await refreshSession()
    if (auth) return true
    if (useSession.getState().status !== 'anon') wipeSession('Your session ended — please sign in again.')
    return false
  },
})

/**
 * Client WITHOUT the 401→refresh retry, for endpoints where 401 is a business answer
 * (a wrong TOTP is `401 INVALID_MFA_CODE`) — a blind retry would double-count failed attempts.
 */
const noRetryClient = createHttpClient({ getAccessToken, credentials: 'include', headers: csrfHeaders })

/** POST /admin/auth/step-up — refreshes only when the *token* (not the code) was rejected. */
export async function postStepUp<T>(code: string): Promise<T> {
  try {
    return await noRetryClient.post<T>('/admin/auth/step-up', { code })
  } catch (e) {
    if (isApiError(e) && e.status === 401 && e.code !== 'INVALID_MFA_CODE' && (await refreshSession()))
      return noRetryClient.post<T>('/admin/auth/step-up', { code })
    throw e
  }
}

// ───────────── interceptors ─────────────

function handleGlobalErrors(e: unknown): never {
  if (isApiError(e, 'MFA_REQUIRED')) wipeSession('Two-factor authentication is required — please sign in again.')
  // server-side "must change temporary password" gate → back to the password step
  if (isApiError(e, 'PASSWORD_POLICY') && e.status === 403) {
    const me = useSession.getState().me
    if (me) useSession.setState({ status: 'pending', me: { ...me, must_change_password: true } })
  }
  if (isApiError(e) && e.status === 401 && !getAccessToken()) throw new ApiError(401, SESSION_ENDED, e.message)
  throw e
}

async function guarded<T>(run: () => Promise<T>): Promise<T> {
  // signed out (or not yet signed in): never hit the network with an authenticated call —
  // queries still mounted during the logout transition fail silently instead of 401-ing
  if (!getAccessToken()) throw new ApiError(401, SESSION_ENDED, 'Signed out')
  try {
    return await run()
  } catch (e) {
    if (isApiError(e, 'STEP_UP_REQUIRED')) {
      await requestStepUp() // rejects with STEP_UP_CANCELLED if dismissed
      try {
        return await run()
      } catch (e2) {
        return handleGlobalErrors(e2)
      }
    }
    return handleGlobalErrors(e)
  }
}

export interface ApprovalQueued {
  approval_id: string
  status?: string
}

function approvalIdOf(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null
  const d = data as Record<string, unknown>
  if (typeof d.approval_id === 'string' && (d.status === undefined || d.status === 'pending' || d.code === 'APPROVAL_REQUIRED'))
    return d.approval_id
  const err = d.error as { code?: string; details?: { approval_id?: string } } | undefined
  if (err?.code === 'APPROVAL_REQUIRED') return err.details?.approval_id ?? ''
  return null
}

export const isApprovalQueued = (x: unknown): x is ApprovalQueued => approvalIdOf(x) !== null

function announceApproval() {
  queryClient.invalidateQueries({ queryKey: ['admin', 'approvals'] })
  queryClient.invalidateQueries({ queryKey: ['admin', 'system'] })
  toast.info('Sent for second-admin approval', {
    description: 'A different admin with approval rights must approve it before it runs.',
    action: { label: 'Approvals', onClick: () => navigateTo('/approvals') },
    duration: 8000,
  })
}

async function mutate<T>(run: () => Promise<T>): Promise<T> {
  try {
    const data = await guarded(run)
    if (isApprovalQueued(data)) announceApproval()
    return data
  } catch (e) {
    if (isApiError(e, 'APPROVAL_REQUIRED')) {
      announceApproval()
      const id = (e.details as { approval_id?: string } | undefined)?.approval_id ?? ''
      return { approval_id: id, status: 'pending' } as T
    }
    throw e
  }
}

export const http = {
  get: <T>(path: string, query?: Query, signal?: AbortSignal) => guarded(() => client.get<T>(path, query, { signal })),
  post: <T>(path: string, body?: unknown) => mutate(() => client.post<T>(path, body)),
  put: <T>(path: string, body?: unknown) => mutate(() => client.put<T>(path, body)),
  patch: <T>(path: string, body?: unknown) => mutate(() => client.patch<T>(path, body)),
  delete: <T>(path: string) => mutate(() => client.delete<T>(path)),
  /** Mutation with extra headers (e.g. `X-Admin-Reason` for endpoints whose body is strict). */
  send: <T>(method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body: unknown, headers: Record<string, string>) =>
    mutate(() => client.request<T>(method, path, { body, headers })),
  download: (path: string, query: Query | undefined, filename: string) => guarded(() => client.download(path, query, filename)),
  /** Pre-session auth calls (login / MFA): no bearer, no refresh, no step-up. */
  anon: <T>(path: string, body?: unknown) => client.post<T>(path, body, { auth: false }),
  /** Step-up itself must never recurse into the step-up interceptor. */
  raw: client,
}

// ───────────── logout ─────────────

/** Sign out: wipe memory first (instant), tell other tabs, then revoke server-side + clear cookies. */
export async function logout(notice: string | null = null, opts: { broadcast?: boolean; server?: boolean } = {}) {
  const { broadcast = true, server = true } = opts
  const token = getAccessToken()
  const csrf = csrfHeaders()
  resetStepUp()
  wipeSession(notice)
  if (broadcast) postChannel({ type: 'logout' })
  if (!server) return
  try {
    await fetch(buildUrl('/admin/auth/logout'), {
      method: 'POST',
      credentials: 'include',
      keepalive: true,
      headers: { Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...csrf },
    })
  } catch {
    /* server also expires idle sessions */
  }
}
