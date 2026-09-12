import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { BadgeCheck, ChevronUp, Crown, Flame, Trophy, Zap } from 'lucide-react'
import { AnimatePresence, LayoutGroup, motion } from 'motion/react'
import { useState } from 'react'
import { Link } from 'react-router'
import { AnimatedNumber } from '@/components/ui/AnimatedNumber'
import { Avatar } from '@/components/ui/Avatar'
import { LinkButton } from '@/components/ui/Button'
import { TierBadge } from '@/components/ui/PlayerBits'
import { Segmented } from '@/components/ui/Segmented'
import { EmptyState, ErrorState, PageHeader, Skeleton } from '@/components/ui/States'
import { useMe } from '@/hooks/useMe'
import { api } from '@/lib/api/endpoints'
import { qk } from '@/lib/api/queryKeys'
import { cn } from '@/lib/cn'
import { alpha } from '@/lib/color'
import { useResolvedTheme } from '@/stores/theme'
import type { Leaderboard, LeaderboardEntry } from '@/types/api'

type Metric = Leaderboard['metric']
type Period = Leaderboard['period']

const fmt = (metric: Metric) => (n: number) => (metric === 'xp' ? Math.round(n).toLocaleString('en-IN') : Math.round(n).toString())
const unit = (metric: Metric) => (metric === 'xp' ? 'XP' : 'TS')

const PODIUM = {
  1: { h: 'h-40 sm:h-48', color: 'var(--color-volt)', delay: 0.45, avatar: 'xl' as const },
  2: { h: 'h-28 sm:h-36', color: 'var(--color-electric)', delay: 0.25, avatar: 'lg' as const },
  3: { h: 'h-20 sm:h-28', color: 'var(--color-sun)', delay: 0.1, avatar: 'lg' as const },
}

