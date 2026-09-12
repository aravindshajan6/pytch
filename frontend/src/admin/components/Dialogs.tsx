import { AlertTriangle, Clock, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Sheet } from '@/components/ui/Sheet'
import { errorMessage, isApiError } from '@/lib/api/http'
import { cn } from '@/lib/cn'
import { adminApi } from '../lib/api'
import { formatClock, IDLE_LOGOUT_MS, useIdleCountdown } from '../lib/idle'
import { logout } from '../lib/http'
import { cancelStepUp, stepUpSucceeded, useStepUp } from '../lib/stepup'
import { OtpInput } from './OtpInput'
import { Field, TextArea } from './ui'

/**
 * Confirmation for destructive / sensitive actions. When `reason` is set, a typed reason
 * (min length) is required and passed to `onConfirm` — it ends up in the audit log.
 */
export function ConfirmDialog({
  open,
  onClose,
  title,
  description,
  confirmLabel = 'Confirm',
  tone = 'danger',
  reason,
  reasonLabel = 'Reason (recorded in the audit log)',
  reasonMin = 5,
  onConfirm,
  loading,
  children,
  confirmDisabled,
}: {
  open: boolean
  onClose: () => void
  title: React.ReactNode
  description?: React.ReactNode
  confirmLabel?: string
  tone?: 'danger' | 'primary'
  reason?: boolean
  reasonLabel?: string
  reasonMin?: number
  onConfirm: (reason: string) => void
  loading?: boolean
  children?: React.ReactNode
  confirmDisabled?: boolean
}) {
  const [text, setText] = useState('')
  const valid = !reason || text.trim().length >= reasonMin
  const close = () => {
    if (loading) return
    setText('')
    onClose()
  }
  return (
    <Sheet open={open} onClose={close} title={title} description={description} size="md">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (valid && !confirmDisabled) onConfirm(text.trim())
        }}
        className="space-y-4"
      >
        {children}
        {reason && (
          <Field label={reasonLabel} hint={`At least ${reasonMin} characters.`} required>
            <TextArea value={text} onChange={(e) => setText(e.target.value)} maxLength={300} autoFocus placeholder="Why is this needed?" />
          </Field>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" size="sm" onClick={close} disabled={loading}>
            Cancel
          </Button>
          <Button type="submit" variant={tone === 'danger' ? 'danger' : 'primary'} size="sm" loading={loading} disabled={!valid || confirmDisabled}>
            {confirmLabel}
          </Button>
        </div>
      </form>
    </Sheet>
  )
}

/** Global TOTP re-authentication prompt, driven by lib/stepup. */
export function StepUpModal() {
  const open = useStepUp((s) => s.open)
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [shake, setShake] = useState(0)

  const submit = async (c: string) => {
    if (busy || c.length !== 6) return
    setBusy(true)
    setError(null)
    try {
      const res = await adminApi.auth.stepUp(c)
      setCode('')
      stepUpSucceeded(res?.valid_until ?? null)
    } catch (e) {
      setError(isApiError(e, 'INVALID_MFA_CODE') ? 'That code didn’t work — wait for the next one and try again.' : errorMessage(e))
      setCode('')
      setShake((n) => n + 1)
    } finally {
      setBusy(false)
    }
  }

  const cancel = () => {
    setCode('')
    setError(null)
    cancelStepUp()
  }

  return (
    <Sheet open={open} onClose={cancel} size="sm" title={null}>
      <div className="text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-volt/12 text-volt ring-1 ring-volt/30">
          <ShieldCheck className="h-6 w-6" />
        </div>
        <h3 className="text-lg font-semibold">Confirm it’s you</h3>
        <p className="mx-auto mt-1 max-w-xs text-sm text-muted">
          This action needs a fresh code from your authenticator app. You won’t be asked again for 5 minutes.
        </p>
        <form
          className="mt-6"
          onSubmit={(e) => {
            e.preventDefault()
            void submit(code)
          }}
        >
          <OtpInput key={shake} value={code} onChange={setCode} onComplete={submit} disabled={busy} invalid={!!error} />
          <p className={cn('mt-3 min-h-5 text-xs', error ? 'text-flare' : 'text-subtle')} role={error ? 'alert' : undefined}>
            {error ?? 'Your original request continues automatically.'}
          </p>
          <div className="mt-4 flex justify-center gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={cancel} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" size="sm" loading={busy} disabled={code.length !== 6}>
              Verify
            </Button>
          </div>
        </form>
      </div>
    </Sheet>
  )
}

export function IdleWarning({ open, onStay }: { open: boolean; onStay: () => void }) {
  const ms = useIdleCountdown(open)
  return (
    <Sheet open={open} onClose={onStay} size="sm" title={null} dismissible={false}>
      <div className="text-center" aria-live="assertive">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-sun/15 text-sun ring-1 ring-sun/35">
          <Clock className="h-6 w-6" />
        </div>
        <h3 className="text-lg font-semibold">Still there?</h3>
        <p className="mt-1 text-sm text-muted">For security you’ll be signed out after {IDLE_LOGOUT_MS / 60000} minutes of inactivity.</p>
        <div className="num mt-4 text-4xl font-semibold text-fg">{formatClock(ms)}</div>
        <div className="mt-6 flex justify-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => void logout()}>
            Sign out now
          </Button>
          <Button size="sm" onClick={onStay} autoFocus>
            Stay signed in
          </Button>
        </div>
      </div>
    </Sheet>
  )
}

export function Callout({
  tone = 'sun',
  title,
  children,
  icon,
  className,
}: {
  tone?: 'sun' | 'flare' | 'electric' | 'mint'
  title?: React.ReactNode
  children?: React.ReactNode
  icon?: React.ReactNode
  className?: string
}) {
  const cls = {
    sun: 'bg-sun/10 ring-sun/30 text-sun',
    flare: 'bg-flare/10 ring-flare/30 text-flare',
    electric: 'bg-electric/10 ring-electric/30 text-electric',
    mint: 'bg-mint/10 ring-mint/30 text-mint',
  }[tone]
  return (
    <div className={cn('flex gap-3 rounded-xl p-3 ring-1', cls, className)}>
      <span className="mt-0.5 shrink-0">{icon ?? <AlertTriangle className="h-4 w-4" />}</span>
      <div className="min-w-0 text-sm">
        {title && <div className="font-semibold">{title}</div>}
        {children && <div className="text-fg/80">{children}</div>}
      </div>
    </div>
  )
}
