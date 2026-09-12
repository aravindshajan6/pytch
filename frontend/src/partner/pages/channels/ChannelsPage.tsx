import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, ArrowRight, CalendarSync, CodeXml, Share2, Smartphone, Zap } from 'lucide-react'
import { motion } from 'motion/react'
import { useEffect } from 'react'
import { useLocation } from 'react-router'
import { ErrorState, Skeleton } from '@/components/ui/States'
import { cn } from '@/lib/cn'
import { partnerApi } from '../../api/endpoints'
import { pk } from '../../api/keys'
import { PageTitle } from '../../components/kit'
import { useVenues } from '../../hooks'
import { useCan } from '../../stores/partnerAuth'
import { ApiSection } from './ApiSection'
import { ConflictsSection } from './ConflictsSection'
import { ExportsSection } from './ExportsSection'
import { FeedsSection } from './FeedsSection'
import { OtherAppsSection } from './OtherAppsSection'

const SECTIONS = [
  { id: 'conflicts', label: 'Conflicts' },
  { id: 'apps', label: 'Other apps' },
  { id: 'import', label: 'Import' },
  { id: 'export', label: 'Export' },
  { id: 'api', label: 'API & webhooks' },
]

export default function ChannelsPage() {
  const overview = useQuery({ queryKey: pk.channels, queryFn: partnerApi.channels.overview })
  const venues = useVenues()
  const owner = useCan('owner')
  const { hash } = useLocation()

  // deep links (#conflicts, #import …) once content is in
  useEffect(() => {
    if (!hash || !overview.data) return
    const el = document.getElementById(hash.slice(1))
    if (el) setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'start' }), 120)
  }, [hash, overview.data])

  const conflicts = overview.data?.open_conflicts ?? 0
  // switched-off pitches can't take new bookings: no new feeds or export links for them
  const pitches = (venues.data ?? []).flatMap((v) => v.pitches.filter((p) => p.is_active).map((p) => ({ ...p, turf_name: v.name })))

  return (
    <div>
      <PageTitle title="Channels" subtitle="Keep every app you sell on consistent — without double bookings." />

      <ModelExplainer />

      <nav className="no-scrollbar sticky top-14 z-20 -mx-3 mt-5 mb-5 flex gap-1.5 overflow-x-auto bg-ink-900/80 px-3 py-2 backdrop-blur-xl sm:top-16 sm:mx-0 sm:rounded-2xl sm:px-2" aria-label="Channel sections">
        {SECTIONS.map((s) => (
          <a
            key={s.id}
            href={`#${s.id}`}
            onClick={(e) => {
              e.preventDefault()
              document.getElementById(s.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
              history.replaceState(null, '', `#${s.id}`)
            }}
            className="flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-white/5 px-3.5 text-xs font-semibold text-fg/75 ring-1 ring-white/10 hover:bg-white/10"
          >
            {s.label}
            {s.id === 'conflicts' && conflicts > 0 && <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-flare px-1.5 text-[10px] font-bold text-snow">{conflicts}</span>}
          </a>
        ))}
      </nav>

      {overview.isError ? (
        <ErrorState error={overview.error} onRetry={() => overview.refetch()} />
      ) : !overview.data ? (
        <div className="space-y-4">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-56 rounded-3xl" />
          ))}
        </div>
      ) : (
        <div className="space-y-5 [&>section]:scroll-mt-32">
          <ConflictsSection openCount={conflicts} />
          <OtherAppsSection />
          <FeedsSection feeds={overview.data.feeds} pitches={pitches} />
          <ExportsSection exports={overview.data.exports} pitches={pitches} />
          <ApiSection keys={overview.data.api_keys} webhooks={overview.data.webhooks} baseUrl={overview.data.api_base_url} owner={owner} />
        </div>
      )}
    </div>
  )
}

function ModelExplainer() {
  const inbound = [
    { icon: Smartphone, label: 'Playo · Hudle · KheloMore', how: 'You quick-block', tone: 'var(--src-playo)' },
    { icon: CalendarSync, label: 'Your Google / other calendars', how: 'iCal import, every 5 min', tone: 'var(--src-ical)' },
    { icon: CodeXml, label: 'Venue software', how: 'Channel API, instant', tone: 'var(--src-api)' },
  ]
  const outbound = [
    { icon: Share2, label: 'Your phone calendar', how: 'iCal export feed' },
    { icon: CodeXml, label: 'Your systems', how: 'Signed webhooks' },
  ]
  return (
    <section className="glass relative overflow-hidden rounded-3xl p-5 shadow-card sm:p-7">
      <div aria-hidden className="pointer-events-none absolute -top-24 -right-24 h-72 w-72 rounded-full bg-volt/10 blur-3xl" />
      <div className="relative grid items-center gap-6 lg:grid-cols-[1fr_auto_1fr_auto_1fr]">
        <ul className="space-y-2">
          {inbound.map((i, n) => (
            <motion.li key={i.label} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: n * 0.08 }} className="flex items-center gap-3 rounded-2xl bg-white/[0.04] p-3 ring-1 ring-white/8">
              <i.icon className="h-5 w-5 shrink-0" style={{ color: i.tone }} />
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold">{i.label}</span>
                <span className="block text-xs text-muted">{i.how}</span>
              </span>
            </motion.li>
          ))}
        </ul>
        <Arrow />
        <div className="text-center">
          <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-3xl bg-volt text-ink-950 shadow-glow-volt">
            <Zap className="h-9 w-9" />
          </div>
          <h2 className="mt-3 font-display text-lg font-bold">Pytch is your master calendar</h2>
          <p className="mx-auto mt-1 max-w-xs text-sm text-muted">Every slot is locked in one place, so a Pytch player can never book what’s already taken elsewhere.</p>
          <p className="mx-auto mt-2 max-w-xs text-xs text-muted">If two systems still collide, the booking confirmed first wins and you get a conflict to resolve.</p>
        </div>
        <Arrow />
        <ul className="space-y-2">
          {outbound.map((i, n) => (
            <motion.li key={i.label} initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.2 + n * 0.08 }} className="flex items-center gap-3 rounded-2xl bg-white/[0.04] p-3 ring-1 ring-white/8">
              <i.icon className="h-5 w-5 shrink-0 text-volt" />
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold">{i.label}</span>
                <span className="block text-xs text-muted">{i.how}</span>
              </span>
            </motion.li>
          ))}
          <li className="flex items-center gap-2 px-1 text-xs text-muted">
            <AlertTriangle className="h-3.5 w-3.5 text-sun" /> Feeds share busy times only — never customer details.
          </li>
        </ul>
      </div>
    </section>
  )
}

function Arrow() {
  return (
    <div className={cn('flex justify-center text-volt')} aria-hidden>
      <ArrowRight className="h-6 w-6 rotate-90 lg:rotate-0" />
    </div>
  )
}
