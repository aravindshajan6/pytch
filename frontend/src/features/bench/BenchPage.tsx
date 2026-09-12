import { useMutation, useQueryClient } from '@tanstack/react-query'
import { animate } from 'animejs'
import { Loader2, Power, Radio, Scale, Sparkles, Zap } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { AnimatedNumber } from '@/components/ui/AnimatedNumber'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { FilterChip } from '@/components/ui/Chip'
import { Countdown } from '@/components/ui/Countdown'
import { Label, Slider } from '@/components/ui/Form'
import { Segmented } from '@/components/ui/Segmented'
import { EmptyState, ErrorState, PageHeader, Skeleton } from '@/components/ui/States'
import { usePayFlow } from '@/features/payments/PaymentSheet'
import { useMe } from '@/hooks/useMe'
import { useMeta } from '@/hooks/useMeta'
import { errorMessage, isApiError } from '@/lib/api/client'
import { api } from '@/lib/api/endpoints'
import { qk } from '@/lib/api/queryKeys'
import { celebrate } from '@/lib/celebrate'
import { cn } from '@/lib/cn'
import { formatWhen } from '@/lib/format'
import { useRealtimeEvent } from '@/lib/realtime'
import { SPORT_LIST, SPORTS } from '@/lib/sports'
import type { LobbyDetail, SOSRequest, Sport } from '@/types/api'
import {
  type BenchSettings,
  useBenchCenter,
  useBenchDefaults,
  useBenchNearby,
  useBenchStatus,
  useBenchToggle,
  useSosFeed,
} from './api'
import { Radar } from './components/Radar'
import { SosCard } from './components/SosCard'

const DURATIONS = [
  { value: '60', label: '1h' },
  { value: '120', label: '2h' },
  { value: '240', label: '4h' },
] as const

type Reservation = { sos: SOSRequest; lobby: LobbyDetail }

