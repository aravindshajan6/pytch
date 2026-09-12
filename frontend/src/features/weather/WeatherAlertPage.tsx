import { animate, svg } from 'animejs'
import { ArrowLeft, ArrowRight, CloudRain, Droplets, Home, MapPin, ShieldCheck, Umbrella, Wallet } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { toast } from 'sonner'
import { Button, LinkButton } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Chip } from '@/components/ui/Chip'
import { Countdown } from '@/components/ui/Countdown'
import { ProgressRing } from '@/components/ui/ProgressRing'
import { Sheet } from '@/components/ui/Sheet'
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States'
import { TurfArt } from '@/components/ui/TurfArt'
import { useMeta } from '@/hooks/useMeta'
import { errorMessage, isApiError } from '@/lib/api/client'
import { celebrate } from '@/lib/celebrate'
import { cn } from '@/lib/cn'
import { formatINR, formatKm, formatTime, formatWhen } from '@/lib/format'
import type { TransferAlternative, WeatherAlert } from '@/types/api'
import { useAlternatives, useDismissAlert, useRainCheck, useTransfer, useWeatherAlert } from './api'
import { RainCanvas } from './components/RainCanvas'

type Outcome =
  | { kind: 'transferred'; lobbyId: string; turf: string }
  | { kind: 'rain_checked'; refunded: number }
  | { kind: 'dismissed' }

export default function WeatherAlertPage() {
  const { alertId } = useParams()
  const q = useWeatherAlert(alertId)

  if (q.isLoading)
    return (
      <div className="space-y-5">
        <Skeleton className="h-[360px] rounded-[2rem]" />
        <div className="grid gap-4 sm:grid-cols-2">
          <Skeleton className="h-48" />
          <Skeleton className="h-48" />
        </div>
      </div>
    )
  if (q.isError || !q.data)
    return isApiError(q.error, 'NOT_FOUND') ? (
      <EmptyState icon="🌤️" title="Alert not found" description="It may have cleared up already." action={<LinkButton to="/app">Back home</LinkButton>} />
    ) : (
      <ErrorState error={q.error} onRetry={() => q.refetch()} />
    )
  return <AlertView alert={q.data} />
}

function AlertView({ alert }: { alert: WeatherAlert }) {
  const navigate = useNavigate()
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const status = outcome?.kind ?? alert.status
  const open = status === 'open'
  const sunny = status === 'transferred'

  return (
    <div className="space-y-6">
      <button
        onClick={() => navigate(-1)}
        className="inline-flex cursor-pointer items-center gap-1.5 text-sm text-muted transition hover:text-fg"
      >
        <ArrowLeft className="h-4 w-4" /> Back
      </button>

      <StormHero alert={alert} status={status} sunny={sunny} outcome={outcome} />

      {!open ? (
        <OutcomeCard alert={alert} status={status} outcome={outcome} />
      ) : alert.is_host ? (
        <HostOptions
          alert={alert}
          onResolved={(o) => {
            setOutcome(o)
            window.scrollTo({ top: 0, behavior: 'smooth' })
            if (o.kind === 'transferred') setTimeout(() => navigate(`/app/lobby/${o.lobbyId}`), 2600)
          }}
        />
      ) : (
        <MemberView alert={alert} />
      )}
    </div>
  )
}

// ───────────────────────── hero ─────────────────────────

