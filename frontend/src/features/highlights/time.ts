/** 83.4 → "1:23", with tenths → "1:23.4" */
export function fmtClock(seconds: number, tenths = false): string {
  const s = Math.max(0, seconds)
  const m = Math.floor(s / 60)
  const rest = s - m * 60
  const whole = Math.floor(rest)
  const base = `${m}:${whole.toString().padStart(2, '0')}`
  return tenths ? `${base}.${Math.floor((rest - whole) * 10)}` : base
}

/** Compact view counts: 1520 → "1.5k" */
export const fmtCount = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n))

export const HIGHLIGHT_TAGS = ['Goal', 'Assist', 'Save', 'Skill', 'Tackle', 'Worldie', 'Team play', 'Banter'] as const
