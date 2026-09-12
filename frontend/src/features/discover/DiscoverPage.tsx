import { Home, Loader2, Map as MapIcon, MapPin, Search, Video, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useSearchParams } from 'react-router'
import { Button } from '@/components/ui/Button'
import { FilterChip } from '@/components/ui/Chip'
import { Segmented } from '@/components/ui/Segmented'
import { EmptyState, ErrorState, PageHeader } from '@/components/ui/States'
import { useIsDesktop } from '@/hooks/useMediaQuery'
import { useSports } from '@/hooks/useSports'
import type { TurfQuery } from '@/lib/api/endpoints'
import { cn } from '@/lib/cn'
import { useLocationStore } from '@/stores/location'
import type { Sport, TurfSummary } from '@/types/api'
import { useDebouncedValue, useTurfs } from './api'
import { TurfCard, TurfCardSkeleton } from './TurfCard'
import { TurfMap } from './TurfMap'

type Sort = NonNullable<TurfQuery['sort']>

const SORTS: Sort[] = ['distance', 'price', 'rating']
const round = (n: number) => Math.round(n * 1000) / 1000

export default function DiscoverPage() {
  // Filters live in the URL (?sport=&indoor=1&camera=1&sort=&q=) so Back from a turf restores them,
  // and a filtered view is shareable. `replace` keeps each tweak out of the history stack.
  const [params, setParams] = useSearchParams()
  const sports = useSports()
  const sportParam = params.get('sport')
  const sport = sportParam && sports.some((s) => s.key === sportParam) ? (sportParam as Sport) : undefined
  const indoor = params.get('indoor') === '1'
  const camera = params.get('camera') === '1'
  const sortParam = params.get('sort') as Sort | null
  const sort: Sort = sortParam && SORTS.includes(sortParam) ? sortParam : 'distance'
  const urlQ = params.get('q') ?? ''
  const [search, setSearch] = useState(urlQ)
  const q = useDebouncedValue(search.trim(), 300)

  const setFilter = useCallback(
    (patch: Record<string, string | null>) =>
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          for (const [k, v] of Object.entries(patch)) {
            if (v) next.set(k, v)
            else next.delete(k)
          }
          return next
        },
        { replace: true },
      ),
    [setParams],
  )
  const setSport = (s: Sport | undefined) => setFilter({ sport: s ?? null })
  const setSort = (s: Sort) => setFilter({ sort: s === 'distance' ? null : s })

  // debounced search → URL (only once the debounce has settled, so "Clear" doesn't bounce the old term back)
  const settled = q === search.trim()
  useEffect(() => {
    if (settled && q !== urlQ.trim()) setFilter({ q: q || null })
  }, [settled, q, urlQ, setFilter])

  const lat = useLocationStore((s) => s.lat)
  const lng = useLocationStore((s) => s.lng)
  const label = useLocationStore((s) => s.label)

  const query: TurfQuery = {
    lat: round(lat),
    lng: round(lng),
    sport,
    indoor: indoor || undefined,
    has_camera: camera || undefined,
    q: q || undefined,
    sort,
    limit: 50,
  }
  const turfsQ = useTurfs(query)
  const turfs = useMemo(() => turfsQ.data?.items ?? [], [turfsQ.data])
  const formingTotal = turfs.reduce((s, t) => s + t.open_lobbies_count, 0)

  const desktop = useIsDesktop()
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [mapOpen, setMapOpen] = useState(false)

  const onHover = useCallback((id: string | null) => setHoveredId(id), [])
  const onSelect = useCallback(
    (id: string) => {
      setSelectedId(id)
      if (desktop) {
        document.querySelector(`[data-turf-id="${id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
    },
    [desktop],
  )

  const filtersActive = !!sport || indoor || camera || !!search
  const clearFilters = () => {
    setSearch('')
    setFilter({ sport: null, indoor: null, camera: null, q: null })
  }

  return (
    <div>
      <PageHeader
        eyebrow={
          <span className="inline-flex items-center gap-1.5">
            <MapPin className="h-3.5 w-3.5" /> {label}
          </span>
        }
        title="Find your pitch"
        subtitle={
          turfsQ.data ? (
            <>
              {turfsQ.data.total} turfs around you
              {formingTotal > 0 && (
                <>
                  {' · '}
                  <span className="font-semibold text-volt">{formingTotal} games forming</span>
                </>
              )}
            </>
          ) : (
            'Turfs, courts and nets across Kochi'
          )
        }
      />

      {/* Filters */}
      <div className="sticky top-16 z-20 -mx-4 space-y-3 border-b border-white/5 bg-ink-900/80 px-4 py-3 backdrop-blur-xl sm:-mx-6 sm:px-6 lg:static lg:mx-0 lg:border-0 lg:bg-transparent lg:px-0 lg:pt-0 lg:backdrop-blur-none">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-4 h-4 w-4 -translate-y-1/2 text-subtle" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search turfs or areas — Kakkanad, Edappally…"
              aria-label="Search turfs"
              className="h-11 w-full rounded-xl bg-white/5 pr-10 pl-11 text-sm text-fg ring-1 ring-white/10 transition outline-none placeholder:text-subtle focus:bg-white/8 focus:ring-2 focus:ring-volt/70"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                aria-label="Clear search"
                className="absolute top-1/2 right-3 -translate-y-1/2 cursor-pointer rounded-full p-1 text-muted hover:bg-white/10 hover:text-fg"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <Segmented
            size="sm"
            aria-label="Sort turfs"
            value={sort}
            onChange={setSort}
            options={[
              { value: 'distance', label: 'Nearest' },
              { value: 'price', label: 'Cheapest' },
              { value: 'rating', label: 'Top rated' },
            ]}
          />
        </div>
        <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <FilterChip active={!sport} onClick={() => setSport(undefined)}>
            All
          </FilterChip>
          {sports.map((s) => (
            <FilterChip key={s.key} active={sport === s.key} onClick={() => setSport(sport === s.key ? undefined : s.key)}>
              <span>{s.emoji}</span> {s.label}
            </FilterChip>
          ))}
          <span className="mx-1 w-px shrink-0 bg-white/10" aria-hidden />
          <FilterChip active={indoor} onClick={() => setFilter({ indoor: indoor ? null : '1' })} aria-pressed={indoor}>
            <Home className="h-3.5 w-3.5" /> Indoor
          </FilterChip>
          <FilterChip active={camera} onClick={() => setFilter({ camera: camera ? null : '1' })} aria-pressed={camera}>
            <Video className="h-3.5 w-3.5" /> Camera
          </FilterChip>
        </div>
      </div>

      <div className="mt-4 lg:mt-6 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:gap-6">
        {/* List */}
        <section aria-label="Turfs" aria-busy={turfsQ.isFetching}>
          <div className="mb-3 flex h-5 items-center justify-between text-xs text-muted">
            <span>{turfsQ.data ? `${turfs.length} result${turfs.length === 1 ? '' : 's'}` : ' '}</span>
            {turfsQ.isFetching && !turfsQ.isLoading && (
              <span className="flex items-center gap-1.5 text-volt">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Updating
              </span>
            )}
          </div>

          {turfsQ.isLoading ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
              {Array.from({ length: 6 }, (_, i) => (
                <TurfCardSkeleton key={i} />
              ))}
            </div>
          ) : turfsQ.isError ? (
            <ErrorState error={turfsQ.error} onRetry={() => turfsQ.refetch()} />
          ) : turfs.length === 0 ? (
            <EmptyState
              icon="🏟️"
              title="No turfs match that"
              description="Try another sport, widen your search, or clear the filters."
              action={
                filtersActive && (
                  <Button variant="secondary" onClick={clearFilters}>
                    Clear filters
                  </Button>
                )
              }
            />
          ) : (
            <motion.ul layout className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
              <AnimatePresence mode="popLayout" initial>
                {turfs.map((t, i) => (
                  <motion.li
                    key={t.id}
                    layout
                    initial={{ opacity: 0, y: 24, scale: 0.97 }}
                    animate={{
                      opacity: 1,
                      y: 0,
                      scale: 1,
                      transition: { delay: Math.min(i, 10) * 0.045, type: 'spring', stiffness: 260, damping: 26 },
                    }}
                    exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.15 } }}
                    transition={{ layout: { type: 'spring', stiffness: 380, damping: 36 } }}
                  >
                    <TurfCard turf={t} highlighted={t.id === hoveredId || t.id === selectedId} onHover={onHover} />
                  </motion.li>
                ))}
              </AnimatePresence>
            </motion.ul>
          )}
        </section>

        {/* Desktop sticky map */}
        {desktop && (
          <aside className="hidden lg:block">
            <div className="sticky top-20 h-[calc(100dvh-7rem)] overflow-hidden rounded-3xl ring-1 ring-white/10 shadow-card">
              <TurfMap
                turfs={turfs}
                hoveredId={hoveredId}
                selectedId={selectedId}
                onHover={onHover}
                onSelect={onSelect}
                className="h-full w-full"
              />
            </div>
          </aside>
        )}
      </div>

      {/* Mobile map toggle */}
      {!desktop &&
        createPortal(
          <AnimatePresence>
            {!mapOpen && (
              <motion.button
                type="button"
                initial={{ y: 40, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: 40, opacity: 0 }}
                whileTap={{ scale: 0.94 }}
                onClick={() => setMapOpen(true)}
                className="fixed bottom-24 left-1/2 z-30 short:bottom-14 flex h-12 -translate-x-1/2 cursor-pointer items-center gap-2 rounded-full bg-volt px-5 text-sm font-bold text-ink-950 shadow-glow-volt"
              >
                <MapIcon className="h-4 w-4" /> Map
                {formingTotal > 0 && (
                  <span className="rounded-full bg-ink-950/15 px-1.5 text-[11px]">{formingTotal} live</span>
                )}
              </motion.button>
            )}
          </AnimatePresence>,
          document.body,
        )}

      {!desktop && (
        <MobileMap
          open={mapOpen}
          onClose={() => setMapOpen(false)}
          turfs={turfs}
          hoveredId={hoveredId}
          selectedId={selectedId}
          onHover={onHover}
          onSelect={setSelectedId}
        />
      )}
    </div>
  )
}

function MobileMap({
  open,
  onClose,
  turfs,
  hoveredId,
  selectedId,
  onHover,
  onSelect,
}: {
  open: boolean
  onClose: () => void
  turfs: TurfSummary[]
  hoveredId: string | null
  selectedId: string | null
  onHover: (id: string | null) => void
  onSelect: (id: string) => void
}) {
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      document.removeEventListener('keydown', onKey)
    }
  }, [open, onClose])

  const selected = turfs.find((t) => t.id === selectedId)

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          role="dialog"
          aria-modal
          aria-label="Map of turfs"
          className="fixed inset-0 z-[950] bg-ink-900"
          initial={{ clipPath: 'circle(0% at 50% 92%)' }}
          animate={{ clipPath: 'circle(150% at 50% 92%)' }}
          exit={{ clipPath: 'circle(0% at 50% 92%)' }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        >
          <TurfMap
            turfs={turfs}
            hoveredId={hoveredId}
            selectedId={selectedId}
            onHover={onHover}
            onSelect={onSelect}
            className="h-full w-full"
          />
          <div className="pointer-events-none absolute top-0 left-0 z-[700] flex items-center gap-2 p-4 pt-[max(env(safe-area-inset-top),1rem)]">
            <button
              type="button"
              onClick={onClose}
              aria-label="Close map"
              className="glass-strong pointer-events-auto flex h-10 w-10 cursor-pointer items-center justify-center rounded-full"
            >
              <X className="h-5 w-5" />
            </button>
            <div className="glass-strong pointer-events-auto rounded-full px-4 py-2 text-sm font-semibold">
              {turfs.length} turfs
            </div>
          </div>
          <div className="absolute inset-x-0 bottom-0 z-[700] p-4 pb-[max(env(safe-area-inset-bottom),1rem)]">
            <AnimatePresence mode="wait">
              {selected ? (
                <motion.div
                  key={selected.id}
                  initial={{ y: 80, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  exit={{ y: 80, opacity: 0 }}
                  transition={{ type: 'spring', stiffness: 380, damping: 32 }}
                >
                  <TurfCard turf={selected} compact />
                </motion.div>
              ) : (
                <motion.p
                  key="hint"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className={cn('glass-strong mx-auto w-fit rounded-full px-4 py-2 text-center text-xs text-muted')}
                >
                  Tap a price pin to preview the turf
                </motion.p>
              )}
            </AnimatePresence>
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
