import { useInfiniteQuery, useMutation, useQueryClient, type InfiniteData } from '@tanstack/react-query'
import {
  AlarmClock,
  ArrowRightLeft,
  Award,
  BadgeCheck,
  BellRing,
  CheckCheck,
  ChevronRight,
  CircleCheck,
  CircleX,
  CloudRain,
  Film,
  IndianRupee,
  LifeBuoy,
  Siren,
  Star,
  TimerOff,
  TrendingUp,
  UserMinus,
  UserPlus,
  Wallet,
  type LucideIcon,
} from 'lucide-react'
import { AnimatePresence, motion, useInView } from 'motion/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { notificationHref } from '@/app/RealtimeProvider'
import { AnimatedNumber } from '@/components/ui/AnimatedNumber'
import { Button } from '@/components/ui/Button'
import { Segmented } from '@/components/ui/Segmented'
import { EmptyState, ErrorState, PageHeader, Skeleton, Spinner } from '@/components/ui/States'
import { errorMessage } from '@/lib/api/client'
import { api } from '@/lib/api/endpoints'
import { qk } from '@/lib/api/queryKeys'
import { cn } from '@/lib/cn'
import { formatDay, formatTime, timeAgo } from '@/lib/format'
import type { Notification, NotificationPage, NotificationType } from '@/types/api'
import { alpha } from '@/lib/color'

const PAGE_SIZE = 20

const TYPE_META: Record<NotificationType, { icon: LucideIcon; color: string; label: string }> = {
  lobby_confirmed: { icon: CircleCheck, color: 'var(--color-volt)', label: 'Confirmed' },
  lobby_expired: { icon: TimerOff, color: 'var(--color-muted)', label: 'Expired' },
  lobby_cancelled: { icon: CircleX, color: 'var(--color-flare)', label: 'Cancelled' },
  member_joined: { icon: UserPlus, color: 'var(--color-electric)', label: 'Lobby' },
  member_left: { icon: UserMinus, color: 'var(--color-sun)', label: 'Lobby' },
  payment_received: { icon: IndianRupee, color: 'var(--color-mint)', label: 'Payment' },
  payment_reminder: { icon: AlarmClock, color: 'var(--color-sun)', label: 'Reminder' },
  sos: { icon: Siren, color: 'var(--color-flare)', label: 'SOS' },
  sub_found: { icon: LifeBuoy, color: 'var(--color-mint)', label: 'Bench' },
  weather_alert: { icon: CloudRain, color: 'var(--color-sun)', label: 'Weather' },
  match_transferred: { icon: ArrowRightLeft, color: 'var(--color-electric)', label: 'Moved' },
  rating_request: { icon: Star, color: 'var(--color-grape-soft)', label: 'Rate' },
  recording_ready: { icon: Film, color: 'var(--color-electric)', label: 'Highlights' },
  badge_earned: { icon: Award, color: 'var(--color-grape-soft)', label: 'Badge' },
  level_up: { icon: TrendingUp, color: 'var(--color-volt)', label: 'Level up' },
  wallet_credit: { icon: Wallet, color: 'var(--color-mint)', label: 'Credits' },
  verified_playmaker: { icon: BadgeCheck, color: 'var(--color-volt)', label: 'Verified' },
}
const FALLBACK_META = { icon: BellRing, color: 'var(--color-muted)', label: 'Update' }

type Filter = 'all' | 'unread'
type Feed = InfiniteData<NotificationPage, number>

