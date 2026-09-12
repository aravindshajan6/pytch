import { useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Clock, CloudRain, Home, MapPin, Navigation, Phone, Share2, Star, Sun, Video } from 'lucide-react'
import { motion, useScroll, useTransform } from 'motion/react'
import { useCallback, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { Button, LinkButton } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { EmptyState, ResourceErrorState, Skeleton } from '@/components/ui/States'
import { TurfArt } from '@/components/ui/TurfArt'
import { useMeta } from '@/hooks/useMeta'
import { qk } from '@/lib/api/queryKeys'
import { cn } from '@/lib/cn'
import { formatDay, formatHour, formatINR, formatKm, istDate } from '@/lib/format'
import { useChannel } from '@/lib/realtime'
import { sportInfo } from '@/lib/sports'
import type { Pitch, Slot, TurfDetail } from '@/types/api'
import { useSlots, useTurf } from './api'
import { BookingSheet } from './components/BookingSheet'
import { BookingsPaused } from './components/BookingsPaused'
import { DateStrip } from './components/DateStrip'
import { PitchSelector } from './components/PitchSelector'
import { SlotGrid, SlotGridSkeleton } from './components/SlotGrid'

export default function TurfPage() {
  const { slug } = useParams()
  const turfQ = useTurf(slug)

  if (turfQ.isLoading) return <TurfSkeleton />
  if (turfQ.isError) {
    return (
      <ResourceErrorState
        error={turfQ.error}
        onRetry={() => turfQ.refetch()}
        notFound={{ icon: '🏟️', title: 'Turf not found', description: 'It may have moved or closed. Find another pitch nearby.' }}
        action={<LinkButton to="/app/discover">Discover turfs</LinkButton>}
      />
    )
  }
  if (!turfQ.data) return null
  return <TurfView turf={turfQ.data} />
}

function TurfView({ turf }: { turf: TurfDetail }) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [params] = useSearchParams()

  const initialPitch = params.get('pitch') ?? turf.pitches.find((p) => p.sport === params.get('sport'))?.id
  const [pitchId, setPitchId] = useState<string | undefined>(initialPitch ?? turf.pitches[0]?.id)
  const pitch = turf.pitches.find((p) => p.id === pitchId) ?? turf.pitches[0]
  const [date, setDate] = useState(() => {
    const d = params.get('date')
    return d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : istDate(0)
  })
  const slotsQ = useSlots(pitch?.id, date)
  const bookingsPaused = useMeta().data?.bookings_enabled === false
  const [booking, setBooking] = useState<Slot | null>(null)
  const [flashes, setFlashes] = useState<Record<string, number>>({})

  // Live availability — patch the cached slot instantly, flash it, then reconcile.
  useChannel(pitch ? `pitch:${pitch.id}` : null, (m) => {
    if (m.event !== 'slot.updated' || !pitch) return
    const d = m.data
    qc.setQueryData<Slot[]>(qk.slots(pitch.id, date), (old) =>
      old?.map((s) => (s.id === d.slot_id ? { ...s, status: d.status, held_until: d.held_until } : s)),
    )
    setFlashes((f) => ({ ...f, [d.slot_id]: Date.now() }))
    qc.invalidateQueries({ queryKey: qk.slots(pitch.id, date) })
    if (booking?.id === d.slot_id && d.status !== 'available') {
      toast.warning('Heads up — someone just grabbed this slot', { description: 'Pick another time.' })
      setBooking(null)
    }
  })

  const upcoming = useMemo(() => {
    const now = Date.now()
    return (slotsQ.data ?? []).filter((s) => new Date(s.start_at).getTime() > now)
  }, [slotsQ.data])
  const risky = upcoming.filter((s) => s.weather?.is_risky && s.status === 'available')
  const indoorAlt = pitch && !pitch.is_indoor ? turf.pitches.find((p) => p.is_indoor && p.sport === pitch.sport) : undefined

  const refetchSlots = useCallback(() => {
    qc.invalidateQueries({ queryKey: qk.slotsAll })
  }, [qc])

  const share = async () => {
    const url = window.location.href
    try {
      if (navigator.share) await navigator.share({ title: turf.name, text: `Let's play at ${turf.name}`, url })
      else {
        await navigator.clipboard.writeText(url)
        toast.success('Link copied')
      }
    } catch {
      /* user cancelled */
    }
  }

  return (
    <div className="-mt-2">
      <Hero turf={turf} onBack={() => (window.history.length > 1 ? navigate(-1) : navigate('/app/discover'))} onShare={share} />

      <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-7">
          {turf.pitches.length > 1 && (
            <section>
              <SectionTitle n={1}>Choose a pitch</SectionTitle>
              <PitchSelector pitches={turf.pitches} value={pitch?.id} onChange={setPitchId} />
            </section>
          )}

          <section>
            <SectionTitle n={turf.pitches.length > 1 ? 2 : 1}>Pick a day</SectionTitle>
            <DateStrip value={date} onChange={setDate} />
          </section>

          <section>
            <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
              <SectionTitle n={turf.pitches.length > 1 ? 3 : 2} className="mb-0">
                {formatDay(`${date}T12:00:00+05:30`)} at {pitch?.name ?? 'the turf'}
              </SectionTitle>
              <span className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wider text-mint uppercase">
                <span className="h-1.5 w-1.5 animate-blink rounded-full bg-mint" /> Live availability
              </span>
            </div>
            <Legend />
            {bookingsPaused && <BookingsPaused className="mb-4" />}

            {risky.length > 0 && pitch && !pitch.is_indoor && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="mb-4 flex flex-col gap-3 rounded-2xl bg-gradient-to-r from-sun/15 via-flare/10 to-transparent p-4 ring-1 ring-sun/30 sm:flex-row sm:items-center"
              >
                <CloudRain className="h-6 w-6 shrink-0 text-sun" />
                <div className="flex-1 text-sm">
                  <div className="font-semibold text-fg">
                    Rain likely around {formatHour(risky[0]!.start_at)}
                    {risky.length > 1 && ` (+${risky.length - 1} more hr${risky.length > 2 ? 's' : ''})`}
                  </div>
                  <div className="text-xs text-muted">
                    Outdoor pitch — pick a dry slot, go indoors, or book anyway: if it pours we'll offer a free indoor transfer.
                  </div>
                </div>
                {indoorAlt && (
                  <Button size="sm" variant="secondary" onClick={() => setPitchId(indoorAlt.id)}>
                    <Home className="h-3.5 w-3.5" /> Try {indoorAlt.name}
                  </Button>
                )}
              </motion.div>
            )}

            {slotsQ.isLoading ? (
              <SlotGridSkeleton />
            ) : slotsQ.isError ? (
              <ResourceErrorState
                error={slotsQ.error}
                onRetry={() => slotsQ.refetch()}
                notFound={{ icon: '🚧', title: 'This pitch isn’t taking bookings', description: 'It may be closed for now. Try another pitch or turf.' }}
                action={<LinkButton to="/app/discover" variant="secondary">Discover turfs</LinkButton>}
              />
            ) : upcoming.length === 0 ? (
              <EmptyState
                icon="🌙"
                title={`No slots left ${date === istDate(0) ? 'today' : 'on this day'}`}
                description="Floodlights are off for this one. Try the next day."
                action={
                  <Button variant="secondary" onClick={() => setDate(nextDay(date))}>
                    Show {formatDay(`${nextDay(date)}T12:00:00+05:30`)}
                  </Button>
                }
              />
            ) : (
              <SlotGrid key={`${pitch?.id}-${date}`} slots={upcoming} flashes={flashes} onBook={setBooking} />
            )}
          </section>
        </div>

        <About turf={turf} pitch={pitch} />
      </div>

      <BookingSheet slot={booking} pitch={pitch} turf={turf} onClose={() => setBooking(null)} onConflict={refetchSlots} />
    </div>
  )
}

