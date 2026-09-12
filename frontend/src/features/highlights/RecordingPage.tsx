import { ArrowLeft, Heart, Keyboard, Loader2, Pause, Pin, PinOff, Play, Repeat, Scissors, Trash2, Volume2, VolumeX } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router'
import { toast } from 'sonner'
import { Avatar } from '@/components/ui/Avatar'
import { Button, LinkButton } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Input, Label } from '@/components/ui/Form'
import { SportBadge } from '@/components/ui/PlayerBits'
import { ResourceErrorState, Skeleton } from '@/components/ui/States'
import { TurfArt } from '@/components/ui/TurfArt'
import { useMe } from '@/hooks/useMe'
import { useMeta } from '@/hooks/useMeta'
import { errorMessage, isApiError } from '@/lib/api/client'
import { pop } from '@/lib/celebrate'
import { cn } from '@/lib/cn'
import { formatWhen } from '@/lib/format'
import type { Clip, Recording } from '@/types/api'
import { useCreateClip, useDeleteClip, usePinClip, useRecording } from './api'
import { type Range, RangeTimeline } from './components/RangeTimeline'
import { fmtClock, fmtCount, HIGHLIGHT_TAGS } from './time'
import { useFilmstrip } from './useFilmstrip'
import { FootageCredit } from './components/FootageCredit'

const round1 = (n: number) => Math.round(n * 10) / 10

export default function RecordingPage() {
  const { recordingId } = useParams()
  const q = useRecording(recordingId)

  if (q.isLoading)
    return (
      <div className="space-y-4">
        <Skeleton className="h-14 w-72" />
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
          <Skeleton className="aspect-video rounded-3xl" />
          <Skeleton className="h-80" />
        </div>
      </div>
    )
  if (q.isError || !q.data)
    return (
      <ResourceErrorState
        error={q.error}
        onRetry={() => q.refetch()}
        notFound={{ icon: '📼', title: 'Recording not found' }}
        forbidden={{ icon: '🔒', title: 'Not your recording', description: 'Only players from this match can open its footage.' }}
        action={<LinkButton to="/app/highlights?tab=recordings">My recordings</LinkButton>}
      />
    )

  const rec = q.data
  return (
    <div>
      <Link to="/app/highlights?tab=recordings" className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted transition hover:text-fg">
        <ArrowLeft className="h-4 w-4" /> My recordings
      </Link>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-xs font-semibold tracking-[0.2em] text-volt uppercase">Clip editor</div>
          <h1 className="mt-1 text-2xl font-bold sm:text-3xl">{rec.lobby.title}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted">
            <SportBadge sport={rec.lobby.sport} format={rec.lobby.format} />
            <span>
              {rec.lobby.turf.name} · {formatWhen(rec.lobby.start_at)}
            </span>
          </div>
        </div>
      </header>
      {rec.status === 'ready' && rec.video_url ? <Editor rec={rec} videoUrl={rec.video_url} /> : <NotReady rec={rec} />}
    </div>
  )
}

function NotReady({ rec }: { rec: Recording }) {
  const failed = rec.status === 'failed'
  return (
    <Card className="overflow-hidden">
      <TurfArt seed={rec.lobby.turf.id} sport={rec.lobby.sport} src={rec.thumbnail_url} className="aspect-[21/9]">
        <div className="flex h-full flex-col items-center justify-center gap-3 bg-ink-950/50 text-center">
          {failed ? (
            <>
              <span className="text-4xl">📉</span>
              <span className="font-display text-lg font-semibold">Recording failed</span>
              <span className="text-sm text-muted">The camera feed didn't make it this time.</span>
            </>
          ) : (
            <>
              <div className="skeleton absolute inset-0 rounded-none opacity-40" />
              <Loader2 className="relative h-10 w-10 animate-spin text-volt" />
              <span className="relative font-display text-lg font-semibold">
                {rec.status === 'scheduled' ? 'Camera booked — rolling at kick-off' : 'Crunching the footage…'}
              </span>
              <span className="relative text-sm text-muted">We'll notify you the moment it's ready to clip.</span>
            </>
          )}
        </div>
      </TurfArt>
    </Card>
  )
}

// ───────────────────────── editor ─────────────────────────

