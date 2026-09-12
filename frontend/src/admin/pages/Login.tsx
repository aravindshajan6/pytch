import { ArrowLeft, Download, KeyRound, Lock, LogIn, ShieldAlert, ShieldCheck, Smartphone } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { QRCodeSVG } from 'qrcode.react'
import { useEffect, useRef, useState } from 'react'
import { LogoMark } from '@/components/layout/Logo'
import { Button } from '@/components/ui/Button'
import { ThemeToggle } from '@/components/ui/ThemeToggle'
import { errorMessage, isApiError } from '@/lib/api/http'
import { cn } from '@/lib/cn'
import type { AdminAuth, AdminLoginResponse, MfaEnrollStart } from '@/types/admin'
import { Callout } from '../components/Dialogs'
import { OtpInput } from '../components/OtpInput'
import { NewPasswordFields, PasswordInput } from '../components/PasswordFields'
import { Checkbox, CopyButton, Field, TextInput } from '../components/ui'
import { adminApi } from '../lib/api'
import { postChannel } from '../lib/channel'
import { retryAfterSeconds } from '../lib/errors'
import { useNow } from '../lib/hooks'
import { logout } from '../lib/http'
import { newPasswordValid } from '../lib/password'
import { applyAuth, completeSignIn, setMe, useSession } from '../lib/session'

type Step =
  | { k: 'credentials' }
  | { k: 'password'; authed: boolean; error?: string }
  | { k: 'enroll' }
  | { k: 'verify' }
  | { k: 'recovery'; codes: string[] }
  | { k: 'blocked' }

const STEP_META: Record<Step['k'], { title: string; sub: string }> = {
  credentials: { title: 'Sign in to the console', sub: 'Pytch staff only. Every action is recorded in a tamper-evident audit log.' },
  password: { title: 'Set a new password', sub: 'Your account requires a new password before you continue.' },
  enroll: { title: 'Set up two-factor authentication', sub: 'Required for every admin. Scan the code with your authenticator app.' },
  verify: { title: 'Two-factor verification', sub: 'Enter the 6-digit code from your authenticator app.' },
  recovery: { title: 'Save your recovery codes', sub: 'Each code works once if you lose your authenticator. They won’t be shown again.' },
  blocked: { title: 'Network not allowed', sub: '' },
}

function useLockout() {
  const [until, setUntil] = useState<number | null>(null)
  const now = useNow(1000, !!until)
  const left = until ? Math.max(0, Math.ceil((until - now) / 1000)) : 0
  return { left, lock: (secs: number | null) => setUntil(secs ? Date.now() + secs * 1000 : null) }
}

const mmss = (s: number) => (s >= 60 ? `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s` : `${s}s`)