export default function NotificationsPage() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [filter, setFilter] = useState<Filter>('all')
  const key = useMemo(() => [...qk.notifications, 'feed', filter] as const, [filter])

  const feed = useInfiniteQuery({
    queryKey: key,
    queryFn: ({ pageParam }) => api.notifications.list({ unread_only: filter === 'unread', limit: PAGE_SIZE, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (last) => {
      const nextOffset = last.offset + last.items.length
      return last.items.length > 0 && nextOffset < last.total ? nextOffset : undefined
    },
  })

  const items = useMemo(() => {
    const seen = new Set<string>()
    return (feed.data?.pages ?? []).flatMap((p) => p.items).filter((n) => (seen.has(n.id) ? false : (seen.add(n.id), true)))
  }, [feed.data])
  const unread = feed.data?.pages[0]?.unread_count ?? 0

  /** Optimistically mark notifications read in every cached feed page. */
  const markLocal = (ids: Set<string> | 'all') => {
    const now = new Date().toISOString()
    qc.setQueriesData<Feed>({ queryKey: [...qk.notifications, 'feed'] }, (data) => {
      if (!data) return data
      let flipped = 0
      const pages = data.pages.map((p) => ({
        ...p,
        items: p.items.map((n) => {
          if (n.read_at || (ids !== 'all' && !ids.has(n.id))) return n
          flipped++
          return { ...n, read_at: now }
        }),
      }))
      return {
        ...data,
        pages: pages.map((p) => ({ ...p, unread_count: ids === 'all' ? 0 : Math.max(0, p.unread_count - flipped) })),
      }
    })
  }

  const markRead = useMutation({
    mutationFn: (id: string) => api.notifications.read(id),
    onMutate: (id) => markLocal(new Set([id])),
    onSettled: () => qc.invalidateQueries({ queryKey: qk.notifications }),
  })

  const markAll = useMutation({
    mutationFn: () => api.notifications.readAll(),
    onMutate: () => markLocal('all'),
    onSuccess: (r) => toast.success(r.updated ? `Marked ${r.updated} as read` : 'All caught up'),
    onError: (e) => toast.error(errorMessage(e)),
    onSettled: () => qc.invalidateQueries({ queryKey: qk.notifications }),
  })

  const open = (n: Notification) => {
    if (!n.read_at) markRead.mutate(n.id)
    const href = notificationHref(n)
    if (href) navigate(href)
  }

  // infinite scroll sentinel (the button remains for keyboard users)
  const sentinel = useRef<HTMLDivElement>(null)
  const nearEnd = useInView(sentinel, { margin: '0px 0px 400px 0px' })
  useEffect(() => {
    if (nearEnd && feed.hasNextPage && !feed.isFetchingNextPage) void feed.fetchNextPage()
  }, [nearEnd, feed])

  const groups = useMemo(() => groupByDay(items), [items])

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        eyebrow="Inbox"
        title="Notifications"
        subtitle={
          feed.isSuccess ? (
            unread > 0 ? (
              <>
                <AnimatedNumber value={unread} className="font-semibold text-volt" /> unread
              </>
            ) : (
              'You’re all caught up'
            )
          ) : (
            'Games, payments, SOS calls and rain alerts'
          )
        }
        actions={
          <Button variant="secondary" size="sm" onClick={() => markAll.mutate()} disabled={unread === 0 || markAll.isPending} loading={markAll.isPending}>
            {!markAll.isPending && <CheckCheck className="h-4 w-4" />} Mark all read
          </Button>
        }
      />

      <Segmented<Filter>
        value={filter}
        onChange={setFilter}
        size="sm"
        className="mb-6"
        options={[
          { value: 'all', label: 'All' },
          {
            value: 'unread',
            label: (
              <>
                Unread
                {unread > 0 && (
                  <span className={cn('rounded-full px-1.5 text-[10px] font-bold', filter === 'unread' ? 'bg-ink-950/20' : 'bg-flare text-snow')}>
                    {unread > 99 ? '99+' : unread}
                  </span>
                )}
              </>
            ),
          },
        ]}
      />

      {feed.isPending ? (
        <ListSkeleton />
      ) : feed.isError ? (
        <ErrorState error={feed.error} onRetry={() => feed.refetch()} />
      ) : items.length === 0 ? (
        filter === 'unread' ? (
          <EmptyState icon="🎉" title="Nothing unread" description="You’ve seen everything. We’ll ping you when your next game fills up." />
        ) : (
          <EmptyState
            icon={<BellIllustration />}
            title="No notifications yet"
            description="Game confirmations, SOS calls, rating requests and rain alerts will land here the moment they happen."
          />
        )
      ) : (
        <div className="space-y-8">
          {groups.map((g) => (
            <section key={g.day} aria-label={g.day}>
              <h2 className="sticky top-16 z-10 -mx-2 mb-2 bg-ink-900/80 px-2 py-2 font-sans text-xs font-semibold tracking-[0.18em] text-muted uppercase backdrop-blur-md">
                {g.day}
              </h2>
              <motion.ul layout className="space-y-2">
                <AnimatePresence>
                  {g.items.map((n, i) => (
                    <NotificationRow key={n.id} n={n} index={i} onOpen={() => open(n)} />
                  ))}
                </AnimatePresence>
              </motion.ul>
            </section>
          ))}

          <div ref={sentinel} className="flex justify-center pt-2 pb-6">
            {feed.hasNextPage ? (
              <Button variant="ghost" onClick={() => feed.fetchNextPage()} disabled={feed.isFetchingNextPage}>
                {feed.isFetchingNextPage ? <Spinner className="h-4 w-4" /> : null} Load more
              </Button>
            ) : (
              <span className="text-xs text-subtle">That’s everything · {items.length} total</span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function NotificationRow({ n, index, onOpen }: { n: Notification; index: number; onOpen: () => void }) {
  const meta = TYPE_META[n.type] ?? FALLBACK_META
  const unread = !n.read_at
  const href = notificationHref(n)
  const Icon = meta.icon
  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0, transition: { delay: Math.min(index, 8) * 0.035, type: 'spring', stiffness: 320, damping: 28 } }}
      exit={{ opacity: 0, x: -30 }}
    >
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          'group relative flex w-full cursor-pointer items-start gap-4 overflow-hidden rounded-2xl p-4 text-left ring-1 transition-[background,box-shadow] duration-300',
          unread
            ? 'bg-white/[0.045] ring-white/12 hover:bg-white/[0.07] [[data-theme=light]_&]:bg-ink-800 [[data-theme=light]_&]:ring-white/10'
            : 'ring-transparent hover:bg-white/[0.035]',
        )}
        style={unread ? { boxShadow: `0 10px 40px -24px ${meta.color}` } : undefined}
        aria-label={`${unread ? 'Unread: ' : ''}${n.title}. ${n.body}`}
      >
        {unread && <span aria-hidden className="absolute inset-y-3 left-0 w-[3px] rounded-r-full" style={{ background: meta.color, boxShadow: `0 0 12px ${meta.color}` }} />}
        <span
          className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl"
          style={{ background: `${alpha(meta.color, 0.1)}`, color: meta.color, boxShadow: `inset 0 0 0 1px ${alpha(meta.color, 0.25)}` }}
        >
          {unread && (n.type === 'sos' || n.type === 'weather_alert') && (
            <span className="absolute inset-0 animate-pulse-ring rounded-2xl" style={{ boxShadow: `0 0 0 2px ${meta.color}` }} />
          )}
          <Icon className="h-5 w-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className={cn('truncate text-[15px]', unread ? 'font-semibold text-fg' : 'font-medium text-fg/80')}>{n.title}</span>
          </span>
          <span className={cn('mt-0.5 line-clamp-2 block text-sm', unread ? 'text-fg/70' : 'text-muted')}>{n.body}</span>
          <span className="mt-2 flex items-center gap-2 text-xs text-subtle">
            <span className="rounded-full px-2 py-0.5 font-semibold" style={{ color: meta.color, background: `${alpha(meta.color, 0.08)}` }}>
              {meta.label}
            </span>
            <time dateTime={n.created_at} title={`${formatDay(n.created_at)} · ${formatTime(n.created_at)}`}>
              {timeAgo(n.created_at)}
            </time>
          </span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-3 self-stretch">
          {unread ? (
            <span className="relative mt-1 flex h-2.5 w-2.5">
              <span className="absolute inset-0 animate-ping rounded-full bg-volt/70" />
              <span className="relative h-2.5 w-2.5 rounded-full bg-volt shadow-[0_0_10px_color-mix(in_srgb,_var(--color-volt)_90%,_transparent)]" />
            </span>
          ) : (
            <span className="h-2.5" />
          )}
          {href && <ChevronRight className="mt-auto h-4 w-4 text-subtle transition-transform group-hover:translate-x-0.5 group-hover:text-fg" />}
        </span>
      </button>
    </motion.li>
  )
}

function groupByDay(items: Notification[]) {
  const out: { day: string; items: Notification[] }[] = []
  for (const n of items) {
    const day = formatDay(n.created_at)
    const last = out[out.length - 1]
    if (last && last.day === day) last.items.push(n)
    else out.push({ day, items: [n] })
  }
  return out
}

function ListSkeleton() {
  return (
    <div className="space-y-2" aria-busy aria-label="Loading notifications">
      <Skeleton className="mb-4 h-4 w-24 rounded-md" />
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="flex gap-4 rounded-2xl p-4">
          <Skeleton className="h-11 w-11 shrink-0 rounded-2xl" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-2/3 rounded-md" />
            <Skeleton className="h-3 w-full rounded-md" />
            <Skeleton className="h-3 w-24 rounded-md" />
          </div>
        </div>
      ))}
    </div>
  )
}

function BellIllustration() {
  return (
    <motion.span
      className="inline-flex h-16 w-16 items-center justify-center rounded-3xl bg-volt/10 text-volt ring-1 ring-volt/30"
      animate={{ rotate: [0, -14, 12, -8, 6, 0] }}
      transition={{ duration: 1.2, repeat: Infinity, repeatDelay: 2.4 }}
    >
      <BellRing className="h-8 w-8" />
    </motion.span>
  )
}
