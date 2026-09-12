import { useMutation } from '@tanstack/react-query'
import { ArrowRight, MapPin, Radio, RotateCcw, Sparkles, Zap } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { AvatarStack } from '@/components/ui/Avatar'
import { Button, LinkButton } from '@/components/ui/Button'
import { SportBadge } from '@/components/ui/PlayerBits'
import { TurfArt } from '@/components/ui/TurfArt'
import { useJoinLobby } from '@/features/lobby/api'
import { errorMessage } from '@/lib/api/client'
import { api } from '@/lib/api/endpoints'
import { cn } from '@/lib/cn'
import { formatINR, formatKm, formatWhen } from '@/lib/format'
import { SPORTS } from '@/lib/sports'
import { useLocationStore } from '@/stores/location'
import type { QuickMatchResponse, Sport } from '@/types/api'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** One-tap matchmaking hero: radar pulse → reveal the best lobby with reasons. */
export function QuickMatch({ sport }: { sport?: Sport }) {
  const navigate = useNavigate()
  const lat = useLocationStore((s) => s.lat)
  const lng = useLocationStore((s) => s.lng)

  const search = useMutation({
    mutationFn: async (): Promise<QuickMatchResponse> => {
      // hold the radar for a beat — the reveal feels earned
      const [r] = await Promise.all([api.lobbies.quickMatch({ lat, lng, sport }), sleep(1300)])
      return r
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const join = useJoinLobby(
    (l) => navigate(`/app/lobby/${l.id}?pay=1`),
    () => search.data?.lobby && navigate(`/app/lobby/${search.data.lobby.id}`),
  )

  const searching = search.isPending
  const result = search.data

  return (
    <section className="relative overflow-hidden rounded-[2rem] ring-1 ring-white/10" aria-label="Quick Match">
      {/* animated aurora */}
      <motion.div
        aria-hidden
        className="absolute inset-0 opacity-70"
        style={{
          background:
            'radial-gradient(60% 80% at 15% 20%, color-mix(in srgb, var(--color-volt) 22%, transparent), transparent 60%), radial-gradient(50% 70% at 90% 90%, color-mix(in srgb, var(--color-electric) 20%, transparent), transparent 60%), radial-gradient(40% 60% at 70% 10%, color-mix(in srgb, var(--color-grape) 16%, transparent), transparent 60%)',
          backgroundSize: '160% 160%',
        }}
        animate={{ backgroundPosition: ['0% 0%', '100% 100%', '0% 0%'] }}
        transition={{ duration: 14, repeat: Infinity, ease: 'linear' }}
      />
      <div aria-hidden className="pitch-grid absolute inset-0 opacity-60 [mask-image:linear-gradient(to_bottom,black,transparent)]" />
      <div className="relative bg-ink-900/40 p-6 sm:p-8">
        <div className="flex flex-col items-center gap-8 md:flex-row md:items-center md:justify-between">
          <div className="max-w-md text-center md:text-left">
            <div className="inline-flex items-center gap-1.5 rounded-full bg-volt/12 px-3 py-1 text-[11px] font-bold tracking-[0.18em] text-volt uppercase ring-1 ring-volt/30">
              <Sparkles className="h-3.5 w-3.5" /> Quick Match
            </div>
            <h2 className="mt-3 text-3xl leading-tight font-bold sm:text-4xl">
              One tap. <span className="text-gradient-volt">Best game</span> for you.
            </h2>
            <p className="mt-2 text-sm text-muted">
              We rank every open {sport ? SPORTS[sport].label.toLowerCase() : ''} lobby by kick-off, distance, skill match and how close it is to filling.
            </p>
          </div>

          <RadarButton searching={searching} onClick={() => search.mutate()} again={!!result} />
        </div>

        <AnimatePresence mode="wait">
          {result && !searching && (
            <motion.div
              key={result.lobby?.id ?? 'none'}
              initial={{ opacity: 0, y: 24, scale: 0.97, filter: 'blur(6px)' }}
              animate={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }}
              exit={{ opacity: 0, y: -10, scale: 0.98 }}
              transition={{ type: 'spring', stiffness: 260, damping: 24 }}
              className="mt-8"
            >
              {result.lobby ? (
                <div className="glass-strong overflow-hidden rounded-3xl md:flex">
                  <TurfArt seed={result.lobby.turf.id} sport={result.lobby.sport} src={result.lobby.turf.cover_url} className="h-32 md:h-auto md:w-56 md:shrink-0">
                    <div className="flex h-full items-start justify-between p-3">
                      <SportBadge sport={result.lobby.sport} format={result.lobby.format} className="bg-ink-900/70" />
                      {result.score > 0 && (
                        <span className="rounded-full bg-volt px-2.5 py-1 font-mono text-[11px] font-bold text-ink-950">
                          {Math.round(Math.min(result.score, 100))}% match
                        </span>
                      )}
                    </div>
                  </TurfArt>
                  <div className="flex-1 p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="truncate text-xl font-semibold">{result.lobby.title}</h3>
                        <p className="mt-1 flex items-center gap-1 text-sm text-muted">
                          <MapPin className="h-3.5 w-3.5" />
                          {formatWhen(result.lobby.start_at)} · {result.lobby.turf.name}
                          {result.lobby.distance_km != null && ` · ${formatKm(result.lobby.distance_km)}`}
                        </p>
                      </div>
                      <div className="text-right">
                        <div className="font-display text-2xl font-bold text-volt">{formatINR(result.lobby.share_paise)}</div>
                        <div className="text-[10px] tracking-wider text-muted uppercase">{result.lobby.spots_left} spots left</div>
                      </div>
                    </div>
                    <div className="mt-4 flex flex-wrap gap-1.5">
                      {result.reasons.map((r, i) => (
                        <motion.span
                          key={r}
                          initial={{ opacity: 0, scale: 0.6, y: 6 }}
                          animate={{ opacity: 1, scale: 1, y: 0 }}
                          transition={{ delay: 0.25 + i * 0.08, type: 'spring', stiffness: 500, damping: 22 }}
                          className="inline-flex h-7 items-center gap-1 rounded-full bg-volt/10 px-3 text-xs font-medium text-volt ring-1 ring-volt/30"
                        >
                          <Zap className="h-3 w-3 fill-current" /> {r}
                        </motion.span>
                      ))}
                    </div>
                    <div className="mt-5 flex flex-wrap items-center gap-2">
                      <Button loading={join.isPending} onClick={() => join.mutate(result.lobby!.id)}>
                        Join · {formatINR(result.lobby.share_paise)}
                      </Button>
                      <LinkButton to={`/app/lobby/${result.lobby.id}`} variant="secondary">
                        View lobby
                      </LinkButton>
                      <div className="ml-auto">
                        <AvatarStack users={result.lobby.member_avatars} max={4} size="xs" total={result.lobby.filled_spots} />
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="glass-strong flex flex-col items-center gap-4 rounded-3xl p-6 text-center sm:flex-row sm:text-left">
                  <div className="text-4xl">😴</div>
                  <div className="flex-1">
                    <h3 className="font-semibold">Nothing forming nearby right now</h3>
                    <p className="mt-1 text-sm text-muted">Go live on the bench and get pinged the moment a squad needs a sub — or host your own game.</p>
                  </div>
                  <div className="flex flex-wrap justify-center gap-2">
                    <LinkButton to="/app/bench" variant="danger">
                      <Radio className="h-4 w-4" /> Go on the bench
                    </LinkButton>
                    <LinkButton to="/app/discover" variant="secondary">
                      Book a turf <ArrowRight className="h-4 w-4" />
                    </LinkButton>
                  </div>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </section>
  )
}

function RadarButton({ searching, onClick, again }: { searching: boolean; onClick: () => void; again: boolean }) {
  return (
    <div className="relative flex h-44 w-44 shrink-0 items-center justify-center">
      {/* pulse rings */}
      {[0, 0.7, 1.4].map((d) => (
        <span
          key={d}
          aria-hidden
          className={cn('absolute inset-6 animate-pulse-ring rounded-full', searching ? 'bg-electric/35' : 'bg-volt/25')}
          style={{ animationDelay: `${d}s` }}
        />
      ))}
      {/* sweep while scanning */}
      <AnimatePresence>
        {searching && (
          <motion.span
            aria-hidden
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 animate-sweep rounded-full bg-[conic-gradient(from_0deg,transparent_0deg,color-mix(in_srgb,_var(--color-electric)_55%,_transparent)_60deg,transparent_70deg)]"
            style={{ animationDuration: '1.2s' }}
          />
        )}
      </AnimatePresence>
      <span aria-hidden className="absolute inset-0 rounded-full ring-1 ring-white/10" />
      <span aria-hidden className="absolute inset-5 rounded-full ring-1 ring-white/8" />
      <motion.button
        type="button"
        onClick={onClick}
        disabled={searching}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.92 }}
        transition={{ type: 'spring', stiffness: 400, damping: 18 }}
        aria-live="polite"
        className="relative z-10 flex h-28 w-28 cursor-pointer flex-col items-center justify-center rounded-full font-display text-sm font-bold text-ink-950 shadow-[0_0_60px_-6px_color-mix(in_srgb,_var(--color-volt)_calc(80%*var(--glow-strength)),_transparent)] disabled:cursor-wait"
      >
        <motion.span
          aria-hidden
          className="absolute inset-0 rounded-full"
          style={{ background: 'linear-gradient(120deg, var(--color-volt), var(--color-mint), var(--color-electric), var(--color-volt))', backgroundSize: '300% 300%' }}
          animate={{ backgroundPosition: ['0% 50%', '100% 50%', '0% 50%'] }}
          transition={{ duration: 4, repeat: Infinity, ease: 'linear' }}
        />
        <span className="relative flex flex-col items-center gap-1">
          {searching ? (
            <>
              <Radio className="h-6 w-6 animate-pulse" />
              Scanning…
            </>
          ) : again ? (
            <>
              <RotateCcw className="h-6 w-6" />
              Again
            </>
          ) : (
            <>
              <Zap className="h-7 w-7 fill-current" />
              <span className="w-20 text-center leading-tight">Find me a game</span>
            </>
          )}
        </span>
      </motion.button>
    </div>
  )
}
