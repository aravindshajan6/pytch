import { Star } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useId, useRef, useState } from 'react'
import { cn } from '@/lib/cn'

const EMOJI = ['', '😬', '😕', '🙂', '😄', '🔥']

interface StarRatingProps {
  label: string
  hint?: string
  value: number // 0 = unset
  onChange: (v: number) => void
  words: [string, string, string, string, string]
  disabled?: boolean
}

/** 5-star radiogroup with hover preview, spring pop and emoji feedback. Arrow keys supported. */
export function StarRating({ label, hint, value, onChange, words, disabled }: StarRatingProps) {
  const id = useId()
  const [hover, setHover] = useState(0)
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const shown = hover || value

  const onKey = (e: React.KeyboardEvent) => {
    let next: number
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = Math.min(5, value + 1)
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = Math.max(1, value - 1)
    else if (e.key >= '1' && e.key <= '5') next = Number(e.key)
    else return
    e.preventDefault()
    e.stopPropagation()
    onChange(next)
    refs.current[next - 1]?.focus()
  }

  return (
    <div className={cn('rounded-2xl bg-white/4 p-3 ring-1 ring-white/8 transition-opacity', disabled && 'pointer-events-none opacity-35')}>
      <div className="flex items-center justify-between gap-2">
        <div>
          <div id={id} className="text-sm font-semibold">
            {label}
          </div>
          {hint && <div className="text-[11px] text-subtle">{hint}</div>}
        </div>
        <div className="flex h-7 min-w-24 items-center justify-end gap-1.5 text-right">
          <AnimatePresence mode="popLayout" initial={false}>
            {shown > 0 && (
              <motion.span
                key={shown}
                initial={{ opacity: 0, y: 8, scale: 0.6 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -8, scale: 0.6 }}
                transition={{ type: 'spring', stiffness: 500, damping: 26 }}
                className="flex items-center gap-1.5"
              >
                <span className="text-xs font-medium text-muted">{words[shown - 1]}</span>
                <span className="text-lg">{EMOJI[shown]}</span>
              </motion.span>
            )}
          </AnimatePresence>
        </div>
      </div>
      <div
        role="radiogroup"
        aria-labelledby={id}
        className="mt-2 flex items-center gap-1"
        onMouseLeave={() => setHover(0)}
        onKeyDown={onKey}
      >
        {[1, 2, 3, 4, 5].map((n) => {
          const on = n <= shown
          return (
            <motion.button
              key={n}
              ref={(el) => {
                refs.current[n - 1] = el
              }}
              type="button"
              role="radio"
              aria-checked={value === n}
              aria-label={`${n} star${n > 1 ? 's' : ''} — ${words[n - 1]}`}
              tabIndex={value ? (value === n ? 0 : -1) : n === 1 ? 0 : -1}
              onClick={() => onChange(n)}
              onMouseEnter={() => setHover(n)}
              onFocus={() => setHover(0)}
              whileTap={{ scale: 0.8 }}
              animate={value === n ? { scale: [1, 1.35, 1], rotate: [0, -12, 0] } : { scale: 1 }}
              transition={{ duration: 0.35 }}
              className="flex h-10 flex-1 cursor-pointer items-center justify-center rounded-xl transition-colors hover:bg-white/5 focus-visible:outline-2"
            >
              <Star
                className={cn(
                  'h-7 w-7 transition-all duration-150',
                  on
                    ? 'fill-volt text-volt drop-shadow-[0_0_8px_color-mix(in_srgb,_var(--color-volt)_60%,_transparent)]'
                    : 'text-white/20 [[data-theme=light]_&]:fill-ink-600 [[data-theme=light]_&]:text-ink-400',
                )}
                strokeWidth={1.6}
              />
            </motion.button>
          )
        })}
      </div>
    </div>
  )
}
