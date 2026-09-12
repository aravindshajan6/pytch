import { useQuery } from '@tanstack/react-query'
import { CalendarPlus, Film, Star } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import { LinkButton } from '@/components/ui/Button'
import { Segmented } from '@/components/ui/Segmented'
import { EmptyState, ErrorState, PageHeader } from '@/components/ui/States'
import { LobbyCard, LobbyCardSkeleton } from '@/features/lobby/components/LobbyCard'
import { api } from '@/lib/api/endpoints'
import { qk } from '@/lib/api/queryKeys'
import { formatDay } from '@/lib/format'
import type { LobbySummary } from '@/types/api'

type Scope = 'upcoming' | 'past'

export default function MatchesPage() {
  const [params, setParams] = useSearchParams()
  const [scope, setScopeState] = useState<Scope>(params.get('tab') === 'past' ? 'past' : 'upcoming')
  const setScope = (s: Scope) => {
    setScopeState(s)
    setParams(s === 'past' ? { tab: 'past' } : {}, { replace: true })
  }

  const upcoming = useQuery({ queryKey: qk.myLobbies('upcoming'), queryFn: () => api.lobbies.mine('upcoming') })
  const past = useQuery({ queryKey: qk.myLobbies('past'), queryFn: () => api.lobbies.mine('past'), enabled: scope === 'past' })
  const pending = useQuery({ queryKey: qk.pendingRatings, queryFn: api.ratings.pending })
  const recordings = useQuery({ queryKey: qk.recordings, queryFn: api.highlights.recordings, enabled: scope === 'past' })

  const pendingIds = useMemo(() => new Set((pending.data ?? []).map((p) => p.lobby_id)), [pending.data])
  const recByLobby = useMemo(() => {
    const m = new Map<string, string>()
    for (const r of recordings.data ?? []) if (r.status === 'ready') m.set(r.lobby_id, r.id)
    return m
  }, [recordings.data])

  const active = scope === 'upcoming' ? upcoming : past
  const list = active.data ?? []

  return (
    <div>
      <PageHeader
        eyebrow="Your games"
        title="My matches"
        subtitle="Everything you're hosting, joined, or have played."
        actions={<LinkButton to="/app/discover" size="sm" className="h-10"><CalendarPlus className="h-4 w-4" /> Book a game</LinkButton>}
      />

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <Segmented
          value={scope}
          onChange={setScope}
          options={[
            { value: 'upcoming', label: <>Upcoming{upcoming.data ? <Count n={upcoming.data.length} /> : null}</> },
            { value: 'past', label: <>Past{pendingIds.size > 0 && <Count n={pendingIds.size} tone="volt" />}</> },
          ]}
        />
        {scope === 'past' && pendingIds.size > 0 && (
          <span className="flex items-center gap-1.5 text-xs text-volt">
            <Star className="h-3.5 w-3.5 fill-volt" /> {pendingIds.size} match{pendingIds.size === 1 ? '' : 'es'} waiting for your ratings
          </span>
        )}
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={scope}
          initial={{ opacity: 0, x: scope === 'past' ? 24 : -24 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: scope === 'past' ? -24 : 24 }}
          transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
        >
          {active.isLoading ? (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 3 }, (_, i) => (
                <LobbyCardSkeleton key={i} />
              ))}
            </div>
          ) : active.isError ? (
            <ErrorState error={active.error} onRetry={() => active.refetch()} />
          ) : list.length === 0 ? (
            scope === 'upcoming' ? (
              <EmptyState
                icon="📅"
                title="Nothing on the calendar"
                description="Book a turf and split it with your squad, or jump into a game that's already forming."
                action={
                  <div className="flex flex-wrap justify-center gap-2">
                    <LinkButton to="/app/discover">Book a turf</LinkButton>
                    <LinkButton to="/app/play" variant="secondary">
                      Find a game
                    </LinkButton>
                  </div>
                }
              />
            ) : (
              <EmptyState
                icon="🥅"
                title="No matches played yet"
                description="Your match history, ratings and recordings will live here."
                action={<LinkButton to="/app/play">Play your first game</LinkButton>}
              />
            )
          ) : scope === 'upcoming' ? (
            <Grouped lobbies={list} />
          ) : (
            <Grid>
              {list.map((l, i) => (
                <Item key={l.id} i={i}>
                  <LobbyCard
                    lobby={l}
                    footer={
                      pendingIds.has(l.id) || recByLobby.has(l.id) ? (
                        <div className="flex flex-wrap gap-2">
                          {pendingIds.has(l.id) && (
                            <LinkButton to={`/app/rate/${l.id}`} size="sm">
                              <Star className="h-3.5 w-3.5" /> Rate teammates
                            </LinkButton>
                          )}
                          {recByLobby.has(l.id) && (
                            <LinkButton to={`/app/highlights/recordings/${recByLobby.get(l.id)}`} size="sm" variant="secondary">
                              <Film className="h-3.5 w-3.5" /> Watch recording
                            </LinkButton>
                          )}
                        </div>
                      ) : undefined
                    }
                  />
                </Item>
              ))}
            </Grid>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}

function Grouped({ lobbies }: { lobbies: LobbySummary[] }) {
  const groups = useMemo(() => {
    const sorted = [...lobbies].sort((a, b) => a.start_at.localeCompare(b.start_at))
    const out: { day: string; items: LobbySummary[] }[] = []
    for (const l of sorted) {
      const day = formatDay(l.start_at)
      const last = out[out.length - 1]
      if (last && last.day === day) last.items.push(l)
      else out.push({ day, items: [l] })
    }
    return out
  }, [lobbies])
  let i = 0
  return (
    <div className="space-y-8">
      {groups.map((g) => (
        <section key={g.day}>
          <h2 className="mb-3 flex items-center gap-3 font-sans text-xs font-bold tracking-[0.2em] text-muted uppercase">
            {g.day}
            <span className="h-px flex-1 bg-white/8" />
          </h2>
          <Grid>
            {g.items.map((l) => (
              <Item key={l.id} i={i++}>
                <LobbyCard lobby={l} />
              </Item>
            ))}
          </Grid>
        </section>
      ))}
    </div>
  )
}

function Grid({ children }: { children: React.ReactNode }) {
  return <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{children}</ul>
}

function Item({ i, children }: { i: number; children: React.ReactNode }) {
  return (
    <motion.li
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(i, 9) * 0.05, type: 'spring', stiffness: 260, damping: 26 }}
    >
      {children}
    </motion.li>
  )
}

function Count({ n, tone }: { n: number; tone?: 'volt' }) {
  return (
    <span
      className={
        tone === 'volt'
          ? 'ml-1 rounded-full bg-flare px-1.5 text-[10px] font-bold text-snow'
          : 'ml-1 rounded-full bg-ink-950/20 px-1.5 text-[10px] font-bold'
      }
    >
      {n}
    </span>
  )
}
