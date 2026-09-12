import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, Globe, Lock, ShieldCheck, Timer, Users, Video, Wallet } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { AnimatedNumber } from '@/components/ui/AnimatedNumber'
import { Button } from '@/components/ui/Button'
import { Input, Label, Slider, Stepper, Switch, Textarea } from '@/components/ui/Form'
import { Segmented } from '@/components/ui/Segmented'
import { Sheet } from '@/components/ui/Sheet'
import { useMeta } from '@/hooks/useMeta'
import { errorMessage, isApiError } from '@/lib/api/client'
import { api } from '@/lib/api/endpoints'
import { qk } from '@/lib/api/queryKeys'
import { cn } from '@/lib/cn'
import { formatDay, formatHour, formatINR, formatSlotRange } from '@/lib/format'
import { sportInfo } from '@/lib/sports'
import { BookingsPaused } from './BookingsPaused'
import type { LobbyMode, Pitch, Slot, TurfDetail, Visibility } from '@/types/api'

export interface BookingSheetProps {
  slot: Slot | null
  pitch: Pitch | undefined
  turf: TurfDetail
  onClose: () => void
  /** Called when the slot turned out to be locked/unavailable so the grid can refresh. */
  onConflict: () => void
}

export function BookingSheet({ slot, pitch, turf, onClose, onConflict }: BookingSheetProps) {
  const open = !!slot && !!pitch
  return (
    <Sheet
      open={open}
      onClose={onClose}
      size="lg"
      title={slot ? `Book ${formatSlotRange(slot.start_at, slot.end_at)}` : undefined}
      description={slot && pitch ? `${formatDay(slot.start_at)} · ${pitch.name} · ${turf.name}` : undefined}
    >
      {slot && pitch && <BookingForm key={slot.id} slot={slot} pitch={pitch} onClose={onClose} onConflict={onConflict} />}
    </Sheet>
  )
}

const shareOf = (total: number, players: number) => Math.ceil(total / players / 100) * 100

