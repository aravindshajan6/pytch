import { ArrowLeft, ChevronLeft, ChevronRight, Clock, Send, Sparkles } from 'lucide-react'
import { AnimatePresence, motion, useMotionValue, useReducedMotion, useTransform } from 'motion/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { toast } from 'sonner'
import { AnimatedNumber } from '@/components/ui/AnimatedNumber'
import { Avatar } from '@/components/ui/Avatar'
import { Button, LinkButton } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Countdown } from '@/components/ui/Countdown'
import { SportBadge } from '@/components/ui/PlayerBits'
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States'
import { useMeta } from '@/hooks/useMeta'
import { errorMessage, isApiError } from '@/lib/api/client'
import { celebrate } from '@/lib/celebrate'
import { cn } from '@/lib/cn'
import { formatWhen } from '@/lib/format'
import type { PendingRating, UserPublic } from '@/types/api'
import { usePendingRatings, useSubmitRatings } from './api'
import { RateCard } from './components/RateCard'
import { emptyDraft, isComplete, type RatingDraft, toInput } from './draft'

const XP_PER_RATING = 15

export default function RatePage() {
  const { lobbyId } = useParams()
  const pending = usePendingRatings()
  const [done, setDone] = useState<{ xp: number; users: UserPublic[] } | null>(null)

  if (done) return <Celebration xp={done.xp} users={done.users} others={(pending.data ?? []).filter((p) => p.lobby_id !== lobbyId)} />

  if (pending.isLoading)
    return (
      <div className="mx-auto max-w-lg space-y-4">
        <Skeleton className="h-20" />
        <Skeleton className="h-[520px] rounded-[2rem]" />
      </div>
    )
  if (pending.isError) return <ErrorState error={pending.error} onRetry={() => pending.refetch()} />

  const match = pending.data?.find((p) => p.lobby_id === lobbyId)
  const others = (pending.data ?? []).filter((p) => p.lobby_id !== lobbyId)

  if (!match || match.teammates.length === 0)
    return (
      <div className="mx-auto max-w-lg space-y-6">
        <EmptyState
          icon="🤝"
          title={others.length ? 'This squad is all rated' : "You're all caught up"}
          description={
            others.length
              ? 'Nothing left to rate for this match — but other squads are waiting on you.'
              : 'No ratings pending. Play a match and rate your teammates to earn XP and build trust.'
          }
          action={!others.length && <LinkButton to="/app/play">Find a game</LinkButton>}
        />
        <OtherMatches items={others} />
      </div>
    )

  return <RateFlow key={match.lobby_id} match={match} onDone={setDone} />
}

// ───────────────────────── flow ─────────────────────────