export default function BenchPage() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const reduce = useReducedMotion()
  const meta = useMeta()
  const { user } = useMe()
  const status = useBenchStatus()
  const defaults = useBenchDefaults(status.data)
  const { goLive, goOff, pending, update } = useBenchToggle()
  const pay = usePayFlow()

  const [radiusDraft, setRadiusDraft] = useState<number | null>(null)
  const [sportsDraft, setSportsDraft] = useState<Sport[] | null>(null)
  const [duration, setDuration] = useState<(typeof DURATIONS)[number]['value']>('120')
  const radius = radiusDraft ?? defaults.radius_km
  const sports = sportsDraft ?? defaults.sports
  const active = !!status.data?.is_active

  const center = useBenchCenter(status.data)
  const nearby = useBenchNearby(center, radius, sports.length === 1 ? sports[0] : undefined)
  const sosQ = useSosFeed()

  const [fresh, setFresh] = useState<ReadonlySet<string>>(new Set())
  const [reservations, setReservations] = useState<Record<string, Reservation>>({})
  const [acceptingId, setAcceptingId] = useState<string | null>(null)
  const [decliningId, setDecliningId] = useState<string | null>(null)
  const flashRef = useRef<HTMLDivElement>(null)
  const syncTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const freshTimers = useRef<ReturnType<typeof setTimeout>[]>([])

  useEffect(
    () => () => {
      clearTimeout(syncTimer.current)
      freshTimers.current.forEach(clearTimeout)
    },
    [],
  )

  const discount = meta.data?.sub_discount_pct ?? 20

  // ───────── bench controls ─────────

  const onToggle = async () => {
    navigator.vibrate?.(20)
    try {
      if (active) {
        await goOff()
        toast('Off the bench', { description: 'Enjoy the rest of your day 👋' })
      } else {
        if (!sports.length) return void toast.error('Pick at least one sport')
        await goLive({ radius_km: radius, sports, duration_minutes: Number(duration) })
        toast.success("You're live on the bench", {
          description: `We'll buzz you when a game within ${radius} km needs a sub.`,
        })
      }
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  /** While live, push radius/sports tweaks to the server (debounced, keeps the remaining time). */
  const scheduleSync = (patch: Partial<BenchSettings>) => {
    const s = status.data
    if (!s?.is_active) return
    clearTimeout(syncTimer.current)
    syncTimer.current = setTimeout(() => {
      const remaining = s.active_until ? new Date(s.active_until).getTime() - Date.now() : 120 * 60000
      update.mutate(
        {
          is_active: true,
          lat: s.lat,
          lng: s.lng,
          radius_km: patch.radius_km ?? radius,
          sports: patch.sports ?? sports,
          duration_minutes: Math.min(240, Math.max(30, Math.round(remaining / 60000))),
        },
        { onError: (e) => toast.error(errorMessage(e)) },
      )
    }, 650)
  }

  const onRadius = (v: number) => {
    setRadiusDraft(v)
    scheduleSync({ radius_km: v })
  }

  const toggleSport = (sp: Sport) => {
    const next = sports.includes(sp) ? sports.filter((x) => x !== sp) : [...sports, sp]
    if (!next.length) return void toast('Keep at least one sport on')
    setSportsDraft(next)
    scheduleSync({ sports: next })
  }

  const onDuration = (v: (typeof DURATIONS)[number]['value']) => {
    setDuration(v)
    const s = status.data
    if (!s?.is_active) return
    update.mutate(
      { is_active: true, lat: s.lat, lng: s.lng, radius_km: radius, sports, duration_minutes: Number(v) },
      {
        onSuccess: () => toast.success(`Bench timer reset to ${DURATIONS.find((d) => d.value === v)?.label}`),
        onError: (e) => toast.error(errorMessage(e)),
      },
    )
  }

  // ───────── SOS feed ─────────

  const flash = () => {
    navigator.vibrate?.([90, 50, 90])
    if (!reduce && flashRef.current) animate(flashRef.current, { opacity: [0, 0.85, 0], duration: 1100, ease: 'outQuad' })
  }

  const markFresh = (id: string) => {
    setFresh((f) => (f.has(id) ? f : new Set(f).add(id)))
    freshTimers.current.push(
      setTimeout(
        () =>
          setFresh((f) => {
            const n = new Set(f)
            n.delete(id)
            return n
          }),
        2500,
      ),
    )
  }

  const insertSos = (sos: SOSRequest) => {
    qc.setQueryData<SOSRequest[]>(qk.sos, (old = []) => [sos, ...old.filter((s) => s.id !== sos.id)])
    const already = fresh.has(sos.id)
    markFresh(sos.id)
    if (!already) flash()
  }

  const removeSos = (id: string) => {
    qc.setQueryData<SOSRequest[]>(qk.sos, (old) => old?.filter((s) => s.id !== id))
    setReservations(({ [id]: _drop, ...rest }) => rest)
  }

  useRealtimeEvent('sos.new', insertSos)
  useRealtimeEvent('sos.closed', ({ sos_id }) => {
    if (reservations[sos_id]) return // our reserved seat — keep it until paid/expired
    qc.setQueryData<SOSRequest[]>(qk.sos, (old) => old?.filter((s) => s.id !== sos_id))
  })

  const simulate = useMutation({
    mutationFn: api.dev.sosNearMe,
    onSuccess: (sos) => insertSos(sos),
    onError: (e) => toast.error(errorMessage(e)),
  })

  const startPay = ({ sos, lobby }: Reservation) =>
    pay.start({
      title: `Sub in: ${lobby.title}`,
      subtitle: `${lobby.turf.name} · ${formatWhen(lobby.start_at)} · seat held 5 min`,
      amountPaise: lobby.my_membership?.share_paise ?? sos.discounted_share_paise,
      createIntent: (useCredits) => api.lobbies.pay(lobby.id, useCredits),
      onSuccess: () => {
        celebrate()
        toast.success('Hero Sub! 🦸', { description: `You saved ${lobby.title}. +150 XP incoming.` })
        qc.invalidateQueries({ queryKey: qk.sos })
        qc.invalidateQueries({ queryKey: qk.bench })
        qc.invalidateQueries({ queryKey: qk.lobbiesAll })
        qc.invalidateQueries({ queryKey: qk.gamification })
        setTimeout(() => navigate(`/app/lobby/${lobby.id}`), 1300)
      },
    })

  const accept = async (sos: SOSRequest) => {
    setAcceptingId(sos.id)
    navigator.vibrate?.(25)
    try {
      const { lobby } = await api.bench.accept(sos.id)
      const r = { sos, lobby }
      setReservations((prev) => ({ ...prev, [sos.id]: r }))
      startPay(r)
    } catch (e) {
      if (isApiError(e, 'SOS_CLOSED')) {
        toast.error('Too slow — that spot just got filled', { description: 'Stay live, another one will come.' })
        removeSos(sos.id)
      } else if (isApiError(e, 'ALREADY_MEMBER')) {
        navigate(`/app/lobby/${sos.lobby.id}`)
      } else if (isApiError(e, 'NOT_ELIGIBLE')) {
        const reasons = (e.details as { reasons?: string[] } | undefined)?.reasons
        toast.error("You can't sub in this one", { description: reasons?.join(' · ') || e.message })
      } else toast.error(errorMessage(e))
    } finally {
      setAcceptingId(null)
    }
  }

  const decline = async (sos: SOSRequest) => {
    setDecliningId(sos.id)
    try {
      await api.bench.decline(sos.id)
      removeSos(sos.id)
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setDecliningId(null)
    }
  }

  const sosList = useMemo(() => {
    const feed = (sosQ.data ?? []).filter((s) => s.status === 'open')
    const extra = Object.values(reservations)
      .map((r) => r.sos)
      .filter((s) => !feed.some((f) => f.id === s.id))
    return [...extra, ...feed]
  }, [sosQ.data, reservations])

  const count = nearby.data?.count ?? 0
  const sportLabel = sports.length === SPORT_LIST.length ? 'all sports' : sports.map((s) => SPORTS[s].label).join(', ')

  // ───────── render ─────────

  return (
    <div className="relative">
      <div
        ref={flashRef}
        aria-hidden
        className="pointer-events-none fixed inset-0 z-[60] opacity-0"
        style={{ background: 'radial-gradient(ellipse at center, color-mix(in srgb, var(--color-flare) 5%, transparent) 30%, color-mix(in srgb, var(--color-flare) 55%, transparent) 100%)' }}
      />

      <PageHeader
        eyebrow="Live Bench"
        title={
          <>
            Ready to <span className="text-gradient-volt">sub</span>?
          </>
        }
        subtitle="Go live and get first dibs when a game near you is a player short."
        actions={
          meta.data?.demo_mode && (
            <Button variant="outline" size="sm" onClick={() => simulate.mutate()} loading={simulate.isPending}>
              <Sparkles className="h-3.5 w-3.5" /> Simulate an SOS near me
            </Button>
          )
        }
      />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,460px)_minmax(0,1fr)] lg:grid-rows-[auto_auto_1fr] lg:items-start xl:gap-8">
        {/* A — radar + toggle */}
        <section className="space-y-4 lg:col-start-1 lg:row-start-1">
          <Card className="p-5 sm:p-6">
            {status.isLoading ? (
              <Skeleton className="mx-auto aspect-square w-full max-w-[380px] rounded-full" />
            ) : (
              <Radar
                className="mx-auto max-w-[380px]"
                center={center}
                radiusKm={radius}
                blips={nearby.data?.blips ?? []}
                active={active}
              >
                {user ? (
                  <Avatar user={user} size="md" ring showVerified={false} className="rounded-full ring-2 ring-ink-900" />
                ) : undefined}
              </Radar>
            )}
            <div className="mt-5 flex items-end justify-between gap-4">
              <div>
                <div className="flex items-baseline gap-2">
                  <AnimatedNumber value={count} className={cn('font-display text-5xl font-bold', active ? 'text-volt' : 'text-fg')} />
                  <span className="text-sm text-muted">{count === 1 ? 'player' : 'players'}</span>
                </div>
                <p className="mt-1 text-sm text-muted">
                  on the bench within <span className="font-semibold text-fg">{radius} km</span> · {sportLabel}
                </p>
              </div>
              {nearby.isFetching && <Loader2 className="mb-1 h-4 w-4 animate-spin text-subtle" aria-label="Refreshing" />}
            </div>
          </Card>

          <ReadyToggle
            active={active}
            pending={pending || status.isLoading}
            activeUntil={status.data?.active_until ?? null}
            onToggle={onToggle}
            onExpire={() => qc.invalidateQueries({ queryKey: qk.bench })}
          />
        </section>

        {/* B — SOS feed */}
        <section className="space-y-4 lg:col-start-2 lg:row-span-3 lg:row-start-1" aria-live="polite">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              <span className="relative flex h-2.5 w-2.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-flare opacity-70" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-flare" />
              </span>
              SOS calls
              {sosList.length > 0 && (
                <span className="rounded-full bg-flare px-2 py-0.5 text-xs font-bold text-snow">{sosList.length}</span>
              )}
            </h2>
            <span className="text-xs text-muted">{discount}% off every sub spot</span>
          </div>

          {sosQ.isLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-60" />
              <Skeleton className="h-60 opacity-60" />
            </div>
          ) : sosQ.isError ? (
            <ErrorState error={sosQ.error} onRetry={() => sosQ.refetch()} />
          ) : sosList.length === 0 ? (
            <EmptyState
              icon={active ? <ScanningIcon /> : '📡'}
              title={active ? 'Scanning the area…' : 'Go live to catch SOS calls'}
              description={
                active
                  ? "No SOS right now. Keep this on — we'll buzz you the second a game needs you."
                  : `When a nearby game loses a player within ${meta.data?.sos_window_hours ?? 6} h of kick-off, benchers get first dibs at ${discount}% off.`
              }
              action={
                meta.data?.demo_mode && (
                  <Button variant="secondary" size="sm" onClick={() => simulate.mutate()} loading={simulate.isPending}>
                    <Sparkles className="h-3.5 w-3.5" /> Simulate one
                  </Button>
                )
              }
            />
          ) : (
            <div className="space-y-4">
              <AnimatePresence initial={false} mode="popLayout">
                {sosList.map((sos) => (
                  <SosCard
                    key={sos.id}
                    sos={sos}
                    fresh={fresh.has(sos.id)}
                    reservation={reservations[sos.id]?.lobby ?? null}
                    accepting={acceptingId === sos.id}
                    declining={decliningId === sos.id}
                    onAccept={() => accept(sos)}
                    onDecline={() => decline(sos)}
                    onPay={() => reservations[sos.id] && startPay(reservations[sos.id]!)}
                    onReservationExpired={() => {
                      setReservations(({ [sos.id]: _gone, ...rest }) => rest)
                      qc.invalidateQueries({ queryKey: qk.sos })
                      toast("Your reserved seat was released", { description: 'Tap “I’m in” again if it’s still open.' })
                    }}
                  />
                ))}
              </AnimatePresence>
            </div>
          )}

          <InfoCards discount={discount} subsMade={status.data?.subs_made ?? 0} />
        </section>

        {/* C — settings */}
        <section className="lg:col-start-1 lg:row-start-2">
          <Card className="space-y-6 p-5 sm:p-6">
            <label className="block">
              <span className="flex items-baseline justify-between">
                <span className="mb-2 block text-xs font-semibold tracking-wider text-muted uppercase">Radius</span>
                <span className="font-display text-lg font-semibold">
                  {radius} <span className="text-sm text-muted">km</span>
                </span>
              </span>
              <Slider value={radius} onChange={onRadius} min={1} max={15} className="mt-1" />
              <span className="mt-1.5 flex justify-between text-[10px] text-subtle">
                <span>1 km</span>
                <span>15 km</span>
              </span>
            </label>
            <div>
              <Label>Sports</Label>
              <div className="flex flex-wrap gap-2">
                {SPORT_LIST.map((sp) => (
                  <FilterChip key={sp} active={sports.includes(sp)} onClick={() => toggleSport(sp)} aria-pressed={sports.includes(sp)}>
                    <span>{SPORTS[sp].emoji}</span> {SPORTS[sp].label}
                  </FilterChip>
                ))}
              </div>
            </div>
            <div>
              <Label>Stay live for</Label>
              <Segmented value={duration} onChange={onDuration} options={[...DURATIONS]} className="w-full" />
              <p className="mt-2 text-xs text-subtle">
                {active ? 'Changing this restarts your timer.' : 'The bench switches itself off so it never goes stale.'}
              </p>
            </div>
          </Card>
        </section>
      </div>

      {pay.sheet}
    </div>
  )
}

