import { AlertTriangle, CalendarClock, Film, Loader2, Play, Scissors } from 'lucide-react'
import { motion } from 'motion/react'
import { Link } from 'react-router'
import { Countdown } from '@/components/ui/Countdown'
import { SportBadge } from '@/components/ui/PlayerBits'
import { TurfArt } from '@/components/ui/TurfArt'
import { cn } from '@/lib/cn'
import { formatWhen } from '@/lib/format'
import type { Recording } from '@/types/api'
import { fmtClock } from '../time'

export function RecordingCard({ rec, index = 0 }: { rec: Recording; index?: number }) {
  const ready = rec.status === 'ready'
  const lobby = rec.lobby

  const body = (
    <motion.article
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index, 8) * 0.05 }}
      whileHover={ready ? { y: -4 } : undefined}
      className={cn(
        'glass group relative overflow-hidden rounded-3xl shadow-card',
        ready && 'cursor-pointer transition-colors hover:border-white/15',
        rec.status === 'failed' && 'ring-1 ring-flare/30',
      )}
    >
      <div data-theme="dark" className="relative aspect-video overflow-hidden">
        <TurfArt seed={lobby.turf.id} sport={lobby.sport} src={rec.thumbnail_url ?? lobby.turf.cover_url} className="absolute inset-0" />
        {rec.status === 'processing' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-ink-950/55 backdrop-blur-[2px]">
            <div className="skeleton absolute inset-0 rounded-none opacity-60" />
            <Loader2 className="relative h-8 w-8 animate-spin text-volt" />
            <span className="relative font-display text-sm font-semibold">Crunching the footage…</span>
            <span className="relative text-xs text-muted">Usually ready within a few minutes</span>
          </div>
        )}
        {rec.status === 'scheduled' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-ink-950/60">
            <CalendarClock className="h-7 w-7 text-electric" />
            <span className="text-sm font-semibold">Camera booked</span>
            <span className="flex items-center gap-1 text-xs text-muted">
              Rolling in <Countdown to={lobby.start_at} className="text-xs" />
            </span>
          </div>
        )}
        {rec.status === 'failed' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-ink-950/70">
            <AlertTriangle className="h-7 w-7 text-flare" />
            <span className="text-sm font-semibold">Recording failed</span>
            <span className="text-xs text-muted">The camera feed didn't make it. Sorry!</span>
          </div>
        )}
        {ready && (
          <>
            <div className="absolute inset-0 bg-gradient-to-t from-ink-950/80 to-transparent" />
            <span className="absolute top-1/2 left-1/2 flex h-14 w-14 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-ink-950/50 ring-1 ring-white/25 backdrop-blur-md transition group-hover:scale-110 group-hover:bg-volt group-hover:text-ink-950">
              <Play className="ml-0.5 h-6 w-6 fill-current" />
            </span>
            {rec.duration_s != null && (
              <span className="absolute right-3 bottom-3 rounded-full bg-ink-950/70 px-2 py-0.5 font-mono text-[11px] font-semibold">
                {fmtClock(rec.duration_s)}
              </span>
            )}
            <span className="absolute top-3 left-3 inline-flex items-center gap-1 rounded-full bg-volt px-2 py-0.5 text-[10px] font-bold text-ink-950">
              <Film className="h-3 w-3" /> READY
            </span>
          </>
        )}
      </div>
      <div className="p-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="truncate font-semibold">{lobby.title}</h3>
          <SportBadge sport={lobby.sport} />
        </div>
        <div className="mt-1 text-xs text-muted">
          {lobby.turf.name} · {formatWhen(lobby.start_at)}
        </div>
        {ready && (
          <div className="mt-3 flex items-center justify-between text-xs">
            <span className="text-muted">
              {rec.clips.length ? `${rec.clips.length} clip${rec.clips.length > 1 ? 's' : ''} cut` : 'No clips yet'}
            </span>
            <span className="inline-flex items-center gap-1 font-semibold text-volt">
              <Scissors className="h-3.5 w-3.5" /> Open editor
            </span>
          </div>
        )}
      </div>
    </motion.article>
  )

  return ready ? (
    <Link to={`/app/highlights/recordings/${rec.id}`} className="block rounded-3xl">
      {body}
    </Link>
  ) : (
    body
  )
}