export default function LeaderboardPage() {
  const { user } = useMe()
  const [metric, setMetric] = useState<Metric>('xp')
  const [period, setPeriod] = useState<Period>('week')
  // XP "this week" = XP earned in the last 7 days. True Skill is a rating, not a tally: "this week" there
  // means "players rated in the last 7 days", ranked by their current score — so label it that way.
  const skill = metric === 'true_skill'

  const board = useQuery({
    queryKey: qk.leaderboard(metric, period),
    queryFn: () => api.gamification.leaderboard(metric, period),
    placeholderData: keepPreviousData,
  })

  const entries = board.data?.entries ?? []
  const top = entries.slice(0, 3)
  const rest = entries.slice(3)
  const me = board.data?.me ?? null
  const myId = user?.id
  const f = fmt(metric)
  const ahead = me && me.rank > 1 ? entries.find((e) => e.rank === me.rank - 1) : undefined
  const gap = ahead && me ? Math.max(1, Math.ceil(ahead.value - me.value + (metric === 'xp' ? 1 : 0.5))) : null
  const boardKey = `${metric}-${period}`

  return (
    <div className="mx-auto max-w-3xl pb-24">
      <PageHeader
        eyebrow="Kochi"
        title="Leaderboard"
        subtitle={
          !skill
            ? period === 'week'
              ? 'XP earned in the last 7 days — playing, hosting, subbing and rating your squad.'
              : 'Lifetime XP from playing, hosting, subbing and rating your squad.'
            : period === 'week'
              ? 'Peer-verified True Skill of players rated in the last 7 days.'
              : 'Peer-verified True Skill — everyone with 3+ ratings.'
        }
      />

      <div className="mb-8 flex flex-wrap items-center gap-3">
        <Segmented<Metric>
          aria-label="Rank by"
          value={metric}
          onChange={setMetric}
          className="[&_button]:whitespace-nowrap"
          options={[
            { value: 'xp', label: <><Zap className="h-4 w-4" /> XP</> },
            { value: 'true_skill', label: <><BadgeCheck className="h-4 w-4" /> True Skill</> },
          ]}
        />
        <Segmented<Period>
          aria-label="Period"
          value={period}
          onChange={setPeriod}
          size="sm"
          className="[&_button]:whitespace-nowrap"
          options={[
            { value: 'week', label: skill ? 'Rated this week' : 'This week' },
            { value: 'all', label: 'All time' },
          ]}
        />
        {board.isFetching && !board.isPending && <span className="h-4 w-4 animate-spin rounded-full border-2 border-volt/30 border-t-volt" aria-label="Updating" />}
      </div>

      {board.isPending ? (
        <BoardSkeleton />
      ) : board.isError ? (
        <ErrorState error={board.error} onRetry={() => board.refetch()} />
      ) : entries.length === 0 ? (
        <EmptyState
          icon="🏆"
          title="The board is wide open"
          description={
            period === 'week'
              ? skill
                ? 'Nobody has been rated this week yet. Play, get rated, climb.'
                : 'Nobody has scored yet this week. Play one game and #1 is yours.'
              : 'No rankings yet — be the first on the board.'
          }
          action={<LinkButton to="/app/play">Find a game</LinkButton>}
        />
      ) : (
        <LayoutGroup>
          {/* podium */}
          <div key={boardKey} className="relative mb-10 grid grid-cols-3 items-end gap-2 sm:gap-4" aria-label="Top three">
            <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-[radial-gradient(60%_100%_at_50%_100%,color-mix(in_srgb,_var(--color-volt)_12%,_transparent),transparent)]" />
            {[top[1], top[0], top[2]].map((e, i) =>
              e ? <PodiumSpot key={e.user.id} entry={e} metric={metric} isMe={e.user.id === myId} /> : <div key={`empty-${i}`} />,
            )}
          </div>

          {/* ranked list */}
          <ol className="space-y-2">
            <AnimatePresence mode="popLayout">
              {rest.map((e, i) => (
                <motion.li
                  key={e.user.id}
                  layout
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0, transition: { delay: Math.min(i, 12) * 0.03 } }}
                  exit={{ opacity: 0, scale: 0.96 }}
                  transition={{ type: 'spring', stiffness: 380, damping: 32 }}
                >
                  <Row entry={e} metric={metric} isMe={e.user.id === myId} />
                </motion.li>
              ))}
            </AnimatePresence>
          </ol>
        </LayoutGroup>
      )}

      {/* sticky "you" row */}
      <AnimatePresence>
        {me && !board.isPending && (
          <motion.div
            key="me"
            initial={{ y: 80, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 80, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 260, damping: 26, delay: 0.6 }}
            className="sticky bottom-24 z-20 mt-6 short:static lg:bottom-6"
          >
            <div className="glass-strong flex items-center gap-3 rounded-2xl p-3 pr-4 shadow-glow-volt sm:gap-4">
              <RankNumber rank={me.rank} highlight />
              <Avatar user={me.user} size="md" ring />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-semibold">You</span>
                  <TierBadge tier={me.user.tier} className="hidden sm:inline-flex" />
                </div>
                <div className="truncate text-xs text-muted">
                  {me.rank === 1 ? (
                    <span className="text-volt">You’re top of Kochi. Defend it. 👑</span>
                  ) : gap && ahead ? (
                    <>
                      <ChevronUp className="inline h-3.5 w-3.5 text-volt" /> {f(gap)} {unit(metric)} to pass {ahead.user.name.split(' ')[0]}
                    </>
                  ) : (
                    'Keep playing to climb'
                  )}
                </div>
              </div>
              <Value value={me.value} metric={metric} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function PodiumSpot({ entry, metric, isMe }: { entry: LeaderboardEntry; metric: Metric; isMe: boolean }) {
  const rank = entry.rank as 1 | 2 | 3
  const p = PODIUM[rank] ?? PODIUM[3]
  const first = rank === 1
  // light mode: the deepened accents need a gentler wash than the neon ones
  const k = useResolvedTheme() === 'light' ? 0.6 : 1
  return (
    <Link to={`/app/players/${entry.user.id}`} className="group relative flex flex-col items-center text-center" aria-label={`#${rank} ${entry.user.name}`}>
      <motion.div
        initial={{ opacity: 0, y: -30, scale: 0.6 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: 'spring', stiffness: 260, damping: 16, delay: p.delay + 0.35 }}
        className="relative mb-3"
      >
        {first && (
          <motion.span
            className="absolute -top-7 left-1/2 -translate-x-1/2 text-volt drop-shadow-[0_0_12px_color-mix(in_srgb,_var(--color-volt)_80%,_transparent)]"
            animate={{ y: [0, -4, 0], rotate: [-6, 6, -6] }}
            transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
          >
            <Crown className="h-7 w-7 fill-volt/30" />
          </motion.span>
        )}
        <span className="absolute inset-0 rounded-full blur-xl" style={{ background: alpha(p.color, 0.35 * k) }} />
        <Avatar user={entry.user} size={p.avatar} ring className="relative transition-transform group-hover:scale-105" />
      </motion.div>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: p.delay + 0.5 }} className="w-full px-1">
        <div className={cn('truncate text-sm font-semibold', isMe && 'text-volt')}>{isMe ? 'You' : entry.user.name.split(' ')[0]}</div>
        <div className="font-mono text-xs text-muted">
          <AnimatedNumber value={entry.value} format={fmt(metric)} /> {unit(metric)}
        </div>
      </motion.div>
      <motion.div
        initial={{ scaleY: 0 }}
        animate={{ scaleY: 1 }}
        transition={{ type: 'spring', stiffness: 90, damping: 15, delay: p.delay }}
        style={{
          originY: 1,
          background: `linear-gradient(180deg, ${alpha(p.color, 0.35 * k)}, ${alpha(p.color, 0.04)})`,
          boxShadow: `inset 0 1px 0 ${alpha(p.color, 0.6)}, 0 -10px 40px -20px ${alpha(p.color, 0.6 * k)}`,
        }}
        className={cn('relative mt-3 flex w-full items-start justify-center overflow-hidden rounded-t-2xl pt-3', p.h)}
      >
        <span className="font-display text-3xl font-black sm:text-4xl" style={{ color: p.color }}>
          {rank}
        </span>
        {first && (
          <motion.span
            aria-hidden
            className="absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-white/15 to-transparent [[data-theme=light]_&]:via-snow/45"
            initial={{ x: '-150%' }}
            animate={{ x: '350%' }}
            transition={{ duration: 1.6, delay: 1.2, repeat: Infinity, repeatDelay: 3 }}
            style={{ skewX: -15 }}
          />
        )}
      </motion.div>
    </Link>
  )
}