export default function Login() {
  const status = useSession((s) => s.status)
  const me = useSession((s) => s.me)
  const notice = useSession((s) => s.notice)
  const demo = useSession((s) => s.demo)

  // A restored-but-incomplete session (forced password change) resumes on the password step.
  const [step, setStep] = useState<Step>(() =>
    status === 'pending' && me?.must_change_password && me.mfa_enrolled ? { k: 'password', authed: true } : { k: 'credentials' },
  )
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const { left, lock } = useLockout()

  // sensitive values for the multi-step flow live in refs (never rendered, dropped on unmount)
  const login = useRef<AdminLoginResponse | null>(null)
  const currentPw = useRef<string>('')
  const pendingNewPw = useRef<string | null>(null)
  // auth issued at enrollment, held until the operator acknowledges the recovery codes
  const recoveryAuth = useRef<AdminAuth | null>(null)

  useEffect(
    () => () => {
      login.current = null
      currentPw.current = ''
      pendingNewPw.current = null
      recoveryAuth.current = null
    },
    [],
  )

  // pending session that can't be completed here (e.g. MFA reset) → start over cleanly
  useEffect(() => {
    if (status === 'pending' && me && !me.mfa_enrolled && !login.current) void logout('Please sign in again to set up two-factor authentication.')
  }, [status, me])

  const restart = (msg?: string) => {
    login.current = null
    pendingNewPw.current = null
    setPassword('')
    setError(msg ?? null)
    setStep({ k: 'credentials' })
  }

  const handleAuthError = (e: unknown) => {
    if (isApiError(e, 'IP_NOT_ALLOWED')) return setStep({ k: 'blocked' })
    if (isApiError(e, 'ACCOUNT_LOCKED')) {
      const s = retryAfterSeconds(e) ?? 15 * 60
      lock(s)
      return setError('Too many failed attempts — this account is temporarily locked.')
    }
    if (isApiError(e, 'RATE_LIMITED')) {
      lock(retryAfterSeconds(e) ?? 60)
      return setError('Too many attempts from this network. Please wait before trying again.')
    }
    setError(errorMessage(e))
  }

  const goMfa = () => setStep(login.current?.mfa_enrolled ? { k: 'verify' } : { k: 'enroll' })

  /** Token issued: finish outstanding steps (password change), then open the console. */
  const finish = async (auth: AdminAuth) => {
    if (pendingNewPw.current) {
      try {
        await adminApi.auth.changePassword(currentPw.current, pendingNewPw.current)
        pendingNewPw.current = null
        currentPw.current = ''
        const fresh = await adminApi.auth.me().catch(() => ({ ...auth.admin, must_change_password: false }))
        setMe(fresh)
      } catch (e) {
        pendingNewPw.current = null
        setStep({ k: 'password', authed: true, error: errorMessage(e) })
        return
      }
    } else if (auth.admin.must_change_password) {
      setStep({ k: 'password', authed: true })
      return
    }
    login.current = null
    recoveryAuth.current = null
    completeSignIn()
    postChannel({ type: 'login' })
  }

  // ───────── step: credentials ─────────
  const submitCredentials = async (e: React.FormEvent) => {
    e.preventDefault()
    if (busy || left > 0) return
    setBusy(true)
    setError(null)
    try {
      const res = await adminApi.auth.login(email.trim().toLowerCase(), password)
      login.current = res
      currentPw.current = password
      setPassword('')
      if (res.must_change_password) setStep({ k: 'password', authed: false })
      else goMfa()
    } catch (err) {
      if (isApiError(err, 'INVALID_CREDENTIALS')) setError('Email or password is incorrect.')
      else handleAuthError(err)
    } finally {
      setBusy(false)
    }
  }

  const meta = STEP_META[step.k]

  return (
    <div className="relative grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
      {/* brand panel (always dark) */}
      <div data-theme="dark" className="relative hidden overflow-hidden bg-night lg:block">
        <div aria-hidden className="absolute inset-0 pitch-grid opacity-70" />
        <div aria-hidden className="absolute -top-40 -left-40 h-[520px] w-[520px] rounded-full bg-volt/10 blur-3xl" />
        <div aria-hidden className="absolute right-[-120px] bottom-[-160px] h-[440px] w-[440px] rounded-full bg-electric/10 blur-3xl" />
        <div className="relative flex h-full flex-col justify-between p-12 xl:p-16">
          <div className="flex items-center gap-3">
            <LogoMark className="h-10 w-10" />
            <span className="font-display text-2xl font-bold tracking-tight text-fg">
              PYT<span className="text-volt">C</span>H
            </span>
            <span className="rounded-md bg-white/8 px-2 py-0.5 text-[10px] font-semibold tracking-[0.16em] text-muted uppercase ring-1 ring-white/10">
              Console
            </span>
          </div>
          <div>
            <h1 className="max-w-xl text-4xl leading-[1.1] font-bold text-fg xl:text-5xl">
              Run the pitch.
              <br />
              <span className="text-gradient-volt">Guard the game.</span>
            </h1>
            <ul className="mt-10 space-y-4 text-sm text-muted">
              {[
                [ShieldCheck, 'Mandatory two-factor on every account, step-up for sensitive actions'],
                [KeyRound, 'Session held in memory only · auto-lock after 15 idle minutes'],
                [Lock, 'Maker–checker approvals and a hash-chained audit trail'],
              ].map(([Icon, text], i) => {
                const I = Icon as typeof ShieldCheck
                return (
                  <li key={i} className="flex items-center gap-3">
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/5 ring-1 ring-white/10">
                      <I className="h-4 w-4 text-volt" />
                    </span>
                    {text as string}
                  </li>
                )
              })}
            </ul>
          </div>
          <p className="text-xs text-subtle">Authorised personnel only. Access from unapproved networks is blocked.</p>
        </div>
      </div>

      {/* form */}
      <div className="relative flex min-h-dvh flex-col px-5 py-6 sm:px-10">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5 lg:invisible">
            <LogoMark className="h-8 w-8" />
            <span className="font-display text-lg font-bold">
              PYT<span className="text-volt">C</span>H <span className="text-xs font-medium text-muted">Admin</span>
            </span>
          </div>
          <div className="flex items-center gap-2">
            {demo && (
              <span className="rounded-lg bg-sun/12 px-2 py-1 text-[11px] font-bold tracking-[0.14em] text-sun uppercase ring-1 ring-sun/35">Demo</span>
            )}
            <ThemeToggle />
          </div>
        </div>

        <div className="flex flex-1 items-center justify-center py-10">
          <div className="w-full max-w-[420px]">
            <AnimatePresence mode="wait">
              <motion.div
                key={step.k}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
              >
                {step.k !== 'blocked' && (
                  <div className="mb-7">
                    <StepDots step={step.k} enrolled={!!login.current?.mfa_enrolled} mustChange={!!login.current?.must_change_password} />
                    <h2 className="mt-4 text-2xl font-bold">{meta.title}</h2>
                    <p className="mt-1.5 text-sm text-muted">{meta.sub}</p>
                  </div>
                )}

                {notice && step.k === 'credentials' && !error && (
                  <Callout tone="electric" className="mb-5">
                    {notice}
                  </Callout>
                )}

                {step.k === 'credentials' && (
                  <form onSubmit={submitCredentials} className="space-y-4" noValidate>
                    <Field label="Work email" htmlFor="email">
                      <TextInput
                        id="email"
                        type="email"
                        autoComplete="username"
                        inputMode="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        autoFocus
                        required
                        className="h-11"
                        spellCheck={false}
                        autoCapitalize="off"
                      />
                    </Field>
                    <Field label="Password" htmlFor="password">
                      <PasswordInput
                        id="password"
                        autoComplete="current-password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                        className="h-11"
                      />
                    </Field>
                    {error && (
                      <Callout tone="flare" className="animate-shake">
                        {error}
                        {left > 0 && (
                          <span className="mt-1 block font-medium text-fg">
                            Try again in <span className="num">{mmss(left)}</span>
                          </span>
                        )}
                      </Callout>
                    )}
                    <Button type="submit" block loading={busy} disabled={!email || !password || left > 0} className="h-11">
                      <LogIn className="h-4 w-4" /> Continue
                    </Button>
                    <p className="text-center text-xs text-subtle">Forgot your password? A super admin can issue you a temporary one (Admin team → Reset password).</p>
                  </form>
                )}

                {step.k === 'password' && (
                  <PasswordStep
                    authed={step.authed}
                    initialError={step.error}
                    email={login.current ? email : (me?.email ?? '')}
                    name={me?.name}
                    knownCurrent={step.authed ? undefined : currentPw.current}
                    onCollected={(pw) => {
                      pendingNewPw.current = pw
                      goMfa()
                    }}
                    onDone={() => {
                      completeSignIn()
                      postChannel({ type: 'login' })
                    }}
                    onCancel={() => (step.authed ? void logout() : restart())}
                  />
                )}

                {step.k === 'enroll' && login.current && (
                  <EnrollStep
                    mfaToken={login.current.mfa_token}
                    onEnrolled={(auth) => {
                      applyAuth(auth, false)
                      setStep({ k: 'recovery', codes: auth.recovery_codes ?? [] })
                      recoveryAuth.current = auth
                    }}
                    onExpired={(msg) => restart(msg ?? 'That sign-in attempt expired — please start again.')}
                    onError={handleAuthError}
                  />
                )}

                {step.k === 'verify' && login.current && (
                  <VerifyStep
                    mfaToken={login.current.mfa_token}
                    onVerified={(auth) => {
                      applyAuth(auth, false)
                      void finish(auth)
                    }}
                    onExpired={(msg) => restart(msg ?? 'That sign-in attempt expired — please start again.')}
                    onError={handleAuthError}
                    onBack={() => restart()}
                  />
                )}

                {step.k === 'recovery' && (
                  <RecoveryStep
                    codes={step.codes}
                    email={email}
                    onDone={() => recoveryAuth.current && void finish(recoveryAuth.current)}
                  />
                )}

                {step.k === 'blocked' && (
                  <div className="text-center">
                    <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-flare/12 text-flare ring-1 ring-flare/30">
                      <ShieldAlert className="h-7 w-7" />
                    </div>
                    <h2 className="text-2xl font-bold">Network not allowed</h2>
                    <p className="mx-auto mt-2 max-w-sm text-sm text-muted">
                      The admin console only accepts connections from approved networks. Connect through the office network or VPN and try again.
                    </p>
                    <Button variant="secondary" className="mt-6" onClick={() => restart()}>
                      Try again
                    </Button>
                  </div>
                )}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
        <p className="text-center text-[11px] text-subtle">This system is monitored. Unauthorised access is prohibited.</p>
      </div>
    </div>
  )
}

