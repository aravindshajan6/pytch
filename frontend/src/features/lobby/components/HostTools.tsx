import { useQuery } from '@tanstack/react-query'
import { Ban, Crown, Radio, Scale, ShieldPlus, Siren } from 'lucide-react'
import { motion } from 'motion/react'
import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Stepper } from '@/components/ui/Form'
import { ProgressBar } from '@/components/ui/ProgressRing'
import { Sheet } from '@/components/ui/Sheet'
import { useCountdown } from '@/hooks/useCountdown'
import { useMeta } from '@/hooks/useMeta'
import { api } from '@/lib/api/endpoints'
import { qk } from '@/lib/api/queryKeys'
import { cn } from '@/lib/cn'
import { formatINR } from '@/lib/format'
import type { LobbyDetail, SOSRequest } from '@/types/api'
import { remainingToCover } from '../lib'

export interface HostToolsProps {
  lobby: LobbyDetail
  onCover: () => void
  onBalance: () => void
  balancing: boolean
  onSos: (spots: number) => Promise<unknown>
  onCancel: () => void
}

/** Host-only controls: cover remaining, balance teams, SOS the bench, cancel. */
export function HostTools({ lobby, onCover, onBalance, balancing, onSos, onCancel }: HostToolsProps) {
  const [sosOpen, setSosOpen] = useState(false)
  const open = lobby.status === 'forming' || lobby.status === 'confirmed'
  if (!open) return null

  const remaining = remainingToCover(lobby)
  const canCover = lobby.mode === 'split' && lobby.status === 'forming' && lobby.paid_spots < lobby.total_spots
  const canSos = !lobby.open_sos && lobby.spots_left > 0
  const canBalance = lobby.members.length >= 2

  return (
    <section className="glass rounded-3xl p-5 sm:p-6" aria-label="Host tools">
      <h2 className="flex items-center gap-2 text-base font-semibold">
        <Crown className="h-4.5 w-4.5 fill-sun text-sun" /> Host tools
      </h2>
      <div className="mt-4 grid gap-2.5 sm:grid-cols-2">
        {canCover && (
          <Tool
            icon={<ShieldPlus className="h-5 w-5" />}
            tone="electric"
            title={`Cover remaining ${formatINR(remaining)}`}
            hint={`Lock the game now — you pay the ${lobby.total_spots - lobby.paid_spots} unpaid seat${lobby.total_spots - lobby.paid_spots === 1 ? '' : 's'}.`}
            onClick={onCover}
          />
        )}
        {canBalance && (
          <Tool
            icon={<Scale className="h-5 w-5" />}
            tone="volt"
            title={lobby.members.some((m) => m.team) ? 'Re-balance teams' : 'Balance teams'}
            hint="Snake draft on True Skill → two even sides."
            onClick={onBalance}
            busy={balancing}
          />
        )}
        {canSos && (
          <Tool
            icon={<Siren className="h-5 w-5" />}
            tone="flare"
            title="Send SOS to the bench"
            hint="Ping nearby subs ready to play right now."
            onClick={() => setSosOpen(true)}
          />
        )}
        <Tool icon={<Ban className="h-5 w-5" />} tone="neutral" title="Cancel match" hint="Everyone who paid is refunded to credits." onClick={onCancel} />
      </div>
      <SosSheet open={sosOpen} onClose={() => setSosOpen(false)} lobby={lobby} onSend={onSos} />
    </section>
  )
}

const TONES = {
  volt: 'text-volt bg-volt/10 ring-volt/25',
  electric: 'text-electric bg-electric/10 ring-electric/25',
  flare: 'text-flare bg-flare/10 ring-flare/30',
  neutral: 'text-muted bg-white/5 ring-white/10',
}

function Tool({
  icon,
  title,
  hint,
  onClick,
  tone,
  busy,
}: {
  icon: React.ReactNode
  title: string
  hint: string
  onClick: () => void
  tone: keyof typeof TONES
  busy?: boolean
}) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      disabled={busy}
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.98 }}
      className="group flex cursor-pointer items-start gap-3 rounded-2xl bg-white/[0.03] p-3.5 text-left ring-1 ring-white/8 transition-colors hover:bg-white/6 disabled:opacity-60"
    >
      <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ring-1', TONES[tone], busy && 'animate-pulse')}>{icon}</span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold">{title}</span>
        <span className="block text-xs text-muted">{hint}</span>
      </span>
    </motion.button>
  )
}

