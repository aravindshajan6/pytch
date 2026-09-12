import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, ArrowRight, BadgeCheck, CloudRain, Radio, ShieldCheck, Sparkles, Users, Wand2 } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { Logo } from '@/components/layout/Logo'
import { MaintenanceBanner } from '@/components/layout/MaintenanceBanner'
import { HeroCanvas } from '@/components/three/HeroCanvas'
import { Button } from '@/components/ui/Button'
import { ThemeToggle } from '@/components/ui/ThemeToggle'
import { useCountdown } from '@/hooks/useCountdown'
import { useIsDesktop } from '@/hooks/useMediaQuery'
import { errorMessage, isApiError } from '@/lib/api/client'
import { api } from '@/lib/api/endpoints'
import { qk } from '@/lib/api/queryKeys'
import { cn } from '@/lib/cn'
import { useAuth } from '@/stores/auth'
import { syncHomeLocation } from '@/stores/location'
import { useResolvedTheme } from '@/stores/theme'
import type { AuthTokens } from '@/types/api'
import { AuthBackdrop } from './AuthBackdrop'
import { OtpInput, type OtpInputHandle } from './OtpInput'
import { safeInAppPath } from '@/lib/safePath'

const DEMO_PHONE = '+919999900001'
const FALLBACK_DEMO_CODE = '123456'
const RESEND_SECONDS = 30

const formatPhone = (digits: string) => (digits.length > 5 ? `${digits.slice(0, 5)} ${digits.slice(5)}` : digits)
const isValidIndianMobile = (digits: string) => /^[6-9]\d{9}$/.test(digits)

/** Only same-origin relative paths are allowed as a post-login destination. */
const safeNext = (next: string | null): string => safeInAppPath(next, '/app')

type Step = 'phone' | 'otp'

interface OtpSession {
  phone: string // E.164
  devCode: string | null
  resendAt: string // ISO
}

