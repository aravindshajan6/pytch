import { motion } from 'motion/react'
import { useId, useRef } from 'react'
import { cn } from '@/lib/cn'

export interface SegmentedOption<T extends string> {
  value: T
  label: React.ReactNode
}

const NEXT_KEYS = ['ArrowRight', 'ArrowDown']
const PREV_KEYS = ['ArrowLeft', 'ArrowUp']

/**
 * Single-choice pill control with a sliding active indicator. Semantically a radio group
 * (`role="radiogroup"` / `radio` + `aria-checked`): one tab stop, arrow keys move *and* select,
 * Home/End jump to the ends. With no matching `value` the first option is the tab stop.
 */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className,
  size = 'md',
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
}: {
  value: T
  onChange: (v: T) => void
  options: SegmentedOption<T>[]
  className?: string
  size?: 'sm' | 'md'
  'aria-label'?: string
  'aria-labelledby'?: string
}) {
  const id = useId()
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const activeIndex = options.findIndex((o) => o.value === value)
  const tabStop = activeIndex >= 0 ? activeIndex : 0

  const onKeyDown = (e: React.KeyboardEvent, i: number) => {
    let to: number | null = null
    if (NEXT_KEYS.includes(e.key)) to = (i + 1) % options.length
    else if (PREV_KEYS.includes(e.key)) to = (i - 1 + options.length) % options.length
    else if (e.key === 'Home') to = 0
    else if (e.key === 'End') to = options.length - 1
    if (to === null) return
    e.preventDefault()
    refs.current[to]?.focus()
    onChange(options[to]!.value)
  }

  return (
    <div
      className={cn('inline-flex rounded-2xl bg-white/5 p-1 ring-1 ring-white/10', className)}
      role="radiogroup"
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
    >
      {options.map((o, i) => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el
            }}
            role="radio"
            aria-checked={active}
            tabIndex={i === tabStop ? 0 : -1}
            type="button"
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={cn(
              'relative flex-1 cursor-pointer rounded-xl font-semibold transition-colors',
              size === 'sm' ? 'px-3 py-1.5 text-xs' : 'px-4 py-2 text-sm',
              active ? 'text-ink-950' : 'text-fg/70 hover:text-fg',
            )}
          >
            {active && (
              <motion.span
                layoutId={`seg-${id}`}
                className="absolute inset-0 rounded-xl bg-volt"
                transition={{ type: 'spring', stiffness: 500, damping: 38 }}
              />
            )}
            <span className="relative z-10 inline-flex items-center justify-center gap-1.5">{o.label}</span>
          </button>
        )
      })}
    </div>
  )
}
