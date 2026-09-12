import { BadgeCheck } from 'lucide-react'
import { cn } from '@/lib/cn'
import { hueFrom, initials } from '@/lib/format'
import { TIERS } from '@/lib/sports'
import type { UserPublic } from '@/types/api'

const SIZES = {
  xs: 'h-6 w-6 text-[9px]',
  sm: 'h-8 w-8 text-[11px]',
  md: 'h-10 w-10 text-sm',
  lg: 'h-14 w-14 text-lg',
  xl: 'h-20 w-20 text-2xl',
  '2xl': 'h-28 w-28 text-4xl',
}

type AvatarUser = Pick<UserPublic, 'id' | 'name' | 'avatar_url'> &
  Partial<Pick<UserPublic, 'tier' | 'is_verified_playmaker'>>

export interface AvatarProps {
  user: AvatarUser
  size?: keyof typeof SIZES
  ring?: boolean
  showVerified?: boolean
  className?: string
}

/** Gradient-initials avatar (deterministic per user), tier ring and verified tick. */
export function Avatar({ user, size = 'md', ring = false, showVerified = true, className }: AvatarProps) {
  const hue = hueFrom(user.id)
  const tier = user.tier ? TIERS[user.tier] : null
  return (
    <span className={cn('relative inline-flex shrink-0', className)}>
      <span
        className={cn(
          'inline-flex items-center justify-center overflow-hidden rounded-full font-display font-semibold text-snow',
          SIZES[size],
          ring && tier && `ring-2 ring-offset-2 ring-offset-ink-900 ${tier.ring}`,
        )}
        style={{
          background: `linear-gradient(135deg, hsl(${hue} 85% 55%), hsl(${(hue + 60) % 360} 80% 35%))`,
        }}
      >
        {user.avatar_url ? (
          <img src={user.avatar_url} alt={user.name} className="h-full w-full object-cover" loading="lazy" />
        ) : (
          initials(user.name)
        )}
      </span>
      {showVerified && user.is_verified_playmaker && (
        <BadgeCheck
          aria-label="Verified Playmaker"
          className={cn(
            'absolute -right-0.5 -bottom-0.5 fill-volt text-ink-900',
            size === 'xs' || size === 'sm' ? 'h-3.5 w-3.5' : 'h-5 w-5',
          )}
        />
      )}
    </span>
  )
}

export function AvatarStack({
  users,
  max = 5,
  size = 'sm',
  total,
}: {
  users: AvatarUser[]
  max?: number
  size?: keyof typeof SIZES
  total?: number
}) {
  const shown = users.slice(0, max)
  const extra = (total ?? users.length) - shown.length
  return (
    <div className="flex items-center -space-x-2">
      {shown.map((u) => (
        <Avatar key={u.id} user={u} size={size} showVerified={false} className="rounded-full ring-2 ring-ink-800" />
      ))}
      {extra > 0 && (
        <span
          className={cn(
            'inline-flex items-center justify-center rounded-full bg-ink-600 font-semibold text-fg/80 ring-2 ring-ink-800',
            SIZES[size],
          )}
        >
          +{extra}
        </span>
      )}
    </div>
  )
}