function SosSheet({
  open,
  onClose,
  lobby,
  onSend,
}: {
  open: boolean
  onClose: () => void
  lobby: LobbyDetail
  onSend: (spots: number) => Promise<unknown>
}) {
  const meta = useMeta().data
  const max = Math.max(1, lobby.spots_left)
  const [spots, setSpots] = useState(1)
  const [busy, setBusy] = useState(false)
  const radius = meta?.bench_default_radius_km ?? 5
  const nearby = useQuery({
    queryKey: qk.benchNearby(lobby.turf.lat, lobby.turf.lng, lobby.sport),
    queryFn: () => api.bench.nearby({ lat: lobby.turf.lat, lng: lobby.turf.lng, sport: lobby.sport, radius_km: radius }),
    enabled: open,
  })
  const discount = meta?.sub_discount_pct ?? 20
  const subPrice = Math.round((lobby.share_paise * (100 - discount)) / 100)

  return (
    <Sheet open={open} onClose={onClose} size="sm" title="SOS the bench" description="Players who toggled “Ready to sub” nearby get pinged instantly.">
      <div className="flex flex-col items-center py-2">
        <Radar count={nearby.data?.count} />
        <p className="mt-3 text-sm text-muted">
          {nearby.data ? (
            <>
              <b className="font-display text-lg text-fg">{nearby.data.count}</b> player{nearby.data.count === 1 ? '' : 's'} on the bench within {radius} km
            </>
          ) : (
            'Scanning the bench…'
          )}
        </p>
      </div>
      <div className="mt-4 flex items-center justify-between rounded-2xl bg-white/4 p-3 pl-4 ring-1 ring-white/8">
        <span className="text-sm">Spots to fill</span>
        <Stepper value={Math.min(spots, max)} onChange={setSpots} min={1} max={max} />
      </div>
      <p className="mt-3 text-xs text-muted">
        Subs get the seat at {discount}% off ({formatINR(subPrice)}). First to accept gets 5 minutes to pay.
      </p>
      <Button
        variant="danger"
        block
        size="lg"
        className="mt-5"
        loading={busy}
        onClick={async () => {
          setBusy(true)
          try {
            await onSend(Math.min(spots, max))
            onClose()
          } finally {
            setBusy(false)
          }
        }}
      >
        <Siren className="h-4 w-4" /> Send SOS · {Math.min(spots, max)} spot{spots > 1 ? 's' : ''}
      </Button>
    </Sheet>
  )
}

function Radar({ count, className }: { count?: number; className?: string }) {
  return (
    <div className={cn('relative h-28 w-28', className)} aria-hidden>
      <div className="absolute inset-0 rounded-full bg-flare/5 ring-1 ring-flare/20" />
      <div className="absolute inset-4 rounded-full ring-1 ring-flare/20" />
      <div className="absolute inset-8 rounded-full ring-1 ring-flare/25" />
      <div className="absolute inset-0 animate-sweep rounded-full bg-[conic-gradient(from_0deg,transparent_0deg,color-mix(in_srgb,_var(--color-flare)_45%,_transparent)_50deg,transparent_60deg)]" />
      <span className="absolute inset-[42%] animate-pulse-ring rounded-full bg-flare/60" />
      <span className="absolute inset-[45%] rounded-full bg-flare" />
      {Array.from({ length: Math.min(count ?? 0, 8) }, (_, i) => {
        const a = (i * 137.5 * Math.PI) / 180
        const r = 22 + ((i * 29) % 26)
        return (
          <span
            key={i}
            className="absolute h-1.5 w-1.5 animate-blink rounded-full bg-volt shadow-[0_0_6px_color-mix(in_srgb,_var(--color-volt)_calc(90%*var(--glow-strength)),_transparent)]"
            style={{ left: `calc(50% + ${Math.cos(a) * r}px)`, top: `calc(50% + ${Math.sin(a) * r}px)`, animationDelay: `${i * 170}ms` }}
          />
        )
      })}
    </div>
  )
}

/** Visible to everyone in the lobby while the bench is being pinged. */
export function SosCard({ sos }: { sos: SOSRequest }) {
  const c = useCountdown(sos.expires_at)
  const done = sos.spots_filled >= sos.spots_needed
  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-flare/15 via-grape/8 to-transparent p-5 ring-1 ring-flare/30"
      aria-label="SOS status"
    >
      <div className="flex items-center gap-4">
        <Radar count={sos.spots_needed - sos.spots_filled + 2} className="h-20 w-20 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-xs font-bold tracking-[0.18em] text-flare uppercase">
            <Radio className="h-3.5 w-3.5" /> {done ? 'Subs found' : 'SOS live'}
          </div>
          <div className="mt-1 font-display text-lg font-semibold">
            {sos.spots_filled}/{sos.spots_needed} sub{sos.spots_needed === 1 ? '' : 's'} found
          </div>
          <ProgressBar value={sos.spots_needed ? sos.spots_filled / sos.spots_needed : 0} tone="flare" className="mt-2" />
          <div className="mt-2 text-xs text-muted">
            {sos.reason === 'dropout' ? 'Auto-triggered by a dropout' : 'Sent by the host'} · {sos.discount_pct}% off for subs
            {!c.expired && (
              <>
                {' '}
                · closes in <span className="font-mono text-fg/80">{c.label}</span>
              </>
            )}
          </div>
        </div>
      </div>
    </motion.section>
  )
}
