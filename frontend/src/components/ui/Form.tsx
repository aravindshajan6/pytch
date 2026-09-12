import { motion } from 'motion/react'
import { forwardRef } from 'react'
import { cn } from '@/lib/cn'

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      className={cn(
        'h-12 w-full rounded-xl bg-white/5 px-4 text-fg ring-1 ring-white/10 transition outline-none placeholder:text-subtle focus:bg-white/8 focus:ring-2 focus:ring-volt/70',
        className,
      )}
      {...props}
    />
  )
})

export const Textarea = forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...props }, ref) {
    return (
      <textarea
        ref={ref}
        className={cn(
          'min-h-24 w-full resize-none rounded-xl bg-white/5 p-4 text-fg ring-1 ring-white/10 transition outline-none placeholder:text-subtle focus:ring-2 focus:ring-volt/70',
          className,
        )}
        {...props}
      />
    )
  },
)

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn('mb-2 block text-xs font-semibold tracking-wider text-muted uppercase', className)} {...props} />
}

export function Switch({
  checked,
  onChange,
  label,
  disabled,
  tone = 'volt',
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label?: string
  disabled?: boolean
  tone?: 'volt' | 'flare' | 'electric'
}) {
  const bg = { volt: 'bg-volt', flare: 'bg-flare', electric: 'bg-electric' }[tone]
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-7 w-12 shrink-0 cursor-pointer items-center rounded-full p-1 transition-colors disabled:opacity-50',
        checked ? bg : 'bg-white/12',
      )}
    >
      <motion.span
        layout
        transition={{ type: 'spring', stiffness: 700, damping: 35 }}
        className={cn('h-5 w-5 rounded-full shadow-md', checked ? 'ml-auto bg-ink-950' : 'bg-snow')}
      />
    </button>
  )
}

/** Styled native range input. */
export function Slider({
  value,
  onChange,
  min,
  max,
  step = 1,
  className,
}: {
  value: number
  onChange: (v: number) => void
  min: number
  max: number
  step?: number
  className?: string
}) {
  const pct = ((value - min) / (max - min)) * 100
  return (
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className={cn(
        'h-2 w-full cursor-pointer appearance-none rounded-full [&::-moz-range-thumb]:h-5 [&::-moz-range-thumb]:w-5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-volt [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-volt [&::-webkit-slider-thumb]:shadow-[0_0_16px_color-mix(in_srgb,_var(--color-volt)_80%,_transparent)]',
        className,
      )}
      style={{ background: `linear-gradient(90deg, var(--color-volt) ${pct}%, color-mix(in srgb, var(--color-white) 10%, transparent) ${pct}%)` }}
    />
  )
}

/** −/+ number stepper. */
export function Stepper({
  value,
  onChange,
  min,
  max,
  label = 'value',
}: {
  value: number
  onChange: (v: number) => void
  min: number
  max: number
  /** What is being counted, for screen readers ("players"). */
  label?: string
}) {
  const btn =
    'h-10 w-10 cursor-pointer rounded-xl bg-white/6 text-lg font-bold ring-1 ring-white/10 transition hover:bg-white/12 disabled:opacity-30'
  return (
    <div className="inline-flex items-center gap-3" role="group" aria-label={label}>
      <button type="button" className={btn} disabled={value <= min} onClick={() => onChange(value - 1)} aria-label={`Fewer ${label}`}>
        −
      </button>
      <motion.span key={value} initial={{ scale: 1.3, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="w-8 text-center font-display text-xl" aria-live="polite">
        {value}
      </motion.span>
      <button type="button" className={btn} disabled={value >= max} onClick={() => onChange(value + 1)} aria-label={`More ${label}`}>
        +
      </button>
    </div>
  )
}