export default function LoginPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const desktop = useIsDesktop()
  const day = useResolvedTheme() === 'light'
  const next = safeNext(params.get('next'))

  const [step, setStep] = useState<Step>('phone')
  const [digits, setDigits] = useState('')
  const [phoneError, setPhoneError] = useState<string | null>(null)
  const [session, setSession] = useState<OtpSession | null>(null)
  const [code, setCode] = useState('')
  const [codeError, setCodeError] = useState<string | null>(null)
  const otpRef = useRef<OtpInputHandle>(null)
  const phoneInput = useRef<HTMLInputElement>(null)
  const phoneShake = useRef<HTMLDivElement>(null)

  const finish = (tokens: AuthTokens) => {
    qc.setQueryData(qk.me, tokens.user)
    useAuth.getState().setSession(tokens)
    syncHomeLocation(tokens.user)
    const first = tokens.user.name.split(' ')[0]
    toast.success(tokens.is_new_user || !tokens.user.onboarded ? 'Welcome to PYTCH ⚽' : `Welcome back, ${first}`)
    navigate(tokens.user.onboarded ? next : `/onboarding?next=${encodeURIComponent(next)}`, { replace: true })
  }

  const requestOtp = useMutation({
    mutationFn: (phone: string) => api.auth.requestOtp(phone),
    onSuccess: (res, phone) => {
      setSession({ phone, devCode: res.dev_code, resendAt: new Date(Date.now() + RESEND_SECONDS * 1000).toISOString() })
      setCode('')
      setCodeError(null)
      setStep('otp')
    },
    onError: (e) => {
      setPhoneError(isApiError(e, 'RATE_LIMITED') ? 'Too many codes requested — give it a few minutes.' : errorMessage(e))
      shake(phoneShake.current)
    },
  })

  const verify = useMutation({
    mutationFn: ({ phone, code }: { phone: string; code: string }) => api.auth.verifyOtp(phone, code),
    onSuccess: finish,
    onError: (e) => {
      setCodeError(isApiError(e, 'INVALID_OTP') ? 'That code didn’t match. Try again.' : errorMessage(e))
      otpRef.current?.shake()
      setCode('')
      setTimeout(() => otpRef.current?.focus(0), 50)
    },
  })

  const demo = useMutation({
    mutationFn: async () => {
      // The demo account always accepts the fixed demo code, so a rate-limited OTP request
      // (e.g. several demo logins in a few minutes) must not block the button.
      const r = await api.auth.requestOtp(DEMO_PHONE).catch(() => null)
      return api.auth.verifyOtp(DEMO_PHONE, r?.dev_code ?? FALLBACK_DEMO_CODE)
    },
    onSuccess: finish,
    onError: (e) => toast.error('Demo login failed', { description: errorMessage(e) }),
  })

  // /login?demo=1 (from the landing page) starts the demo straight away
  const autoDemo = useRef(false)
  useEffect(() => {
    if (params.get('demo') === '1' && !autoDemo.current) {
      autoDemo.current = true
      demo.mutate()
    }
  }, [params, demo])

  const submitPhone = (e: React.FormEvent) => {
    e.preventDefault()
    if (!isValidIndianMobile(digits)) {
      setPhoneError(digits.length < 10 ? 'Enter your 10-digit mobile number.' : 'Indian mobile numbers start with 6, 7, 8 or 9.')
      shake(phoneShake.current)
      phoneInput.current?.focus()
      return
    }
    setPhoneError(null)
    requestOtp.mutate(`+91${digits}`)
  }

  const submitCode = (value = code) => {
    if (!session || value.length !== 6 || verify.isPending) return
    setCodeError(null)
    verify.mutate({ phone: session.phone, code: value })
  }

  const fillDevCode = () => {
    if (!session?.devCode) return
    const devCode = session.devCode
    setCodeError(null)
    // type it in, digit by digit, for a satisfying fill
    devCode.split('').forEach((_, i) => {
      setTimeout(() => {
        setCode(devCode.slice(0, i + 1))
        if (i === devCode.length - 1) submitCode(devCode)
      }, i * 70)
    })
  }

  const busy = requestOtp.isPending || verify.isPending || demo.isPending

  return (
    <div className="relative flex min-h-dvh">
      <AuthBackdrop />

      {/* brand panel (desktop) */}
      <aside className="relative hidden w-[46%] max-w-[44rem] flex-col justify-between overflow-hidden border-r border-white/6 p-10 lg:flex">
        {day ? (
          // daylight panel: soft sky → turf wash, sun glow behind the ball and a contact shadow under it
          <div className="absolute inset-0 bg-[radial-gradient(60%_42%_at_50%_36%,rgb(255_250_235/0.95),transparent_70%),radial-gradient(70%_40%_at_85%_0%,rgb(255_236_190/0.6),transparent_70%),linear-gradient(180deg,#cfe4ee_0%,#e6efe9_48%,#e2edd9_100%)]">
            <div className="pitch-grid absolute inset-0 [mask-image:linear-gradient(to_top,black,transparent_55%)]" />
            <div className="absolute top-[64%] left-1/2 h-10 w-[42%] -translate-x-1/2 rounded-[50%] bg-[radial-gradient(closest-side,rgb(14_42_26/0.28),transparent)] blur-[2px]" />
          </div>
        ) : (
          <div className="absolute inset-0 bg-[radial-gradient(90%_60%_at_50%_40%,#132219,var(--color-ink-900)_70%)]" />
        )}
        {desktop && <HeroCanvas variant="lite" scrollLinked={false} />}
        <div className="relative">
          <Logo />
        </div>
        <div className="relative">
          <ValueTicker />
          <p className="mt-4 max-w-sm text-sm text-muted">
            Book turfs, split the bill automatically and find a game — or a sub — in minutes. Kochi’s pickup scene, organised.
          </p>
        </div>
      </aside>

      {/* form */}
      <main className="relative flex min-w-0 flex-1 flex-col px-5 py-6 sm:px-10">
        <div className="flex items-center justify-between lg:justify-end">
          <Logo className="lg:hidden" />
          <div className="flex items-center gap-3">
            <Link to="/" className="text-sm text-muted transition hover:text-fg">
              ← Back to site
            </Link>
            <ThemeToggle className="h-9 w-9 rounded-lg [&_svg]:h-[18px] [&_svg]:w-[18px]" />
          </div>
        </div>
        <MaintenanceBanner variant="floating" className="mt-4 w-full" />

        <div className="flex flex-1 items-center justify-center py-10">
          <div className="w-full max-w-[26rem]">
            <AnimatePresence mode="wait" custom={step === 'otp' ? 1 : -1}>
              {step === 'phone' ? (
                <motion.section
                  key="phone"
                  custom={-1}
                  variants={slide}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  aria-labelledby="login-title"
                >
                  <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="mb-2 text-xs font-bold tracking-[0.22em] text-volt uppercase">
                    Sign in · Sign up
                  </motion.div>
                  <h1 id="login-title" className="text-3xl leading-tight font-bold sm:text-4xl">
                    Let’s get you <span className="text-volt">on the pitch.</span>
                  </h1>
                  <p className="mt-3 text-muted">We’ll text you a 6-digit code. No passwords, ever.</p>

                  <form onSubmit={submitPhone} noValidate className="mt-8">
                    <label htmlFor="phone" className="mb-2 block text-xs font-semibold tracking-wider text-muted uppercase">
                      Mobile number
                    </label>
                    <div ref={phoneShake}>
                      <div
                        className={cn(
                          'flex h-14 items-center overflow-hidden rounded-2xl bg-white/5 ring-1 transition focus-within:bg-white/8 focus-within:ring-2',
                          phoneError ? 'ring-flare/70 focus-within:ring-flare' : 'ring-white/10 focus-within:ring-volt/70',
                        )}
                      >
                        <span className="flex h-full items-center gap-2 border-r border-white/10 pr-3 pl-4 font-mono text-fg/85 select-none">
                          <span aria-hidden>🇮🇳</span>+91
                        </span>
                        <input
                          ref={phoneInput}
                          id="phone"
                          type="tel"
                          inputMode="numeric"
                          autoComplete="tel-national"
                          autoFocus
                          placeholder="98765 43210"
                          value={formatPhone(digits)}
                          onChange={(e) => {
                            let d = e.target.value.replace(/\D/g, '')
                            if (d.length > 10 && d.startsWith('91')) d = d.slice(2) // pasted with country code
                            setDigits(d.slice(0, 10))
                            if (phoneError) setPhoneError(null)
                          }}
                          aria-invalid={!!phoneError}
                          aria-describedby={phoneError ? 'phone-error' : 'phone-hint'}
                          className="h-full flex-1 bg-transparent px-4 font-mono text-lg tracking-wider text-fg outline-none placeholder:text-subtle"
                        />
                        <AnimatePresence>
                          {isValidIndianMobile(digits) && (
                            <motion.span
                              initial={{ scale: 0, opacity: 0 }}
                              animate={{ scale: 1, opacity: 1 }}
                              exit={{ scale: 0, opacity: 0 }}
                              className="mr-4 flex h-6 w-6 items-center justify-center rounded-full bg-volt text-ink-950"
                            >
                              <BadgeCheck className="h-4 w-4" />
                            </motion.span>
                          )}
                        </AnimatePresence>
                      </div>
                    </div>
                    <div className="mt-2 min-h-5 text-sm">
                      <AnimatePresence mode="wait" initial={false}>
                        {phoneError ? (
                          <motion.p key="err" id="phone-error" role="alert" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="text-flare">
                            {phoneError}
                          </motion.p>
                        ) : (
                          <motion.p key="hint" id="phone-hint" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="text-subtle">
                            {digits.length}/10 digits
                          </motion.p>
                        )}
                      </AnimatePresence>
                    </div>

                    <Button type="submit" size="lg" block className="mt-5" loading={requestOtp.isPending} disabled={busy}>
                      Send code <ArrowRight className="h-5 w-5" />
                    </Button>
                  </form>

                  <div className="my-7 flex items-center gap-3 text-xs text-subtle">
                    <span className="h-px flex-1 bg-white/8" /> or just look around <span className="h-px flex-1 bg-white/8" />
                  </div>

                  <DemoButton pending={demo.isPending} disabled={busy} onClick={() => demo.mutate()} />
                  <p className="mt-3 text-center text-xs text-subtle">
                    Logs you in as a seeded Kochi player with games, credits and ratings.
                  </p>
                </motion.section>
              ) : (
                <motion.section key="otp" custom={1} variants={slide} initial="enter" animate="center" exit="exit" aria-labelledby="otp-title">
                  <button
                    type="button"
                    onClick={() => {
                      setStep('phone')
                      requestAnimationFrame(() => phoneInput.current?.focus())
                    }}
                    className="-ml-2 mb-6 inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1 text-sm text-muted transition hover:bg-white/5 hover:text-fg"
                  >
                    <ArrowLeft className="h-4 w-4" /> Change number
                  </button>
                  <h1 id="otp-title" className="text-3xl leading-tight font-bold sm:text-4xl">
                    Enter the code
                  </h1>
                  <p className="mt-3 text-muted">
                    Sent to <span className="font-mono text-fg">+91 {formatPhone(digits)}</span>
                  </p>

                  <form
                    className="mt-8"
                    onSubmit={(e) => {
                      e.preventDefault()
                      submitCode()
                    }}
                  >
                    <OtpInput
                      ref={otpRef}
                      value={code}
                      onChange={(v) => {
                        setCode(v)
                        if (codeError) setCodeError(null)
                      }}
                      onComplete={submitCode}
                      disabled={verify.isPending}
                      invalid={!!codeError}
                    />
                    <div className="mt-3 min-h-5 text-sm" aria-live="polite">
                      {codeError && (
                        <motion.p role="alert" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="text-flare">
                          {codeError}
                        </motion.p>
                      )}
                    </div>

                    <AnimatePresence>
                      {session?.devCode && (
                        <motion.button
                          type="button"
                          onClick={fillDevCode}
                          initial={{ opacity: 0, y: 8, scale: 0.95 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          transition={{ delay: 0.2, type: 'spring', stiffness: 300, damping: 22 }}
                          className="mt-4 inline-flex cursor-pointer items-center gap-2 rounded-full bg-volt/12 px-4 py-2 text-sm font-medium text-volt ring-1 ring-volt/35 transition hover:bg-volt/20"
                        >
                          <Wand2 className="h-4 w-4" />
                          Demo code: <span className="font-mono tracking-widest">{session.devCode}</span>
                          <span className="text-volt/70">· tap to fill</span>
                        </motion.button>
                      )}
                    </AnimatePresence>

                    <Button type="submit" size="lg" block className="mt-6" loading={verify.isPending} disabled={code.length !== 6 || busy}>
                      Verify & continue
                    </Button>
                  </form>

                  {session && (
                    <ResendRow
                      resendAt={session.resendAt}
                      pending={requestOtp.isPending}
                      onResend={() => requestOtp.mutate(session.phone)}
                    />
                  )}
                </motion.section>
              )}
            </AnimatePresence>
          </div>
        </div>

        <p className="text-center text-xs text-subtle">
          By continuing you agree to play fair, turn up on time and rate honestly. <ShieldCheck className="inline h-3.5 w-3.5 text-mint" />
        </p>
        <p className="mt-2 text-center text-xs text-subtle">
          Own a turf?{' '}
          <Link to="/partner/login" className="font-semibold text-muted underline-offset-2 transition hover:text-volt hover:underline">
            Partner with Pytch
          </Link>
        </p>
      </main>
    </div>
  )
}

const slide = {
  enter: (dir: number) => ({ opacity: 0, x: dir * 48, filter: 'blur(6px)' }),
  center: { opacity: 1, x: 0, filter: 'blur(0px)', transition: { type: 'spring' as const, stiffness: 260, damping: 28 } },
  exit: (dir: number) => ({ opacity: 0, x: dir * -48, filter: 'blur(6px)', transition: { duration: 0.18 } }),
}

function shake(el: HTMLElement | null) {
  if (!el || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  el.animate(
    [{ transform: 'translateX(0)' }, { transform: 'translateX(-10px)' }, { transform: 'translateX(9px)' }, { transform: 'translateX(-6px)' }, { transform: 'translateX(4px)' }, { transform: 'translateX(0)' }],
    { duration: 420, easing: 'ease-out' },
  )
}

function ResendRow({ resendAt, pending, onResend }: { resendAt: string; pending: boolean; onResend: () => void }) {
  const c = useCountdown(resendAt)
  return (
    <div className="mt-5 text-center text-sm text-muted">
      {c.expired ? (
        <button type="button" onClick={onResend} disabled={pending} className="cursor-pointer font-semibold text-volt transition hover:text-volt-soft disabled:opacity-50">
          {pending ? 'Sending…' : 'Resend code'}
        </button>
      ) : (
        <span>
          Resend code in <span className="font-mono text-fg tabular-nums">{c.label}</span>
        </span>
      )}
    </div>
  )
}

function DemoButton({ pending, disabled, onClick }: { pending: boolean; disabled: boolean; onClick: () => void }) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      disabled={disabled}
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.97 }}
      className="group relative flex h-14 w-full cursor-pointer items-center justify-center gap-2 overflow-hidden rounded-2xl bg-white/5 font-semibold ring-1 ring-white/12 transition hover:ring-volt/50 disabled:cursor-not-allowed disabled:opacity-60"
    >
      <span
        aria-hidden
        className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-volt/15 to-transparent transition-transform duration-700 group-hover:translate-x-full"
      />
      {pending ? (
        <>
          <motion.span
            className="h-4 w-4 rounded-full border-2 border-volt/30 border-t-volt"
            animate={{ rotate: 360 }}
            transition={{ repeat: Infinity, duration: 0.8, ease: 'linear' }}
          />
          Warming up the demo…
        </>
      ) : (
        <>
          <Sparkles className="h-5 w-5 text-volt" /> Try the demo account
        </>
      )}
    </motion.button>
  )
}