function nextDay(d: string) {
  const [y, m, day] = d.split('-').map(Number)
  const dt = new Date(Date.UTC(y!, m! - 1, day! + 1))
  return dt.toISOString().slice(0, 10)
}

function SectionTitle({ n, children, className }: { n: number; children: React.ReactNode; className?: string }) {
  return (
    <h2 className={cn('mb-3 flex items-center gap-2.5 text-base font-semibold sm:text-lg', className)}>
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-volt/15 font-mono text-[11px] text-volt ring-1 ring-volt/30">
        {n}
      </span>
      {children}
    </h2>
  )
}

function Legend() {
  const items = [
    { label: 'Open', cls: 'glass [[data-theme=light]_&]:ring-1 [[data-theme=light]_&]:ring-white/20' },
    { label: 'Game forming', cls: 'ring-1 ring-volt/70 bg-volt/10' },
    { label: 'Checking out', cls: 'ring-1 ring-sun/50 bg-sun/10' },
    { label: 'Booked', cls: 'bg-white/5 opacity-50 [[data-theme=light]_&]:bg-white/20' },
  ]
  return (
    <div className="mb-4 flex flex-wrap gap-x-4 gap-y-1.5 text-[11px] text-muted">
      {items.map((i) => (
        <span key={i.label} className="flex items-center gap-1.5">
          <span className={cn('h-3 w-3 rounded', i.cls)} /> {i.label}
        </span>
      ))}
      <span className="flex items-center gap-1.5">
        <span className="text-sun">🔥</span> Peak
      </span>
    </div>
  )
}

