import { isApiError } from '@/lib/api/client'

/**
 * FastAPI 422s carry `details: [{loc: ['body', 'phone'], msg}]`. Map them onto form fields so a save error says
 * *which* field is wrong instead of a bare "Invalid request". Model-level errors land on `_form`.
 */
export function apiFieldErrors(e: unknown): Record<string, string> {
  if (!isApiError(e) || e.status !== 422 || !Array.isArray(e.details)) return {}
  const out: Record<string, string> = {}
  for (const d of e.details as { loc?: (string | number)[]; msg?: string }[]) {
    const path = (d.loc ?? []).filter((p) => p !== 'body' && p !== 'query')
    const key = typeof path[0] === 'string' ? path[0] : '_form'
    out[key] ??= humanize(d.msg ?? '')
  }
  return out
}

function humanize(msg: string): string {
  const m = msg.replace(/^Value error, /, '')
  if (/should match pattern/i.test(m)) return 'That doesn’t look right — check the format.'
  const min = /at least (\d+) characters?/i.exec(m)
  if (min) return `Use at least ${min[1]} characters.`
  const max = /at most (\d+) characters?/i.exec(m)
  if (max) return `Keep it under ${Number(max[1]) + 1} characters.`
  return m.charAt(0).toUpperCase() + m.slice(1)
}

/** One line for a toast: "Phone: that doesn’t look right — check the format." (falls back to the API message). */
export function describeApiError(e: unknown, labels: Record<string, string> = {}): string | undefined {
  const fields = apiFieldErrors(e)
  const [key, msg] = Object.entries(fields)[0] ?? []
  if (!key || !msg) return isApiError(e) || e instanceof Error ? (e as Error).message : undefined
  return key === '_form' ? msg : `${labels[key] ?? key.replace(/_/g, ' ')}: ${msg.charAt(0).toLowerCase()}${msg.slice(1)}`
}
