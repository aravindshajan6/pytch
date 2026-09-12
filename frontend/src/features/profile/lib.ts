import type { BadgeRarity, PlayerStats, Tier } from '@/types/api'

/** 1..5 average → 0..100 card attribute. */
export const attr = (avg: number | null | undefined) => (avg == null ? null : Math.round(Math.min(5, Math.max(0, avg)) * 20))

export const positionCode = (position: string | null | undefined) => {
  if (!position) return '—'
  const p = position.trim().toLowerCase()
  const known: Record<string, string> = {
    goalkeeper: 'GK',
    keeper: 'GK',
    defender: 'DEF',
    midfielder: 'MID',
    forward: 'FWD',
    striker: 'ST',
    winger: 'WNG',
    batter: 'BAT',
    batsman: 'BAT',
    bowler: 'BWL',
    'all-rounder': 'AR',
    'wicket-keeper': 'WK',
    guard: 'GRD',
    center: 'CTR',
    singles: 'SGL',
    doubles: 'DBL',
  }
  return known[p] ?? position.slice(0, 3).toUpperCase()
}

export interface FrameStyle {
  frame: string // CSS background for the border frame
  tint: string // rgb triplet for inner glows
  text: string // accent colour
}

export const FRAMES: Record<Tier, FrameStyle> = {
  elite: {
    frame: 'linear-gradient(135deg, var(--color-grape-soft) 0%, var(--color-flare) 22%, var(--color-electric) 45%, var(--color-volt) 68%, var(--color-grape) 100%)',
    tint: '139 92 255',
    text: '#c9b6ff',
  },
  skilled: {
    frame: 'linear-gradient(135deg, #f4ffd6 0%, var(--color-volt) 30%, #5f8500 62%, var(--color-volt-soft) 100%)',
    tint: '200 255 46',
    text: 'var(--color-volt)',
  },
  regular: {
    frame: 'linear-gradient(135deg, #d4f7ff 0%, var(--color-electric) 30%, #0b5f75 62%, #9ae9ff 100%)',
    tint: '61 217 255',
    text: 'var(--color-electric)',
  },
  rookie: {
    frame: 'linear-gradient(135deg, #f1f5f3 0%, #9aa8a3 30%, #3a4541 62%, #c9d2cf 100%)',
    tint: '170 185 180',
    text: '#c9d2cf',
  },
}

export const RARITY: Record<BadgeRarity, { color: string; label: string }> = {
  // light-dark() follows the nearest color-scheme: pale steel on night, a darker slate that stays legible on white.
  common: { color: 'light-dark(#5f6e67, #9aa8a3)', label: 'Common' },
  rare: { color: 'var(--color-electric)', label: 'Rare' },
  epic: { color: 'var(--color-grape)', label: 'Epic' },
  legendary: { color: 'var(--color-sun)', label: 'Legendary' },
}

export const TIER_COPY: Record<Tier, string> = {
  rookie: 'Get 3 ratings to earn your first tier.',
  regular: 'Hit True Skill 55 to reach Skilled.',
  skilled: 'Hit True Skill 70 to reach Elite.',
  elite: 'Top of the pyramid. Keep it there.',
}

export const emptyStats = (tier: Tier = 'rookie'): PlayerStats => ({
  matches_played: 0,
  matches_hosted: 0,
  subs_made: 0,
  dropouts: 0,
  no_shows: 0,
  ratings_received: 0,
  ratings_given: 0,
  avg_skill: null,
  avg_fair_play: null,
  avg_reliability: null,
  true_skill: null,
  tier,
  is_verified_playmaker: false,
  top_tags: [],
  streak_weeks: 0,
  xp: 0,
  level: 1,
})
