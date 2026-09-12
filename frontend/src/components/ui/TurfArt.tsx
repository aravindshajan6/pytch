import { cn } from '@/lib/cn'
import { hueFrom } from '@/lib/format'
import type { Sport } from '@/types/api'

/**
 * Generative cover art for turfs/lobbies: floodlit pitch markings over a
 * gradient seeded by the id. Used whenever `cover_url` is null (and as the
 * backdrop while photos load).
 */
export function TurfArt({
  seed,
  sport = 'football',
  src,
  className,
  children,
}: {
  seed: string
  sport?: Sport
  src?: string | null
  className?: string
  children?: React.ReactNode
}) {
  const hue = (hueFrom(seed) % 70) + 95 // stay in green→teal range
  const shift = hueFrom(seed + 'x') % 40
  return (
    // Media panel: always rendered as a dark island so overlaid text/scrims read on photos in both themes.
    <div data-theme="dark" className={cn('relative overflow-hidden bg-ink-800', className)}>
      <div
        className="absolute inset-0"
        style={{
          background: `radial-gradient(120% 90% at ${20 + shift}% 0%, hsl(${hue} 70% 32% / 0.95), transparent 60%),
            radial-gradient(90% 80% at 100% 100%, hsl(${hue + 40} 80% 25% / 0.9), transparent 55%),
            linear-gradient(160deg, hsl(${hue} 45% 14%), hsl(${hue + 20} 50% 8%))`,
        }}
      />
      {/* mowing stripes */}
      <div
        className="absolute inset-0 opacity-25"
        style={{ backgroundImage: 'repeating-linear-gradient(90deg, color-mix(in srgb, var(--color-white) 5%, transparent) 0 28px, transparent 28px 56px)' }}
      />
      <PitchLines sport={sport} />
      {src && <img src={src} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover" onError={(e) => (e.currentTarget.style.display = 'none')} />}
      {/* floodlight flare */}
      <div className="absolute -top-10 left-1/4 h-40 w-40 rounded-full bg-white/10 blur-3xl" />
      <div className="absolute inset-0 bg-gradient-to-t from-ink-900/90 via-ink-900/20 to-transparent" />
      {children && <div className="relative h-full">{children}</div>}
    </div>
  )
}

function PitchLines({ sport }: { sport: Sport }) {
  const stroke = 'color-mix(in srgb, var(--color-white) 35%, transparent)'
  if (sport === 'badminton' || sport === 'pickleball') {
    return (
      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 400 220" preserveAspectRatio="xMidYMid slice" fill="none">
        <rect x="60" y="30" width="280" height="160" stroke={stroke} strokeWidth="2" />
        <line x1="200" y1="30" x2="200" y2="190" stroke="color-mix(in srgb, var(--color-white) 60%, transparent)" strokeWidth="3" />
        <line x1="60" y1="110" x2="340" y2="110" stroke={stroke} strokeWidth="1.5" />
        <line x1="150" y1="30" x2="150" y2="190" stroke={stroke} strokeWidth="1.5" />
        <line x1="250" y1="30" x2="250" y2="190" stroke={stroke} strokeWidth="1.5" />
      </svg>
    )
  }
  if (sport === 'cricket') {
    return (
      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 400 220" preserveAspectRatio="xMidYMid slice" fill="none">
        <rect x="120" y="85" width="160" height="50" stroke={stroke} strokeWidth="2" />
        <line x1="140" y1="85" x2="140" y2="135" stroke={stroke} strokeWidth="2" />
        <line x1="260" y1="85" x2="260" y2="135" stroke={stroke} strokeWidth="2" />
        <path d="M0 20 Q200 -10 400 20 M0 200 Q200 230 400 200" stroke="color-mix(in srgb, var(--color-white) 15%, transparent)" strokeWidth="2" />
      </svg>
    )
  }
  return (
    <svg className="absolute inset-0 h-full w-full" viewBox="0 0 400 220" preserveAspectRatio="xMidYMid slice" fill="none">
      <rect x="20" y="15" width="360" height="190" rx="4" stroke={stroke} strokeWidth="2" />
      <line x1="200" y1="15" x2="200" y2="205" stroke={stroke} strokeWidth="2" />
      <circle cx="200" cy="110" r="32" stroke={stroke} strokeWidth="2" />
      <circle cx="200" cy="110" r="3" fill={stroke} />
      <rect x="20" y="65" width="50" height="90" stroke={stroke} strokeWidth="2" />
      <rect x="330" y="65" width="50" height="90" stroke={stroke} strokeWidth="2" />
    </svg>
  )
}
