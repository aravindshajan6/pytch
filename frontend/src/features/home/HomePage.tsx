import { ArrowRight, CalendarClock, Compass, Flame, MapPin, Radio, Sparkles, Star, Swords, Trophy, Zap } from 'lucide-react'
import { motion } from 'motion/react'
import { Link } from 'react-router'
import { Avatar } from '@/components/ui/Avatar'
import { AnimatedNumber } from '@/components/ui/AnimatedNumber'
import { LinkButton } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Chip } from '@/components/ui/Chip'
import { SportBadge, TrueSkillPill } from '@/components/ui/PlayerBits'
import { ProgressBar } from '@/components/ui/ProgressRing'
import { EmptyState, Skeleton } from '@/components/ui/States'
import { TurfArt } from '@/components/ui/TurfArt'
import { BenchQuickToggle } from '@/features/bench/components/BenchQuickToggle'
import { ClipCard } from '@/features/highlights/components/ClipCard'
import { LobbyCard } from '@/features/lobby/components/LobbyCard'
import { WeatherAlertBanner } from '@/features/weather/components/WeatherAlertBanner'
import { useCountdown } from '@/hooks/useCountdown'
import { useMe } from '@/hooks/useMe'
import { formatWhen } from '@/lib/format'
import type { LobbySummary } from '@/types/api'
import {
  useGamification,
  useNearbyLobbies,
  usePendingRatings,
  useTrendingClips,
  useUpcoming,
  useWeatherAlerts,
  useWeeklyLeaders,
} from './api'

const container = { hidden: {}, show: { transition: { staggerChildren: 0.07 } } }
const item = {
  hidden: { opacity: 0, y: 18 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] as const } },
}

function greeting() {
  const h = Number(new Intl.DateTimeFormat('en-IN', { hour: 'numeric', hour12: false, timeZone: 'Asia/Kolkata' }).format(new Date()))
  if (h < 5) return 'Late night'
  if (h < 12) return 'Morning'
  if (h < 17) return 'Afternoon'
  return 'Evening'
}

