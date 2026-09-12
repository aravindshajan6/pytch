import { Building2, ChevronRight, Clock, MapPin, Star } from 'lucide-react'
import { motion } from 'motion/react'
import { Link } from 'react-router'
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States'
import { TurfArt } from '@/components/ui/TurfArt'
import { SportBadge } from '@/components/ui/PlayerBits'
import { formatINR } from '@/lib/format'
import { PageTitle, StatusPill } from '../../components/kit'
import { useVenues } from '../../hooks'
import { hhmmLabel } from '../../lib/time'

export default function VenuesPage() {
  const venues = useVenues()
  return (
    <div>
      <PageTitle title="Venues" subtitle="Details players see, opening hours, pitches and prices." />
      {venues.isError ? (
        <ErrorState error={venues.error} onRetry={() => venues.refetch()} />
      ) : !venues.data ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-72 rounded-3xl" />
          ))}
        </div>
      ) : venues.data.length === 0 ? (
        <EmptyState
          icon={<Building2 className="mx-auto h-10 w-10 text-muted" />}
          title="No venues assigned yet"
          description="Pytch links your venues to your account after approval. Contact partner support if something’s missing."
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {venues.data.map((v, i) => (
            <motion.div key={v.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
              <Link to={`/partner/venues/${v.id}`} className="glass group block overflow-hidden rounded-3xl shadow-card transition hover:-translate-y-0.5 hover:border-volt/40">
                <TurfArt seed={v.id} sport={v.sports[0]} src={v.cover_url} className="h-36">
                  <div className="flex h-full flex-col justify-between p-4">
                    <div className="flex justify-end">{!v.is_active && <StatusPill status="paused" label="Hidden from players" />}</div>
                    <div>
                      <h2 className="font-display text-lg font-semibold text-snow">{v.name}</h2>
                      <div className="flex items-center gap-1 text-xs text-snow/75">
                        <MapPin className="h-3.5 w-3.5" /> {v.area}
                      </div>
                    </div>
                  </div>
                </TurfArt>
                <div className="p-4">
                  <div className="flex flex-wrap gap-1.5">
                    {v.sports.map((s) => (
                      <SportBadge key={s} sport={s} />
                    ))}
                  </div>
                  <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
                    <div className="rounded-xl bg-white/4 py-2 ring-1 ring-white/8">
                      <dt className="text-[10px] font-semibold tracking-wider text-muted uppercase">Pitches</dt>
                      <dd className="font-mono font-semibold">
                        {v.pitch_count_active}
                        <span className="text-muted">/{v.pitches.length}</span>
                      </dd>
                    </div>
                    <div className="rounded-xl bg-white/4 py-2 ring-1 ring-white/8">
                      <dt className="text-[10px] font-semibold tracking-wider text-muted uppercase">From</dt>
                      <dd className="font-mono font-semibold">{formatINR(v.min_price_per_hour_paise, { compact: true })}</dd>
                    </div>
                    <div className="rounded-xl bg-white/4 py-2 ring-1 ring-white/8">
                      <dt className="text-[10px] font-semibold tracking-wider text-muted uppercase">Rating</dt>
                      <dd className="flex items-center justify-center gap-1 font-mono font-semibold">
                        <Star className="h-3.5 w-3.5 fill-sun text-sun" />
                        {v.rating_count ? v.rating_avg.toFixed(1) : '—'}
                      </dd>
                    </div>
                  </dl>
                  <div className="mt-4 flex items-center justify-between text-sm text-muted">
                    <span className="flex items-center gap-1.5">
                      <Clock className="h-4 w-4" /> {hhmmLabel(v.open_time.slice(0, 5))} – {hhmmLabel(v.close_time.slice(0, 5))}
                    </span>
                    <span className="flex items-center gap-1 font-semibold text-volt">
                      Manage <ChevronRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
                    </span>
                  </div>
                </div>
              </Link>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  )
}
