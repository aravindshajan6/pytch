import { motion } from 'motion/react'
import { lazy, Suspense } from 'react'
import { cn } from '@/lib/cn'
import { useResolvedTheme } from '@/stores/theme'
import type { PlayerStats, UserPublic } from '@/types/api'
import { FRAMES } from '../lib'
import { PlayerCard } from './PlayerCard'

const HoloSparkles = lazy(() => import('./HoloSparkles'))

/** Player card on a floodlit stage; elite / verified players get an R3F particle aura. */
export function CardHero({ user, stats }: { user: UserPublic; stats?: PlayerStats | null }) {
  const tier = stats?.tier ?? user.tier
  const special = tier === 'elite' || (stats?.is_verified_playmaker ?? user.is_verified_playmaker)
  const f = FRAMES[tier]
  const light = useResolvedTheme() === 'light'

  return (
    <div className="relative flex justify-center py-6">
      <div
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-1/2 h-[120%] w-[140%] -translate-x-1/2 -translate-y-1/2 rounded-full blur-3xl"
        style={{ background: `radial-gradient(closest-side, rgb(${f.tint} / ${light ? 0.3 : 0.22}), transparent)` }}
      />
      {special && (
        <div className="pointer-events-none absolute -inset-x-6 -inset-y-4">
          <Suspense fallback={null}>
            <HoloSparkles tokens={tier === 'elite' ? ['--color-grape-soft', '--color-electric'] : ['--color-volt', '--color-mint']} />
          </Suspense>
        </div>
      )}
      {/* stage floor */}
      <div aria-hidden className={cn('pointer-events-none absolute bottom-2 left-1/2 h-8 w-3/4 -translate-x-1/2 rounded-[100%] blur-xl', light ? 'bg-night/25' : 'bg-black/60')} />
      <motion.div
        initial={{ opacity: 0, y: 40, rotateY: -35, scale: 0.9 }}
        animate={{ opacity: 1, y: 0, rotateY: 0, scale: 1 }}
        transition={{ type: 'spring', stiffness: 120, damping: 16 }}
        style={{ transformPerspective: 1000 }}
        className="relative"
      >
        <div className="animate-float">
          <PlayerCard user={user} stats={stats} size="lg" />
        </div>
      </motion.div>
    </div>
  )
}
