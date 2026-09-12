import { ApiError, isApiError } from '@/lib/api/http'

/** Thrown when the operator dismisses the step-up (TOTP) prompt — never toasted. */
export const STEP_UP_CANCELLED = 'STEP_UP_CANCELLED'
/** Thrown for requests abandoned because the session ended — the login screen explains. */
export const SESSION_ENDED = 'SESSION_ENDED'

export const stepUpCancelled = () => new ApiError(403, STEP_UP_CANCELLED, 'Confirmation cancelled')

export const isSilentError = (e: unknown) =>
  isApiError(e, STEP_UP_CANCELLED) || isApiError(e, SESSION_ENDED) || (e instanceof Error && e.name === 'AbortError')

/** Seconds until retry, from `details` of ACCOUNT_LOCKED / RATE_LIMITED (several shapes tolerated). */
export function retryAfterSeconds(e: unknown): number | null {
  if (!(e instanceof ApiError)) return null
  const d = (e.details ?? {}) as Record<string, unknown>
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() && !Number.isNaN(Number(v)) ? Number(v) : null)
  const secs = n(d.retry_after_seconds) ?? n(d.retry_after) ?? n(d.seconds)
  if (secs != null) return Math.max(0, Math.ceil(secs))
  const until = d.locked_until ?? d.until ?? d.retry_at
  if (typeof until === 'string') {
    const t = Date.parse(until)
    if (!Number.isNaN(t)) return Math.max(0, Math.ceil((t - Date.now()) / 1000))
  }
  return null
}

/** Field-level validation messages from a VALIDATION_ERROR (`details.fields` or pydantic-style list). */
export function fieldErrors(e: unknown): Record<string, string> {
  if (!(e instanceof ApiError)) return {}
  const d = e.details as unknown
  const out: Record<string, string> = {}
  if (d && typeof d === 'object' && !Array.isArray(d) && 'fields' in d) {
    Object.assign(out, (d as { fields: Record<string, string> }).fields)
  } else if (Array.isArray(d)) {
    for (const item of d as { loc?: (string | number)[]; msg?: string }[]) {
      const key = item.loc?.filter((x) => x !== 'body').join('.')
      if (key && item.msg) out[key] = item.msg
    }
  }
  return out
}