function RateFlow({ match, onDone }: { match: PendingRating; onDone: (r: { xp: number; users: UserPublic[] }) => void }) {
  const meta = useMeta()
  const navigate = useNavigate()
  const submit = useSubmitRatings(match.lobby_id)
  const mates = match.teammates
  const [index, setIndex] = useState(0)
  const [dir, setDir] = useState(1)
  const advanceTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const [drafts, setDrafts] = useState<Record<string, RatingDraft>>(() =>
    Object.fromEntries(mates.map((u) => [u.id, emptyDraft()])),
  )

  const tags = meta.data?.rating_tags ?? []
  const completed = mates.filter((u) => drafts[u.id] && isComplete(drafts[u.id]!))
  const allDone = completed.length === mates.length

  const go = (next: number) => {
    const clamped = Math.max(0, Math.min(mates.length - 1, next))
    if (clamped === index) return
    setDir(clamped > index ? 1 : -1)
    setIndex(clamped)
  }

  const patch = (id: string, p: Partial<RatingDraft>) => {
    const prev = drafts[id]!
    setDrafts((d) => ({ ...d, [id]: { ...d[id]!, ...p } }))
    // Auto-advance once a card is finished for the first time via its stars.
    const starred = 'skill' in p || 'fair_play' in p || 'reliability' in p
    if (starred && !isComplete(prev) && isComplete({ ...prev, ...p })) {
      const at = mates.findIndex((u) => u.id === id)
      if (at < mates.length - 1) {
        clearTimeout(advanceTimer.current)
        advanceTimer.current = setTimeout(() => go(at + 1), 450)
      }
    }
  }
  useEffect(() => () => clearTimeout(advanceTimer.current), [])

  // Keyboard: ←/→ between teammates (star groups swallow their own arrows).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.closest('input, textarea, [role=radiogroup]') || t.isContentEditable)) return
      if (e.key === 'ArrowRight') go(index + 1)
      if (e.key === 'ArrowLeft') go(index - 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const onSubmit = () => {
    const ratings = completed.map((u) => toInput(u.id, drafts[u.id]!))
    submit.mutate(ratings, {
      onSuccess: (r) => {
        celebrate()
        onDone({ xp: r.xp_awarded, users: completed })
      },
      onError: (e) => {
        if (isApiError(e, 'RATING_WINDOW_CLOSED')) {
          toast.error('The rating window has closed', { description: 'Ratings open for 48 h after each match.' })
          navigate('/app')
        } else toast.error(errorMessage(e))
      },
    })
  }

  const visible = mates.map((u, i) => ({ u, offset: i - index })).filter((x) => x.offset >= 0 && x.offset <= 2)

  return (
    <div className="mx-auto max-w-lg">
      <Link to="/app" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted transition hover:text-fg">
        <ArrowLeft className="h-4 w-4" /> Home
      </Link>

      <motion.header initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="mb-5">
        <div className="text-xs font-semibold tracking-[0.2em] text-volt uppercase">Rate your squad</div>
        <h1 className="mt-1 text-2xl font-bold">{match.title}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted">
          <SportBadge sport={match.sport} />
          <span>
            {match.turf_name} · {formatWhen(match.start_at)}
          </span>
        </div>
        <div className="mt-2 flex items-center gap-1.5 text-xs text-subtle">
          <Clock className="h-3.5 w-3.5" /> Window closes in <Countdown to={match.closes_at} className="text-xs" urgentMs={3 * 3600 * 1000} />
        </div>
      </motion.header>

      {/* card stack */}
      <div className="relative grid grid-cols-1" aria-roledescription="carousel">
        <AnimatePresence initial={false} custom={dir}>
          {visible
            .slice()
            .reverse()
            .map(({ u, offset }) => (
              <StackCard
                key={u.id}
                offset={offset}
                dir={dir}
                onSwipe={(d) => go(index + d)}
                canNext={index < mates.length - 1}
                canPrev={index > 0}
              >
                <RateCard
                  user={u}
                  index={index + offset}
                  total={mates.length}
                  draft={drafts[u.id]!}
                  tags={tags}
                  onChange={(p) => patch(u.id, p)}
                />
              </StackCard>
            ))}
        </AnimatePresence>
      </div>

      {/* nav */}
      <div className="mt-6 flex items-center justify-between gap-3">
        <Button variant="secondary" size="icon" onClick={() => go(index - 1)} disabled={index === 0} aria-label="Previous teammate">
          <ChevronLeft className="h-5 w-5" />
        </Button>
        <div className="flex flex-wrap items-center justify-center gap-1.5">
          {mates.map((u, i) => {
            const c = isComplete(drafts[u.id]!)
            return (
              <button
                key={u.id}
                type="button"
                onClick={() => go(i)}
                aria-label={`Go to ${u.name}${c ? ' (rated)' : ''}`}
                aria-current={i === index}
                className="flex h-6 cursor-pointer items-center"
              >
                <motion.span
                  layout
                  className={cn('block h-2 rounded-full', c ? 'bg-volt' : 'bg-white/20', i === index && 'ring-2 ring-white/60')}
                  animate={{ width: i === index ? 22 : 8 }}
                  transition={{ type: 'spring', stiffness: 500, damping: 32 }}
                />
              </button>
            )
          })}
        </div>
        <Button variant="secondary" size="icon" onClick={() => go(index + 1)} disabled={index === mates.length - 1} aria-label="Next teammate">
          <ChevronRight className="h-5 w-5" />
        </Button>
      </div>
      <p className="mt-2 text-center text-[11px] text-subtle">Swipe or use ← → to move between teammates</p>

      {/* submit bar — sticky above the mobile bottom nav */}
      <div className="sticky bottom-24 z-20 mt-6 short:static lg:bottom-6">
        <div className="glass-strong flex items-center gap-3 rounded-3xl p-3 pl-5 shadow-2xl">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold">
              {completed.length}/{mates.length} rated
            </div>
            <div className="text-xs text-muted">
              {allDone ? 'Full squad — nice.' : completed.length ? `${mates.length - completed.length} will be skipped` : 'Rate at least one teammate'}
            </div>
          </div>
          <Button onClick={onSubmit} loading={submit.isPending} disabled={completed.length === 0}>
            <Send className="h-4 w-4" /> Submit{completed.length > 0 && ` · +${completed.length * XP_PER_RATING} XP`}
          </Button>
        </div>
      </div>
    </div>
  )
}

function StackCard({
  offset,
  dir,
  onSwipe,
  canNext,
  canPrev,
  children,
}: {
  offset: number
  dir: number
  onSwipe: (d: 1 | -1) => void
  canNext: boolean
  canPrev: boolean
  children: React.ReactNode
}) {
  const reduce = useReducedMotion()
  const x = useMotionValue(0)
  const rotate = useTransform(x, [-300, 0, 300], [-12, 0, 12])
  const top = offset === 0

  return (
    <motion.div
      custom={dir}
      className="[grid-area:1/1]"
      style={{ x, rotate, zIndex: 10 - offset, transformOrigin: '50% 90%' }}
      initial={reduce ? { opacity: 0 } : top && dir < 0 ? { x: -420, rotate: -14, opacity: 0 } : { scale: 0.86, y: 48, opacity: 0 }}
      animate={{ x: 0, scale: 1 - offset * 0.05, y: offset * 18, opacity: top ? 1 : 0.55 - offset * 0.15 }}
      variants={{
        exit: (d: number) =>
          reduce ? { opacity: 0 } : d > 0 ? { x: -440, rotate: -16, opacity: 0 } : { scale: 0.86, y: 48, opacity: 0 },
      }}
      exit="exit"
      transition={{ type: 'spring', stiffness: 320, damping: 30 }}
      drag={top && !reduce ? 'x' : false}
      dragSnapToOrigin
      dragElastic={0.7}
      onDragEnd={(_, info) => {
        const power = info.offset.x + info.velocity.x * 0.2
        if (power < -120 && canNext) onSwipe(1)
        else if (power > 120 && canPrev) onSwipe(-1)
      }}
      inert={!top}
      aria-hidden={!top}
    >
      {children}
    </motion.div>
  )
}

// ───────────────────────── done ─────────────────────────

function Celebration({ xp, users, others }: { xp: number; users: UserPublic[]; others: PendingRating[] }) {
  return (
    <div className="mx-auto flex max-w-lg flex-col items-center py-8 text-center">
      <motion.div
        initial={{ scale: 0.4, opacity: 0, rotate: -10 }}
        animate={{ scale: 1, opacity: 1, rotate: 0 }}
        transition={{ type: 'spring', stiffness: 260, damping: 14 }}
        className="relative flex h-44 w-44 items-center justify-center"
      >
        <span className="absolute inset-0 animate-pulse-ring rounded-full bg-volt/25" />
        <span className="absolute inset-4 rounded-full bg-volt/10 blur-2xl" />
        <div className="relative flex h-36 w-36 flex-col items-center justify-center rounded-full bg-ink-800 shadow-glow-volt ring-2 ring-volt/60">
          <Sparkles className="h-5 w-5 text-volt" />
          <div className="font-display text-4xl font-bold text-volt">
            +<AnimatedNumber value={xp} duration={1.6} />
          </div>
          <div className="text-xs font-bold tracking-[0.2em] text-muted">XP</div>
        </div>
      </motion.div>
      <motion.h1 initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="mt-8 text-3xl font-bold">
        Squad rated!
      </motion.h1>
      <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.45 }} className="mt-2 text-muted">
        Honest ratings keep lobbies fair. Your votes are anonymous and count toward everyone's True Skill.
      </motion.p>
      <div className="mt-6 flex -space-x-3">
        {users.slice(0, 8).map((u, i) => (
          <motion.span
            key={u.id}
            initial={{ opacity: 0, y: 30, scale: 0.5 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ delay: 0.55 + i * 0.07, type: 'spring', stiffness: 400, damping: 18 }}
          >
            <Avatar user={u} size="lg" className="rounded-full ring-4 ring-ink-900" />
          </motion.span>
        ))}
      </div>
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.9 }} className="mt-10 w-full space-y-4">
        {others.length > 0 && (
          <LinkButton to={`/app/rate/${others[0]!.lobby_id}`} block size="lg">
            Rate your next squad · {others[0]!.title}
          </LinkButton>
        )}
        <div className="flex gap-3">
          <LinkButton to="/app" variant="secondary" block>
            Home
          </LinkButton>
          <LinkButton to="/app/profile" variant="secondary" block>
            My player card
          </LinkButton>
        </div>
      </motion.div>
    </div>
  )
}

function OtherMatches({ items }: { items: PendingRating[] }) {
  const list = useMemo(() => items.filter((p) => p.teammates.length > 0), [items])
  if (!list.length) return null
  return (
    <div className="space-y-3">
      <h2 className="text-sm font-semibold tracking-wider text-muted uppercase">Waiting on you</h2>
      {list.map((p) => (
        <Link key={p.lobby_id} to={`/app/rate/${p.lobby_id}`}>
          <Card interactive spotlight className="flex items-center gap-4 p-4">
            <div className="min-w-0 flex-1">
              <div className="truncate font-semibold">{p.title}</div>
              <div className="text-xs text-muted">
                {p.turf_name} · {formatWhen(p.start_at)} · {p.teammates.length} to rate
              </div>
            </div>
            <span className="text-xs font-bold text-volt">+{p.teammates.length * XP_PER_RATING} XP</span>
            <ChevronRight className="h-4 w-4 text-muted" />
          </Card>
        </Link>
      ))}
    </div>
  )
}