function StepDots({ step, enrolled, mustChange }: { step: Step['k']; enrolled: boolean; mustChange: boolean }) {
  const steps: Step['k'][] = ['credentials', ...(mustChange ? (['password'] as const) : []), enrolled ? 'verify' : 'enroll', ...(!enrolled ? (['recovery'] as const) : [])]
  const idx = Math.max(0, steps.indexOf(step))
  if (steps.length <= 1 || step === 'credentials') return <div className="h-1" />
  return (
    <div className="flex gap-1.5" aria-label={`Step ${idx + 1} of ${steps.length}`}>
      {steps.map((s, i) => (
        <span key={s} className={cn('h-1 rounded-full transition-all', i <= idx ? 'w-8 bg-volt' : 'w-4 bg-white/12')} />
      ))}
    </div>
  )
}

function PasswordStep({
  authed,
  initialError,
  email,
  name,
  knownCurrent,
  onCollected,
  onDone,
  onCancel,
}: {
  authed: boolean
  initialError?: string
  email: string
  name?: string
  /** current password already typed at sign-in (flow mode) */
  knownCurrent?: string
  onCollected: (pw: string) => void
  onDone: () => void
  onCancel: () => void
}) {
  const [current, setCurrent] = useState('')
  const [pw, setPw] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(initialError ?? null)
  const [busy, setBusy] = useState(false)
  const cur = knownCurrent ?? current
  const valid = newPasswordValid(pw, confirm, { email, name, current: cur || undefined }) && (!!knownCurrent || current.length > 0)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!valid || busy) return
    setError(null)
    if (!authed) {
      onCollected(pw) // applied right after two-factor verification
      return
    }
    setBusy(true)
    try {
      await adminApi.auth.changePassword(cur, pw)
      const fresh = await adminApi.auth.me().catch(() => null)
      if (fresh) setMe(fresh)
      onDone()
    } catch (err) {
      setError(isApiError(err, 'STEP_UP_CANCELLED') ? 'Confirmation cancelled.' : errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {authed && !knownCurrent && (
        <Field label="Current password" htmlFor="current-password">
          <PasswordInput id="current-password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
        </Field>
      )}
      <NewPasswordFields value={pw} confirm={confirm} onChange={setPw} onConfirmChange={setConfirm} email={email} name={name} current={cur || undefined} />
      {error && <Callout tone="flare">{error}</Callout>}
      <div className="flex gap-2 pt-1">
        <Button type="button" variant="ghost" onClick={onCancel}>
          <ArrowLeft className="h-4 w-4" /> {authed ? 'Sign out' : 'Back'}
        </Button>
        <Button type="submit" className="flex-1" loading={busy} disabled={!valid}>
          {authed ? 'Update password' : 'Continue'}
        </Button>
      </div>
      <p className="text-xs text-subtle">Changing your password signs out your other sessions.</p>
    </form>
  )
}

