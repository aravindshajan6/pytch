import { ChevronRight } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { AnimatedNumber } from '@/components/ui/AnimatedNumber'
import { Countdown } from '@/components/ui/Countdown'
import { Switch } from '@/components/ui/Form'
import { errorMessage } from '@/lib/api/client'
import { cn } from '@/lib/cn'
import { useBenchCenter, useBenchDefaults, useBenchNearby, useBenchStatus, useBenchToggle } from '../api'
import { Radar } from './Radar'

/** Compact Live Bench card for the Home page: mini radar + go-live switch + nearby count. */
export function BenchQuickToggle({ className }: { className?: string }) {
  const status = useBenchStatus()
  const defaults = useBenchDefaults(status.data)
  const center = useBenchCenter(status.data)
  const nearby = useBenchNearby(center, defaults.radius_km)
  const { goLive, goOff, pending } = useBenchToggle()
  const active = !!status.data?.is_active
  const count = nearby.data?.count ?? 0

  const onToggle = async (next: boolean) => {
    navigator.vibrate?.(15)
    try {
      if (next) {
        await goLive(defaults)
        toast.success("You're on the bench", { description: "We'll ping you when a game nearby needs a sub." })
      } else await goOff()
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  return (
    <div
      className={cn(
        'glass relative flex items-center gap-4 overflow-hidden rounded-3xl p-4 shadow-card transition-shadow duration-500',
        active && 'shadow-glow-volt',
        className,
      )}
    >
      {active && <div aria-hidden className="pointer-events-none absolute -top-16 -left-10 h-40 w-40 rounded-full bg-volt/15 blur-3xl" />}
      <Link to="/app/bench" aria-label="Open Live Bench" className="relative w-20 shrink-0 sm:w-24">
        <Radar size="sm" center={center} radiusKm={defaults.radius_km} blips={nearby.data?.blips ?? []} active={active} />
      </Link>
      <div className="relative min-w-0 flex-1">
        <div className="flex items-center gap-2 text-[11px] font-bold tracking-[0.18em] uppercase">
          <span className={cn('relative flex h-2 w-2')}>
            {active && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-volt opacity-75" />}
            <span className={cn('relative inline-flex h-2 w-2 rounded-full', active ? 'bg-volt' : 'bg-subtle')} />
          </span>
          <span className={active ? 'text-volt' : 'text-muted'}>{active ? 'Live on the bench' : 'Live Bench'}</span>
        </div>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={active ? 'on' : 'off'}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.2 }}
          >
            <div className="mt-1 font-display text-lg leading-tight font-semibold">
              {active ? 'Ready to sub' : 'Free right now?'}
            </div>
            <div className="mt-0.5 text-xs text-muted">
              {active && status.data?.active_until ? (
                <span className="inline-flex items-center gap-1">
                  Auto-off in <Countdown to={status.data.active_until} className="text-xs text-fg" urgentMs={10 * 60 * 1000} />
                </span>
              ) : (
                <span>
                  <AnimatedNumber value={count} className="font-semibold text-fg" /> on the bench within {defaults.radius_km} km
                </span>
              )}
            </div>
          </motion.div>
        </AnimatePresence>
      </div>
      <div className="relative flex flex-col items-end gap-2">
        <Switch checked={active} onChange={onToggle} disabled={pending || status.isLoading} label="Ready to sub" />
        <Link to="/app/bench" className="flex items-center text-[11px] font-semibold text-muted transition hover:text-volt">
          Open <ChevronRight className="h-3.5 w-3.5" />
        </Link>
      </div>
    </div>
  )
}