function StormHero({
  alert,
  status,
  sunny,
  outcome,
}: {
  alert: WeatherAlert
  status: string
  sunny: boolean
  outcome: Outcome | null
}) {
  const reduce = useReducedMotion()
  const flashRef = useRef<HTMLDivElement>(null)
  const boltRef = useRef<SVGPathElement>(null)
  const [rainMounted, setRainMounted] = useState(!sunny)
  const warning = alert.severity === 'warning'
  const intensity = Math.min(1, Math.max(alert.precipitation_probability / 100, alert.precipitation_mm / 6))

  // Occasional lightning (warning severity only).
  useEffect(() => {
    if (reduce || status !== 'open' || !warning) return
    let timer: ReturnType<typeof setTimeout>
    const strike = () => {
      if (flashRef.current) animate(flashRef.current, { opacity: [0, 0.75, 0.1, 0.55, 0], duration: 750, ease: 'outQuad' })
      if (boltRef.current) {
        const [drawable] = svg.createDrawable(boltRef.current)
        if (drawable) animate(drawable, { draw: ['0 0', '0 1', '1 1'], opacity: [1, 1, 0], duration: 650, ease: 'outQuad' })
      }
      timer = setTimeout(strike, 3800 + Math.random() * 5200)
    }
    timer = setTimeout(strike, 1400)
    return () => clearTimeout(timer)
  }, [reduce, status, warning])

  return (
    // Storm sky = dark island: rain, lightning and the sunrise are night-tuned and stay so in light mode.
    <section
      data-theme="dark"
      className={cn(
        'relative isolate overflow-hidden rounded-[2rem] ring-1 transition-[box-shadow] duration-1000',
        sunny
          ? 'ring-sun/40 shadow-[0_30px_80px_-30px_color-mix(in_srgb,_var(--color-sun)_50%,_transparent)]'
          : 'ring-white/10 shadow-card [[data-theme=light]_&]:shadow-[0_28px_60px_-30px_rgb(14_42_26_/_0.55)]',
      )}
    >
      {/* sky */}
      <div className="absolute inset-0 -z-10 bg-gradient-to-b from-[#0d1624] via-[#0a121b] to-ink-900" />
      <motion.div
        aria-hidden
        className="absolute inset-0 -z-10 bg-gradient-to-b from-[#3a2a10] via-[#1d1a10] to-ink-900"
        initial={false}
        animate={{ opacity: sunny ? 1 : 0 }}
        transition={{ duration: 1.6 }}
      />
      {/* clouds */}
      <motion.div aria-hidden className="absolute inset-0 -z-10" initial={false} animate={{ opacity: sunny ? 0.25 : 1 }} transition={{ duration: 1.4 }}>
        <div className="absolute -top-24 -left-10 h-64 w-96 animate-float rounded-full bg-[#2a3a52]/70 blur-3xl" />
        <div className="absolute -top-20 right-0 h-56 w-80 animate-float rounded-full bg-[#1c2a40]/80 blur-3xl [animation-delay:-3s]" />
        <div className="absolute top-10 left-1/3 h-40 w-72 animate-float rounded-full bg-[#34405a]/50 blur-3xl [animation-delay:-1.5s]" />
      </motion.div>

      {/* rain */}
      <motion.div
        className="absolute inset-0 -z-10"
        initial={false}
        animate={{ opacity: sunny ? 0 : 1 }}
        transition={{ duration: 1.4 }}
        onAnimationComplete={() => sunny && setRainMounted(false)}
      >
        {(rainMounted || !sunny) && <RainCanvas intensity={intensity} />}
      </motion.div>

      {/* lightning */}
      {warning && status === 'open' && (
        <>
          <div ref={flashRef} aria-hidden className="pointer-events-none absolute inset-0 z-0 bg-[#cfe3ff] opacity-0 mix-blend-overlay" />
          <svg aria-hidden viewBox="0 0 100 200" className="pointer-events-none absolute top-0 right-[18%] z-0 h-3/4 w-24">
            <path
              ref={boltRef}
              d="M60 0 L42 70 L58 72 L35 140 L50 142 L30 200"
              fill="none"
              stroke="#e8f3ff"
              strokeWidth="2.5"
              strokeLinejoin="round"
              style={{ filter: 'drop-shadow(0 0 8px #9fd0ff)', opacity: 0 }}
            />
          </svg>
        </>
      )}

      {/* sun */}
      <AnimatePresence>
        {sunny && (
          <motion.div
            aria-hidden
            className="pointer-events-none absolute top-6 right-6 z-0 sm:top-8 sm:right-12"
            initial={{ y: 120, opacity: 0, scale: 0.6 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            transition={{ type: 'spring', stiffness: 60, damping: 14, delay: 0.4 }}
          >
            <div
              className="absolute top-1/2 left-1/2 h-72 w-72 -translate-x-1/2 -translate-y-1/2 animate-sweep rounded-full opacity-60"
              style={{
                animationDuration: '24s',
                background:
                  'repeating-conic-gradient(from 0deg, rgb(255 200 80 / 0.28) 0deg 6deg, transparent 6deg 18deg)',
                maskImage: 'radial-gradient(circle, black 20%, transparent 70%)',
                WebkitMaskImage: 'radial-gradient(circle, black 20%, transparent 70%)',
              }}
            />
            <div className="relative h-24 w-24 rounded-full bg-gradient-to-br from-[#fff3c4] via-sun to-[#ff8a1f] shadow-[0_0_80px_20px_color-mix(in_srgb,_var(--color-sun)_45%,_transparent)]" />
          </motion.div>
        )}
      </AnimatePresence>

      {/* content */}
      <div className="relative z-10 flex min-h-[340px] flex-col justify-between gap-8 p-6 sm:p-8">
        <div className="flex flex-wrap items-center gap-2">
          <AnimatePresence mode="wait" initial={false}>
            {sunny ? (
              <motion.span key="sun" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
                <Chip tone="sun" size="md">☀️ Sorted</Chip>
              </motion.span>
            ) : (
              <motion.span key="rain" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
                <Chip tone={warning ? 'flare' : 'sun'} size="md" dot>
                  {warning ? '⛈️ Rain warning' : '🌧️ Rain watch'}
                </Chip>
              </motion.span>
            )}
          </AnimatePresence>
          <Chip size="md">
            <MapPin className="h-3 w-3" /> {alert.turf_name} · {alert.pitch_name}
          </Chip>
        </div>

        <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <div className="max-w-xl">
            <AnimatePresence mode="wait" initial={false}>
              <motion.h1
                key={status}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                className="text-3xl leading-tight font-bold sm:text-4xl"
              >
                {outcome?.kind === 'transferred' ? (
                  <>
                    Moved <span className="text-gradient-volt">indoors</span>!
                  </>
                ) : status === 'dismissed' ? (
                  <>Game on, rain or shine</>
                ) : status === 'rain_checked' ? (
                  <>Rain-checked</>
                ) : status === 'expired' ? (
                  <>Rain alert</>
                ) : (
                  <>
                    Rain is <span className="text-gradient-flare">incoming</span>
                  </>
                )}
              </motion.h1>
            </AnimatePresence>
            <p className="mt-3 text-base text-fg/80">
              {outcome?.kind === 'transferred' ? `New venue: ${outcome.turf}. Taking you to the match room…` : alert.summary}
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
              <span className="font-semibold text-fg">{alert.lobby_title}</span>
              <span>{formatWhen(alert.start_at)}</span>
              <span className="inline-flex items-center gap-1">
                Kick-off in <Countdown to={alert.start_at} urgentMs={60 * 60 * 1000} className="text-sm" />
              </span>
            </div>
          </div>

          {!sunny && (
            <div className="flex items-center gap-4">
              <ProgressRing value={alert.precipitation_probability / 100} size={112} stroke={10} from="var(--color-electric)" to="var(--color-grape)">
                <span className="font-display text-2xl font-bold">{Math.round(alert.precipitation_probability)}%</span>
                <span className="text-[10px] tracking-wider text-muted uppercase">chance</span>
              </ProgressRing>
              <div className="rounded-2xl bg-ink-950/40 p-4 ring-1 ring-white/10 backdrop-blur">
                <Droplets className="h-5 w-5 text-electric" />
                <div className="mt-1 font-display text-2xl font-bold">{alert.precipitation_mm.toFixed(1)}</div>
                <div className="text-[10px] tracking-wider text-muted uppercase">mm / hour</div>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

// ───────────────────────── host options ─────────────────────────

function HostOptions({ alert, onResolved }: { alert: WeatherAlert; onResolved: (o: Outcome) => void }) {
  const meta = useMeta()
  const alts = useAlternatives(alert)
  const transfer = useTransfer(alert)
  const rainCheck = useRainCheck(alert)
  const dismiss = useDismissAlert(alert)
  const [picked, setPicked] = useState<TransferAlternative | null>(null)
  const [confirm, setConfirm] = useState<'rain_check' | 'dismiss' | null>(null)
  const cover = meta.data?.rain_transfer_cover_paise ?? 20000
  const bonus = meta.data?.rain_bonus_paise ?? 2500

  const doTransfer = () => {
    if (!picked) return
    transfer.mutate(picked.slot.id, {
      onSuccess: (lobby) => {
        setPicked(null)
        celebrate()
        toast.success('Match moved indoors ☀️', { description: 'Everyone in the lobby has been notified.' })
        onResolved({ kind: 'transferred', lobbyId: lobby.id, turf: picked.turf.name })
      },
      onError: (e) => {
        setPicked(null)
        if (isApiError(e, 'SLOT_LOCKED') || isApiError(e, 'SLOT_UNAVAILABLE'))
          toast.error('That slot was just taken', { description: 'Pick another — the list has been refreshed.' })
        else toast.error(errorMessage(e))
      },
    })
  }

  const doRainCheck = () =>
    rainCheck.mutate(undefined, {
      onSuccess: (r) => {
        setConfirm(null)
        toast.success('Rain-checked', { description: `${formatINR(r.refunded_paise_total)} refunded to the squad as credits.` })
        onResolved({ kind: 'rain_checked', refunded: r.refunded_paise_total })
      },
      onError: (e) => toast.error(errorMessage(e)),
    })

  const doDismiss = () =>
    dismiss.mutate(undefined, {
      onSuccess: () => {
        setConfirm(null)
        toast('Game on 💪', { description: 'Bring a towel.' })
        onResolved({ kind: 'dismissed' })
      },
      onError: (e) => toast.error(errorMessage(e)),
    })

  return (
    <div className="space-y-8">
      <section>
        <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
          <div>
            <div className="text-xs font-semibold tracking-[0.2em] text-volt uppercase">Recommended</div>
            <h2 className="mt-1 text-xl font-semibold">Move indoors</h2>
            <p className="mt-1 text-sm text-muted">
              Indoor pitches within 10 km at the same time. Pytch covers up to {formatINR(cover)} of any price difference.
            </p>
          </div>
          <Chip tone="volt" size="md">
            <ShieldCheck className="h-3.5 w-3.5" /> Rain guarantee
          </Chip>
        </div>

        {alts.isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-64" />
            ))}
          </div>
        ) : alts.isError ? (
          <ErrorState error={alts.error} onRetry={() => alts.refetch()} />
        ) : !alts.data?.length ? (
          <EmptyState
            icon="🏟️"
            title="No indoor slots free nearby"
            description="Nothing within 10 km at this kick-off. Rain-check below and everyone gets their money back."
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {alts.data.map((alt, i) => (
              <AlternativeCard key={alt.slot.id} alt={alt} index={i} onPick={() => setPicked(alt)} />
            ))}
          </div>
        )}
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <Card className="flex flex-col p-6" spotlight glow="sun">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-sun/15 text-sun ring-1 ring-sun/40">
            <Wallet className="h-5 w-5" />
          </div>
          <h3 className="mt-4 text-lg font-semibold">Rain-check</h3>
          <p className="mt-1 flex-1 text-sm text-muted">
            Call it off. Every player gets <span className="font-semibold text-fg">100% back</span> as Pytch Credits plus a{' '}
            <span className="font-semibold text-sun">{formatINR(bonus)} rain bonus</span>.
          </p>
          <Button variant="secondary" className="mt-5 self-start" onClick={() => setConfirm('rain_check')}>
            Rain-check the match
          </Button>
        </Card>
        <Card className="flex flex-col p-6" spotlight glow="electric">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-electric/12 text-electric ring-1 ring-electric/30">
            <Umbrella className="h-5 w-5" />
          </div>
          <h3 className="mt-4 text-lg font-semibold">We'll play in the rain</h3>
          <p className="mt-1 flex-1 text-sm text-muted">Keep the booking as it is. Rain Dancer badge energy.</p>
          <Button variant="ghost" className="mt-5 self-start" onClick={() => setConfirm('dismiss')}>
            Keep the game on
          </Button>
        </Card>
      </section>

      {/* transfer confirm */}
      <Sheet open={!!picked} onClose={() => !transfer.isPending && setPicked(null)} title="Move the match?" size="sm" dismissible={!transfer.isPending}>
        {picked && (
          <div>
            <div className="flex items-stretch gap-3">
              <div className="flex-1 rounded-2xl bg-white/4 p-3 ring-1 ring-white/8">
                <div className="flex items-center gap-1.5 text-[10px] font-bold tracking-wider text-flare uppercase">
                  <CloudRain className="h-3.5 w-3.5" /> From
                </div>
                <div className="mt-1 text-sm font-semibold">{alert.turf_name}</div>
                <div className="text-xs text-muted">{alert.pitch_name} · outdoor</div>
              </div>
              <div className="flex items-center">
                <motion.span animate={{ x: [0, 4, 0] }} transition={{ repeat: Infinity, duration: 1.2 }}>
                  <ArrowRight className="h-5 w-5 text-volt" />
                </motion.span>
              </div>
              <div className="flex-1 rounded-2xl bg-volt/8 p-3 ring-1 ring-volt/30">
                <div className="flex items-center gap-1.5 text-[10px] font-bold tracking-wider text-volt uppercase">
                  <Home className="h-3.5 w-3.5" /> To
                </div>
                <div className="mt-1 text-sm font-semibold">{picked.turf.name}</div>
                <div className="text-xs text-muted">
                  {picked.pitch.name} · {formatTime(picked.slot.start_at)}
                </div>
              </div>
            </div>
            <div className="mt-4 rounded-2xl bg-white/4 p-4 text-sm ring-1 ring-white/8">
              <PriceLine alt={picked} />
              <p className="mt-2 text-xs text-muted">
                Your old slot is released and everyone in the lobby is notified instantly. Payments carry over.
              </p>
            </div>
            <Button block size="lg" className="mt-5" onClick={doTransfer} loading={transfer.isPending}>
              Confirm move
            </Button>
          </div>
        )}
      </Sheet>

      {/* rain-check / dismiss confirm */}
      <Sheet
        open={!!confirm}
        onClose={() => setConfirm(null)}
        size="sm"
        title={confirm === 'rain_check' ? 'Rain-check this match?' : 'Play in the rain?'}
        description={
          confirm === 'rain_check'
            ? `The match is cancelled. Every payer gets 100% back + ${formatINR(bonus)} bonus as credits, instantly.`
            : 'The booking stays as is. Everyone will see that the game is on.'
        }
      >
        <div className="flex gap-3">
          <Button variant="secondary" block onClick={() => setConfirm(null)}>
            Not yet
          </Button>
          {confirm === 'rain_check' ? (
            <Button variant="danger" block onClick={doRainCheck} loading={rainCheck.isPending}>
              Rain-check
            </Button>
          ) : (
            <Button block onClick={doDismiss} loading={dismiss.isPending}>
              Game on
            </Button>
          )}
        </div>
      </Sheet>
    </div>
  )
}

function PriceLine({ alt }: { alt: TransferAlternative }) {
  const d = alt.price_diff_paise
  if (d > 0 && alt.covered_by_pytch)
    return (
      <div className="flex items-center justify-between">
        <span className="text-muted">
          {formatINR(d, { sign: true })} price difference
        </span>
        <span className="font-semibold text-volt">Covered by Pytch</span>
      </div>
    )
  if (d > 0)
    return (
      <div className="flex items-center justify-between">
        <span className="text-muted">Price difference</span>
        <span className="font-semibold text-sun">{formatINR(d, { sign: true })}</span>
      </div>
    )
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted">Price</span>
      <span className="font-semibold text-mint">{d < 0 ? `${formatINR(-d)} cheaper` : 'Same price'}</span>
    </div>
  )
}

function AlternativeCard({ alt, index, onPick }: { alt: TransferAlternative; index: number; onPick: () => void }) {
  const d = alt.price_diff_paise
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.06, type: 'spring', stiffness: 300, damping: 26 }}
    >
      <Card interactive spotlight className="flex h-full flex-col" onClick={onPick}>
        <TurfArt seed={alt.turf.id} sport={alt.pitch.sport} src={alt.turf.cover_url} className="h-28">
          <div className="flex h-full items-start justify-between p-3">
            <Chip tone="electric" size="xs">
              <Home className="h-3 w-3" /> Indoor
            </Chip>
            {index === 0 && (
              <Chip tone="solid" size="xs">
                Closest
              </Chip>
            )}
          </div>
        </TurfArt>
        <div className="flex flex-1 flex-col p-4">
          <div className="font-semibold">{alt.turf.name}</div>
          <div className="text-xs text-muted">
            {alt.pitch.name} · {alt.pitch.format} · {alt.turf.area}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
            <Chip size="xs">
              <MapPin className="h-3 w-3" /> {formatKm(alt.distance_km)}
            </Chip>
            <Chip size="xs">{formatTime(alt.slot.start_at)}</Chip>
            {d > 0 && alt.covered_by_pytch ? (
              <Chip tone="volt" size="xs">
                <ShieldCheck className="h-3 w-3" /> Covered by Pytch
              </Chip>
            ) : d > 0 ? (
              <Chip tone="sun" size="xs">
                {formatINR(d, { sign: true })}
              </Chip>
            ) : (
              <Chip tone="mint" size="xs">
                {d < 0 ? `${formatINR(-d)} cheaper` : 'Same price'}
              </Chip>
            )}
          </div>
          <Button size="sm" className="mt-4 self-start" onClick={(e) => (e.stopPropagation(), onPick())}>
            Move here <ArrowRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      </Card>
    </motion.div>
  )
}