function EnrollStep({
  mfaToken,
  onEnrolled,
  onExpired,
  onError,
}: {
  mfaToken: string
  onEnrolled: (auth: AdminAuth) => void
  onExpired: (msg?: string) => void
  onError: (e: unknown) => void
}) {
  const [data, setData] = useState<MfaEnrollStart | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [codeError, setCodeError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true
    adminApi.auth
      .enrollStart(mfaToken)
      .then(setData)
      .catch((e) => {
        if (isApiError(e) && e.status === 401) onExpired(e.message)
        else setLoadError(errorMessage(e))
      })
  }, [mfaToken, onExpired])

  const confirm = async (c: string) => {
    if (busy || c.length !== 6) return
    setBusy(true)
    setCodeError(null)
    try {
      onEnrolled(await adminApi.auth.enrollConfirm(mfaToken, c))
    } catch (e) {
      if (isApiError(e, 'INVALID_MFA_CODE') || isApiError(e, 'VALIDATION_ERROR')) setCodeError('That code didn’t match. Check your device’s clock and try the next code.')
      else if (isApiError(e) && e.status === 401) onExpired(e.message)
      else onError(e)
      setCode('')
      setAttempt((a) => a + 1)
    } finally {
      setBusy(false)
    }
  }

  if (loadError) return <Callout tone="flare">{loadError}</Callout>
  const secretGroups = data?.secret.replace(/\s/g, '').match(/.{1,4}/g)?.join(' ') ?? ''

  return (
    <div className="space-y-6">
      <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-start">
        <div className="shrink-0 rounded-2xl bg-snow p-2.5 shadow-card ring-1 ring-black/5">
          {data ? (
            <QRCodeSVG value={data.otpauth_uri} size={168} level="M" marginSize={1} bgColor="#ffffff" fgColor="#05080a" title="Authenticator setup QR code" />
          ) : (
            <div className="skeleton h-[168px] w-[168px] rounded-lg" />
          )}
        </div>
        <ol className="space-y-3 text-sm text-muted">
          <li className="flex gap-2.5">
            <span className="num flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/8 text-[11px] text-fg">1</span>
            <span>
              Open an authenticator app <span className="text-subtle">(Google Authenticator, 1Password, Authy…)</span>
            </span>
          </li>
          <li className="flex gap-2.5">
            <span className="num flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/8 text-[11px] text-fg">2</span>
            <span>Scan the QR code, or enter the key below manually</span>
          </li>
          <li className="flex gap-2.5">
            <span className="num flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/8 text-[11px] text-fg">3</span>
            <span>Type the 6-digit code it shows</span>
          </li>
        </ol>
      </div>
      <div className="rounded-xl bg-white/4 p-3 ring-1 ring-white/8">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-[11px] font-medium tracking-wide text-subtle uppercase">Setup key</span>
          {data && <CopyButton value={data.secret} label="Copy key" />}
        </div>
        <code data-testid="mfa-secret" className="block font-mono text-sm tracking-wider break-all text-fg select-all">
          {secretGroups || '••••'}
        </code>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void confirm(code)
        }}
        className="space-y-3"
      >
        <OtpInput key={attempt} value={code} onChange={setCode} onComplete={confirm} disabled={busy || !data} invalid={!!codeError} autoFocus={!!data} />
        {codeError && (
          <p className="text-center text-xs text-flare" role="alert">
            {codeError}
          </p>
        )}
        <Button type="submit" block loading={busy} disabled={code.length !== 6}>
          <Smartphone className="h-4 w-4" /> Verify & enable
        </Button>
      </form>
    </div>
  )
}