function Editor({ rec, videoUrl }: { rec: Recording; videoUrl: string }) {
  const meta = useMeta()
  const maxLen = meta.data?.max_clip_seconds ?? 60
  const videoRef = useRef<HTMLVideoElement>(null)
  const playheadRef = useRef<HTMLDivElement>(null)
  const timeRef = useRef<HTMLSpanElement>(null)
  const [duration, setDuration] = useState(rec.duration_s ?? 0)
  const [range, setRange] = useState<Range>(() => ({ start: 0, end: Math.min(12, rec.duration_s ?? 12) }))
  const [playing, setPlaying] = useState(false)
  const [loop, setLoop] = useState(true)
  const [muted, setMuted] = useState(false)
  const [title, setTitle] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const frames = useFilmstrip(videoUrl, duration || null, 10)
  const create = useCreateClip(rec.id)

  const rangeRef = useRef(range)
  const loopRef = useRef(loop)
  useEffect(() => {
    rangeRef.current = range
    loopRef.current = loop
  }, [range, loop])

  // Playhead + time readout painted straight to the DOM; loop enforcement while playing.
  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    let raf = 0
    const paint = () => {
      const d = v.duration || duration || 1
      if (playheadRef.current) playheadRef.current.style.left = `${(v.currentTime / d) * 100}%`
      if (timeRef.current) timeRef.current.textContent = fmtClock(v.currentTime, true)
    }
    const tick = () => {
      const r = rangeRef.current
      if (loopRef.current && !v.paused && (v.currentTime >= r.end || v.currentTime < r.start - 0.1)) v.currentTime = r.start
      paint()
      raf = requestAnimationFrame(tick)
    }
    const onPlay = () => {
      setPlaying(true)
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(tick)
    }
    const onPause = () => {
      setPlaying(false)
      cancelAnimationFrame(raf)
      paint()
    }
    v.addEventListener('play', onPlay)
    v.addEventListener('pause', onPause)
    v.addEventListener('seeked', paint)
    v.addEventListener('timeupdate', paint)
    paint()
    return () => {
      cancelAnimationFrame(raf)
      v.removeEventListener('play', onPlay)
      v.removeEventListener('pause', onPause)
      v.removeEventListener('seeked', paint)
      v.removeEventListener('timeupdate', paint)
    }
  }, [duration])

  const seek = useCallback((t: number) => {
    const v = videoRef.current
    if (!v) return
    v.currentTime = Math.max(0, Math.min(t, (v.duration || Infinity) - 0.05))
  }, [])

  const togglePlay = useCallback(() => {
    const v = videoRef.current
    if (!v) return
    if (v.paused) {
      const r = rangeRef.current
      if (loopRef.current && (v.currentTime < r.start || v.currentTime >= r.end - 0.05)) v.currentTime = r.start
      v.play().catch(() => {})
    } else v.pause()
  }, [])

  const setIn = useCallback(
    (t: number) => {
      const D = duration || t + 1
      setRange((r) => {
        const start = Math.max(0, Math.min(t, D - 1))
        let end = r.end
        if (end < start + 1 || end - start > maxLen) end = Math.min(D, start + Math.min(maxLen, 10))
        return { start, end }
      })
      toast(`In point · ${fmtClock(t, true)}`, { duration: 1200 })
    },
    [duration, maxLen],
  )

  const setOut = useCallback(
    (t: number) => {
      const D = duration || t
      setRange((r) => {
        const end = Math.min(D, Math.max(t, 1))
        let start = r.start
        if (end < start + 1 || end - start > maxLen) start = Math.max(0, end - Math.min(maxLen, 10))
        return { start, end }
      })
      toast(`Out point · ${fmtClock(t, true)}`, { duration: 1200 })
    },
    [duration, maxLen],
  )

  // Keyboard: space play/pause, I/O set in/out, ←/→ nudge 1 s (5 s with Shift).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t?.closest('input, textarea, select, [contenteditable=true]')) return
      const v = videoRef.current
      if (!v) return
      if (e.code === 'Space') {
        if (t?.closest('button, a, [role=slider]')) return
        e.preventDefault()
        togglePlay()
      } else if (e.key === 'i' || e.key === 'I') setIn(v.currentTime)
      else if (e.key === 'o' || e.key === 'O') setOut(v.currentTime)
      else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !t?.closest('[role=slider], [role=radiogroup]')) {
        e.preventDefault()
        seek(v.currentTime + (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 5 : 1))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [togglePlay, setIn, setOut, seek])

  const len = range.end - range.start
  const titleOk = title.trim().length >= 2
  const lenOk = len > 1 && len <= maxLen + 0.001

  const onCreate = (e: React.FormEvent) => {
    e.preventDefault()
    if (!titleOk) return void toast.error('Give your clip a title')
    if (!lenOk) return void toast.error(`Clips must be 1–${maxLen} seconds`)
    const start_s = round1(range.start)
    const end_s = Math.min(round1(range.end), start_s + maxLen)
    create.mutate(
      { title: title.trim(), start_s, end_s, tags },
      {
        onSuccess: (clip) => {
          pop(0.5, 0.7)
          toast.success('Clip saved · +20 XP', { description: clip.title })
          setTitle('')
          setTags([])
        },
        onError: (err) => toast.error(errorMessage(err)),
      },
    )
  }

  const previewClip = (c: Clip) => {
    setRange({ start: c.start_s, end: c.end_s })
    setLoop(true)
    seek(c.start_s)
    videoRef.current?.play().catch(() => {})
    videoRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
      <section className="min-w-0 space-y-4">
        {/* player */}
        <div data-theme="dark" className="group relative aspect-video overflow-hidden rounded-3xl bg-black shadow-card ring-1 ring-white/10 [[data-theme=light]_&]:shadow-[0_24px_50px_-28px_rgb(14_42_26_/_0.5)]">
          <video
            ref={videoRef}
            src={videoUrl}
            poster={rec.thumbnail_url ?? undefined}
            muted={muted}
            playsInline
            preload="auto"
            className="absolute inset-0 h-full w-full object-contain"
            onClick={togglePlay}
            onLoadedMetadata={(e) => {
              const d = e.currentTarget.duration
              if (Number.isFinite(d) && d > 0) {
                setDuration(d)
                setRange((r) => (r.end > d ? { start: Math.min(r.start, Math.max(0, d - 1)), end: d } : r))
              }
            }}
          />
          <AnimatePresence>
            {!playing && (
              <motion.button
                type="button"
                aria-label="Play"
                onClick={togglePlay}
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 1.3 }}
                className="absolute top-1/2 left-1/2 flex h-20 w-20 -translate-x-1/2 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full bg-ink-950/50 ring-1 ring-white/25 backdrop-blur-md transition hover:bg-volt hover:text-ink-950"
              >
                <Play className="ml-1 h-8 w-8 fill-current" />
              </motion.button>
            )}
          </AnimatePresence>
          {/* control bar */}
          <div className="absolute inset-x-0 bottom-0 flex items-center gap-2 bg-gradient-to-t from-ink-950/90 to-transparent px-3 pt-10 pb-3 sm:gap-3 sm:px-4">
            <button
              type="button"
              onClick={togglePlay}
              aria-label={playing ? 'Pause' : 'Play'}
              className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-full bg-white/10 backdrop-blur transition hover:bg-volt hover:text-ink-950"
            >
              {playing ? <Pause className="h-5 w-5 fill-current" /> : <Play className="ml-0.5 h-5 w-5 fill-current" />}
            </button>
            <span className="font-mono text-xs text-fg/85 tabular-nums sm:text-sm">
              <span ref={timeRef}>0:00.0</span>
              <span className="text-subtle"> / {fmtClock(duration)}</span>
            </span>
            <span className="flex-1" />
            <button
              type="button"
              onClick={() => setLoop((l) => !l)}
              aria-pressed={loop}
              className={cn(
                'flex h-9 cursor-pointer items-center gap-1.5 rounded-full px-3 text-xs font-semibold backdrop-blur transition',
                loop ? 'bg-volt text-ink-950' : 'bg-white/10 text-fg/80 hover:bg-white/15',
              )}
            >
              <Repeat className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Loop selection</span>
            </button>
            <button
              type="button"
              onClick={() => setMuted((m) => !m)}
              aria-label={muted ? 'Unmute' : 'Mute'}
              className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-full bg-white/10 backdrop-blur transition hover:bg-white/15"
            >
              {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
            </button>
          </div>
        </div>

        <FootageCredit videoUrl={videoUrl} className="-mt-2 px-1" />
        {/* timeline */}
        <Card className="p-4 sm:p-5">
          {duration > 0 ? (
            <RangeTimeline
              ref={playheadRef}
              duration={duration}
              value={range}
              onChange={setRange}
              onSeek={seek}
              maxLen={maxLen}
              frames={frames}
            />
          ) : (
            <Skeleton className="h-24" />
          )}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-3 rounded-xl bg-white/4 px-3 py-2 font-mono text-xs ring-1 ring-white/8">
              <span>
                <span className="text-subtle">IN </span>
                {fmtClock(range.start, true)}
              </span>
              <span>
                <span className="text-subtle">OUT </span>
                {fmtClock(range.end, true)}
              </span>
              <span className={cn('font-semibold', len > maxLen - 5 ? 'text-sun' : 'text-volt')}>
                {len.toFixed(1)}s<span className="text-subtle"> / {maxLen}s</span>
              </span>
            </div>
            <span className="flex-1" />
            <Button variant="secondary" size="sm" onClick={() => setIn(videoRef.current?.currentTime ?? 0)}>
              Set in <kbd className="rounded bg-white/10 px-1 font-mono text-[10px]">I</kbd>
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setOut(videoRef.current?.currentTime ?? 0)}>
              Set out <kbd className="rounded bg-white/10 px-1 font-mono text-[10px]">O</kbd>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setLoop(true)
                seek(range.start)
                videoRef.current?.play().catch(() => {})
              }}
            >
              <Play className="h-3.5 w-3.5" /> Preview
            </Button>
          </div>
        </Card>

        {/* create */}
        <Card className="p-5 sm:p-6">
          <form onSubmit={onCreate} className="space-y-4">
            <div>
              <Label htmlFor="clip-title">Clip title</Label>
              <Input
                id="clip-title"
                value={title}
                maxLength={80}
                placeholder="Top-bin volley from outside the box"
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>
            <div>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-semibold tracking-wider text-muted uppercase">Tags</span>
                <span className="font-mono text-[11px] text-subtle">{tags.length}/3</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {HIGHLIGHT_TAGS.map((t) => {
                  const on = tags.includes(t)
                  return (
                    <motion.button
                      key={t}
                      type="button"
                      whileTap={{ scale: 0.9 }}
                      aria-pressed={on}
                      disabled={!on && tags.length >= 3}
                      onClick={() => setTags((s) => (on ? s.filter((x) => x !== t) : [...s, t]))}
                      className={cn(
                        'h-8 cursor-pointer rounded-full px-3 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-35',
                        on ? 'bg-volt text-ink-950' : 'bg-white/5 text-fg/75 ring-1 ring-white/10 hover:bg-white/10',
                      )}
                    >
                      #{t}
                    </motion.button>
                  )
                })}
              </div>
            </div>
            <Button type="submit" size="lg" block loading={create.isPending} disabled={!titleOk || !lenOk}>
              <Scissors className="h-4 w-4" /> Cut clip · {len.toFixed(1)}s · +20 XP
            </Button>
          </form>
        </Card>
      </section>

      <aside className="space-y-4">
        <ClipsList rec={rec} onPreview={previewClip} />
        <Card className="p-5">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <Keyboard className="h-4 w-4 text-muted" /> Shortcuts
          </h3>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-xs">
            {[
              ['Space', 'Play / pause'],
              ['I / O', 'Set in / out at playhead'],
              ['← →', 'Nudge 1 s (Shift: 5 s)'],
              ['Handles', '← → 0.5 s (Shift: 5 s)'],
            ].map(([k, d]) => (
              <div key={k} className="contents">
                <dt>
                  <kbd className="rounded-md bg-white/8 px-1.5 py-0.5 font-mono text-[11px] ring-1 ring-white/10">{k}</kbd>
                </dt>
                <dd className="text-muted">{d}</dd>
              </div>
            ))}
          </dl>
        </Card>
      </aside>
    </div>
  )
}