// ───────────────────────── non-host + outcomes ─────────────────────────

function MemberView({ alert }: { alert: WeatherAlert }) {
  const meta = useMeta()
  return (
    <Card className="p-6 sm:p-8">
      <div className="flex flex-col gap-6 md:flex-row md:items-center">
        <div className="flex-1">
          <h2 className="text-xl font-semibold">Your host has options</h2>
          <p className="mt-2 text-sm text-muted">
            Sit tight — they can move the game indoors (Pytch covers up to{' '}
            {formatINR(meta.data?.rain_transfer_cover_paise ?? 20000)} of the difference), rain-check it (everyone gets 100% back
            + a bonus) or keep it on. You'll be notified the moment they decide.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Chip tone="electric" size="md">🏠 Move indoors</Chip>
            <Chip tone="sun" size="md">💸 Rain-check</Chip>
            <Chip size="md">☔ Play on</Chip>
          </div>
        </div>
        <LinkButton to={`/app/lobby/${alert.lobby_id}`} size="lg">
          Open match room <ArrowRight className="h-4 w-4" />
        </LinkButton>
      </div>
    </Card>
  )
}

const OUTCOMES: Record<string, { icon: string; title: string; body: string }> = {
  transferred: { icon: '🏠', title: 'Moved indoors', body: 'Same squad, same time — now with a roof. Everyone has been notified.' },
  rain_checked: { icon: '💸', title: 'Rain-checked', body: 'The match was called off. Every payer got 100% back plus a rain bonus as Pytch Credits.' },
  dismissed: { icon: '💪', title: 'Playing in the rain', body: 'The host kept the game on. Bring a towel and a spare pair of socks.' },
  expired: { icon: '🌤️', title: 'Alert expired', body: 'Kick-off has passed, so this alert is closed.' },
}

