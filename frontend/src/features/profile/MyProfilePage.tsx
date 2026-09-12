import { CalendarDays, Film, LogOut, MapPin, Palette, Pencil, ShieldCheck, Sparkles } from 'lucide-react'
import { motion } from 'motion/react'
import { Button, LinkButton } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { TierBadge, VerifiedBadge } from '@/components/ui/PlayerBits'
import { EmptyState, ErrorState, Skeleton, Stat } from '@/components/ui/States'
import { ThemeSelector } from '@/components/ui/ThemeToggle'
import { ClipCard } from '@/features/highlights/components/ClipCard'
import { formatDateLong } from '@/lib/format'
import { useLogout } from '@/features/auth/useLogout'
import { useGamification, useMyProfile, useRatingSummary } from './api'
import { BadgesGrid } from './components/BadgesGrid'
import { CardHero } from './components/CardHero'
import { RatingBars, StreakFlame, TagCloud, VerifiedProgress, XpBar } from './components/ProfileBits'
import { SkillSparkline, TrueSkillGauge } from './components/TrueSkillGauge'
import { TIER_COPY } from './lib'

const fade = {
  initial: { opacity: 0, y: 18 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: '-60px' },
  transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] as const },
}

export default function MyProfilePage() {
  const { logout, pending: loggingOut } = useLogout('/')
  const profile = useMyProfile()
  const game = useGamification()
  const ratings = useRatingSummary()

  if (profile.isLoading)
    return (
      <div className="grid gap-8 lg:grid-cols-[380px_1fr]">
        <Skeleton className="mx-auto aspect-[63/88] w-[290px]" />
        <div className="space-y-4">
          <Skeleton className="h-28" />
          <Skeleton className="h-64" />
          <Skeleton className="h-48" />
        </div>
      </div>
    )
  if (profile.isError || !profile.data) return <ErrorState error={profile.error} onRetry={() => profile.refetch()} />

  const p = profile.data
  const st = p.stats
  const rs = ratings.data

  return (
    <div className="grid gap-8 lg:grid-cols-[380px_minmax(0,1fr)] xl:gap-12">
      {/* ── Hero column ── */}
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
              <CalendarDays className="h-3.5 w-3.5" /> Joined {formatDateLong(p.joined_at)}
            </span>
          </div>
          <div className="mt-5 flex justify-center gap-2">
            <LinkButton to="/app/profile/edit" variant="secondary">
              <Pencil className="h-4 w-4" /> Edit profile
            </LinkButton>
            <Button variant="ghost" onClick={logout} loading={loggingOut}>
              {!loggingOut && <LogOut className="h-4 w-4" />} {loggingOut ? 'Logging out…' : 'Log out'}
            </Button>
          </div>
          <div className="mx-auto mt-5 w-full max-w-[320px] rounded-2xl bg-white/4 p-3 text-left ring-1 ring-white/8">
            <div className="mb-2 flex items-center gap-1.5 px-1 text-[11px] font-semibold tracking-[0.18em] text-muted uppercase">
              <Palette className="h-3.5 w-3.5" /> Appearance
            </div>
            <ThemeSelector className="w-full" />
          </div>
        </div>
      </aside>

      {/* ── Details ── */}
      <div className="min-w-0 space-y-6">
        {/* XP + streak */}
        <motion.div {...fade}>
          <Card className="grid gap-6 p-5 sm:grid-cols-[1.6fr_1fr] sm:p-6">
            {game.data ? <XpBar g={game.data} /> : <Skeleton className="h-16" />}
            <div className="sm:border-l sm:border-white/8 sm:pl-6">
              <StreakFlame weeks={game.data?.streak_weeks ?? st.streak_weeks} />
            </div>
          </Card>
        </motion.div>

        {/* True Skill */}
        <motion.div {...fade}>
          <Card className="p-5 sm:p-6">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">True Skill</h2>
                <p className="text-xs text-muted">Peer-verified by {rs?.distinct_raters ?? 0} teammates · {TIER_COPY[st.tier]}</p>
              </div>
              <span className="rounded-full bg-white/5 px-2.5 py-1 font-mono text-xs text-muted ring-1 ring-white/10">
                {st.ratings_received} ratings
              </span>
            </div>
            <div className="grid items-center gap-6 md:grid-cols-[260px_1fr]">
              <TrueSkillGauge value={st.true_skill} tier={st.tier} />
              {ratings.isLoading ? <Skeleton className="h-28" /> : <SkillSparkline history={rs?.history ?? []} />}
            </div>
          </Card>
        </motion.div>

        {/* Verified Playmaker */}
        <motion.div {...fade}>
          <Card className="relative overflow-hidden p-5 sm:p-6" spotlight>
            <div aria-hidden className="pointer-events-none absolute -top-16 -right-16 h-48 w-48 rounded-full bg-volt/10 blur-3xl" />
            <div className="mb-5 flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-volt" />
              <h2 className="text-lg font-semibold">Verified Playmaker</h2>
              {st.is_verified_playmaker && <span className="ml-auto text-xs font-bold text-volt">UNLOCKED</span>}
            </div>
            {rs ? (
              <VerifiedProgress eligible={rs.verified_progress.eligible} criteria={rs.verified_progress.criteria} verified={st.is_verified_playmaker} />
            ) : ratings.isError ? (
              <p className="text-sm text-muted">Couldn't load your progress right now.</p>
            ) : (
              <Skeleton className="h-36" />
            )}
            <p className="mt-5 text-xs text-subtle">
              Verified status is re-checked after every rating — keep your standards up to keep the badge.
            </p>
          </Card>
        </motion.div>

        {/* Breakdown + tags */}
        <motion.div {...fade} className="grid gap-6 md:grid-cols-2">
          <Card className="p-5 sm:p-6">
            <h2 className="mb-5 text-lg font-semibold">Rating breakdown</h2>
            <RatingBars
              rows={[
                { label: 'Skill', value: rs?.avg_skill ?? st.avg_skill, color: 'var(--color-volt)' },
                { label: 'Fair play', value: rs?.avg_fair_play ?? st.avg_fair_play, color: 'var(--color-mint)' },
                { label: 'Reliability', value: rs?.avg_reliability ?? st.avg_reliability, color: 'var(--color-electric)' },
              ]}
            />
            <p className="mt-5 text-[11px] text-subtle">Anonymous · weighted by rater credibility · shown only in aggregate</p>
          </Card>
          <Card className="p-5 sm:p-6">
            <h2 className="mb-5 text-lg font-semibold">What teammates say</h2>
            <TagCloud tags={rs?.top_tags ?? st.top_tags} />
          </Card>
        </motion.div>

        {/* Stats */}
        <motion.div {...fade} className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
          <Stat label="Matches" value={st.matches_played} />
          <Stat label="Hosted" value={st.matches_hosted} />
          <Stat label="Subs" value={st.subs_made} hint="Hero saves" />
          <Stat label="Rated" value={st.ratings_given} hint="teammates" />
          <Stat label="Dropouts" value={st.dropouts} />
          <Stat label="No-shows" value={st.no_shows} />
        </motion.div>

        {/* Badges */}
        <motion.div {...fade}>
          <Card className="p-5 sm:p-6">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-lg font-semibold">
                <Sparkles className="h-5 w-5 text-grape" /> Badges
              </h2>
              {game.data && (
                <span className="font-mono text-xs text-muted">
                  {game.data.badges.filter((b) => b.earned_at).length}/{game.data.badges.length}
                </span>
              )}
            </div>
            {game.isLoading ? (
              <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
                {Array.from({ length: 6 }, (_, i) => (
                  <Skeleton key={i} className="aspect-square" />
                ))}
              </div>
            ) : (
              <BadgesGrid badges={game.data?.badges ?? p.badges} />
            )}
          </Card>
        </motion.div>

        {/* Pinned clips */}
        <motion.section {...fade}>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              <Film className="h-5 w-5 text-electric" /> Pinned highlights
            </h2>
            <LinkButton to="/app/highlights?tab=recordings" variant="ghost" size="sm">
              Manage
            </LinkButton>
          </div>
          {p.pinned_clips.length ? (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {p.pinned_clips.map((c) => (
                <ClipCard key={c.id} clip={c} hideOwner />
              ))}
            </div>
          ) : (
            <EmptyState
              icon="🎬"
              title="No pinned clips yet"
              description="Play a recorded match, clip your best moment and pin up to 3 to your profile."
              action={<LinkButton to="/app/highlights?tab=recordings" variant="secondary">My recordings</LinkButton>}
            />
          )}
        </motion.section>
      </div>
    </div>
  )
}