// ───────────────────────── clips list ─────────────────────────

function ClipsList({ rec, onPreview }: { rec: Recording; onPreview: (c: Clip) => void }) {
  const { user } = useMe()
  const meta = useMeta()
  const pin = usePinClip()
  const del = useDeleteClip()
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const maxPinned = meta.data?.max_pinned_clips ?? 3
  const clips = [...rec.clips].sort((a, b) => b.created_at.localeCompare(a.created_at))

  const togglePin = (c: Clip) =>
    pin.mutate(
      { id: c.id, pin: !c.is_pinned },
      {
        onSuccess: (updated) => toast.success(updated.is_pinned ? 'Pinned to your profile 📌' : 'Unpinned'),
        onError: (e) =>
          isApiError(e, 'LIMIT_REACHED') ? toast.error(`Unpin one first — max ${maxPinned}`) : toast.error(errorMessage(e)),
      },
    )

  const remove = (c: Clip) => {
    if (confirmId !== c.id) {
      setConfirmId(c.id)
      setTimeout(() => setConfirmId((id) => (id === c.id ? null : id)), 3000)
      return
    }
    del.mutate(c.id, {
      onSuccess: () => toast('Clip deleted'),
      onError: (e) => toast.error(errorMessage(e)),
    })
  }

  return (
    <Card className="p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-semibold">Clips from this match</h2>
        <span className="font-mono text-xs text-muted">{clips.length}</span>
      </div>
      {clips.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-white/10 p-5 text-center text-sm text-subtle">
          No clips yet. Drag the handles, name it, cut it.
        </p>
      ) : (
        <ul className="space-y-3">
          <AnimatePresence initial={false}>
            {clips.map((c) => {
              const mine = c.owner.id === user?.id
              return (
                <motion.li
                  key={c.id}
                  layout
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20, height: 0 }}
                  className="flex gap-3 rounded-2xl bg-white/4 p-2.5 ring-1 ring-white/8"
                >
                  <button
                    type="button"
                    onClick={() => onPreview(c)}
                    aria-label={`Preview ${c.title}`}
                    data-theme="dark"
                    className="group relative aspect-video w-24 shrink-0 cursor-pointer overflow-hidden rounded-xl"
                  >
                    <TurfArt seed={c.id} sport={c.sport} src={c.thumbnail_url} className="absolute inset-0" />
                    <span className="absolute inset-0 flex items-center justify-center bg-ink-950/40 opacity-80 transition group-hover:opacity-100">
                      <Play className="h-5 w-5 fill-snow text-snow" />
                    </span>
                    <span className="absolute right-1 bottom-1 rounded bg-ink-950/70 px-1 font-mono text-[9px]">
                      {fmtClock(c.end_s - c.start_s)}
                    </span>
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start gap-1.5">
                      <div className="line-clamp-2 flex-1 text-sm leading-snug font-semibold">{c.title}</div>
                      {c.is_pinned && <Pin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-volt" aria-label="Pinned" />}
                    </div>
                    <div className="mt-1 flex items-center gap-1.5 text-[11px] text-muted">
                      <Avatar user={c.owner} size="xs" showVerified={false} />
                      <span className="truncate">{mine ? 'You' : c.owner.name}</span>
                      <span>·</span>
                      <span className="font-mono">
                        {fmtClock(c.start_s)}–{fmtClock(c.end_s)}
                      </span>
                    </div>
                    <div className="mt-1.5 flex items-center gap-1">
                      <span className="mr-auto flex items-center gap-1 text-[11px] text-subtle">
                        <Heart className="h-3 w-3" /> {fmtCount(c.likes_count)} · {fmtCount(c.views)} views
                      </span>
                      {mine && (
                        <>
                          <button
                            type="button"
                            onClick={() => togglePin(c)}
                            disabled={pin.isPending && pin.variables?.id === c.id}
                            aria-label={c.is_pinned ? 'Unpin from profile' : 'Pin to profile'}
                            title={c.is_pinned ? 'Unpin' : `Pin (max ${maxPinned})`}
                            className={cn(
                              'flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg transition disabled:opacity-50',
                              c.is_pinned ? 'bg-volt/15 text-volt hover:bg-volt/25' : 'text-muted hover:bg-white/10 hover:text-fg',
                            )}
                          >
                            {c.is_pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
                          </button>
                          <button
                            type="button"
                            onClick={() => remove(c)}
                            disabled={del.isPending && del.variables === c.id}
                            aria-label={confirmId === c.id ? 'Confirm delete' : 'Delete clip'}
                            className={cn(
                              'flex h-7 cursor-pointer items-center justify-center gap-1 rounded-lg px-1.5 text-[11px] font-semibold transition disabled:opacity-50',
                              confirmId === c.id ? 'bg-flare text-snow' : 'text-muted hover:bg-flare/15 hover:text-flare',
                            )}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            {confirmId === c.id && 'Sure?'}
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </motion.li>
              )
            })}
          </AnimatePresence>
        </ul>
      )}
    </Card>
  )
}
