import { Clock, MapPin, ShieldCheck, Siren, X } from 'lucide-react'
import { motion, useReducedMotion } from 'motion/react'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { Countdown } from '@/components/ui/Countdown'
import { SportBadge } from '@/components/ui/PlayerBits'
import { TurfArt } from '@/components/ui/TurfArt'
import { cn } from '@/lib/cn'
import { formatINR, formatKm, formatWhen } from '@/lib/format'
import type { LobbyDetail, SOSRequest } from '@/types/api'

interface SosCardProps {
  sos: SOSRequest
  fresh?: boolean
  reservation?: LobbyDetail | null
  accepting?: boolean
  declining?: boolean
  onAccept: () => void
  onDecline: () => void
  onPay: () => void
  onReservationExpired?: () => void
}

export function SosCard({
  sos,
  fresh,
  reservation,
  accepting,
  declining,
  onAccept,
  onDecline,
  onPay,
  onReservationExpired,
}: SosCardProps) {
  const reduce = useReducedMotion()
  const lobby = sos.lobby
  const spotsLeft = Math.max(0, sos.spots_needed - sos.spots_filled)
  const reservedUntil = reservation?.my_membership?.reserved_until ?? null

  return (
    <motion.article
      layout
      initial={fresh && !reduce ? { opacity: 0, scale: 0.7, y: -40 } : { opacity: 0, y: 16 }}
      animate={
        fresh && !reduce
          ? { opacity: 1, scale: 1, y: 0, x: [0, -14, 14, -10, 10, -5, 5, 0] }
          : { opacity: 1, scale: 1, y: 0 }
      }
      exit={{ opacity: 0, x: -80, scale: 0.9, transition: { duration: 0.25 } }}
      transition={{ type: 'spring', stiffness: 380, damping: 26, x: { duration: 0.6, delay: 0.15 } }}
      className="relative overflow-hidden rounded-3xl bg-ink-800/80 shadow-glow-flare ring-1 ring-flare/40 backdrop-blur-xl"
    >
      {/* entrance flash */}
      {fresh && !reduce && (
        <motion.div
          aria-hidden
          className="pointer-events-none absolute inset-0 z-20 bg-flare"
          initial={{ opacity: 0.75 }}
          animate={{ opacity: 0 }}
          transition={{ duration: 0.9, ease: 'easeOut' }}
        />
      )}
      <div aria-hidden className="pointer-events-none absolute -top-20 -right-16 h-48 w-48 rounded-full bg-flare/25 blur-3xl" />

      {/* urgency strip */}
      <div className="relative flex items-center justify-between gap-2 bg-gradient-to-r from-flare/30 via-flare/10 to-transparent px-4 py-2">
        <div className="flex items-center gap-2 text-[11px] font-bold tracking-[0.2em] text-flare uppercase">
          <Siren className="h-4 w-4 animate-blink" />
          SOS · {sos.reason === 'dropout' ? 'Dropout' : 'Host call'}
        </div>
        <div className="flex items-center gap-1.5 text-[11px] text-fg/70">
          Offer ends <Countdown to={sos.expires_at} className="text-[11px] font-semibold" urgentMs={3 * 60 * 1000} />
        </div>
      </div>

      <div className="relative flex gap-4 p-4">
        <TurfArt seed={lobby.turf.id} sport={lobby.sport} src={lobby.turf.cover_url} className="hidden h-24 w-24 shrink-0 rounded-2xl sm:block" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <SportBadge sport={lobby.sport} format={lobby.format} />
            {lobby.min_true_skill != null && <Chip tone="electric" size="xs">TS {lobby.min_true_skill}+</Chip>}
            {lobby.verified_only && (
              <Chip tone="volt" size="xs">
                <ShieldCheck className="h-3 w-3" /> Verified only
              </Chip>
            )}
          </div>
          <h3 className="mt-2 truncate font-display text-lg font-semibold">{lobby.title}</h3>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
            <span className="flex items-center gap-1">
              <MapPin className="h-3.5 w-3.5" /> {lobby.turf.name} · {lobby.turf.area}
            </span>
            {sos.distance_km != null && <span className="font-semibold text-fg/85">{formatKm(sos.distance_km)} away</span>}
          </div>
          <div className="mt-1 flex items-center gap-1 text-xs text-muted">
            <Clock className="h-3.5 w-3.5" /> {formatWhen(lobby.start_at)}
          </div>
        </div>
      </div>

      <div className="relative grid grid-cols-3 gap-2 px-4">
        <div className="rounded-2xl bg-white/4 p-3 ring-1 ring-white/8">
          <div className="text-[10px] font-semibold tracking-wider text-muted uppercase">Kick-off in</div>
          <Countdown to={lobby.start_at} urgentMs={60 * 60 * 1000} className="mt-1 font-display text-base font-bold sm:text-lg" />
        </div>
        <div className="rounded-2xl bg-white/4 p-3 ring-1 ring-white/8">
          <div className="text-[10px] font-semibold tracking-wider text-muted uppercase">Needed</div>
          <div className="mt-1.5 flex items-center gap-1">
            {Array.from({ length: Math.min(sos.spots_needed, 5) }, (_, i) => (
              <span
                key={i}
                className={cn(
                  'h-3.5 w-3.5 rounded-full',
                  i < sos.spots_filled ? 'bg-mint' : 'animate-blink bg-flare shadow-[0_0_8px_var(--color-flare)]',
                )}
              />
            ))}
            <span className="ml-1 font-display text-sm font-bold">{spotsLeft}</span>
          </div>
        </div>
        <div className="rounded-2xl bg-volt/8 p-3 ring-1 ring-volt/25">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-semibold tracking-wider text-muted uppercase">You pay</span>
            <span className="rounded-md bg-volt px-1 text-[9px] font-black text-ink-950">{sos.discount_pct}% OFF</span>
          </div>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span className="font-display text-base font-bold text-volt sm:text-lg">{formatINR(sos.discounted_share_paise)}</span>
            <span className="text-[11px] text-subtle line-through">{formatINR(sos.original_share_paise)}</span>
          </div>
        </div>
      </div>

      <div className="relative flex items-center gap-3 p-4">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Avatar user={lobby.host} size="sm" />
          <div className="min-w-0 text-xs">
            <div className="truncate font-semibold">{lobby.host.name}</div>
            <div className="text-muted">Host · {lobby.filled_spots}/{lobby.total_spots} in</div>
          </div>
        </div>
        {reservation ? (
          <div className="flex items-center gap-2">
            {reservedUntil && (
              <span className="flex flex-col items-end text-[10px] leading-tight text-muted sm:flex-row sm:items-center sm:gap-1 sm:text-xs">
                Seat held
                <Countdown to={reservedUntil} className="text-xs" urgentMs={2 * 60 * 1000} onExpire={onReservationExpired} />
              </span>
            )}
            <Button onClick={onPay} className="shadow-glow-volt">
              Pay {formatINR(reservation.my_membership?.share_paise ?? sos.discounted_share_paise)}
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" aria-label="Decline" onClick={onDecline} loading={declining} disabled={accepting}>
              {!declining && <X className="h-5 w-5" />}
            </Button>
            <Button onClick={onAccept} loading={accepting} disabled={declining || spotsLeft === 0}>
              I'm in · Sub
            </Button>
          </div>
        )}
      </div>
    </motion.article>
  )
}