const VALUES = [
  { icon: Users, text: 'Split the bill before kick-off.', tone: 'text-volt' },
  { icon: Radio, text: 'Subs on standby within 5 km.', tone: 'text-flare' },
  { icon: BadgeCheck, text: 'A rating your teammates vouch for.', tone: 'text-[var(--color-grape-soft)]' },
  { icon: CloudRain, text: 'Rain? Moved indoors, ₹0 extra.', tone: 'text-sun' },
]

function ValueTicker() {
  const [i, setI] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setI((v) => (v + 1) % VALUES.length), 3200)
    return () => clearInterval(id)
  }, [])
  const v = VALUES[i]!
  return (
    <div className="h-[7.5rem]" aria-live="off">
      <div className="font-display text-sm tracking-[0.2em] text-muted uppercase">Play more. Chase less.</div>
      <AnimatePresence mode="wait">
        <motion.div
          key={i}
          initial={{ opacity: 0, y: 24, filter: 'blur(8px)' }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          exit={{ opacity: 0, y: -24, filter: 'blur(8px)' }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          className="mt-3 flex items-start gap-3"
        >
          <v.icon className={cn('mt-1.5 h-7 w-7 shrink-0', v.tone)} />
          <span className="font-display text-3xl leading-tight font-bold xl:text-4xl">{v.text}</span>
        </motion.div>
      </AnimatePresence>
    </div>
  )
}