function VerifyStep({
  mfaToken,
  onVerified,
  onExpired,
  onError,
  onBack,
}: {
  mfaToken: string
  onVerified: (auth: AdminAuth) => void
  onExpired: (msg?: string) => void
  onError: (e: unknown) => void
  onBack: () => void
}) {
  const [mode, setMode] = useState<'totp' | 'recovery'>('totp')
  const [code, setCode] = useState('')
  const [recovery, setRecovery] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [attempt, setAttempt] = useState(0)

  const submit = async (body: { code?: string; recovery_code?: string }) => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      onVerified(await adminApi.auth.verify(mfaToken, body))
    } catch (e) {
      if (isApiError(e, 'INVALID_MFA_CODE') || isApiError(e, 'VALIDATION_ERROR'))
        setError(mode === 'totp' ? 'Invalid or already-used code. Wait for the next one.' : 'That recovery code is invalid or already used.')
      else if (isApiError(e) && e.status === 401) onExpired(e.message)
      else onError(e)
      setCode('')
      setAttempt((a) => a + 1)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      {mode === 'totp' ? (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (code.length === 6) void submit({ code })
          }}
          className="space-y-4"
        >
          <OtpInput key={attempt} value={code} onChange={setCode} onComplete={(c) => void submit({ code: c })} disabled={busy} invalid={!!error} />
          {error && (
            <p className="text-center text-xs text-flare" role="alert">
              {error}
            </p>
          )}
          <Button type="submit" block loading={busy} disabled={code.length !== 6}>
            <ShieldCheck className="h-4 w-4" /> Verify
          </Button>
        </form>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            const v = recovery.trim()
            if (v.length >= 8) void submit({ recovery_code: v })
          }}
          className="space-y-4"
        >
          <Field label="Recovery code" htmlFor="recovery" hint="Each recovery code can only be used once.">
            <TextInput
              id="recovery"
              value={recovery}
              onChange={(e) => setRecovery(e.target.value)}
              autoFocus
              autoComplete="off"
              spellCheck={false}
              placeholder="xxxxx-xxxxx"
              className="h-11 font-mono tracking-wider"
            />
          </Field>
          {error && <Callout tone="flare">{error}</Callout>}
          <Button type="submit" block loading={busy} disabled={recovery.trim().length < 8}>
            Use recovery code
          </Button>
        </form>
      )}
      <div className="flex items-center justify-between pt-1 text-xs">
        <button type="button" onClick={onBack} className="inline-flex cursor-pointer items-center gap-1 text-muted hover:text-fg">
          <ArrowLeft className="h-3.5 w-3.5" /> Start over
        </button>
        <button
          type="button"
          onClick={() => {
            setMode((m) => (m === 'totp' ? 'recovery' : 'totp'))
            setError(null)
          }}
          className="cursor-pointer font-medium text-volt hover:underline"
        >
          {mode === 'totp' ? 'Use a recovery code instead' : 'Use authenticator code'}
        </button>
      </div>
    </div>
  )
}