function Hero({ turf, onBack, onShare }: { turf: TurfDetail; onBack: () => void; onShare: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const { scrollY } = useScroll()
  const y = useTransform(scrollY, [0, 500], [0, 140])
  const scale = useTransform(scrollY, [0, 500], [1.04, 1.16])
  const fade = useTransform(scrollY, [0, 320], [1, 0.35])
  const textY = useTransform(scrollY, [0, 400], [0, -30])

  return (
    // Photo hero with overlaid controls + title → dark island in both themes.
    <div ref={ref} data-theme="dark" className="relative -mx-4 h-72 overflow-hidden rounded-b-3xl sm:mx-0 sm:h-80 sm:rounded-3xl lg:h-96">
      <motion.div className="absolute inset-0" style={{ y, scale, opacity: fade }}>
        <TurfArt seed={turf.id} sport={turf.sports[0]} src={turf.cover_url ?? turf.photos[0]} className="h-full w-full" />
      </motion.div>
      <div className="absolute inset-0 bg-gradient-to-t from-ink-900 via-ink-900/40 to-transparent" />

      <div className="absolute inset-x-0 top-0 flex items-center justify-between p-4">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back"
          className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-full bg-ink-900/60 ring-1 ring-white/10 backdrop-blur transition hover:bg-ink-900/80"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <button
          type="button"
          onClick={onShare}
          aria-label="Share turf"
          className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-full bg-ink-900/60 ring-1 ring-white/10 backdrop-blur transition hover:bg-ink-900/80"
        >
          <Share2 className="h-4.5 w-4.5" />
        </button>
      </div>

      <motion.div style={{ y: textY }} className="absolute inset-x-0 bottom-0 p-5 sm:p-7">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        >
          <div className="mb-3 flex flex-wrap gap-1.5">
            {turf.sports.map((s) => (
              <span key={s} className="inline-flex h-6 items-center gap-1 rounded-full bg-ink-900/60 px-2.5 text-[11px] font-semibold backdrop-blur">
                {sportInfo(s).emoji} {sportInfo(s).label}
              </span>
            ))}
            {turf.open_lobbies_count > 0 && (
              <span className="inline-flex h-6 items-center gap-1.5 rounded-full bg-volt px-2.5 text-[11px] font-bold text-ink-950 shadow-[0_0_24px_-2px_color-mix(in_srgb,_var(--color-volt)_80%,_transparent)]">
                <span className="h-1.5 w-1.5 animate-blink rounded-full bg-ink-950" />
                {turf.open_lobbies_count} game{turf.open_lobbies_count === 1 ? '' : 's'} forming
              </span>
            )}
          </div>
          <h1 className="text-3xl leading-[1.05] font-bold sm:text-5xl">{turf.name}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-fg/80">
            <span className="flex items-center gap-1">
              <MapPin className="h-4 w-4 text-volt" /> {turf.area}
              {turf.distance_km != null && <span className="text-muted"> · {formatKm(turf.distance_km)}</span>}
            </span>
            {turf.rating_count > 0 && (
              <span className="flex items-center gap-1">
                <Star className="h-4 w-4 fill-sun text-sun" /> {turf.rating_avg.toFixed(1)}
                <span className="text-muted">({turf.rating_count})</span>
              </span>
            )}
            <span className="font-semibold">
              from {formatINR(turf.min_price_per_hour_paise)}
              <span className="font-normal text-muted">/hr</span>
            </span>
          </div>
        </motion.div>
      </motion.div>
    </div>
  )
}

function About({ turf, pitch }: { turf: TurfDetail; pitch: Pitch | undefined }) {
  return (
    <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
      <div className="glass space-y-4 rounded-3xl p-5">
        <h3 className="text-sm font-semibold tracking-wider text-muted uppercase">About</h3>
        {turf.description && <p className="text-sm leading-relaxed text-fg/80">{turf.description}</p>}
        <div className="flex flex-wrap gap-1.5">
          {turf.has_indoor && (
            <Chip tone="electric">
              <Home className="h-3 w-3" /> Indoor
            </Chip>
          )}
          {turf.has_outdoor && (
            <Chip>
              <Sun className="h-3 w-3" /> Outdoor
            </Chip>
          )}
          {turf.has_camera && (
            <Chip tone="grape">
              <Video className="h-3 w-3" /> Match cameras
            </Chip>
          )}
          {turf.amenities.map((a) => (
            <Chip key={a}>{a}</Chip>
          ))}
        </div>
        <dl className="space-y-3 border-t border-white/8 pt-4 text-sm">
          <div className="flex items-start gap-3">
            <Clock className="mt-0.5 h-4 w-4 shrink-0 text-muted" />
            <div>
              <dt className="sr-only">Hours</dt>
              <dd>
                Open {turf.open_time} – {turf.close_time}
              </dd>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted" />
            <div>
              <dt className="sr-only">Address</dt>
              <dd className="text-fg/80">{turf.address}</dd>
              <a
                href={`https://www.google.com/maps/dir/?api=1&destination=${turf.lat},${turf.lng}`}
                target="_blank"
                rel="noreferrer"
                className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-volt hover:underline"
              >
                <Navigation className="h-3 w-3" /> Directions
              </a>
            </div>
          </div>
          {turf.phone && (
            <div className="flex items-start gap-3">
              <Phone className="mt-0.5 h-4 w-4 shrink-0 text-muted" />
              <div>
                <dt className="sr-only">Phone</dt>
                <dd>
                  <a href={`tel:${turf.phone}`} className="hover:text-volt">
                    {turf.phone}
                  </a>
                </dd>
              </div>
            </div>
          )}
        </dl>
      </div>
      {pitch && (
        <div className="glass rounded-3xl p-5 text-sm">
          <div className="text-xs font-semibold tracking-wider text-muted uppercase">{pitch.name}</div>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <Mini label="Off-peak" value={`${formatINR(pitch.price_per_hour_paise)}/hr`} />
            <Mini label="Peak" value={`${formatINR(pitch.peak_price_per_hour_paise)}/hr`} />
            <Mini label="Format" value={`${pitch.format} · ${pitch.capacity}p`} />
            <Mini label="Camera" value={pitch.has_camera ? `+${formatINR(pitch.camera_price_paise)}` : '—'} />
          </div>
        </div>
      )}
    </aside>
  )
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-white/4 p-3 ring-1 ring-white/6">
      <div className="text-[10px] font-semibold tracking-wider text-subtle uppercase">{label}</div>
      <div className="mt-0.5 font-mono text-sm font-semibold">{value}</div>
    </div>
  )
}

function TurfSkeleton() {
  return (
    <div>
      <Skeleton className="-mx-4 h-72 rounded-none sm:mx-0 sm:h-80 sm:rounded-3xl" />
      <div className="mt-6 grid gap-8 lg:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          <div className="flex gap-3">
            <Skeleton className="h-36 w-[220px]" />
            <Skeleton className="h-36 w-[220px]" />
          </div>
          <div className="flex gap-2">
            {Array.from({ length: 7 }, (_, i) => (
              <Skeleton key={i} className="h-[76px] w-16" />
            ))}
          </div>
          <SlotGridSkeleton />
        </div>
        <Skeleton className="hidden h-80 lg:block" />
      </div>
    </div>
  )
}
