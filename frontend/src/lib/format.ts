import { differenceInCalendarDays, formatDistanceToNowStrict } from 'date-fns'
import { formatInTimeZone, toZonedTime } from 'date-fns-tz'

export const TZ = 'Asia/Kolkata'

/** 15000 → "₹150", 123456 → "₹1,234.56", compact: 150000000 → "₹15L" */
export function formatINR(paise: number, opts: { compact?: boolean; sign?: boolean } = {}): string {
  const rupees = paise / 100
  const abs = Math.abs(rupees)
  let body: string
  if (opts.compact && abs >= 100000) body = `${(abs / 100000).toFixed(abs >= 1000000 ? 0 : 1)}L`
  else if (opts.compact && abs >= 1000) body = `${(abs / 1000).toFixed(abs >= 10000 ? 0 : 1)}k`
  else
    body = abs.toLocaleString('en-IN', {
      minimumFractionDigits: Number.isInteger(abs) ? 0 : 2,
      maximumFractionDigits: 2,
    })
  const sign = rupees < 0 ? '−' : opts.sign && rupees > 0 ? '+' : ''
  return `${sign}₹${body}`
}

const toDate = (iso: string | Date) => (typeof iso === 'string' ? new Date(iso) : iso)

/** "7:00 PM" */
export const formatTime = (iso: string | Date) => formatInTimeZone(toDate(iso), TZ, 'h:mm a')

/** "7 PM" / "7:30 PM" */
export const formatHour = (iso: string | Date) => {
  const d = toDate(iso)
  return formatInTimeZone(d, TZ, formatInTimeZone(d, TZ, 'mm') === '00' ? 'h a' : 'h:mm a')
}

/** "Today" / "Tomorrow" / "Sat, 14 Sep" */
export function formatDay(iso: string | Date): string {
  const d = toZonedTime(toDate(iso), TZ)
  const now = toZonedTime(new Date(), TZ)
  const diff = differenceInCalendarDays(d, now)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Tomorrow'
  if (diff === -1) return 'Yesterday'
  return formatInTimeZone(toDate(iso), TZ, 'EEE, d MMM')
}

/** "Today · 7:00 PM" */
export const formatWhen = (iso: string | Date) => `${formatDay(iso)} · ${formatTime(iso)}`

/** "7–8 PM", "6:30–7:30 AM", and "11 AM–12 PM" when the range crosses noon/midnight (never an ambiguous "11–12 PM"). */
export function formatSlotRange(start: string, end: string): string {
  const s = toDate(start)
  const e = toDate(end)
  const clock = (d: Date) => formatInTimeZone(d, TZ, formatInTimeZone(d, TZ, 'mm') === '00' ? 'h' : 'h:mm')
  const sMer = formatInTimeZone(s, TZ, 'a')
  const eMer = formatInTimeZone(e, TZ, 'a')
  return `${clock(s)}${sMer === eMer ? '' : ` ${sMer}`}–${clock(e)} ${eMer}`
}

export const formatDateLong = (iso: string | Date) => formatInTimeZone(toDate(iso), TZ, 'd MMM yyyy')

/** "5 min ago" / "in 2 hours" */
export const timeAgo = (iso: string | Date) => formatDistanceToNowStrict(toDate(iso), { addSuffix: true })

/** YYYY-MM-DD for an IST day offset from today */
export function istDate(offsetDays = 0): string {
  const d = new Date(Date.now() + offsetDays * 86400000)
  return formatInTimeZone(d, TZ, 'yyyy-MM-dd')
}

export const formatKm = (km: number | null | undefined) =>
  km == null ? '' : km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(km < 10 ? 1 : 0)} km`

export const pluralize = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('')

/** Deterministic 0..359 hue from any string (user id → avatar gradient). */
export function hueFrom(seed: string): number {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return h % 360
}

export const trueSkillLabel = (v: number | null) => (v == null ? '—' : Math.round(v).toString())
