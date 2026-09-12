import { formatInTimeZone } from 'date-fns-tz'
import { TZ, formatINR } from '@/lib/format'

/** "+919876543210" → "+91 98••• ••210" (never render the full number in lists). */
/** The API already masks phones for support / read-only / marketing roles. */
export const isMaskedPhone = (phone: string | null | undefined) => !!phone && /[•*x]{2,}/i.test(phone)

export function maskPhone(phone: string | null | undefined): string {
  if (!phone) return '—'
  if (isMaskedPhone(phone)) return phone
  const digits = phone.replace(/[^\d]/g, '')
  if (digits.length < 6) return '••••'
  const local = digits.length > 10 ? digits.slice(-10) : digits
  const cc = digits.length > 10 ? `+${digits.slice(0, digits.length - 10)} ` : ''
  return `${cc}${local.slice(0, 2)}••• ••${local.slice(-3)}`
}

/** "+919876543210" → "+91 98765 43210" */
export function formatPhone(phone: string | null | undefined): string {
  if (!phone) return '—'
  if (isMaskedPhone(phone)) return phone
  const digits = phone.replace(/[^\d]/g, '')
  if (digits.length === 12 && digits.startsWith('91')) return `+91 ${digits.slice(2, 7)} ${digits.slice(7)}`
  return phone
}

export const inr = (paise: number | null | undefined, compact = false) => (paise == null ? '—' : formatINR(paise, { compact }))

export const pct = (v: number | null | undefined, digits = 1) =>
  v == null || Number.isNaN(v) ? '—' : `${v.toFixed(v !== 0 && Math.abs(v) < 10 ? digits : 0)}%`

export const bpsToPct = (bps: number) => `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 2)}%`

export const compactNum = (n: number) =>
  Math.abs(n) >= 1e7 ? `${(n / 1e7).toFixed(1)}Cr` : Math.abs(n) >= 1e5 ? `${(n / 1e5).toFixed(1)}L` : Math.abs(n) >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : Math.round(n).toLocaleString('en-IN')

const d = (iso: string | Date) => (typeof iso === 'string' ? new Date(iso) : iso)

/** "12 Sep 2026, 7:05 PM" (IST) */
export const dateTime = (iso: string | null | undefined) => (iso ? formatInTimeZone(d(iso), TZ, 'd MMM yyyy, h:mm a') : '—')
/** "12 Sep, 19:05:22" — dense audit/log timestamps */
export const dateTimeSec = (iso: string | null | undefined) => (iso ? formatInTimeZone(d(iso), TZ, 'd MMM, HH:mm:ss') : '—')
export const dateShort = (iso: string | null | undefined) => (iso ? formatInTimeZone(d(iso), TZ, 'd MMM yyyy') : '—')
export const dayLabel = (iso: string) => formatInTimeZone(d(iso.length === 10 ? `${iso}T00:00:00+05:30` : iso), TZ, 'd MMM')

export const titleCase = (s: string | null | undefined) =>
  (s ?? '').replace(/[_.]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())

export const shortId = (id: string | number | null | undefined) => (id == null ? '—' : String(id).slice(0, 8))

/** Signed delta between current and previous. For percentages → percentage points. */
export function delta(value: number, previous: number, unit: 'paise' | 'count' | 'pct' | 'ratio') {
  if (unit === 'pct') return { kind: 'pp' as const, value: value - previous }
  if (!previous) return { kind: 'pct' as const, value: value === 0 ? 0 : null }
  return { kind: 'pct' as const, value: ((value - previous) / Math.abs(previous)) * 100 }
}

export const ROLE_LABEL: Record<string, string> = {
  super_admin: 'Super admin',
  ops: 'Operations',
  finance: 'Finance',
  support: 'Support',
  marketing: 'Marketing',
  read_only: 'Read-only',
}

export const rupeesToPaise = (v: string) => {
  const n = Number(v.replace(/[,₹\s]/g, ''))
  return Number.isFinite(n) ? Math.round(n * 100) : NaN
}
export const paiseToRupeesInput = (p: number | null | undefined) => (p == null ? '' : String(p / 100))

export function formatKpi(k: { unit: 'paise' | 'count' | 'pct' | 'ratio'; value: number }, compact = true) {
  switch (k.unit) {
    case 'paise':
      return inr(k.value, compact && Math.abs(k.value) >= 1_00_000_00)
    case 'pct':
      return `${k.value.toFixed(k.value >= 10 ? 0 : 1)}%`
    case 'ratio':
      return k.value.toFixed(2)
    default:
      return compact ? compactNum(k.value) : Math.round(k.value).toLocaleString('en-IN')
  }
}