// ───────────────────────── pieces ─────────────────────────

function ReadyToggle({
  active,
  pending,
  activeUntil,
  onToggle,
  onExpire,
}: {
  active: boolean
  pending: boolean
  activeUntil: string | null
  onToggle: () => void
  onExpire: () => void
}) {
  const reduce = useReducedMotion()
  return (
    <div>
      <motion.button
        type="button"
        role="switch"
        aria-checked={active}
        aria-label="Ready to sub"
        disabled={pending}
        onClick={onToggle}
        whileTap={{ scale: 0.97 }}
        className={cn(
          'relative flex h-20 w-full cursor-pointer items-center overflow-hidden rounded-[1.75rem] p-2 transition-[background,box-shadow] duration-500 disabled:cursor-wait',
          active ? 'justify-end bg-volt text-ink-950 shadow-glow-volt' : 'justify-start bg-white/5 text-fg ring-1 ring-white/12',
        )}
      >
        {active && !reduce && (
          <motion.span
            aria-hidden
            className="pointer-events-none absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-snow/45 to-transparent"
            initial={{ x: '-120%' }}
            animate={{ x: '360%' }}
            transition={{ repeat: Infinity, duration: 2.4, ease: 'easeInOut', repeatDelay: 0.8 }}
          />
        )}
        <span className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-display text-lg font-bold tracking-wide uppercase sm:text-xl">
            {active ? "You're live" : 'Ready to sub'}
          </span>
          <span className={cn('text-xs', active ? 'text-ink-950/70' : 'text-muted')}>
            {active ? 'Tap to go off the bench' : 'Tap to go live'}
          </span>
        </span>
        <motion.span
          layout
          transition={{ type: 'spring', stiffness: 520, damping: 34 }}
          className={cn(
            'relative z-10 flex h-16 w-16 items-center justify-center rounded-[1.4rem] shadow-lg',
            active ? 'bg-ink-950 text-volt' : 'bg-volt text-ink-950',
          )}
        >
          {pending ? <Loader2 className="h-6 w-6 animate-spin" /> : active ? <Radio className="h-7 w-7" /> : <Power className="h-7 w-7" />}
        </motion.span>
      </motion.button>
      <AnimatePresence>
        {active && activeUntil && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="flex items-center justify-center gap-2 pt-3 text-sm text-muted"
          >
            Auto-off in <Countdown to={activeUntil} className="text-sm font-semibold" urgentMs={10 * 60 * 1000} onExpire={onExpire} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function ScanningIcon() {
  return (
    <span className="relative mx-auto flex h-14 w-14 items-center justify-center">
      <span className="absolute inset-0 animate-pulse-ring rounded-full bg-volt/30" />
      <span className="absolute inset-0 animate-sweep rounded-full" style={{ background: 'conic-gradient(from 0deg, transparent 270deg, color-mix(in srgb, var(--color-volt) 60%, transparent))' }} />
      <span className="relative h-3 w-3 rounded-full bg-volt" />
    </span>
  )
}

function InfoCards({ discount, subsMade }: { discount: number; subsMade: number }) {
  return (
    <div className="grid gap-4 pt-2 sm:grid-cols-2">
      <Card className="p-5">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-electric/12 text-electric ring-1 ring-electric/30">
          <Scale className="h-5 w-5" />
        </div>
        <h3 className="mt-3 font-display text-base font-semibold">The dropout rule</h3>
        <p className="mt-1.5 text-sm leading-relaxed text-muted">
          Subs pay <span className="font-semibold text-volt">{discount}% less</span>. The player who dropped out is credited only
          what you pay — the {discount}% is their penalty, not the host's problem.
        </p>
      </Card>
      <Card className="relative overflow-hidden p-5">
        <div aria-hidden className="pointer-events-none absolute -right-8 -bottom-10 h-36 w-36 rounded-full bg-grape/25 blur-3xl" />
        <div className="flex items-center justify-between">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-grape/15 text-2xl ring-1 ring-grape/40">🦸</div>
          <span className="inline-flex items-center gap-1 rounded-full bg-volt/12 px-2.5 py-1 text-xs font-bold text-volt ring-1 ring-volt/30">
            <Zap className="h-3.5 w-3.5" /> +150 XP
          </span>
        </div>
        <h3 className="mt-3 font-display text-base font-semibold">Become a Hero Sub</h3>
        <p className="mt-1.5 text-sm leading-relaxed text-muted">
          Save a game, earn big XP and unlock the <span className="font-semibold text-[var(--color-grape-soft)]">Hero Sub</span> badge. Every
          sub shows on your player card.
        </p>
        <div className="mt-3 text-xs text-subtle">
          You've subbed <span className="font-display text-sm font-semibold text-fg">{subsMade}</span>{' '}
          {subsMade === 1 ? 'time' : 'times'}
          {subsMade === 0 && ' — your first save is one tap away.'}
        </div>
      </Card>
    </div>
  )
}