function OutcomeCard({ alert, status, outcome }: { alert: WeatherAlert; status: string; outcome: Outcome | null }) {
  const o = OUTCOMES[status] ?? OUTCOMES.expired!
  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
      <Card className="flex flex-col gap-5 p-6 sm:flex-row sm:items-center sm:p-8">
        <motion.div
          initial={{ scale: 0, rotate: -20 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ type: 'spring', stiffness: 300, damping: 14, delay: 0.5 }}
          className="flex h-16 w-16 shrink-0 items-center justify-center rounded-3xl bg-white/6 text-4xl ring-1 ring-white/10"
        >
          {o.icon}
        </motion.div>
        <div className="flex-1">
          <h2 className="text-xl font-semibold">{o.title}</h2>
          <p className="mt-1 text-sm text-muted">{o.body}</p>
          {outcome?.kind === 'rain_checked' && (
            <p className="mt-2 text-sm">
              <span className="font-display text-lg font-bold text-sun">{formatINR(outcome.refunded)}</span>{' '}
              <span className="text-muted">returned to the squad</span>
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {status === 'rain_checked' && (
            <LinkButton to="/app/wallet" variant="secondary">
              <Wallet className="h-4 w-4" /> Wallet
            </LinkButton>
          )}
          <LinkButton to={outcome?.kind === 'transferred' ? `/app/lobby/${outcome.lobbyId}` : `/app/lobby/${alert.lobby_id}`}>
            Match room <ArrowRight className="h-4 w-4" />
          </LinkButton>
        </div>
      </Card>
      <p className="mt-4 text-center text-xs text-subtle">
        <Link to="/app/matches" className="hover:text-fg">
          See all your matches
        </Link>
      </p>
    </motion.div>
  )
}