export default function HomePage() {
  const { user } = useMe()
  const upcoming = useUpcoming()
  const nearby = useNearbyLobbies()
  const pending = usePendingRatings()
  const alerts = useWeatherAlerts()
  const game = useGamification()
  const clips = useTrendingClips()
  const leaders = useWeeklyLeaders()

  const next = upcoming.data?.[0]
  const pendingCount = pending.data?.reduce((n, p) => n + p.teammates.length, 0) ?? 0
  const firstName = user?.name.split(' ')[0] ?? 'Player'

  return (
    <motion.div variants={container} initial="hidden" animate="show" className="space-y-8">
      {/* ── Hero ── */}
      <motion.section variants={item} className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Card className="relative overflow-hidden p-6 sm:p-8" spotlight>
          <div aria-hidden className="pitch-grid absolute inset-0 opacity-60 [mask-image:radial-gradient(ellipse_at_top_right,black,transparent_70%)]" />
          <div className="relative">
            <div className="flex items-center gap-2 text-sm text-muted">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-volt opacity-70" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-volt" />
              </span>
              {greeting()}, Kochi is playing
            </div>
            <h1 className="mt-3 text-3xl leading-tight font-bold sm:text-4xl">
              Ready for kick-off,
              <br />
              <span className="text-gradient-volt">{firstName}?</span>
            </h1>

            {game.data ? (
              <div className="mt-6 flex flex-wrap items-center gap-5">
                <div className="min-w-48 flex-1">
                  <div className="mb-1.5 flex items-baseline justify-between text-xs">
                    <span className="font-semibold tracking-wider text-muted uppercase">Level {game.data.level}</span>
                    <span className="font-mono text-subtle">
                      {game.data.xp - game.data.level_xp_start} / {game.data.next_level_xp - game.data.level_xp_start} XP
                    </span>
                  </div>
                  <ProgressBar value={game.data.progress} />
                </div>
                <div className="flex items-center gap-3">
                  <Chip tone={game.data.streak_weeks > 0 ? 'sun' : 'neutral'} size="md">
                    <Flame className="h-3.5 w-3.5" /> {game.data.streak_weeks}-week streak
                  </Chip>
                  {user && <TrueSkillPill value={user.true_skill} />}
                </div>
              </div>
            ) : (
              <Skeleton className="mt-6 h-10 w-full max-w-md" />
            )}

            <div className="mt-7 flex flex-wrap gap-2">
              <LinkButton to="/app/discover" size="md">
                <Compass className="h-4 w-4" /> Book a turf
              </LinkButton>
              <LinkButton to="/app/play" variant="secondary">
                <Swords className="h-4 w-4" /> Find a game
              </LinkButton>
              <LinkButton to="/app/bench" variant="secondary">
                <Radio className="h-4 w-4 text-flare" /> Go on the bench
              </LinkButton>
            </div>
          </div>
        </Card>

        <NextMatchCard lobby={next} loading={upcoming.isLoading} />
      </motion.section>

      {/* ── Nudges ── */}
      {(alerts.data?.length || pendingCount > 0) && (
        <motion.section variants={item} className="grid gap-3 md:grid-cols-2">
          {alerts.data?.map((a) => <WeatherAlertBanner key={a.id} alert={a} />)}
          {pending.data && pendingCount > 0 && (
            <Link to={`/app/rate/${pending.data[0]!.lobby_id}`}>
              <Card interactive glow="volt" spotlight className="flex items-center gap-4 p-5">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-volt/15 ring-1 ring-volt/40">
                  <Star className="h-6 w-6 text-volt" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">Rate your squad from {pending.data[0]!.title}</div>
                  <div className="text-sm text-muted">
                    {pendingCount} teammate{pendingCount > 1 ? 's' : ''} waiting · +{pendingCount * 15} XP · anonymous
                  </div>
                </div>
                <ArrowRight className="h-5 w-5 text-volt" />
              </Card>
            </Link>
          )}
        </motion.section>
      )}

      {/* ── Games forming ── */}
      <motion.section variants={item}>
        <SectionHeader icon={<Zap className="h-4 w-4 text-volt" />} title="Games forming near you" to="/app/play" />
        {nearby.isLoading ? (
          <div className="flex gap-4 overflow-hidden">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-72 w-80 shrink-0" />
            ))}
          </div>
        ) : nearby.data?.items.length ? (
          <div className="no-scrollbar -mx-4 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-2 sm:-mx-6 sm:px-6">
            {nearby.data.items.map((l) => (
              <div key={l.id} className="w-[19rem] shrink-0 snap-start sm:w-80">
                <LobbyCard lobby={l} />
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            icon="🥅"
            title="No open games nearby right now"
            description="Host one — split the fee with your squad in 30 minutes flat."
            action={<LinkButton to="/app/discover">Book a turf</LinkButton>}
          />
        )}
      </motion.section>

      {/* ── Bench + leaderboard ── */}
      <motion.section variants={item} className="grid items-start gap-4 lg:grid-cols-[1.2fr_1fr]">
        <BenchQuickToggle />
        <Card className="p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-base font-semibold">
              <Trophy className="h-4 w-4 text-sun" /> This week's top players
            </h2>
            <Link to="/app/leaderboard" className="text-xs font-semibold text-volt hover:underline">
              Full table
            </Link>
          </div>
          {leaders.isLoading ? (
            <div className="space-y-3">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-12" />
              ))}
            </div>
          ) : (
            <ol className="space-y-2">
              {leaders.data?.entries.slice(0, 3).map((e, i) => (
                <motion.li
                  key={e.user.id}
                  initial={{ opacity: 0, x: -12 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.1 * i }}
                >
                  <Link to={`/app/players/${e.user.id}`} className="flex items-center gap-3 rounded-2xl p-2 transition hover:bg-white/5">
                    <span className="w-6 text-center font-display text-lg">{['🥇', '🥈', '🥉'][i]}</span>
                    <Avatar user={e.user} size="sm" />
                    <span className="flex-1 truncate text-sm font-medium">{e.user.name}</span>
                    <span className="font-mono text-sm text-volt">
                      <AnimatedNumber value={e.value} /> XP
                    </span>
                  </Link>
                </motion.li>
              ))}
              {leaders.data?.me && leaders.data.me.rank > 3 && (
                <li className="mt-2 flex items-center gap-3 rounded-2xl bg-volt/8 p-2 ring-1 ring-volt/20">
                  <span className="w-6 text-center font-mono text-sm text-muted">#{leaders.data.me.rank}</span>
                  <Avatar user={leaders.data.me.user} size="sm" />
                  <span className="flex-1 text-sm font-medium">You</span>
                  <span className="font-mono text-sm">{Math.round(leaders.data.me.value)} XP</span>
                </li>
              )}
            </ol>
          )}
        </Card>
      </motion.section>

      {/* ── Highlights ── */}
      <motion.section variants={item}>
        <SectionHeader icon={<Sparkles className="h-4 w-4 text-grape" />} title="Trending highlights" to="/app/highlights" />
        {clips.isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="aspect-video" />
            ))}
          </div>
        ) : clips.data?.items.length ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {clips.data.items.slice(0, 3).map((c) => (
              <ClipCard key={c.id} clip={c} />
            ))}
          </div>
        ) : (
          <EmptyState icon="🎬" title="No highlights yet" description="Book a recorded match on a camera turf and clip your best moments." />
        )}
      </motion.section>

      {/* ── Badges teaser ── */}
      {game.data && (
        <motion.section variants={item}>
          <SectionHeader icon={<Trophy className="h-4 w-4 text-volt" />} title="Your trophy cabinet" to="/app/profile" />
          <div className="no-scrollbar -mx-4 flex gap-3 overflow-x-auto px-4 pb-2 sm:-mx-6 sm:px-6">
            {game.data.badges
              .slice()
              .sort((a, b) => Number(!!b.earned_at) - Number(!!a.earned_at))
              .map((b, i) => (
                <motion.div
                  key={b.code}
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: 0.03 * i }}
                  title={`${b.name} — ${b.description}`}
                  className={`flex w-24 shrink-0 flex-col items-center gap-2 rounded-2xl p-3 text-center ring-1 ${
                    b.earned_at ? 'bg-white/5 ring-white/10' : 'opacity-35 ring-white/5 grayscale'
                  }`}
                >
                  <span className="text-3xl">{b.icon}</span>
                  <span className="text-[11px] leading-tight font-semibold">{b.name}</span>
                </motion.div>
              ))}
          </div>
        </motion.section>
      )}
    </motion.div>
  )
}

