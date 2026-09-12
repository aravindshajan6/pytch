import { Loader2, Tag } from 'lucide-react'
import { useState } from 'react'
import { errorMessage, isApiError } from '@/lib/api/client'
import { api } from '@/lib/api/endpoints'
import { pop } from '@/lib/celebrate'
import { cn } from '@/lib/cn'
import { formatINR } from '@/lib/format'
import type { CouponValidation } from '@/types/api'

/** Optional promo-code entry: collapsed link → input → server-side preview of the discount. */
export function PromoCode({
  lobbyId,
  applied,
  onChange,
  disabled,
  oneSeatOf,
}: {
  lobbyId: string
  applied: CouponValidation | null
  onChange: (c: CouponValidation | null) => void
  disabled?: boolean
  /** set when the payment covers several seats (full-mode host): codes only ever discount one seat — say so */
  oneSeatOf?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [code, setCode] = useState('')
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const apply = async () => {
    const c = code.trim().toUpperCase()
    if (!c) return
    setChecking(true)
    setError(null)
    try {
      const v = await api.coupons.validate(c, lobbyId)
      if (v.valid) {
        onChange(v)
        pop(0.5, 0.55)
      } else setError(v.message || 'This code can’t be used here.')
    } catch (e) {
      setError(isApiError(e, 'COUPON_EXHAUSTED') ? 'This code has been fully used up.' : errorMessage(e))
    } finally {
      setChecking(false)
    }
  }

  if (applied?.valid) {
    return (
      <div className="mt-3 flex items-center justify-between gap-3 rounded-xl bg-volt/10 px-3 py-2 ring-1 ring-volt/35">
        <span className="flex min-w-0 items-center gap-2 text-sm">
          <Tag className="h-4 w-4 shrink-0 text-volt" />
          <span className="min-w-0">
            <span className="font-mono font-semibold tracking-wider">{applied.code}</span>
            <span className="block truncate text-xs text-muted">
              {oneSeatOf
                ? `${formatINR(applied.discount_paise)} off (1 seat) — codes discount your own seat, not the whole booking`
                : applied.message || `You save ${formatINR(applied.discount_paise)}`}
            </span>
          </span>
        </span>
        <button
          type="button"
          onClick={() => {
            onChange(null)
            setCode('')
          }}
          disabled={disabled}
          className="shrink-0 cursor-pointer rounded-lg px-2 py-1 text-xs font-semibold text-muted hover:bg-white/8 hover:text-fg"
        >
          Remove
        </button>
      </div>
    )
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-3 inline-flex cursor-pointer items-center gap-1.5 text-sm font-medium text-volt hover:underline"
      >
        <Tag className="h-3.5 w-3.5" /> Have a promo code?
      </button>
    )
  }

  return (
    <div className="mt-3">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          e.stopPropagation()
          apply()
        }}
      >
        <input
          autoFocus
          value={code}
          onChange={(e) => {
            setCode(e.target.value.toUpperCase().replace(/\s/g, '').slice(0, 24))
            setError(null)
          }}
          placeholder="PROMO CODE"
          aria-label="Promo code"
          aria-invalid={!!error}
          autoComplete="off"
          className={cn(
            'h-10 min-w-0 flex-1 rounded-xl bg-white/5 px-3 font-mono text-sm tracking-wider text-fg uppercase ring-1 outline-none placeholder:text-subtle focus:ring-2',
            error ? 'ring-flare/60 focus:ring-flare' : 'ring-white/10 focus:ring-volt/70',
          )}
        />
        <button
          type="submit"
          disabled={!code.trim() || checking}
          className="flex h-10 shrink-0 cursor-pointer items-center gap-1.5 rounded-xl bg-white/8 px-4 text-sm font-semibold ring-1 ring-white/12 transition hover:bg-white/12 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {checking && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Apply
        </button>
      </form>
      {error && (
        <p role="alert" className="mt-1.5 text-xs text-flare">
          {error}
        </p>
      )}
    </div>
  )
}

export function Row({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className={cn('flex items-center justify-between text-sm', className)}>
      <span className="text-muted">{label}</span>
      <span className="font-semibold">{value}</span>
    </div>
  )
}
