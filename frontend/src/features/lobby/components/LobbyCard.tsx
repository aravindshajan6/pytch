import { Lock, MapPin, ShieldCheck, Timer, Video } from 'lucide-react'
import { Link } from 'react-router'
import { Avatar, AvatarStack } from '@/components/ui/Avatar'
import { Card } from '@/components/ui/Card'
import { Chip } from '@/components/ui/Chip'
import { SportBadge } from '@/components/ui/PlayerBits'
import { ProgressBar } from '@/components/ui/ProgressRing'
import { TurfArt } from '@/components/ui/TurfArt'
import { useCountdown } from '@/hooks/useCountdown'
import { cn } from '@/lib/cn'
import { formatINR, formatKm, formatWhen } from '@/lib/format'
import type { LobbySummary } from '@/types/api'
import { STATUS_META, firstName } from '../lib'

export interface LobbyCardProps {
  lobby: LobbySummary
  /** Reasons the viewer can't join yet — renders a lock treatment. */
  lockedReasons?: string[]
  /** Extra actions under the card (rendered above the stretched link). */
  footer?: React.ReactNode
  className?: string
}

/** Feed / home / matches card for a lobby. The whole card links to the waiting room. */
export function LobbyCard({ lobby, lockedReasons, footer, className }: LobbyCardProps) {
  const locked = !!lockedReasons?.length
  const status = STATUS_META[lobby.status]
  const fill = lobby.total_spots ? lobby.filled_spots / lobby.total_spots : 0
  const almostFull = lobby.status === 'forming' && lobby.spots_left > 0 && lobby.spots_left <= 2
  const showDeadline = lobby.mode === 'split' && lobby.status === 'forming' && !!lobby.pay_deadline

  return (
    <Card spotlight interactive className={cn('group flex h-full flex-col', className)}>
      <TurfArt seed={lobby.turf.id} sport={lobby.sport} src={lobby.turf.cover_url} className="h-28 shrink-0">
        <div className="flex h-full flex-col justify-between p-3">
          <div className="flex items-start justify-between gap-2">
            <SportBadge sport={lobby.sport} format={lobby.format} className="bg-ink-900/70 backdrop-blur" />
            {lobby.status === 'forming' ? (
              <Chip tone={lobby.mode === 'split' ? 'sun' : 'electric'} size="xs" dot className="bg-ink-900/70 backdrop-blur">
                {lobby.mode === 'split' ? 'Split pay' : 'Host-fronted'}
              </Chip>
            ) : (
              <Chip tone={status.tone} size="xs" className="bg-ink-900/70 backdrop-blur">
                {status.label}
              </Chip>
            )}
          </div>
          <div className="flex items-end justify-between gap-2">
            <div className="text-sm font-semibold text-fg drop-shadow">{formatWhen(lobby.start_at)}</div>
            <div className="text-right leading-none">
              <div className="font-display text-xl font-bold text-volt drop-shadow-[0_0_12px_color-mix(in_srgb,_var(--color-volt)_45%,_transparent)]">
                {formatINR(lobby.share_paise)}
              </div>
              <div className="mt-0.5 text-[10px] font-medium tracking-wider text-fg/70 uppercase">per player</div>
            </div>
          </div>
        </div>
      </TurfArt>

      <div className={cn('flex flex-1 flex-col gap-3 p-4', locked && 'opacity-80')}>
        <div className="min-w-0">
          <h3 className="truncate text-base font-semibold">{lobby.title}</h3>
          <p className="mt-1 flex items-center gap-1 truncate text-xs text-muted">
            <MapPin className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">
              {lobby.turf.name} · {lobby.turf.area}
              {lobby.distance_km != null && ` · ${formatKm(lobby.distance_km)}`}
            </span>
          </p>
        </div>

        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <Avatar user={lobby.host} size="sm" />
            <div className="min-w-0 text-xs leading-tight">
              <div className="text-subtle">Hosted by</div>
              <div className="truncate font-semibold">{firstName(lobby.host)}</div>
            </div>
          </div>
          {lobby.member_avatars.length > 0 && (
            <AvatarStack users={lobby.member_avatars} max={4} size="xs" total={lobby.filled_spots} />
          )}
        </div>

        <div>
          <ProgressBar value={fill} tone={almostFull ? 'sun' : 'volt'} />
          <div className="mt-1.5 flex items-center justify-between text-[11px]">
            <span className={cn('font-semibold', almostFull ? 'text-sun' : 'text-fg/80')}>
              {lobby.spots_left > 0 ? `${lobby.spots_left} spot${lobby.spots_left === 1 ? '' : 's'} left` : 'Full squad'}
            </span>
            <span className="text-subtle">
              {lobby.filled_spots}/{lobby.total_spots} in · {lobby.paid_spots} paid
            </span>
          </div>
        </div>

        {(lobby.min_true_skill != null || lobby.verified_only || lobby.recorded || showDeadline || lobby.visibility === 'private') && (
          <div className="mt-auto flex flex-wrap items-center gap-1.5">
            {showDeadline && <PayWindow to={lobby.pay_deadline!} />}
            {lobby.min_true_skill != null && (
              <Chip tone="grape" size="xs">
                TS {Math.round(lobby.min_true_skill)}+
              </Chip>
            )}
            {lobby.verified_only && (
              <Chip tone="volt" size="xs">
                <ShieldCheck className="h-3 w-3" /> Verified only
              </Chip>
            )}
            {lobby.recorded && (
              <Chip tone="electric" size="xs">
                <Video className="h-3 w-3" /> Recorded
              </Chip>
            )}
            {lobby.visibility === 'private' && (
              <Chip size="xs">
                <Lock className="h-3 w-3" /> Private
              </Chip>
            )}
          </div>
        )}

        {locked && (
          <div className="rounded-xl bg-flare/8 p-2.5 ring-1 ring-flare/25">
            <div className="flex items-center gap-1.5 text-[11px] font-bold tracking-wider text-flare uppercase">
              <Lock className="h-3 w-3" /> Locked for you
            </div>
            <ul className="mt-1 space-y-0.5 text-xs text-fg/75">
              {lockedReasons!.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <Link
        to={`/app/lobby/${lobby.id}`}
        aria-label={`Open ${lobby.title}`}
        className="absolute inset-0 z-[1] rounded-3xl focus-visible:outline-offset-[-2px]"
      />
      {footer && <div className="relative z-[2] border-t border-white/8 px-4 py-3">{footer}</div>}
    </Card>
  )
}

function PayWindow({ to }: { to: string }) {
  const c = useCountdown(to)
  if (c.expired) return null
  const urgent = c.totalMs < 5 * 60 * 1000
  return (
    <Chip tone={urgent ? 'flare' : 'sun'} size="xs" className="font-mono tabular-nums">
      <Timer className="h-3 w-3" /> {c.label}
    </Chip>
  )
}

/** Skeleton matching LobbyCard's footprint. */
export function LobbyCardSkeleton() {
  return (
    <div className="glass overflow-hidden rounded-3xl">
      <div className="skeleton h-28" />
      <div className="space-y-3 p-4">
        <div className="skeleton h-4 w-2/3 rounded-lg" />
        <div className="skeleton h-3 w-1/2 rounded-lg" />
        <div className="flex items-center gap-2">
          <div className="skeleton h-8 w-8 rounded-full" />
          <div className="skeleton h-3 w-24 rounded-lg" />
        </div>
        <div className="skeleton h-2 w-full rounded-full" />
      </div>
    </div>
  )
}
