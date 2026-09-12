/**
 * Audience-agnostic HTTP layer: `createHttpClient` factory, `ApiError`, helpers.
 * Imported by every bundle (player app, partner portal, admin console) — must not import any
 * audience-specific store. The player client lives in ./client.ts.
 */
import type { ApiErrorBody, ErrorCode } from '@/types/api'

export const API_BASE = import.meta.env.VITE_API_BASE ?? '/api/v1'

export class ApiError extends Error {
  status: number
  code: ErrorCode | (string & {})
  details: unknown

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message)
    this.status = status
    this.code = code
    this.details = details
  }
}

export const isApiError = (e: unknown, code?: string): e is ApiError =>
  e instanceof ApiError && (!code || e.code === code)

/** Human message for toasts. */
export const errorMessage = (e: unknown) =>
  e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Something went wrong'

export type Query = Record<string, string | number | boolean | null | undefined | (string | number)[]>

export interface RequestOptions {
  query?: Query
  body?: unknown
  auth?: boolean
  signal?: AbortSignal
  headers?: Record<string, string>
  /** return the raw Response (CSV downloads etc.) */
  raw?: boolean
}

export function buildUrl(path: string, query?: Query, base = API_BASE) {
  const url = `${base}${path}`
  if (!query) return url
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === '') continue
    if (Array.isArray(v)) v.forEach((x) => params.append(k, String(x)))
    else params.set(k, String(v))
  }
  const qs = params.toString()
  return qs ? `${url}?${qs}` : url
}

export interface HttpClientConfig {
  /** Bearer token for authenticated calls (null → anonymous). */
  getAccessToken: () => string | null
  /** Try to obtain a fresh access token (the one that just got a 401 is passed in); resolve true on success. */
  refresh?: (failedToken: string | null) => Promise<boolean>
  /** Extra headers on every request (e.g. X-Provider-Id, X-CSRF-Token). */
  headers?: () => Record<string, string>
  /** 'include' for cookie-based auth (admin console). */
  credentials?: RequestCredentials
  base?: string
  /** Observe every API error response before it's thrown (e.g. a global "account suspended" screen). */
  onApiError?: (error: ApiError) => void
}

export type HttpClient = ReturnType<typeof createHttpClient>

/**
 * Run `fn` holding a browser-wide lock (Web Locks API), so tabs sharing one rotating refresh token never
 * refresh concurrently — the loser would present a stale token and trip reuse detection (= logout).
 */
export function withCrossTabLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const locks = (navigator as Navigator & { locks?: LockManager }).locks
  return locks?.request ? (locks.request(name, fn) as Promise<T>) : fn()
}

interface PersistedTokenStore<S> {
  getState: () => S
  persist: { rehydrate: () => Promise<void> | void; getOptions: () => { name?: string } }
}

/**
 * Cross-tab safe refresh for localStorage-persisted token stores (player + partner):
 * lock → re-read storage (another tab may have rotated already) → refresh only if still needed.
 * Logs out only when the server rejects the refresh token, not on network errors.
 */
export function makeTokenRefresher<S extends { accessToken: string | null; refreshToken: string | null }>(
  store: PersistedTokenStore<S>,
  /** `onRejected` gets the server's error (e.g. ACCOUNT_SUSPENDED) when it sent one. */
  opts: { lock: string; url: string; onSuccess: (auth: unknown) => void; onRejected: (error?: ApiError) => void },
) {
  // keep tabs in sync: a rotation/logout in one tab lands in the others immediately
  if (typeof window !== 'undefined') {
    const key = store.persist.getOptions().name
    window.addEventListener('storage', (e) => {
      if (e.key === key) void store.persist.rehydrate()
    })
  }
  return (failedToken: string | null) =>
    withCrossTabLock(opts.lock, async () => {
      await store.persist.rehydrate()
      const { accessToken, refreshToken } = store.getState()
      if (accessToken && accessToken !== failedToken) return true // another tab already refreshed
      if (!refreshToken) return false
      let res: Response
      try {
        res = await fetch(opts.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refresh_token: refreshToken }),
          cache: 'no-store',
        })
      } catch {
        return false // offline: keep the session, try again later
      }
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) opts.onRejected(await errorFromResponse(res))
        return false
      }
      opts.onSuccess(await res.json())
      return true
    })
}

/** Best-effort `ApiError` from a failed response's `{error: {code, message, details}}` body. */
async function errorFromResponse(res: Response): Promise<ApiError | undefined> {
  try {
    const err = ((await res.json()) as ApiErrorBody | undefined)?.error
    return err ? new ApiError(res.status, err.code, err.message, err.details) : undefined
  } catch {
    return undefined
  }
}

/** Factory: one client per audience (player / partner / admin), each with its own token source. */
export function createHttpClient(cfg: HttpClientConfig) {
  // single-flight refresh so concurrent 401s trigger one refresh call
  let refreshing: Promise<boolean> | null = null
  const doRefresh = (failedToken: string | null) => {
    if (!cfg.refresh) return Promise.resolve(false)
    refreshing ??= cfg.refresh(failedToken).finally(() => setTimeout(() => (refreshing = null), 0))
    return refreshing
  }

  async function request<T>(method: string, path: string, opts: RequestOptions = {}, retry = true): Promise<T> {
    const { auth = true } = opts
    const headers: Record<string, string> = { Accept: 'application/json', ...cfg.headers?.(), ...opts.headers }
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json'
    const token = cfg.getAccessToken()
    if (auth && token) headers.Authorization = `Bearer ${token}`

    let res: Response
    try {
      res = await fetch(buildUrl(path, opts.query, cfg.base), {
        method,
        headers,
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: opts.signal,
        credentials: cfg.credentials ?? 'same-origin',
      })
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw e
      throw new ApiError(0, 'INTERNAL_ERROR', 'Network error — check your connection')
    }

    if (res.status === 401 && auth && retry && cfg.refresh) {
      if (await doRefresh(token)) return request<T>(method, path, opts, false)
    }
    if (opts.raw && res.ok) return res as T
    if (res.status === 204) return undefined as T

    const text = await res.text()
    let data: unknown
    try {
      data = text ? JSON.parse(text) : undefined
    } catch {
      data = undefined
    }
    if (!res.ok) {
      const err = (data as ApiErrorBody | undefined)?.error
      const apiError = new ApiError(res.status, err?.code ?? 'INTERNAL_ERROR', err?.message ?? res.statusText, err?.details)
      cfg.onApiError?.(apiError)
      throw apiError
    }
    return data as T
  }

  return {
    request,
    get: <T>(path: string, query?: Query, opts?: Omit<RequestOptions, 'query' | 'body'>) =>
      request<T>('GET', path, { ...opts, query }),
    post: <T>(path: string, body?: unknown, opts?: Omit<RequestOptions, 'body'>) =>
      request<T>('POST', path, { ...opts, body: body ?? {} }),
    put: <T>(path: string, body?: unknown) => request<T>('PUT', path, { body: body ?? {} }),
    patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, { body: body ?? {} }),
    delete: <T>(path: string) => request<T>('DELETE', path),
    /** Authenticated file download (CSV exports). */
    download: async (path: string, query: Query | undefined, filename: string) => {
      const res = await request<Response>('GET', path, { query, raw: true })
      const url = URL.createObjectURL(await res.blob())
      const a = Object.assign(document.createElement('a'), { href: url, download: filename })
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    },
  }
}
