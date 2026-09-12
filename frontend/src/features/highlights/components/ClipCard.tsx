import { useQueryClient } from '@tanstack/react-query'
import { Eye, Heart, Pin, Play, Volume2, VolumeX } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { Avatar } from '@/components/ui/Avatar'
import { FootageCredit } from './FootageCredit'
import { TurfArt } from '@/components/ui/TurfArt'
import { errorMessage } from '@/lib/api/client'
import { api } from '@/lib/api/endpoints'
import { cn } from '@/lib/cn'
import { timeAgo } from '@/lib/format'
import { sportInfo } from '@/lib/sports'
import type { Clip } from '@/types/api'
import { replaceClip } from '../api'
import { fmtClock, fmtCount } from '../time'

interface ClipCardProps {
  clip: Clip
  className?: string
  /** Extra controls rendered in the footer (pin/delete on the recording page). */
  actions?: React.ReactNode
  /** Autoplay muted while ≥60% visible. Default true (off when reduced motion). */
  autoPlay?: boolean
  /** Hide the owner row (e.g. on the owner's own profile). */
  hideOwner?: boolean
}

const BURST = Array.from({ length: 8 }, (_, i) => (i / 8) * Math.PI * 2)

/**
 * Highlight clip card: plays only the clip window [start_s, end_s] of the source
 * footage on a loop, autoplays muted when in view, double-tap / heart to like.
 */
