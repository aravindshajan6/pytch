import { useQuery } from '@tanstack/react-query'
import { ArrowRight, CloudLightning, Film, Loader2, Star } from 'lucide-react'
import { motion } from 'motion/react'
import { Link } from 'react-router'
import { api } from '@/lib/api/endpoints'
import { qk } from '@/lib/api/queryKeys'
import { cn } from '@/lib/cn'
import type { LobbyDetail } from '@/types/api'

/** Contextual banners: weather alert, recording, rate teammates. */
export function Banners({ lobby }: { lobby: LobbyDetail }) {
  const member = !!lobby.my_membership
  const completed = lobby.status === 'completed'
  const pending = useQuery({ queryKey: qk.pendingRatings, queryFn: api.ratings.pending, enabled: completed && member })
  const needsRating = completed && member && (pending.data ? pending.data.some((p) => p.lobby_id === lobby.id) : true)
  const alert = lobby.weather_alert?.status === 'open' ? lobby.weather_alert : null
  const rec = lobby.recording

  const items: React.ReactNode[] = []

  if (alert) {
    items.push(
      <Banner
        key="weather"
        to={`/app/weather/${alert.id}`}
        className="bg-gradient-to-r from-sun/25 via-flare/20 to-grape/10 ring-sun/40"
        icon={<CloudLightning className="h-6 w-6 text-sun" />}
        title={alert.severity === 'warning' ? 'Heavy rain likely — see options' : 'Rain on the radar — see options'}
        body={alert.summary}
        cta={alert.is_host ? 'Move indoors or rain-check' : 'See what the host can do'}
        pulse={alert.severity === 'warning'}
      />,
    )
  }

  if (rec?.status === 'ready') {
    items.push(
      <Banner
        key="rec"
        to={`/app/highlights/recordings/${rec.id}`}
        className="bg-gradient-to-r from-electric/20 via-grape/15 to-transparent ring-electric/40"
        icon={
          rec.thumbnail_url ? (
            <img src={rec.thumbnail_url} alt="" className="h-12 w-16 rounded-lg object-cover" />
          ) : (
            <Film className="h-6 w-6 text-electric" />
          )
        }
        title="Your match recording is ready 🎬"
        body="Scrub the footage, clip your best moments and pin them to your player card."
        cta="Watch & clip"
      />,
    )
  } else if (rec && (rec.status === 'processing' || rec.status === 'scheduled') && completed) {
    items.push(
      <div key="rec-proc" className="flex items-center gap-3 rounded-2xl bg-white/4 px-4 py-3 text-sm text-muted ring-1 ring-white/8">
        <Loader2 className="h-4 w-4 animate-spin text-electric" /> Recording {rec.status === 'processing' ? 'is processing' : 'scheduled'} — we'll ping you when it's ready.
      </div>,
    )
  }

  if (needsRating) {
    items.push(
      <Banner
        key="rate"
        to={`/app/rate/${lobby.id}`}
        className="bg-gradient-to-r from-volt/20 via-mint/10 to-transparent ring-volt/40"
        icon={<Star className="h-6 w-6 fill-volt text-volt" />}
        title="Rate your teammates"
        body="Anonymous, 30 seconds, +15 XP each. It's how True Skill stays honest."
        cta="Rate now"
      />,
    )
  }

  if (!items.length) return null
  return <div className="mt-4 space-y-3">{items}</div>
}

function Banner({
  to,
  className,
  icon,
  title,
  body,
  cta,
  pulse,
}: {
  to: string
  className: string
  icon: React.ReactNode
  title: string
  body: string
  cta: string
  pulse?: boolean
}) {
  return (
    <motion.div initial={{ opacity: 0, y: -8, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ type: 'spring', stiffness: 380, damping: 28 }}>
      <Link
        to={to}
        className={cn('group relative flex items-center gap-4 overflow-hidden rounded-2xl p-4 ring-1 transition hover:brightness-110', className)}
      >
        {pulse && <span aria-hidden className="absolute inset-0 animate-pulse bg-flare/5" />}
        <span className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-ink-900/40">{icon}</span>
        <span className="relative min-w-0 flex-1">
          <span className="block font-semibold">{title}</span>
          <span className="block text-xs text-fg/70 sm:text-sm">{body}</span>
        </span>
        <span className="relative hidden items-center gap-1 text-sm font-semibold whitespace-nowrap sm:flex">
          {cta} <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
        </span>
        <ArrowRight className="relative h-5 w-5 shrink-0 sm:hidden" />
      </Link>
    </motion.div>
  )
}