function RecoveryStep({ codes, email, onDone }: { codes: string[]; email: string; onDone: () => void }) {
  const [saved, setSaved] = useState(false)
  const text = `PYTCH Admin — recovery codes\nAccount: ${email}\nGenerated: ${new Date().toISOString()}\n\nEach code can be used once.\n\n${codes.join('\n')}\n`
  const download = () => {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }))
    const a = Object.assign(document.createElement('a'), { href: url, download: 'pytch-admin-recovery-codes.txt' })
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  return (
    <div className="space-y-5">
      <Callout tone="sun" title="Store these somewhere safe">
        A password manager or printed copy in a secure place. Anyone with a code and your password can sign in.
      </Callout>
      <div className="grid grid-cols-2 gap-2 rounded-2xl bg-white/4 p-4 ring-1 ring-white/8" data-testid="recovery-codes">
        {codes.map((c) => (
          <code key={c} className="rounded-lg bg-white/4 px-2 py-1.5 text-center font-mono text-sm tracking-wider text-fg select-all">
            {c}
          </code>
        ))}
        {codes.length === 0 && <p className="col-span-2 text-center text-sm text-muted">No recovery codes were returned.</p>}
      </div>
      <div className="flex gap-2">
        <CopyButton value={codes.join('\n')} label="Copy all" className="h-9 flex-1 justify-center" />
        <button
          type="button"
          onClick={download}
          className="inline-flex h-9 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-lg bg-white/5 px-2.5 text-xs font-medium text-fg/80 ring-1 ring-white/10 transition hover:bg-white/10"
        >
          <Download className="h-3.5 w-3.5" /> Download .txt
        </button>
      </div>
      <Checkbox checked={saved} onChange={setSaved} label="I’ve saved my recovery codes" />
      <Button block disabled={!saved} onClick={onDone}>
        Continue to console
      </Button>
    </div>
  )
}