export function ClipCard({ clip, className, actions, autoPlay = true, hideOwner }: ClipCardProps) {
  const qc = useQueryClient()
  const reduce = useReducedMotion()
  const rootRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const progressRef = useRef<HTMLDivElement>(null)
  const viewed = useRef(false)
  const [playing, setPlaying] = useState(false)
  const [muted, setMuted] = useState(true)
  const [views, setViews] = useState<number | null>(null)
  const [like, setLike] = useState<{ liked: boolean; count: number } | null>(null)
  const [burst, setBurst] = useState(0)
  const [bigHeart, setBigHeart] = useState(0)
  const [failed, setFailed] = useState(false)

  const liked = like?.liked ?? clip.liked_by_me
  const likes = like?.count ?? clip.likes_count
  const duration = Math.max(0, clip.end_s - clip.start_s)
  const sport = sportInfo(clip.sport)

  // Autoplay while in view.
  useEffect(() => {
    const el = rootRef.current
    const v = videoRef.current
    if (!el || !v || reduce || !autoPlay || failed) return
    const io = new IntersectionObserver(
      ([e]) => {
        if (e && e.isIntersecting && e.intersectionRatio >= 0.6) v.play().catch(() => {})
        else v.pause()
      },
      { threshold: [0, 0.6, 1] },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [reduce, autoPlay, failed])

  const onTimeUpdate = () => {
    const v = videoRef.current
    if (!v) return
    if (v.currentTime >= clip.end_s || v.currentTime < clip.start_s - 0.25) v.currentTime = clip.start_s
    if (progressRef.current && duration > 0) {
      const p = Math.min(1, Math.max(0, (v.currentTime - clip.start_s) / duration))
      progressRef.current.style.transform = `scaleX(${p})`
    }
  }

  const onPlay = () => {
    setPlaying(true)
    if (viewed.current) return
    viewed.current = true
    api.highlights
      .view(clip.id)
      .then((r) => setViews(r.views))
      .catch(() => {})
  }

  const togglePlay = () => {
    const v = videoRef.current
    if (!v) return
    if (v.paused) v.play().catch(() => {})
    else v.pause()
  }

  const toggleLike = async (force?: boolean) => {
    const next = force ?? !liked
    if (next === liked) return
    const prev = { liked, count: likes }
    setLike({ liked: next, count: likes + (next ? 1 : -1) })
    if (next) setBurst((b) => b + 1)
    try {
      const updated = next ? await api.highlights.like(clip.id) : await api.highlights.unlike(clip.id)
      setLike({ liked: updated.liked_by_me, count: updated.likes_count })
      replaceClip(qc, updated)
    } catch (e) {
      setLike(prev)
      toast.error(errorMessage(e))
    }
  }

  const onDoubleClick = () => {
    setBigHeart((h) => h + 1)
    void toggleLike(true)
  }

  return (
    <motion.article
      ref={rootRef}
      layout
      className={cn('glass group relative flex flex-col overflow-hidden rounded-3xl shadow-card', className)}
    >
      {/* Video — dark island: overlays / title are tuned for footage, not the page theme */}
      <div data-theme="dark" className="relative aspect-video overflow-hidden bg-ink-800">
        <TurfArt seed={clip.recording_id} sport={clip.sport} src={clip.thumbnail_url} className="absolute inset-0" />
        {!failed && (
          <video
            ref={videoRef}
            src={`${clip.video_url}#t=${clip.start_s}`}
            poster={clip.thumbnail_url ?? undefined}
            muted={muted}
            playsInline
            preload="metadata"
            className="absolute inset-0 h-full w-full object-cover"
            onLoadedMetadata={(e) => (e.currentTarget.currentTime = clip.start_s)}
            onTimeUpdate={onTimeUpdate}
            onPlay={onPlay}
            onPause={() => setPlaying(false)}
            onError={() => setFailed(true)}
            onClick={togglePlay}
            onDoubleClick={onDoubleClick}
            aria-label={`Highlight: ${clip.title}`}
          />
        )}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-ink-950/85 via-transparent to-ink-950/30" />

        {/* play affordance */}
        <AnimatePresence>
          {!playing && !failed && (
            <motion.button
              type="button"
              aria-label="Play clip"
              onClick={togglePlay}
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 1.2 }}
              className="absolute top-1/2 left-1/2 flex h-14 w-14 -translate-x-1/2 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full bg-ink-950/50 ring-1 ring-white/25 backdrop-blur-md transition hover:bg-volt hover:text-ink-950"
            >
              <Play className="ml-0.5 h-6 w-6 fill-current" />
            </motion.button>
          )}
        </AnimatePresence>

        {/* double-tap heart */}
        <AnimatePresence>
          {bigHeart > 0 && (
            <motion.div
              key={bigHeart}
              className="pointer-events-none absolute inset-0 flex items-center justify-center"
              initial={{ opacity: 0, scale: 0.3 }}
              animate={{ opacity: [0, 1, 1, 0], scale: [0.3, 1.25, 1, 1.1] }}
              transition={{ duration: 0.9, times: [0, 0.25, 0.7, 1] }}
              onAnimationComplete={() => setBigHeart(0)}
            >
              <Heart className="h-24 w-24 fill-flare text-flare drop-shadow-[0_0_30px_color-mix(in_srgb,_var(--color-flare)_80%,_transparent)]" />
            </motion.div>
          )}
        </AnimatePresence>

        {/* right-14 keeps the chips clear of the mute button; they wrap on narrow cards */}
        <div className="absolute top-3 right-14 left-3 flex flex-wrap items-center gap-1.5">
          <span className="rounded-full bg-ink-950/60 px-2 py-0.5 font-mono text-[11px] font-semibold backdrop-blur">
            {fmtClock(duration)}
          </span>
          <FootageCredit videoUrl={clip.video_url} compact />
          {clip.is_pinned && (
            <span className="inline-flex items-center gap-1 rounded-full bg-volt px-2 py-0.5 text-[10px] font-bold text-ink-950">
              <Pin className="h-3 w-3" /> Pinned
            </span>
          )}
        </div>
        {!failed && (
          <button
            type="button"
            onClick={() => setMuted((m) => !m)}
            aria-label={muted ? 'Unmute' : 'Mute'}
            className="absolute top-3 right-3 flex h-8 w-8 cursor-pointer items-center justify-center rounded-full bg-ink-950/60 text-fg/85 backdrop-blur transition hover:text-volt"
          >
            {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
          </button>
        )}

        <div className="pointer-events-none absolute right-3 bottom-3 left-3">
          <h3 className="line-clamp-2 font-display text-sm font-semibold text-snow drop-shadow sm:text-base">{clip.title}</h3>
          <div className="mt-1 flex items-center gap-1.5 text-[11px] text-fg/70">
            <span>{sport.emoji}</span>
            <span className="truncate">{clip.turf_name}</span>
            <span>·</span>
            <span className="shrink-0">{timeAgo(clip.created_at)}</span>
          </div>
        </div>
        {/* window progress */}
        <div className="absolute inset-x-0 bottom-0 h-0.5 bg-white/10">
          <div ref={progressRef} className="h-full origin-left scale-x-0 bg-volt shadow-[0_0_8px_var(--color-volt)]" />
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center gap-3 px-4 py-3">
        {!hideOwner && (
          <Link to={`/app/players/${clip.owner.id}`} className="flex min-w-0 flex-1 items-center gap-2.5 rounded-xl transition hover:opacity-80">
            <Avatar user={clip.owner} size="sm" />
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">{clip.owner.name}</div>
              <div className="text-[11px] text-muted">Lvl {clip.owner.level}</div>
            </div>
          </Link>
        )}
        {hideOwner && (
          <div className="flex min-w-0 flex-1 flex-wrap gap-1">
            {clip.tags.slice(0, 3).map((t) => (
              <span key={t} className="rounded-full bg-white/6 px-2 py-0.5 text-[10px] text-fg/70 ring-1 ring-white/10">
                #{t}
              </span>
            ))}
          </div>
        )}
        <span className="flex items-center gap-1 text-xs text-muted" title="Views">
          <Eye className="h-3.5 w-3.5" />
          {fmtCount(views ?? clip.views)}
        </span>
        <button
          type="button"
          onClick={() => void toggleLike()}
          aria-pressed={liked}
          aria-label={liked ? 'Unlike' : 'Like'}
          className="relative flex h-9 cursor-pointer items-center gap-1.5 rounded-full px-2.5 text-sm font-semibold transition hover:bg-flare/10"
        >
          <span className="relative">
            <motion.span
              key={`${liked}-${burst}`}
              initial={liked && !reduce ? { scale: 0.4 } : false}
              animate={{ scale: 1 }}
              transition={{ type: 'spring', stiffness: 600, damping: 12 }}
              className="block"
            >
              <Heart className={cn('h-5 w-5 transition-colors', liked ? 'fill-flare text-flare' : 'text-fg/70')} />
            </motion.span>
            <AnimatePresence>
              {burst > 0 && liked && !reduce && (
                <span key={burst} className="pointer-events-none absolute inset-0">
                  {BURST.map((a, i) => (
                    <motion.span
                      key={i}
                      className={cn('absolute top-1/2 left-1/2 h-1.5 w-1.5 rounded-full', i % 2 ? 'bg-volt' : 'bg-flare')}
                      initial={{ x: '-50%', y: '-50%', opacity: 1, scale: 1 }}
                      animate={{ x: `calc(-50% + ${Math.cos(a) * 18}px)`, y: `calc(-50% + ${Math.sin(a) * 18}px)`, opacity: 0, scale: 0.4 }}
                      transition={{ duration: 0.55, ease: 'easeOut' }}
                    />
                  ))}
                </span>
              )}
            </AnimatePresence>
          </span>
          <span className={cn('tabular-nums', liked ? 'text-flare' : 'text-fg/80')}>{fmtCount(likes)}</span>
        </button>
        {actions}
      </div>
    </motion.article>
  )
}
