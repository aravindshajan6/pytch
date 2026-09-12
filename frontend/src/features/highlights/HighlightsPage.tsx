import { Clock, Flame, Loader2 } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useRef } from 'react'
import { useSearchParams } from 'react-router'
import { Button, LinkButton } from '@/components/ui/Button'
import { FilterChip } from '@/components/ui/Chip'
import { Segmented } from '@/components/ui/Segmented'
import { EmptyState, ErrorState, PageHeader, Skeleton } from '@/components/ui/States'
import { SPORT_LIST, SPORTS } from '@/lib/sports'
import type { Sport } from '@/types/api'
import { type FeedSort, useHighlightFeed, useRecordings } from './api'
import { ClipCard } from './components/ClipCard'
import { RecordingCard } from './components/RecordingCard'

type Tab = 'feed' | 'recordings'

export default function HighlightsPage() {
  const [params, setParams] = useSearchParams()
  const tab: Tab = params.get('tab') === 'recordings' ? 'recordings' : 'feed'
  const recordings = useRecordings()
  const processing = recordings.data?.filter((r) => r.status === 'processing').length ?? 0

  const setTab = (t: Tab) =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p)
        if (t === 'feed') n.delete('tab')
        else n.set('tab', t)
        return n
      },
      { replace: true },
    )

  return (
    <div>
      <PageHeader
        eyebrow="Highlights"
        title={
          <>
            Relive the <span className="text-gradient-volt">worldies</span>
          </>
        }
        subtitle="Clips from camera turfs across Kochi. Cut yours, pin your best three."
      />
      <Segmented
        value={tab}
        onChange={setTab}
        className="mb-6 w-full sm:w-auto"
        options={[
          { value: 'feed', label: 'Feed' },
          {
            value: 'recordings',
            label: (
              <>
                My recordings
                {processing > 0 && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-label={`${processing} processing`} />}
              </>
            ),
          },
        ]}
      />
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={tab}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.22 }}
        >
          {tab === 'feed' ? <Feed /> : <Recordings query={recordings} />}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}

function Feed() {
  const [params, setParams] = useSearchParams()
  const sort: FeedSort = params.get('sort') === 'recent' ? 'recent' : 'trending'
  const sportParam = params.get('sport')
  const sport = sportParam && sportParam in SPORTS ? (sportParam as Sport) : undefined
  const feed = useHighlightFeed(sort, sport)
  const sentinel = useRef<HTMLDivElement>(null)

  const patch = (k: string, v: string | null) =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p)
        if (v) n.set(k, v)
        else n.delete(k)
        return n
      },
      { replace: true },
    )

  const clips = useMemo(() => feed.data?.pages.flatMap((p) => p.items) ?? [], [feed.data])

  // Infinite scroll
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = feed
  useEffect(() => {
    const el = sentinel.current
    if (!el || !hasNextPage) return
    const io = new IntersectionObserver(([e]) => e?.isIntersecting && !isFetchingNextPage && fetchNextPage(), { rootMargin: '600px' })
    io.observe(el)
    return () => io.disconnect()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  return (
    <div>
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Segmented
          size="sm"
          value={sort}
          onChange={(v) => patch('sort', v === 'trending' ? null : v)}
          options={[
            { value: 'trending', label: (<><Flame className="h-3.5 w-3.5" /> Trending</>) },
            { value: 'recent', label: (<><Clock className="h-3.5 w-3.5" /> Recent</>) },
          ]}
        />
        <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <FilterChip active={!sport} onClick={() => patch('sport', null)}>
            All
          </FilterChip>
          {SPORT_LIST.map((s) => (
            <FilterChip key={s} active={sport === s} onClick={() => patch('sport', sport === s ? null : s)}>
              {SPORTS[s].emoji} {SPORTS[s].label}
            </FilterChip>
          ))}
        </div>
      </div>

      {feed.isLoading ? (
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="space-y-3">
              <Skeleton className="aspect-video" />
              <Skeleton className="h-10" />
            </div>
          ))}
        </div>
      ) : feed.isError ? (
        <ErrorState error={feed.error} onRetry={() => feed.refetch()} />
      ) : clips.length === 0 ? (
        <EmptyState
          icon="🎬"
          title={sport ? `No ${SPORTS[sport].label.toLowerCase()} highlights yet` : 'No highlights yet'}
          description="Book a recorded match on a camera turf, then cut and share your best moments."
          action={<LinkButton to="/app/discover">Find a camera turf</LinkButton>}
        />
      ) : (
        <>
          <motion.div layout className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
            {clips.map((c, i) => (
              <motion.div
                key={c.id}
                initial={{ opacity: 0, y: 20, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ delay: (i % 12) * 0.04, type: 'spring', stiffness: 260, damping: 24 }}
              >
                <ClipCard clip={c} />
              </motion.div>
            ))}
          </motion.div>
          <div ref={sentinel} className="flex justify-center py-8">
            {feed.hasNextPage ? (
              <Button variant="secondary" onClick={() => feed.fetchNextPage()} loading={feed.isFetchingNextPage}>
                Load more
              </Button>
            ) : (
              <span className="text-xs text-subtle">You've seen it all — go make some more 🎥</span>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function Recordings({ query }: { query: ReturnType<typeof useRecordings> }) {
  if (query.isLoading)
    return (
      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="aspect-[4/3]" />
        ))}
      </div>
    )
  if (query.isError) return <ErrorState error={query.error} onRetry={() => query.refetch()} />
  const list = [...(query.data ?? [])].sort((a, b) => b.lobby.start_at.localeCompare(a.lobby.start_at))
  if (!list.length)
    return (
      <EmptyState
        icon="📹"
        title="No recordings yet"
        description="Tick “Recorded match” when you book a pitch with a camera. After the final whistle your footage lands here."
        action={<LinkButton to="/app/discover">Find a camera turf</LinkButton>}
      />
    )
  return (
    <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
      {list.map((r, i) => (
        <RecordingCard key={r.id} rec={r} index={i} />
      ))}
    </div>
  )
}
