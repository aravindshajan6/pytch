import { motion, useAnimationControls } from 'motion/react'
import { useEffect, useImperativeHandle, useRef, type Ref } from 'react'
import { cn } from '@/lib/cn'

export interface OtpInputHandle {
  focus: (index?: number) => void
  shake: () => void
}

/**
 * Six single-digit boxes: auto-advance, backspace-to-previous, arrow keys,
 * paste / SMS autofill of the whole code into any box.
 */
export function OtpInput({
  value,
  onChange,
  onComplete,
  disabled,
  invalid,
  length = 6,
  ref,
}: {
  value: string
  onChange: (v: string) => void
  onComplete?: (code: string) => void
  disabled?: boolean
  invalid?: boolean
  length?: number
  ref?: Ref<OtpInputHandle>
}) {
  const inputs = useRef<(HTMLInputElement | null)[]>([])
  const controls = useAnimationControls()
  const digits = Array.from({ length }, (_, i) => value[i] ?? '')
  // committed length, updated synchronously in commit() so focus guards never see a stale render value
  const lenRef = useRef(value.length)
  useEffect(() => {
    lenRef.current = value.length
  }, [value])

  useImperativeHandle(ref, () => ({
    focus: (i = Math.min(value.length, length - 1)) => inputs.current[i]?.focus(),
    shake: () => void controls.start({ x: [0, -10, 10, -8, 8, -4, 4, 0], transition: { duration: 0.45 } }),
  }))

  useEffect(() => {
    inputs.current[0]?.focus()
  }, [])

  const commit = (next: string, focusIndex: number) => {
    const clean = next.replace(/\D/g, '').slice(0, length)
    lenRef.current = clean.length
    onChange(clean)
    inputs.current[Math.min(focusIndex, length - 1)]?.focus()
    if (clean.length === length) onComplete?.(clean)
  }

  const setAt = (i: number, raw: string) => {
    let incoming = raw.replace(/\D/g, '')
    if (!incoming) return
    // typed over an existing digit with the caret instead of a selection → keep the new keystroke
    if (incoming.length === 2 && digits[i] && incoming.includes(digits[i]!)) {
      incoming = incoming[0] === digits[i] ? incoming[1]! : incoming[0]!
    }
    if (incoming.length > 1) {
      // paste / autofill into a box → spread from here
      const merged = (value.slice(0, i) + incoming).slice(0, length)
      commit(merged, merged.length)
      return
    }
    const arr = digits.slice()
    arr[i] = incoming
    const next = arr.join('').slice(0, length)
    // only keep a contiguous prefix so the code stays well-formed
    const firstGap = arr.findIndex((d) => d === '')
    commit(firstGap === -1 ? next : arr.slice(0, firstGap).join(''), i + 1)
  }

  const onKeyDown = (i: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace') {
      e.preventDefault()
      if (digits[i]) commit(value.slice(0, i), i)
      else if (i > 0) commit(value.slice(0, i - 1), i - 1)
    } else if (e.key === 'ArrowLeft' && i > 0) {
      e.preventDefault()
      inputs.current[i - 1]?.focus()
    } else if (e.key === 'ArrowRight' && i < length - 1) {
      e.preventDefault()
      inputs.current[Math.min(i + 1, value.length)]?.focus()
    }
  }

  return (
    <motion.div animate={controls} className="flex justify-between gap-2 sm:gap-3" role="group" aria-label="One-time code">
      {digits.map((d, i) => {
        const active = i === Math.min(value.length, length - 1) && !disabled
        return (
          <div key={i} className="relative">
            <input
              ref={(el) => {
                inputs.current[i] = el
              }}
              value={d}
              onChange={(e) => setAt(i, e.target.value)}
              onKeyDown={(e) => onKeyDown(i, e)}
              onPaste={(e) => {
                e.preventDefault()
                const text = e.clipboardData.getData('text').replace(/\D/g, '')
                if (text) commit(text, text.length)
              }}
              onFocus={(e) => {
                // never let focus land beyond the first empty box
                if (i > lenRef.current) inputs.current[lenRef.current]?.focus()
                else e.currentTarget.select()
              }}
              inputMode="numeric"
              autoComplete={i === 0 ? 'one-time-code' : 'off'}
              pattern="[0-9]*"
              maxLength={length}
              disabled={disabled}
              aria-label={`Digit ${i + 1} of ${length}`}
              aria-invalid={invalid || undefined}
              className={cn(
                'h-14 w-11 rounded-2xl bg-white/5 text-center font-display text-2xl text-transparent caret-transparent ring-1 transition-[box-shadow,background] outline-none sm:h-16 sm:w-13',
                invalid ? 'ring-2 ring-flare/80' : d ? 'bg-volt/8 ring-volt/60' : 'ring-white/10',
                active && !invalid && 'bg-white/8 ring-2 ring-volt shadow-[0_0_24px_-4px_color-mix(in_srgb,_var(--color-volt)_60%,_transparent)]',
                'focus-visible:outline-none',
              )}
            />
            {/* animated glyph layer (the real input text is transparent) */}
            <span aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center font-display text-2xl">
              {d ? (
                <motion.span key={d + i} initial={{ y: 12, scale: 0.6, opacity: 0 }} animate={{ y: 0, scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 500, damping: 22 }} className={invalid ? 'text-flare' : 'text-fg'}>
                  {d}
                </motion.span>
              ) : active ? (
                <span className="h-6 w-0.5 animate-blink rounded bg-volt" />
              ) : null}
            </span>
          </div>
        )
      })}
    </motion.div>
  )
}