function Row({ entry, metric, isMe }: { entry: LeaderboardEntry; metric: Metric; isMe: boolean }) {
  return (
    <Link
      to={`/app/players/${entry.user.id}`}
      className={cn(
        'group flex items-center gap-3 rounded-2xl p-3 pr-4 ring-1 transition sm:gap-4',
        isMe
          ? 'bg-volt/8 ring-volt/40'
          : 'bg-white/[0.03] ring-white/8 hover:bg-white/[0.06] hover:ring-white/15 [[data-theme=light]_&]:bg-ink-800 [[data-theme=light]_&]:hover:shadow-card',
      )}
    >
      <RankNumber rank={entry.rank} highlight={isMe} />
      <Avatar user={entry.user} size="md" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className={cn('truncate font-semibold', isMe && 'text-volt')}>{isMe ? `${entry.user.name} (you)` : entry.user.name}</span>
          {entry.user.is_verified_playmaker && <BadgeCheck className="h-4 w-4 shrink-0 text-volt" aria-label="Verified Playmaker" />}
        </div>
        <div className="flex items-center gap-2 text-xs text-muted">
          <TierBadge tier={entry.user.tier} className="h-5 px-2 text-[10px]" />
          <span className="truncate">{entry.user.home_area ?? `Level ${entry.user.level}`}</span>
        </div>
      </div>
      <Value value={entry.value} metric={metric} />
    </Link>
  )
}

function RankNumber({ rank, highlight }: { rank: number; highlight?: boolean }) {
  return (
    <span
      className={cn(
        'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl font-mono text-sm font-bold tabular-nums',
        highlight ? 'bg-volt text-ink-950' : 'bg-white/5 text-fg/70',
      )}
    >
      {rank}
    </span>
  )
}

function Value({ value, metric }: { value: number; metric: Metric }) {
  return (
    <div className="text-right">
      <div className="flex items-center justify-end gap-1 font-display text-lg leading-none">
        {metric === 'xp' ? <Flame className="h-4 w-4 text-sun" /> : <Trophy className="h-4 w-4 text-volt" />}
        <AnimatedNumber value={value} format={fmt(metric)} />
      </div>
      <div className="mt-1 text-[10px] font-semibold tracking-wider text-subtle">{unit(metric)}</div>
    </div>
  )
}

function BoardSkeleton() {
  return (
    <div aria-busy aria-label="Loading leaderboard">
      <div className="mb-10 grid grid-cols-3 items-end gap-3">
        {['h-28', 'h-40', 'h-20'].map((h, i) => (
          <div key={i} className="flex flex-col items-center gap-3">
            <Skeleton className="h-14 w-14 rounded-full" />
            <Skeleton className="h-3 w-16 rounded-md" />
            <Skeleton className={cn('w-full rounded-b-none', h)} />
          </div>
        ))}
      </div>
      <div className="space-y-2">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    </div>
  )
}