function BookingForm({
  slot,
  pitch,
  onClose,
  onConflict,
}: {
  slot: Slot
  pitch: Pitch
  onClose: () => void
  onConflict: () => void
}) {
  const meta = useMeta().data
  const navigate = useNavigate()
  const qc = useQueryClient()
  const paused = meta?.bookings_enabled === false

  const [mode, setMode] = useState<LobbyMode>('split')
  const [players, setPlayers] = useState(pitch.capacity)
  const [visibility, setVisibility] = useState<Visibility>('public')
  const [title, setTitle] = useState('')
  const [recorded, setRecorded] = useState(false)
  const [gateOn, setGateOn] = useState(false)
  const [minTs, setMinTs] = useState(55)
  const [verifiedOnly, setVerifiedOnly] = useState(false)
  const [notes, setNotes] = useState('')

  const pitchFee = slot.price_paise
  const cameraFee = recorded && pitch.has_camera ? pitch.camera_price_paise : 0
  const total = pitchFee + cameraFee
  const share = shareOf(total, players)
  const splitMin = meta?.split_window_minutes ?? 30
  const fullMin = meta?.full_hold_minutes ?? 10
  const defaultTitle = `${sportInfo(pitch.sport).label} ${pitch.format} · ${formatHour(slot.start_at)}`

  const book = useMutation({
    mutationFn: () =>
      api.bookings.create({
        slot_id: slot.id,
        mode,
        total_spots: players,
        visibility,
        title: title.trim() || defaultTitle,
        recorded: pitch.has_camera ? recorded : false,
        min_true_skill: gateOn ? minTs : null,
        verified_only: verifiedOnly,
        notes: notes.trim() || null,
      }),
    onSuccess: (res) => {
      qc.setQueryData(qk.lobby(res.lobby.id), res.lobby)
      qc.invalidateQueries({ queryKey: qk.slotsAll })
      qc.invalidateQueries({ queryKey: qk.lobbiesAll })
      toast.success(mode === 'split' ? 'Slot held — lobby is live!' : 'Slot held — complete your payment')
      navigate(`/app/lobby/${res.lobby.id}?pay=1`)
    },
    onError: (e) => {
      if (isApiError(e, 'SLOT_LOCKED')) {
        toast.warning('Someone is checking out this slot right now — try another or wait a minute')
        onConflict()
        onClose()
      } else if (isApiError(e, 'SLOT_UNAVAILABLE')) {
        toast.error('That slot was just taken', { description: 'The grid has been refreshed — pick another time.' })
        onConflict()
        onClose()
      } else if (isApiError(e, 'LIMIT_REACHED')) {
        // max unpaid open bookings per host (2 split + 1 full)
        toast.error('Too many bookings on hold', {
          description: errorMessage(e),
          action: { label: 'My matches', onClick: () => navigate('/app/matches') },
        })
      } else if (isApiError(e, 'RATE_LIMITED')) {
        toast.error('Slow down a little', { description: 'Too many bookings in a few minutes — try again shortly.' })
      } else if (isApiError(e, 'BOOKINGS_PAUSED')) {
        toast.error('Bookings are paused right now', { description: 'Please try again soon.' })
        qc.invalidateQueries({ queryKey: qk.meta }) // pick up the switch → the notice shows up front
      } else toast.error(errorMessage(e))
    },
  })

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (!paused) book.mutate()
      }}
      className="space-y-6"
    >
      {/* Mode */}
      <fieldset>
        <legend className="mb-2 block text-xs font-semibold tracking-wider text-muted uppercase">How are we paying?</legend>
        <div role="radiogroup" className="grid gap-3 sm:grid-cols-2">
          <ModeCard
            active={mode === 'split'}
            onClick={() => setMode('split')}
            icon={<Users className="h-5 w-5" />}
            title="Split"
            tag="All-or-nothing"
            tone="volt"
          >
            Everyone pays <b className="text-fg">{formatINR(share)}</b> within {splitMin} min. No full payment, no game — nobody chases anyone.
          </ModeCard>
          <ModeCard
            active={mode === 'full'}
            onClick={() => setMode('full')}
            icon={<Wallet className="h-5 w-5" />}
            title="Full"
            tag="Host fronts"
            tone="electric"
          >
            You pay <b className="text-fg">{formatINR(total)}</b> now; teammates who join reimburse you automatically.
          </ModeCard>
        </div>
      </fieldset>

      {/* Players + visibility */}
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <Label>Total players</Label>
          <div className="flex items-center justify-between rounded-2xl bg-white/4 p-2 pl-4 ring-1 ring-white/8">
            <span className="text-xs text-muted">
              incl. you · {pitch.format} fits {pitch.capacity}
            </span>
            <Stepper value={players} onChange={setPlayers} min={2} max={pitch.capacity + 4} label="players" />
          </div>
        </div>
        <div>
          <Label>Who can join</Label>
          <Segmented
            className="w-full"
            value={visibility}
            onChange={setVisibility}
            options={[
              { value: 'public', label: <><Globe className="h-4 w-4" /> Public</> },
              { value: 'private', label: <><Lock className="h-4 w-4" /> Invite only</> },
            ]}
          />
          <p className="mt-1.5 text-xs text-subtle">
            {visibility === 'public' ? 'Listed in Open matches — strangers can join.' : 'Hidden. Only people with your link or code.'}
          </p>
        </div>
      </div>

      <div>
        <Label htmlFor="bk-title">Match title</Label>
        <Input id="bk-title" value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} placeholder={defaultTitle} />
      </div>

      {/* Camera */}
      {pitch.has_camera && (
        <ToggleRow
          icon={<Video className="h-4 w-4 text-[var(--color-grape-soft)]" />}
          title="Record this match"
          hint={`+${formatINR(pitch.camera_price_paise)} camera fee, split with everyone · highlight reels after full time`}
          checked={recorded}
          onChange={setRecorded}
        />
      )}

      {/* Skill gate */}
      <div className="space-y-3 rounded-2xl bg-white/4 p-4 ring-1 ring-white/8">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-sm font-semibold">Minimum True Skill</div>
            <div className="text-xs text-muted">Peer-verified ratings — no self-rated "pros".</div>
          </div>
          <Switch checked={gateOn} onChange={setGateOn} label="Minimum True Skill" tone="electric" />
        </div>
        <AnimatePresence initial={false}>
          {gateOn && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden"
            >
              <div className="flex items-center gap-4 pt-1">
                <Slider value={minTs} onChange={setMinTs} min={40} max={90} />
                <span className="w-12 text-right font-display text-xl font-semibold text-electric">{minTs}</span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        <div className="flex items-center justify-between gap-4 border-t border-white/8 pt-3">
          <div className="flex items-center gap-2 text-sm">
            <ShieldCheck className="h-4 w-4 text-volt" /> Verified Playmakers only
          </div>
          <Switch checked={verifiedOnly} onChange={setVerifiedOnly} label="Verified Playmakers only" />
        </div>
      </div>

      <div>
        <Label htmlFor="bk-notes">Notes for players</Label>
        <Textarea
          id="bk-notes"
          value={notes}
          maxLength={500}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Bring both kits · friendly game · parking behind the turf"
          className="min-h-20"
        />
      </div>

      {/* Breakdown */}
      <div className="rounded-2xl bg-white/4 p-4 ring-1 ring-white/8">
        <Line label={`Pitch fee · ${formatSlotRange(slot.start_at, slot.end_at)}${slot.is_peak ? ' 🔥' : ''}`} value={formatINR(pitchFee)} />
        <AnimatePresence initial={false}>
          {cameraFee > 0 && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
              <Line label="Camera fee" value={formatINR(cameraFee)} className="pt-2" />
            </motion.div>
          )}
        </AnimatePresence>
        <Line label="Total" value={formatINR(total)} className="mt-2 border-t border-white/8 pt-2 font-semibold text-fg" />
        <div className="mt-3 flex items-end justify-between rounded-xl bg-volt/8 p-3 ring-1 ring-volt/25">
          <div>
            <div className="text-[11px] font-bold tracking-wider text-volt uppercase">Per player</div>
            <div className="text-xs text-muted">
              {formatINR(total)} ÷ {players} · rounded up to the rupee
            </div>
          </div>
          <AnimatedNumber
            value={share / 100}
            duration={0.5}
            format={(n) => formatINR(Math.round(n) * 100)}
            className="font-display text-3xl font-bold text-volt"
          />
        </div>
      </div>

      {/* Sticky submit */}
      <div className="sticky bottom-[calc(-1*max(env(safe-area-inset-bottom),0.5rem))] -mx-6 -mb-6 bg-gradient-to-t from-ink-700 via-ink-700 to-transparent px-6 pt-8 pb-[calc(1.5rem+max(env(safe-area-inset-bottom),0.5rem))] lg:bottom-0 lg:pb-6">
        {paused && <BookingsPaused className="mb-3" />}
        <Button type="submit" block size="lg" loading={book.isPending} disabled={paused}>
          {paused ? (
            <>Bookings paused</>
          ) : mode === 'split' ? (
            <>Hold slot & open lobby · you pay {formatINR(share)}</>
          ) : (
            <>Book & pay {formatINR(total)}</>
          )}
        </Button>
        <p className="mt-2 flex items-center justify-center gap-1.5 text-center text-xs text-subtle">
          <Timer className="h-3.5 w-3.5" />
          {mode === 'split'
            ? `We hold the slot for ${splitMin} min. If it isn't fully paid, everyone is refunded to credits.`
            : `Held for ${fullMin} min while you pay.`}
        </p>
      </div>
    </form>
  )
}

