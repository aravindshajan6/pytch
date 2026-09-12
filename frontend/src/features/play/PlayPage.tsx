import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { formatInTimeZone } from 'date-fns-tz'
import { Loader2, Lock, Ticket } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { Button, LinkButton } from '@/components/ui/Button'
import { FilterChip } from '@/components/ui/Chip'
import { Switch } from '@/components/ui/Form'
import { EmptyState, ErrorState, PageHeader } from '@/components/ui/States'
import { LobbyCard, LobbyCardSkeleton } from '@/features/lobby/components/LobbyCard'
import { clientEligibility } from '@/features/lobby/lib'
import { useMe } from '@/hooks/useMe'
import { useSports } from '@/hooks/useSports'
import type { LobbyQuery } from '@/lib/api/endpoints'
import { api } from '@/lib/api/endpoints'
import { qk } from '@/lib/api/queryKeys'
import { TZ, istDate } from '@/lib/format'
import { useLocationStore } from '@/stores/location'
import type { Sport } from '@/types/api'
import { QuickMatch } from './QuickMatch'

const round = (n: number) => Math.round(n * 1000) / 1000

function dateOptions() {
  return [
    { value: '', label: 'Any day' },
    ...Array.from({ length: 7 }, (_, i) => ({
      value: istDate(i),
      label: i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : formatInTimeZone(new Date(Date.now() + i * 86400000), TZ, 'EEE d'),
    })),
  ]
}

export default function PlayPage() {
  const { user } = useMe()
  const lat = useLocationStore((s) => s.lat)
  const lng = useLocationStore((s) => s.lng)
  const label = useLocationStore((s) => s.label)
  const [sport, setSport] = useState<Sport | undefined>(() => (user?.preferred_sports.length === 1 ? user.preferred_sports[0] : undefined))
  const [date, setDate] = useState('')
  const [includeIneligible, setIncludeIneligible] = useState(false)
  const dates = useMemo(dateOptions, [])
  const sports = useSports()

  const query: LobbyQuery = {
    lat: round(lat),
    lng: round(lng),
    sport,
    date: date || undefined,
    include_ineligible: includeIneligible || undefined,
    limit: 50,
  }
  const lobbiesQ = useQuery({
    queryKey: qk.lobbies(query),
    queryFn: () => api.lobbies.list(query),
    placeholderData: keepPreviousData,
    refetchInterval: 30_000,
  })
  const lobbies = lobbiesQ.data?.items ?? []

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow={`Near ${label}`}
        title="Open matches"
        subtitle="Jump into a game that's already forming — no group chat required."
        actions={<JoinWithCode />}
      />

      <QuickMatch sport={sport} />

      <section aria-label="Open matches">
        <div className="space-y-3">
          <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:px-0">
            <FilterChip active={!sport} onClick={() => setSport(undefined)}>
              All sports
            </FilterChip>
            {sports.map((s) => (
              <FilterChip key={s.key} active={sport === s.key} onClick={() => setSport(sport === s.key ? undefined : s.key)}>
                <span>{s.emoji}</span> {s.label}
              </FilterChip>
            ))}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="no-scrollbar -mx-4 flex gap-1.5 overflow-x-auto px-4 sm:mx-0 sm:px-0">
              {dates.map((d) => (
                <button
                  key={d.value}
                  type="button"
                  onClick={() => setDate(d.value)}
                  aria-pressed={date === d.value}
                  className={
                    date === d.value
                      ? 'h-8 shrink-0 cursor-pointer rounded-lg bg-white/12 px-3 text-xs font-semibold text-fg ring-1 ring-white/25'
                      : 'h-8 shrink-0 cursor-pointer rounded-lg px-3 text-xs font-medium text-muted transition hover:bg-white/6 hover:text-fg'
                  }
                >
                  {d.label}
                </button>
              ))}
            </div>
            <label className="flex cursor-pointer items-center gap-2.5 text-sm text-muted">
              <Lock className="h-3.5 w-3.5" />
              Show matches I can't join yet
              <Switch checked={includeIneligible} onChange={setIncludeIneligible} label="Show matches I can't join yet" tone="electric" />
            </label>
          </div>
        </div>

        <div className="mt-5 mb-3 flex h-5 items-center justify-between text-xs text-muted">
          <span>{lobbiesQ.data ? `${lobbiesQ.data.total} open match${lobbiesQ.data.total === 1 ? '' : 'es'}` : ''}</span>
          {lobbiesQ.isFetching && !lobbiesQ.isLoading && <Loader2 className="h-3.5 w-3.5 animate-spin text-volt" />}
        </div>

        {lobbiesQ.isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }, (_, i) => (
              <LobbyCardSkeleton key={i} />
            ))}
          </div>
        ) : lobbiesQ.isError ? (
          <ErrorState error={lobbiesQ.error} onRetry={() => lobbiesQ.refetch()} />
        ) : lobbies.length === 0 ? (
          <EmptyState
            icon="🏟️"
            title="No open matches here yet"
            description="Be the one who starts it — book a slot and open it to the city, or go live on the bench to get pinged."
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <LinkButton to="/app/discover">Host a game</LinkButton>
                <LinkButton to="/app/bench" variant="secondary">
                  Go on the bench
                </LinkButton>
              </div>
            }
          />
        ) : (
          <motion.ul layout className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <AnimatePresence mode="popLayout">
              {lobbies.map((l, i) => {
                const reasons = includeIneligible ? clientEligibility(l, user) : []
                return (
                  <motion.li
                    key={l.id}
                    layout
                    initial={{ opacity: 0, y: 24 }}
                    animate={{ opacity: 1, y: 0, transition: { delay: Math.min(i, 9) * 0.05, type: 'spring', stiffness: 260, damping: 26 } }}
                    exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.15 } }}
                    transition={{ layout: { type: 'spring', stiffness: 380, damping: 36 } }}
                  >
                    <LobbyCard lobby={l} lockedReasons={reasons} />
                  </motion.li>
                )
              })}
            </AnimatePresence>
          </motion.ul>
        )}
      </section>
    </div>
  )
}

function JoinWithCode() {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [code, setCode] = useState('')
  return (
    <AnimatePresence mode="wait" initial={false}>
      {open ? (
        <motion.form
          key="form"
          initial={{ opacity: 0, width: 120 }}
          animate={{ opacity: 1, width: 'auto' }}
          exit={{ opacity: 0 }}
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (code.trim()) navigate(`/app/join/${code.trim().toUpperCase()}`)
          }}
        >
          <input
            autoFocus
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            onBlur={() => !code && setOpen(false)}
            maxLength={8}
            placeholder="CODE"
            aria-label="Lobby code"
            className="h-10 w-28 rounded-xl bg-white/5 px-3 text-center font-mono text-sm tracking-[0.25em] ring-1 ring-white/15 outline-none focus:ring-2 focus:ring-volt/70"
          />
          <Button type="submit" size="sm" className="h-10">
            Go
          </Button>
        </motion.form>
      ) : (
        <motion.div key="btn" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <Button variant="secondary" size="sm" className="h-10" onClick={() => setOpen(true)}>
            <Ticket className="h-4 w-4" /> Have a code?
          </Button>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