function SectionHeader({ icon, title, to }: { icon: React.ReactNode; title: string; to: string }) {
  return (
    <div className="mb-4 flex items-center justify-between">
      <h2 className="flex items-center gap-2 text-lg font-semibold">
        {icon}
        {title}
      </h2>
      <Link to={to} className="group flex items-center gap-1 text-sm font-semibold text-volt">
        See all <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
      </Link>
    </div>
  )
}

function NextMatchCard({ lobby, loading }: { lobby?: LobbySummary; loading: boolean }) {
  const kickoff = useCountdown(lobby?.start_at)
  if (loading) return <Skeleton className="min-h-64" />
  if (!lobby)
    return (
      <Card className="flex min-h-64 flex-col items-center justify-center p-6 text-center">
        <CalendarClock className="h-10 w-10 text-subtle" />
        <div className="mt-3 font-semibold">No matches lined up</div>
        <p className="mt-1 text-sm text-muted">Your next game will show up here with a live countdown.</p>
        <LinkButton to="/app/play" className="mt-5" size="sm">
          Find a game
        </LinkButton>
      </Card>
    )
  return (
    <Link to={`/app/lobby/${lobby.id}`} className="block">
      <Card interactive spotlight className="h-full min-h-64">
        {/* Media face: text sits on the turf photo, so it's a dark island in both themes. */}
        <div data-theme="dark" className="relative h-full min-h-64">
          <TurfArt seed={lobby.turf.id} sport={lobby.sport} src={lobby.turf.cover_url} className="absolute inset-0" />
          <div className="relative flex h-full min-h-64 flex-col justify-between p-6">
            <div className="flex items-center justify-between">
              <Chip tone="solid" size="sm">
                Next match
              </Chip>
              <SportBadge sport={lobby.sport} format={lobby.format} />
            </div>
            <div>
              <div className="text-xs font-semibold tracking-[0.2em] text-volt uppercase">Kick-off in</div>
              <div className="mt-1 font-mono text-4xl font-bold tabular-nums sm:text-5xl">
                {kickoff.hours > 23 ? `${Math.floor(kickoff.hours / 24)}d ${kickoff.hours % 24}h` : kickoff.label}
              </div>
              <div className="mt-3 text-lg font-semibold">{lobby.title}</div>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-fg/75">
                <span>{formatWhen(lobby.start_at)}</span>
                <span className="flex items-center gap-1">
                  <MapPin className="h-3.5 w-3.5" /> {lobby.turf.name}
                </span>
              </div>
            </div>
          </div>
        </div>
      </Card>
    </Link>
  )
}
