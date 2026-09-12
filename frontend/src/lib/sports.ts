import type { Sport, Tier } from '@/types/api'

export const SPORTS: Record<Sport, { label: string; emoji: string; color: string }> = {
  football: { label: 'Football', emoji: '⚽', color: 'var(--color-volt)' },
  cricket: { label: 'Cricket', emoji: '🏏', color: 'var(--color-electric)' },
  badminton: { label: 'Badminton', emoji: '🏸', color: 'var(--color-sun)' },
  pickleball: { label: 'Pickleball', emoji: '🥒', color: 'var(--color-mint)' },
  basketball: { label: 'Basketball', emoji: '🏀', color: '#ff7a3d' },
}

export const SPORT_LIST = Object.keys(SPORTS) as Sport[]

export const TIERS: Record<Tier, { label: string; color: string; ring: string }> = {
  rookie: { label: 'Rookie', color: 'var(--color-muted)', ring: 'ring-white/15' },
  regular: { label: 'Regular', color: 'var(--color-electric)', ring: 'ring-electric/60' },
  skilled: { label: 'Skilled', color: 'var(--color-volt)', ring: 'ring-volt/70' },
  elite: { label: 'Elite', color: 'var(--color-grape)', ring: 'ring-grape/80' },
}

/** WMO weather code → emoji */
export function weatherEmoji(code: number, isRisky = false): string {
  if (code >= 95) return '⛈️'
  if (code >= 80) return isRisky ? '🌧️' : '🌦️'
  if (code >= 61) return '🌧️'
  if (code >= 51) return '🌦️'
  if (code >= 45) return '🌫️'
  if (code >= 2) return '⛅'
  if (code === 1) return '🌤️'
  return '☀️'
}
