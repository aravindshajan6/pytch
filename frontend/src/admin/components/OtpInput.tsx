import { useEffect, useRef } from 'react'
import { cn } from '@/lib/cn'

/**
 * Six-box TOTP input: auto-advance, backspace to previous, arrow keys, and paste of a full code
 * (spaces/dashes stripped). Calls `onComplete` once all digits are filled.
 */
export function OtpInput({
  value,
  onChange,
  onComplete,
  length = 6,
  disabled,
  autoFocus = true,
  invalid,
  label = 'Authentication code',
}: {
  value: string
  onChange: (v: string) => void
  onComplete?: (code: string) => void
  length?: number
  disabled?: boolean
  autoFocus?: boolean
  invalid?: boolean
  label?: string
}) {
  const refs = useRef<(HTMLInputElement | null)[]>([])
  const digits = Array.from({ length }, (_, i) => value[i] ?? '')

  useEffect(() => {
    if (autoFocus && !disabled) refs.current[Math.min(value.length, length - 1)]?.focus()
    // focus only on mount / when re-enabled
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFocus, disabled])

  const commit = (next: string) => {
    const clean = next.replace(/\D/g, '').slice(0, length)
    onChange(clean)
    if (clean.length === length) onComplete?.(clean)
    return clean
  }

  const setAt = (i: number, ch: string) => {
    const arr = digits.slice()
    arr[i] = ch
    // collapse to a contiguous string (no holes)
    const next = arr.join('')
    return commit(next)
  }

  return (
    <div className={cn('flex justify-center gap-2 sm:gap-2.5', invalid && 'animate-shake')} role="group" aria-label={label}>
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el
          }}
          value={d}
          disabled={disabled}
          inputMode="numeric"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          pattern="[0-9]*"
          maxLength={length}
          aria-label={`${label} digit ${i + 1}`}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => {
            const raw = e.target.value.replace(/\D/g, '')
            if (!raw) return
            if (raw.length > 1) {
              // typed over a selection or browser autofill of the whole code
              const merged = commit(value.slice(0, i) + raw)
              refs.current[Math.min(merged.length, length - 1)]?.focus()
              return
            }
            const next = setAt(i, raw)
            if (i < length - 1 && next.length > i) refs.current[i + 1]?.focus()
          }}
          onKeyDown={(e) => {
            if (e.key === 'Backspace') {
              e.preventDefault()
              if (digits[i]) {
                commit(value.slice(0, i) + value.slice(i + 1))
              } else if (i > 0) {
                commit(value.slice(0, i - 1) + value.slice(i))
                refs.current[i - 1]?.focus()
              }
            } else if (e.key === 'ArrowLeft' && i > 0) refs.current[i - 1]?.focus()
            else if (e.key === 'ArrowRight' && i < length - 1) refs.current[i + 1]?.focus()
          }}
          onPaste={(e) => {
            e.preventDefault()
            const merged = commit(e.clipboardData.getData('text'))
            refs.current[Math.min(merged.length, length - 1)]?.focus()
          }}
          className={cn(
            'h-13 w-11 rounded-xl bg-white/5 text-center font-mono text-2xl font-semibold text-fg ring-1 ring-white/12 transition outline-none focus:bg-white/8 focus:ring-2 focus:ring-volt sm:h-14 sm:w-12',
            d && 'ring-volt/40',
            invalid && 'ring-flare/70',
          )}
        />
      ))}
    </div>
  )
}
