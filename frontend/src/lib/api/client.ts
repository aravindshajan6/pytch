import { useAuth } from '@/stores/auth'
import type { ApiErrorBody, AuthTokens, ErrorCode } from '@/types/api'

export const API_BASE = import.meta.env.VITE_API_BASE ?? '/api/v1'

export class ApiError extends Error {
  status: number
  code: ErrorCode
  details: unknown

  constructor(status: number, code: ErrorCode, message: string, details?: unknown) {
    super(message)
    this.status = status
    this.code = code
    this.details = details
  }
}

export const isApiError = (e: unknown, code?: ErrorCode): e is ApiError =>
  e instanceof ApiError && (!code || e.code === code)

/** Human message for toasts. */
export const errorMessage = (e: unknown) =>
  e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Something went wrong'

type Query = Record<string, string | number | boolean | null | undefined>

interface RequestOptions {
  query?: Query
  body?: unknown
  auth?: boolean
  signal?: AbortSignal
}

function buildUrl(path: string, query?: Query) {
  const url = `${API_BASE}${path}`
  if (!query) return url
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== '') params.set(k, String(v))
  const qs = params.toString()
  return qs ? `${url}?${qs}` : url
}

// Single-flight refresh so concurrent 401s trigger one refresh call.
let refreshing: Promise<boolean> | null = null

async function refreshTokens(): Promise<boolean> {
  const { refreshToken, setSession, logout } = useAuth.getState()
  if (!refreshToken) return false
  refreshing ??= (async () => {
    try {
      const res = await fetch(buildUrl('/auth/refresh'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken }),
      })
      if (!res.ok) throw new Error('refresh failed')
      setSession((await res.json()) as AuthTokens)
      return true
    } catch {
      logout()
      return false
    } finally {
      setTimeout(() => (refreshing = null), 0)
    }
  })()
  return refreshing
}

async function request<T>(method: string, path: string, opts: RequestOptions = {}, retry = true): Promise<T> {
  const { auth = true } = opts
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json'
  const token = useAuth.getState().accessToken
  if (auth && token) headers.Authorization = `Bearer ${token}`

  let res: Response
  try {
    res = await fetch(buildUrl(path, opts.query), {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: opts.signal,
    })
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e
    throw new ApiError(0, 'INTERNAL_ERROR', 'Network error — check your connection')
  }

  if (res.status === 401 && auth && retry && useAuth.getState().refreshToken) {
    if (await refreshTokens()) return request<T>(method, path, opts, false)
  }
  if (res.status === 204) return undefined as T

  const text = await res.text()
  const data = text ? JSON.parse(text) : undefined
  if (!res.ok) {
    const err = (data as ApiErrorBody | undefined)?.error
    throw new ApiError(res.status, err?.code ?? 'INTERNAL_ERROR', err?.message ?? res.statusText, err?.details)
  }
  return data as T
}

export const http = {
  get: <T>(path: string, query?: Query, opts?: Omit<RequestOptions, 'query' | 'body'>) =>
    request<T>('GET', path, { ...opts, query }),
  post: <T>(path: string, body?: unknown, opts?: Omit<RequestOptions, 'body'>) =>
    request<T>('POST', path, { ...opts, body: body ?? {} }),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, { body: body ?? {} }),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, { body: body ?? {} }),
  delete: <T>(path: string) => request<T>('DELETE', path),
}
