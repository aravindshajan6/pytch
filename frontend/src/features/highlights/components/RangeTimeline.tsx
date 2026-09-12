import { forwardRef, useRef } from 'react'
import { cn } from '@/lib/cn'
import { fmtClock } from '../time'

export interface Range {
  start: number
  end: number
}

interface RangeTimelineProps {
  duration: number
  value: Range
  onChange: (r: Range) => void
  /** Called while scrubbing / dragging so the player can preview that frame. */
  onSeek: (t: number) => void
  maxLen: number
  minLen?: number
  frames: string[]
}

type DragMode = 'start' | 'end' | 'move' | 'seek'

/**
 * Filmstrip timeline with draggable in/out handles (keyboard: ←/→ ±0.5 s, Shift ±5 s),
 * a draggable selection window and click/drag-to-scrub. The playhead element is
 * exposed via ref so the page can move it every frame without re-rendering.
 * Pointer capture lands on the pressed element; moves bubble up to the track handler.
 */
export const RangeTimeline = forwardRef<HTMLDivElement, RangeTimelineProps>(function RangeTimeline(
  { duration, value, onChange, onSeek, maxLen, minLen = 1, frames },
  playheadRef,
) {
  const trackRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{ mode: DragMode; grabT: number; start: number; end: number } | null>(null)
  const D = Math.max(duration, 0.1)
  const pct = (t: number) => `${(t / D) * 100}%`

  const timeAt = (clientX: number) => {
    const r = trackRef.current!.getBoundingClientRect()
    return Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * D
  }

  const clampStart = (t: number, end: number) => Math.min(end - minLen, Math.max(0, end - maxLen, t))
  const clampEnd = (t: number, start: number) => Math.max(start + minLen, Math.min(D, start + maxLen, t))

  const begin = (mode: DragMode) => (e: React.PointerEvent) => {
    e.stopPropagation()
    e.preventDefault()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    const t = timeAt(e.clientX)
    drag.current = { mode, grabT: t, start: value.start, end: value.end }
    if (mode === 'seek') onSeek(t)
  }

  const move = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    const t = timeAt(e.clientX)
    if (d.mode === 'seek') return onSeek(t)
    if (d.mode === 'start') {
      const s = clampStart(t, d.end)
      onChange({ start: s, end: d.end })
      onSeek(s)
    } else if (d.mode === 'end') {
      const en = clampEnd(t, d.start)
      onChange({ start: d.start, end: en })
      onSeek(en)
    } else {
      const len = d.end - d.start
      const s = Math.min(D - len, Math.max(0, d.start + (t - d.grabT)))
      onChange({ start: s, end: s + len })
      onSeek(s)
    }
  }

  const end = () => {
    drag.current = null
  }

  const onKey = (which: 'start' | 'end') => (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 5 : 0.5
    const dirs: Record<string, number> = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1 }
    if (!(e.key in dirs)) return
    const delta = dirs[e.key]! * step
    e.preventDefault()
    e.stopPropagation()
    if (which === 'start') {
      const s = clampStart(value.start + delta, value.end)
      onChange({ start: s, end: value.end })
      onSeek(s)
    } else {
      const en = clampEnd(value.end + delta, value.start)
      onChange({ start: value.start, end: en })
      onSeek(en)
    }
  }

  const ticks = Math.min(12, Math.max(4, Math.floor(D / 10)))

  return (
    <div className="select-none">
      <div
        ref={trackRef}
        data-theme="dark" // filmstrip is footage: keep night dims, neon handles and a white playhead in both themes
        className="relative h-20 cursor-pointer touch-none overflow-hidden rounded-2xl bg-ink-800 ring-1 ring-white/10"
        onPointerDown={begin('seek')}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
      >
        {/* filmstrip */}
        <div className="absolute inset-0 flex">
          {frames.length
            ? frames.map((src, i) => (
                <img key={i} src={src} alt="" draggable={false} className="h-full min-w-0 flex-1 object-cover opacity-80" />
              ))
            : Array.from({ length: 10 }, (_, i) => (
                <div
                  key={i}
                  className="h-full flex-1 border-r border-black/40"
                  style={{
                    background: `linear-gradient(160deg, hsl(${120 + i * 6} 40% ${16 + (i % 3) * 3}%), hsl(${150 + i * 4} 45% 9%))`,
                  }}
                />
              ))}
        </div>

        {/* dim outside selection */}
        <div className="pointer-events-none absolute inset-y-0 left-0 bg-ink-950/70" style={{ width: pct(value.start) }} />
        <div className="pointer-events-none absolute inset-y-0 right-0 bg-ink-950/70" style={{ left: pct(value.end) }} />

        {/* selection window */}
        <div
          className="absolute inset-y-0 cursor-grab border-y-[3px] border-volt active:cursor-grabbing"
          style={{ left: pct(value.start), width: pct(value.end - value.start), boxShadow: '0 0 30px -6px color-mix(in srgb, var(--color-volt) 60%, transparent)' }}
          onPointerDown={begin('move')}
          aria-hidden
        />

        {/* handles */}
        {(['start', 'end'] as const).map((which) => {
          const t = which === 'start' ? value.start : value.end
          return (
            <div
              key={which}
              role="slider"
              tabIndex={0}
              aria-label={which === 'start' ? 'Clip in point' : 'Clip out point'}
              aria-valuemin={0}
              aria-valuemax={Math.round(D)}
              aria-valuenow={Math.round(t * 10) / 10}
              aria-valuetext={fmtClock(t, true)}
              onPointerDown={begin(which)}
              onKeyDown={onKey(which)}
              className={cn(
                'group absolute inset-y-0 z-10 flex w-5 cursor-ew-resize items-center justify-center bg-volt outline-none focus-visible:ring-2 focus-visible:ring-white',
                which === 'start' ? 'rounded-l-xl' : '-translate-x-full rounded-r-xl',
              )}
              style={{ left: pct(t) }}
            >
              <span className="h-6 w-1 rounded-full bg-ink-950/60 transition group-hover:h-8" />
            </div>
          )
        })}

        {/* playhead */}
        <div ref={playheadRef} className="pointer-events-none absolute inset-y-0 z-20 w-0.5 -translate-x-1/2 bg-snow shadow-[0_0_10px_white]" style={{ left: 0 }}>
          <span className="absolute -top-1 left-1/2 h-2.5 w-2.5 -translate-x-1/2 rounded-full bg-snow" />
        </div>
      </div>

      {/* ruler */}
      <div className="relative mt-1.5 h-4 font-mono text-[10px] text-subtle">
        {Array.from({ length: ticks + 1 }, (_, i) => {
          const t = (i / ticks) * D
          return (
            <span
              key={i}
              className={cn('absolute', i === 0 ? '' : i === ticks ? '-translate-x-full' : '-translate-x-1/2')}
              style={{ left: pct(t) }}
            >
              {fmtClock(t)}
            </span>
          )
        })}
      </div>
    </div>
  )
})
