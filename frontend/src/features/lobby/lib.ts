/**
 * Pure helpers shared by the lobby feature (waiting room, cards, join preview).
 */
import { formatInTimeZone } from 'date-fns-tz'
import type { LobbyDetail, LobbyStatus, LobbySummary, UserMe, UserPublic } from '@/types/api'

export type Tone = 'neutral' | 'volt' | 'mint' | 'electric' | 'flare' | 'sun' | 'grape'

export const STATUS_META: Record<LobbyStatus, { label: string; tone: Tone; live?: boolean }> = {
  forming: { label: 'Forming', tone: 'sun', live: true },
  confirmed: { label: 'Confirmed', tone: 'volt' },
  completed: { label: 'Full time', tone: 'electric' },
  expired: { label: 'Expired', tone: 'neutral' },
  cancelled: { label: 'Cancelled', tone: 'flare' },
}

export const firstName = (u: Pick<UserPublic, 'name'>) => u.name.split(/\s+/)[0] ?? u.name

/** What the current user still owes on this lobby (paise). */
export function amountOwed(l: LobbyDetail): number {
  const m = l.my_membership
  if (!m || m.status === 'paid') return 0
  if (l.status !== 'forming' && l.status !== 'confirmed') return 0
  if (l.mode === 'full' && m.role === 'host' && l.booking.status === 'pending_payment') {
    return Math.max(0, l.booking.total_paise - m.paid_paise)
  }
  return Math.max(0, m.share_paise - m.paid_paise)
}

/** Unpaid remainder the host can cover in split mode. */
export function remainingToCover(l: LobbyDetail): number {
  return Math.max(0, (l.total_spots - l.paid_spots) * l.share_paise)
}

/**
 * Client-side eligibility guess for feed cards (LobbySummary has no eligibility block).
 * The server remains the authority — this only explains *why* a card is locked.
 */
export function clientEligibility(l: LobbySummary, me: Pick<UserMe, 'true_skill' | 'is_verified_playmaker'> | null) {
  const reasons: string[] = []
  if (!me) return reasons
  if (l.min_true_skill != null && (me.true_skill ?? 0) < l.min_true_skill) {
    reasons.push(
      me.true_skill == null
        ? `Needs True Skill ${Math.round(l.min_true_skill)} — you're unrated`
        : `Needs True Skill ${Math.round(l.min_true_skill)} — you're ${Math.round(me.true_skill)}`,
    )
  }
  if (l.verified_only && !me.is_verified_playmaker) reasons.push('Verified Playmakers only')
  if (l.spots_left <= 0) reasons.push('Lobby is full')
  return reasons
}

// ───────────────────────── Calendar (.ics) ─────────────────────────

const icsStamp = (iso: string | Date) => formatInTimeZone(new Date(iso), 'UTC', "yyyyMMdd'T'HHmmss'Z'")
const icsEscape = (s: string) => s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1')

export function buildIcs(l: LobbyDetail): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//PYTCH//Match//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${l.id}@pytch`,
    `DTSTAMP:${icsStamp(new Date())}`,
    `DTSTART:${icsStamp(l.start_at)}`,
    `DTEND:${icsStamp(l.end_at)}`,
    `SUMMARY:${icsEscape(`${l.title} · PYTCH`)}`,
    `LOCATION:${icsEscape(`${l.turf.name}, ${l.turf.area}`)}`,
    `GEO:${l.turf.lat};${l.turf.lng}`,
    `DESCRIPTION:${icsEscape(`${l.pitch.name} · ${l.format}\nBooking ${l.booking.code}\n${l.invite_url}`)}`,
    `URL:${l.invite_url}`,
    'BEGIN:VALARM',
    'TRIGGER:-PT1H',
    'ACTION:DISPLAY',
    'DESCRIPTION:Kick-off in 1 hour',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ]
  return lines.join('\r\n')
}

export function downloadIcs(l: LobbyDetail) {
  const blob = new Blob([buildIcs(l)], { type: 'text/calendar;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `pytch-${l.code}.ics`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

export function inviteText(l: Pick<LobbySummary, 'title' | 'start_at' | 'turf' | 'share_paise' | 'spots_left'>, url: string, when: string, price: string) {
  return `⚽ ${l.title} — ${when} at ${l.turf.name}. ${l.spots_left} spot${l.spots_left === 1 ? '' : 's'} left, ${price} each. Join on PYTCH: ${url}`
}