function ModeCard({
  active,
  onClick,
  icon,
  title,
  tag,
  tone,
  children,
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  title: string
  tag: string
  tone: 'volt' | 'electric'
  children: React.ReactNode
}) {
  const ring = tone === 'volt' ? 'ring-volt/70 bg-volt/[0.07]' : 'ring-electric/70 bg-electric/[0.07]'
  const iconBg = tone === 'volt' ? 'bg-volt text-ink-950' : 'bg-electric text-ink-950'
  return (
    <motion.button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      whileTap={{ scale: 0.98 }}
      className={cn(
        'relative cursor-pointer rounded-2xl p-4 text-left ring-1 transition-colors',
        active ? ring : 'bg-white/4 ring-white/10 hover:bg-white/7',
      )}
    >
      <div className="flex items-center gap-3">
        <span className={cn('flex h-10 w-10 items-center justify-center rounded-xl transition-colors', active ? iconBg : 'bg-white/8 text-fg/70')}>
          {icon}
        </span>
        <div className="flex-1">
          <div className="font-display text-base font-semibold">{title}</div>
          <div className={cn('text-[10px] font-bold tracking-wider uppercase', tone === 'volt' ? 'text-volt' : 'text-electric')}>{tag}</div>
        </div>
        <span
          className={cn(
            'flex h-6 w-6 items-center justify-center rounded-full ring-2 transition',
            active ? (tone === 'volt' ? 'bg-volt ring-volt' : 'bg-electric ring-electric') : 'ring-white/20',
          )}
        >
          <AnimatePresence>
            {active && (
              <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} transition={{ type: 'spring', stiffness: 600, damping: 22 }}>
                <Check className="h-3.5 w-3.5 text-ink-950" strokeWidth={3} />
              </motion.span>
            )}
          </AnimatePresence>
        </span>
      </div>
      <p className="mt-3 text-xs leading-relaxed text-muted">{children}</p>
    </motion.button>
  )
}

function ToggleRow({
  icon,
  title,
  hint,
  checked,
  onChange,
}: {
  icon: React.ReactNode
  title: string
  hint: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-2xl bg-white/4 p-4 ring-1 ring-white/8">
      <div className="flex items-start gap-3">
        <span className="mt-0.5">{icon}</span>
        <div>
          <div className="text-sm font-semibold">{title}</div>
          <div className="text-xs text-muted">{hint}</div>
        </div>
      </div>
      <Switch checked={checked} onChange={onChange} label={title} />
    </div>
  )
}

function Line({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className={cn('flex items-center justify-between text-sm text-muted', className)}>
      <span>{label}</span>
      <span className="font-mono text-fg">{value}</span>
    </div>
  )
}
