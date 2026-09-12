import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, CreditCard, Landmark, ShieldCheck, Smartphone, Wallet, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useCallback, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import { Switch } from '@/components/ui/Form'
import { Sheet } from '@/components/ui/Sheet'
import { useMe } from '@/hooks/useMe'
import { errorMessage, isApiError } from '@/lib/api/client'
import { api } from '@/lib/api/endpoints'
import { qk } from '@/lib/api/queryKeys'
import { pop } from '@/lib/celebrate'
import { cn } from '@/lib/cn'
import { formatINR } from '@/lib/format'
import { cssVar } from '@/stores/theme'
import type { CouponValidation, PaymentIntent } from '@/types/api'
import { PromoCode, Row } from './PaymentParts'

export interface PayRequestConfig {
  title: string
  subtitle?: string
  amountPaise: number
  /** What `amountPaise` is, e.g. "Remaining seats" (default "Your share"). */
  amountLabel?: string
  /**
   * Called after the user reviews; must create the intent server-side. `useCredits` is the user's
   * toggle as-is — the server decides how much of the balance applies.
   */
  createIntent: (useCredits: boolean, couponCode?: string | null) => Promise<PaymentIntent>
  /**
   * Lobby being paid for. Lets the sheet count credits still held by an abandoned checkout for this
   * seat (the next attempt supersedes it and gets them back), and enables the promo-code field.
   */
  lobbyId?: string
  /** Offer the promo-code field (needs `lobbyId`; default true). Coupons only discount your own seat. */
  promo?: boolean
  /** The payment covers more than your own seat (full-mode host pays the whole booking) → label promo savings as "1 seat". */
  multiSeat?: boolean
  onSuccess?: (intent: PaymentIntent) => void
}

type Step = 'review' | 'method' | 'processing' | 'success' | 'failed'

const METHODS = [
  { id: 'upi', label: 'UPI', hint: 'GPay · PhonePe · Paytm', icon: Smartphone },
  { id: 'card', label: 'Card', hint: 'Visa · Mastercard · RuPay', icon: CreditCard },
  { id: 'netbanking', label: 'Netbanking', hint: 'All major banks', icon: Landmark },
] as const

declare global {
  interface Window {
    Razorpay?: new (opts: Record<string, unknown>) => { open: () => void; on: (e: string, cb: (r: unknown) => void) => void }
  }
}

function loadRazorpay(): Promise<boolean> {
  if (window.Razorpay) return Promise.resolve(true)
  return new Promise((resolve) => {
    const s = document.createElement('script')
    s.src = 'https://checkout.razorpay.com/v1/checkout.js'
    s.onload = () => resolve(true)
    s.onerror = () => resolve(false)
    document.body.appendChild(s)
  })
}

/**
 * Payment flow hook. Usage:
 *   const pay = usePayFlow()
 *   pay.start({ title, amountPaise, lobbyId, createIntent: (c) => api.lobbies.pay(id, c), onSuccess })
 *   return <>{...}{pay.sheet}</>
 * `pay.open` is true while the sheet is up (e.g. to hold back other overlays).
 */
