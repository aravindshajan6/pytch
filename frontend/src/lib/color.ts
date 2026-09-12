/**
 * Theme-safe colour helpers. Colours in TS should be CSS values like `var(--color-volt)` so they
 * follow the active theme; use `alpha()` instead of appending hex alpha digits (`${c}1a`).
 */
export const alpha = (color: string, amount: number) =>
  `color-mix(in srgb, ${color} ${Math.round(amount * 1000) / 10}%, transparent)`

export const tokens = {
  volt: 'var(--color-volt)',
  voltSoft: 'var(--color-volt-soft)',
  mint: 'var(--color-mint)',
  electric: 'var(--color-electric)',
  flare: 'var(--color-flare)',
  sun: 'var(--color-sun)',
  grape: 'var(--color-grape)',
  grapeSoft: 'var(--color-grape-soft)',
  fg: 'var(--color-fg)',
  muted: 'var(--color-muted)',
  subtle: 'var(--color-subtle)',
} as const
