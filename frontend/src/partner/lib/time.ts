import { formatInTimeZone } from 'date-fns-tz'
import { TZ } from '@/lib/format'

/** Calendar maths in IST (Asia/Kolkata has no DST, so a fixed +05:30 offset is exact). */
export const IST_OFFSET = '+05:30'

/** 'YYYY-MM-DD' of an instant, in IST. */
export const istDateOf = (iso: string | Date) => formatInTimeZone(typeof iso === 'string' ? new Date(iso) : iso, TZ, 'yyyy-MM-dd')

/** 'HH:mm' of an instant, in IST. */
export const istTimeOf = (iso: string | Date) => formatInTimeZone(typeof iso === 'string' ? new Date(iso) : iso, TZ, 'HH:mm')

/** Minutes since IST midnight. */
export const istMinutesOf = (iso: string | Date) => {
  const [h, m] = istTimeOf(iso).split(':').map(Number)
  return h! * 60 + m!
}

/** Add days to a 'YYYY-MM-DD' date. */
export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** 0 = Monday … 6 = Sunday (matches the API's weekday convention). */
export function weekdayOf(date: string): number {
  const d = new Date(`${date}T00:00:00Z`).getUTCDay() // 0 = Sun
  return (d + 6) % 7
}

/** Monday of the week containing `date`. */
export const weekStart = (date: string) => addDays(date, -weekdayOf(date))

export const dayDiff = (a: string, b: string) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86400000)

/** ISO instant for an IST wall-clock time. */
export const istInstant = (date: string, hhmm: string) => `${date}T${hhmm}:00${IST_OFFSET}`

/** "Sat 14" / "Sat, 14 Sep" for a 'YYYY-MM-DD'. */
export const dayLabel = (date: string, fmt = 'EEE d') => formatInTimeZone(new Date(`${date}T12:00:00${IST_OFFSET}`), TZ, fmt)

/** "7 AM" / "7:30 PM" from 'HH:mm'. */
export function hhmmLabel(hhmm: string, compact = false): string {
  const [hRaw, m] = hhmm.split(':').map(Number)
  const h = hRaw! % 24
  const suffix = h >= 12 ? (compact ? 'p' : ' PM') : compact ? 'a' : ' AM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return m ? `${h12}:${String(m).padStart(2, '0')}${suffix}` : `${h12}${suffix}`
}

/** Hour 0..23 → "6a" / "6 AM" */
export const hourLabel = (h: number, compact = true) => hhmmLabel(`${String(h).padStart(2, '0')}:00`, compact)

/** Range presets for filters: [from, to] inclusive IST dates. */
export function rangePreset(key: RangeKey, today: string): [string, string] {
  switch (key) {
    case 'today':
      return [today, today]
    case '7d':
      return [addDays(today, -6), today]
    case '30d':
      return [addDays(today, -29), today]
    case '90d':
      return [addDays(today, -89), today]
    case 'mtd':
      return [`${today.slice(0, 8)}01`, today]
    case 'last_month': {
      const firstThis = `${today.slice(0, 8)}01`
      const lastPrev = addDays(firstThis, -1)
      return [`${lastPrev.slice(0, 8)}01`, lastPrev]
    }
    case 'next7':
      return [today, addDays(today, 6)]
  }
}

export type RangeKey = 'today' | '7d' | '30d' | '90d' | 'mtd' | 'last_month' | 'next7'
