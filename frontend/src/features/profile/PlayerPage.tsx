import { ArrowLeft, CalendarDays, Film, MapPin, Sparkles } from 'lucide-react'
import { motion } from 'motion/react'
import { Navigate, useNavigate, useParams } from 'react-router'
import { LinkButton } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { SportBadge, TierBadge, VerifiedBadge } from '@/components/ui/PlayerBits'
import { EmptyState, ErrorState, Skeleton, Stat } from '@/components/ui/States'
import { ClipCard } from '@/features/highlights/components/ClipCard'
import { useUserClips } from '@/features/highlights/api'
import { useMe } from '@/hooks/useMe'
import { isApiError } from '@/lib/api/client'
import { formatDateLong } from '@/lib/format'
import { usePlayerProfile } from './api'
import { BadgesGrid } from './components/BadgesGrid'
import { CardHero } from './components/CardHero'
import { StreakFlame, TagCloud } from './components/ProfileBits'

const SKILL_LABEL = { beginner: 'Beginner', intermediate: 'Intermediate', advanced: 'Advanced', pro: 'Pro' } as const
const FOOT_LABEL = { left: 'Left-footed', right: 'Right-footed', both: 'Two-footed' } as const

export default function PlayerPage() {
  const { userId } = useParams()
  const navigate = useNavigate()
  const { user: me } = useMe()
  const profile = usePlayerProfile(userId)
  const clips = useUserClips(userId)

  if (me && userId === me.id) return <Navigate to="/app/profile" replace />

  if (profile.isLoading)
    return (
      <div className="grid gap-8 lg:grid-cols-[380px_1fr]">
        <Skeleton className="mx-auto aspect-[63/88] w-[290px]" />
        <div className="space-y-4">
          <Skeleton className="h-24" />
          <Skeleton className="h-48" />
        </div>
      </div>
    )
  if (profile.isError || !profile.data)
    return isApiError(profile.error, 'NOT_FOUND') ? (
      <EmptyState icon="🕵️" title="Player not found" description="This player may have left the pitch." action={<LinkButton to="/app">Home</LinkButton>} />
    ) : (
      <ErrorState error={profile.error} onRetry={() => profile.refetch()} />
    )

  const p = profile.data
  const st = p.stats
  const pinnedIds = new Set(p.pinned_clips.map((c) => c.id))
  const more = (clips.data ?? []).filter((c) => !pinnedIds.has(c.id)).slice(0, 6)

  return (
    <div>
      <button
        onClick={() => navigate(-1)}
        className="mb-2 inline-flex cursor-pointer items-center gap-1.5 text-sm text-muted transition hover:text-fg"
      >
        <ArrowLeft className="h-4 w-4" /> Back
      </button>
      <div className="grid gap-8 lg:grid-cols-[380px_minmax(0,1fr)] xl:gap-12">
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <CardHero user={p.user} stats={st} />
          <div className="mt-2 text-center">
            <h1 className="text-2xl font-bold">{p.user.name}</h1>
            <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
              <TierBadge tier={st.tier} />
              {st.is_verified_playmaker && <VerifiedBadge />}
            </div>
            {p.bio && <p className="mx-auto mt-3 max-w-xs text-sm text-fg/80">{p.bio}</p>}
            <div className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-muted">
              {p.user.home_area && (
                <span className="flex items-center gap-1">
                  <MapPin className="h-3.5 w-3.5" /> {p.user.home_area}
                </span>
              )}
              <span className="flex items-center gap-1">
                <CalendarDays className="h-3.5 w-3.5" /> Since {formatDateLong(p.joined_at)}
              </span>
            </div>
            <div className="mt-3 flex flex-wrap justify-center gap-1.5">
              {p.user.preferred_sports.map((s) => (
                <SportBadge key={s} sport={s} />
              ))}
            </div>
          </div>
        </aside>

        <div className="min-w-0 space-y-6">
          <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Matches" value={st.matches_played} />
            <Stat label="Hosted" value={st.matches_hosted} />
            <Stat label="Subs" value={st.subs_made} hint="Hero saves" />
            <Stat label="Level" value={st.level} />
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }} className="grid gap-6 md:grid-cols-2">
            <Card className="p-5 sm:p-6">
              <h2 className="mb-4 text-lg font-semibold">Plays like</h2>
              <TagCloud tags={st.top_tags} />
              {(p.self_skill_level || p.dominant_foot || p.user.position) && (
                <div className="mt-5 flex flex-wrap gap-2 border-t border-white/8 pt-4 text-xs text-muted">
                  {p.user.position && <span className="rounded-full bg-white/5 px-2.5 py-1 ring-1 ring-white/10">{p.user.position}</span>}
                  {p.dominant_foot && <span className="rounded-full bg-white/5 px-2.5 py-1 ring-1 ring-white/10">{FOOT_LABEL[p.dominant_foot]}</span>}
                  {p.self_skill_level && (
                    <span className="rounded-full bg-white/5 px-2.5 py-1 ring-1 ring-white/10">Self-rated {SKILL_LABEL[p.self_skill_level]}</span>
                  )}
                </div>
              )}
            </Card>
            <Card className="flex flex-col justify-between gap-5 p-5 sm:p-6">
              <StreakFlame weeks={st.streak_weeks} />
              <div className="text-xs text-muted">
                True Skill comes from {st.ratings_received} anonymous teammate ratings — never self-reported.
              </div>
            </Card>
          </motion.div>

          <Card className="p-5 sm:p-6">
            <h2 className="mb-5 flex items-center gap-2 text-lg font-semibold">
              <Sparkles className="h-5 w-5 text-grape" /> Badges
              <span className="ml-auto font-mono text-xs font-normal text-muted">{p.badges.length}</span>
            </h2>
            {p.badges.length ? (
              <BadgesGrid badges={p.badges} showLocked={false} />
            ) : (
              <p className="text-sm text-subtle">No badges yet — early days.</p>
            )}
          </Card>

          <section>
            <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold">
              <Film className="h-5 w-5 text-electric" /> Pinned highlights
            </h2>
            {p.pinned_clips.length ? (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {p.pinned_clips.map((c) => (
                  <ClipCard key={c.id} clip={c} hideOwner />
                ))}
              </div>
            ) : (
              <EmptyState icon="🎬" title="No pinned highlights" description={`${p.user.name.split(' ')[0]} hasn't pinned any clips yet.`} />
            )}
          </section>

          {more.length > 0 && (
            <section>
              <h2 className="mb-4 text-lg font-semibold">More clips</h2>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {more.map((c) => (
                  <ClipCard key={c.id} clip={c} hideOwner />
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  )
}