export function usePayFlow() {
  const qc = useQueryClient()
  const { user } = useMe()
  const [config, setConfig] = useState<PayRequestConfig | null>(null)
  const [step, setStep] = useState<Step>('review')
  const [useCredits, setUseCredits] = useState(true)
  const [intent, setIntent] = useState<PaymentIntent | null>(null)
  const [method, setMethod] = useState<(typeof METHODS)[number]['id']>('upi')
  const [busy, setBusy] = useState(false)
  const [coupon, setCoupon] = useState<CouponValidation | null>(null)

  // Credits are debited when an intent is created. Closing the sheet cancels the intent (credits come
  // back), but a checkout abandoned elsewhere (Razorpay dismissed, tab closed, cancel failed) keeps them on
  // hold until the next attempt for this seat supersedes it — the server then returns and re-applies them.
  // So "available" here = balance + whatever is still held for this lobby.
  const lobbyId = config?.lobbyId
  const payments = useQuery({ queryKey: qk.payments, queryFn: api.payments.mine, enabled: !!lobbyId, staleTime: 0 })
  const held = useMemo(
    () =>
      (payments.data ?? [])
        .filter((p) => p.status === 'created' && p.lobby_id === lobbyId)
        .reduce((sum, p) => sum + p.credits_applied_paise, 0),
    [payments.data, lobbyId],
  )
  const balance = (user?.wallet_balance_paise ?? 0) + held

  /** Fresh balance + held credits (another tab / an earlier attempt may have moved money). */
  const refreshMoney = useCallback(() => {
    qc.invalidateQueries({ queryKey: qk.me })
    qc.invalidateQueries({ queryKey: qk.wallet })
    qc.invalidateQueries({ queryKey: qk.payments })
  }, [qc])

  const start = useCallback(
    (c: PayRequestConfig) => {
      setConfig(c)
      setIntent(null)
      setStep('review')
      setUseCredits(true)
      setCoupon(null)
      refreshMoney()
    },
    [refreshMoney],
  )

  const backToReview = useCallback(() => {
    setStep('review')
    refreshMoney()
  }, [refreshMoney])

  const close = useCallback(() => {
    if (step === 'processing') return
    // Walking away from an unpaid intent: cancel it so its credits / promo use come straight back (best
    // effort — if that fails, the next attempt for this seat, or the seat/lobby closing, returns them).
    const abandoned = intent && intent.status === 'created' && (step === 'method' || step === 'review')
    if (abandoned) {
      const heldPaise = intent.credits_applied_paise
      api.payments
        .cancel(intent.payment_id)
        .catch(() => {
          if (heldPaise > 0)
            toast(`${formatINR(heldPaise)} in credits is on hold for this checkout`, {
              description: "It's applied when you pay, or returned to your wallet automatically if you don't.",
            })
        })
        .finally(refreshMoney)
      setIntent(null)
    }
    setConfig(null)
  }, [step, intent, refreshMoney])

  const finish = useCallback(
    (i: PaymentIntent) => {
      setStep('success')
      pop(0.5, 0.6)
      qc.invalidateQueries({ queryKey: qk.me })
      qc.invalidateQueries({ queryKey: qk.wallet })
      qc.invalidateQueries({ queryKey: qk.payments })
      config?.onSuccess?.(i)
      setTimeout(() => setConfig(null), 1400)
    },
    [qc, config],
  )

  const createAndRoute = async () => {
    if (!config) return
    setBusy(true)
    try {
      // always the user's choice: with credits held by an earlier attempt, the visible balance can be 0
      // while the server still has credits to apply (it releases the old hold first)
      const i = await config.createIntent(useCredits, coupon?.valid ? coupon.code : null)
      setIntent(i)
      if (i.status === 'paid') return finish(i)
      if (i.provider === 'razorpay' && i.razorpay) return openRazorpay(i)
      setStep('method')
    } catch (e) {
      if (coupon && (isApiError(e, 'COUPON_INVALID') || isApiError(e, 'COUPON_EXHAUSTED'))) {
        // the code stopped working between preview and pay (limit hit, expired…) — drop it, keep the sheet open
        setCoupon(null)
        toast.error('Promo code no longer applies', { description: errorMessage(e) })
      } else toast.error(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const openRazorpay = async (i: PaymentIntent) => {
    const ok = await loadRazorpay()
    if (!ok || !window.Razorpay || !i.razorpay) return toast.error('Could not load Razorpay checkout')
    const o = i.razorpay
    const rzp = new window.Razorpay({
      key: o.key_id,
      order_id: o.order_id,
      amount: o.amount,
      currency: o.currency,
      name: o.name,
      description: o.description,
      prefill: o.prefill,
      // Razorpay renders in its own iframe — it needs a concrete colour, not a CSS var.
      theme: { color: cssVar('--color-volt') || '#c8ff2e' },
      handler: async (resp: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) => {
        setStep('processing')
        try {
          await api.payments.verify(i.payment_id, resp)
          finish(i)
        } catch (e) {
          toast.error(errorMessage(e))
          setStep('failed')
        }
      },
      modal: { ondismiss: backToReview },
    })
    rzp.open()
  }

  const payMock = async (outcome: 'success' | 'failure') => {
    if (!intent) return
    setStep('processing')
    await new Promise((r) => setTimeout(r, 1300))
    try {
      const p = await api.payments.mockComplete(intent.payment_id, outcome)
      if (p.status === 'paid') finish(intent)
      else setStep('failed')
    } catch (e) {
      toast.error(errorMessage(e))
      setStep('failed')
    }
  }

  const discount = coupon?.valid ? Math.min(coupon.discount_paise, config?.amountPaise ?? 0) : 0
  const afterDiscount = config ? config.amountPaise - discount : 0
  const credits = config ? Math.min(balance, afterDiscount) : 0
  const payable = config ? afterDiscount - (useCredits ? credits : 0) : 0

  const sheet = (
    <Sheet open={!!config} onClose={close} dismissible={step !== 'processing'} size="sm">
      {config && (
        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.22 }}
          >
            {step === 'review' && (
              <div>
                <div className="text-xs font-semibold tracking-[0.2em] text-volt uppercase">Pytch Pay</div>
                <h3 className="mt-2 text-xl font-semibold">{config.title}</h3>
                {config.subtitle && <p className="mt-1 text-sm text-muted">{config.subtitle}</p>}
                <div className="mt-6 rounded-2xl bg-white/4 p-4 ring-1 ring-white/8">
                  <Row label={config.amountLabel ?? 'Your share'} value={formatINR(config.amountPaise)} />
                  {config.lobbyId && config.promo !== false && (
                    <PromoCode lobbyId={config.lobbyId} applied={coupon} onChange={setCoupon} disabled={busy} oneSeatOf={config.multiSeat} />
                  )}
                  {discount > 0 && (
                    <Row
                      label={`Promo ${coupon!.code}${config.multiSeat ? ' (1 seat)' : ''}`}
                      value={`−${formatINR(discount)}`}
                      className="mt-2 text-volt"
                    />
                  )}
                  {balance > 0 && credits > 0 && (
                    <div className="mt-3 flex items-center justify-between gap-3 border-t border-white/8 pt-3">
                      <div className="flex items-center gap-2 text-sm">
                        <Wallet className="h-4 w-4 text-mint" />
                        Use credits <span className="text-muted">({formatINR(balance)} available)</span>
                      </div>
                      <Switch checked={useCredits} onChange={setUseCredits} label="Use credits" />
                    </div>
                  )}
                  {useCredits && credits > 0 && <Row label="Credits applied" value={`−${formatINR(credits)}`} className="text-mint" />}
                  <div className="mt-3 flex items-baseline justify-between border-t border-white/8 pt-3">
                    <span className="text-sm text-muted">To pay</span>
                    <span className="font-display text-3xl font-bold">{formatINR(payable)}</span>
                  </div>
                </div>
                <Button block size="lg" className="mt-6" loading={busy} onClick={createAndRoute}>
                  {payable === 0 ? (useCredits && credits > 0 ? 'Pay with credits' : 'Confirm · nothing to pay') : `Continue · ${formatINR(payable)}`}
                </Button>
                <p className="mt-3 flex items-center justify-center gap-1.5 text-xs text-subtle">
                  <ShieldCheck className="h-3.5 w-3.5" /> Refunds land instantly as Pytch Credits
                </p>
              </div>
            )}

            {step === 'method' && intent && (
              <div>
                <h3 className="text-xl font-semibold">Choose a method</h3>
                <p className="mt-1 text-sm text-muted">Demo checkout — no real money moves.</p>
                <div className="mt-5 space-y-2">
                  {METHODS.map((m) => (
                    <button
                      key={m.id}
                      onClick={() => setMethod(m.id)}
                      className={cn(
                        'flex w-full cursor-pointer items-center gap-3 rounded-2xl p-4 text-left ring-1 transition',
                        method === m.id ? 'bg-volt/10 ring-volt/60' : 'bg-white/4 ring-white/8 hover:bg-white/8',
                      )}
                    >
                      <m.icon className={cn('h-5 w-5', method === m.id ? 'text-volt' : 'text-muted')} />
                      <div className="flex-1">
                        <div className="font-semibold">{m.label}</div>
                        <div className="text-xs text-muted">{m.hint}</div>
                      </div>
                      <span className={cn('h-4 w-4 rounded-full ring-2', method === m.id ? 'bg-volt ring-volt' : 'ring-white/25')} />
                    </button>
                  ))}
                </div>
                <Button block size="lg" className="mt-6" onClick={() => payMock('success')}>
                  Pay {formatINR(intent.payable_paise)}
                </Button>
                <button onClick={() => payMock('failure')} className="mt-3 w-full cursor-pointer text-center text-xs text-subtle hover:text-flare">
                  Simulate a failed payment
                </button>
              </div>
            )}

            {step === 'processing' && (
              <div className="flex flex-col items-center py-10 text-center">
                <motion.div
                  className="h-16 w-16 rounded-full border-4 border-volt/15 border-t-volt"
                  animate={{ rotate: 360 }}
                  transition={{ repeat: Infinity, duration: 0.8, ease: 'linear' }}
                />
                <p className="mt-6 font-semibold">Confirming with your bank…</p>
                <p className="mt-1 text-sm text-muted">Don't close this window</p>
              </div>
            )}

            {step === 'success' && (
              <div className="flex flex-col items-center py-8 text-center">
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: 'spring', stiffness: 400, damping: 15 }}
                  className="flex h-20 w-20 items-center justify-center rounded-full bg-volt shadow-glow-volt"
                >
                  <Check className="h-10 w-10 text-ink-950" strokeWidth={3} />
                </motion.div>
                <p className="mt-6 font-display text-xl font-semibold">Paid!</p>
                <p className="mt-1 text-sm text-muted">Your seat is locked in.</p>
              </div>
            )}

            {step === 'failed' && (
              <div className="flex flex-col items-center py-8 text-center">
                <div className="flex h-20 w-20 items-center justify-center rounded-full bg-flare/20 ring-1 ring-flare/50">
                  <X className="h-10 w-10 text-flare" strokeWidth={3} />
                </div>
                <p className="mt-6 font-display text-xl font-semibold">Payment failed</p>
                <p className="mt-1 text-sm text-muted">Nothing was charged. Try again?</p>
                <Button className="mt-6" onClick={backToReview}>
                  Try again
                </Button>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      )}
    </Sheet>
  )

  return { start, sheet, close, open: !!config }
}
