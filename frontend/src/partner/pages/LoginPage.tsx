import { useMutation } from '@tanstack/react-query'
import { ArrowLeft, ArrowRight, BadgeCheck, Building2, ShieldCheck, Sparkles, Wand2 } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useRef, useState } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { Logo } from '@/components/layout/Logo'
import { Button } from '@/components/ui/Button'
import { ThemeToggle } from '@/components/ui/ThemeToggle'
import { AuthBackdrop } from '@/features/auth/AuthBackdrop'
import { OtpInput, type OtpInputHandle } from '@/features/auth/OtpInput'
import { useCountdown } from '@/hooks/useCountdown'
import { errorMessage, isApiError } from '@/lib/api/client'
import { cn } from '@/lib/cn'
import type { PartnerAuth } from '@/types/partner'
import { partnerApi } from '../api/endpoints'
import { CalendarIllustration } from '../components/CalendarIllustration'
import { useResetPartnerCache } from '../hooks'
import { usePartnerAuth } from '../stores/partnerAuth'
import { safeInAppPath } from '@/lib/safePath'

const DEMO_OWNER = '+919999900010'
const FALLBACK_DEMO_CODE = '123456'
const RESEND_SECONDS = 30

const formatPhone = (d: string) => (d.length > 5 ? `${d.slice(0, 5)} ${d.slice(5)}` : d)
const isValidIndianMobile = (d: string) => /^[6-9]\d{9}$/.test(d)
const safeNext = (n: string | null) =>
  safeInAppPath(n, '/partner', { prefix: '/partner', exclude: ['/partner/login'] })

export default function LoginPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const authed = usePartnerAuth((s) => !!s.accessToken)
  const reset = useResetPartnerCache()
  const next = safeNext(params.get('next'))

  const [step, setStep] = useState<'phone' | 'otp'>('phone')
  const [digits, setDigits] = useState('')
  const [phoneError, setPhoneError] = useState<string | null>(null)
  const [session, setSession] = useState<{ phone: string; devCode: string | null; resendAt: string } | null>(null)
  const [code, setCode] = useState('')
  const [codeError, setCodeError] = useState<string | null>(null)
  const otpRef = useRef<OtpInputHandle>(null)
  const phoneInput = useRef<HTMLInputElement>(null)

  const [leaving, setLeaving] = useState(false)
  const finish = (auth: PartnerAuth) => {
    setLeaving(true)
    reset()
    usePartnerAuth.getState().setSession(auth)
    const first = auth.user.name_is_default ? null : auth.user.name?.split(' ')[0] // not "Welcome back, Player"
    if (auth.memberships.length === 0) {
      toast.success('Welcome to PYTCH Partner', { description: 'Tell us about your venue to get started.' })
      navigate('/partner/apply', { replace: true })
      return
    }
    toast.success(first ? `Welcome back, ${first}` : 'Welcome back')
    navigate(next, { replace: true })
  }

  const requestOtp = useMutation({
    mutationFn: (phone: string) => partnerApi.auth.requestOtp(phone),
    onSuccess: (res, phone) => {
      setSession({ phone, devCode: res.dev_code, resendAt: new Date(Date.now() + RESEND_SECONDS * 1000).toISOString() })
      setCode('')
      setCodeError(null)
      setStep('otp')
    },
    onError: (e) => setPhoneError(isApiError(e, 'RATE_LIMITED') ? 'Too many codes requested — give it a few minutes.' : errorMessage(e)),
  })

  const verify = useMutation({
    mutationFn: (v: { phone: string; code: string }) => partnerApi.auth.verifyOtp(v.phone, v.code),
    onSuccess: finish,
    onError: (e) => {
      setCodeError(
        isApiError(e, 'INVALID_OTP') ? 'That code didn’t match. Try again.' : isApiError(e, 'ACCOUNT_SUSPENDED') ? 'This account is suspended. Contact Pytch support.' : errorMessage(e),
      )
      otpRef.current?.shake()
      setCode('')
      setTimeout(() => otpRef.current?.focus(0), 50)
    },
  })

  const demo = useMutation({
    mutationFn: async () => {
      const r = await partnerApi.auth.requestOtp(DEMO_OWNER).catch(() => null)
      return partnerApi.auth.verifyOtp(DEMO_OWNER, r?.dev_code ?? FALLBACK_DEMO_CODE)
    },
    onSuccess: finish,
    onError: (e) => toast.error('Demo login failed', { description: errorMessage(e) }),
  })

  if (authed && !leaving) return <Navigate to={next} replace />

  const busy = requestOtp.isPending || verify.isPending || demo.isPending

  const submitPhone = (e: React.FormEvent) => {
    e.preventDefault()
    if (!isValidIndianMobile(digits)) {
      setPhoneError(digits.length < 10 ? 'Enter your 10-digit mobile number.' : 'Indian mobile numbers start with 6, 7, 8 or 9.')
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
    const dev = session?.devCode
    if (!dev) return
    dev.split('').forEach((_, i) =>
      setTimeout(() => {
        setCode(dev.slice(0, i + 1))
        if (i === dev.length - 1) submitCode(dev)
      }, i * 70),
    )
  }

  return (
    <div className="relative flex min-h-dvh">
      <AuthBackdrop />

      <aside className="relative hidden w-[46%] max-w-[44rem] flex-col justify-between overflow-hidden border-r border-white/6 p-10 lg:flex">
        <div className="absolute inset-0 bg-[radial-gradient(90%_60%_at_50%_40%,color-mix(in_srgb,var(--color-volt)_7%,transparent),transparent_70%)]" />
        <div className="relative flex items-center gap-3">
          <Logo to="/" />
          <span className="rounded-md bg-volt/12 px-2 py-0.5 text-[11px] font-bold tracking-[0.16em] text-volt uppercase ring-1 ring-volt/30">Partner</span>
        </div>
        <div className="relative">
          <CalendarIllustration />
          <h2 className="mt-8 font-display text-3xl leading-tight font-bold xl:text-4xl">
            One calendar.
            <br />
            <span className="text-volt">Every channel.</span>
          </h2>
          <p className="mt-4 max-w-md text-sm text-muted">
            Pytch bookings, walk-ins, phone calls and the other apps you sell on — in a single live grid your front desk can run from a phone.
            No double bookings, no end-of-day spreadsheets.
          </p>
        </div>
        <ul className="relative grid grid-cols-3 gap-3 text-xs text-muted">
          <li className="rounded-2xl bg-white/4 p-3 ring-1 ring-white/8">
            <div className="font-mono text-lg font-semibold text-fg">2 taps</div>to log a walk-in
          </li>
          <li className="rounded-2xl bg-white/4 p-3 ring-1 ring-white/8">
            <div className="font-mono text-lg font-semibold text-fg">Live</div>updates across devices
          </li>
          <li className="rounded-2xl bg-white/4 p-3 ring-1 ring-white/8">
            <div className="font-mono text-lg font-semibold text-fg">Weekly</div>statements & payouts
          </li>
        </ul>
      </aside>

      <main className="relative flex min-w-0 flex-1 flex-col px-5 py-6 sm:px-10">
        <div className="flex items-center justify-between lg:justify-end">
          <div className="flex items-center gap-2 lg:hidden">
            <Logo to="/" />
            <span className="rounded-md bg-volt/12 px-1.5 py-0.5 text-[10px] font-bold tracking-[0.14em] text-volt uppercase ring-1 ring-volt/30">Partner</span>
          </div>
          <div className="flex items-center gap-3">
            <Link to="/login" className="hidden text-sm text-muted transition hover:text-fg sm:inline">
              Player login
            </Link>
            <ThemeToggle className="h-9 w-9 rounded-lg [&_svg]:h-[18px] [&_svg]:w-[18px]" />
          </div>
        </div>

        <div className="flex flex-1 items-center justify-center py-10">
          <div className="w-full max-w-[26rem]">
            <AnimatePresence mode="wait" custom={step === 'otp' ? 1 : -1}>
              {step === 'phone' ? (
                <motion.section key="phone" custom={-1} variants={slide} initial="enter" animate="center" exit="exit" aria-labelledby="pl-title">
                  <div className="mb-2 flex items-center gap-2 text-xs font-bold tracking-[0.22em] text-volt uppercase">
                    <Building2 className="h-4 w-4" /> Venue partners
                  </div>
                  <h1 id="pl-title" className="text-3xl leading-tight font-bold sm:text-4xl">
                    Run your turf <span className="text-volt">from one screen.</span>
                  </h1>
                  <p className="mt-3 text-muted">Owners and front-desk staff sign in with their mobile number.</p>

                  <form onSubmit={submitPhone} noValidate className="mt-8">
                    <label htmlFor="pl-phone" className="mb-2 block text-xs font-semibold tracking-wider text-muted uppercase">
                      Mobile number
                    </label>
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
                        id="pl-phone"
                        type="tel"
                        inputMode="numeric"
                        autoComplete="tel-national"
                        autoFocus
                        placeholder="98765 43210"
                        value={formatPhone(digits)}
                        onChange={(e) => {
                          let d = e.target.value.replace(/\D/g, '')
                          if (d.length > 10 && d.startsWith('91')) d = d.slice(2)
                          setDigits(d.slice(0, 10))
                          if (phoneError) setPhoneError(null)
                        }}
                        aria-invalid={!!phoneError}
                        aria-describedby="pl-phone-msg"
                        className="h-full min-w-0 flex-1 bg-transparent px-4 font-mono text-lg tracking-wider text-fg outline-none placeholder:text-subtle"
                      />
                      <AnimatePresence>
                        {isValidIndianMobile(digits) && (
                          <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} className="mr-4 flex h-6 w-6 items-center justify-center rounded-full bg-volt text-ink-950">
                            <BadgeCheck className="h-4 w-4" />
                          </motion.span>
                        )}
                      </AnimatePresence>
                    </div>
                    <p id="pl-phone-msg" role={phoneError ? 'alert' : undefined} className={cn('mt-2 min-h-5 text-sm', phoneError ? 'text-flare' : 'text-muted')}>
                      {phoneError ?? `${digits.length}/10 digits`}
                    </p>
                    <Button type="submit" size="lg" block className="mt-5" loading={requestOtp.isPending} disabled={busy}>
                      Send code <ArrowRight className="h-5 w-5" />
                    </Button>
                  </form>

                  <div className="my-7 flex items-center gap-3 text-xs text-muted">
                    <span className="h-px flex-1 bg-white/8" /> exploring? <span className="h-px flex-1 bg-white/8" />
                  </div>

                  <motion.button
                    type="button"
                    onClick={() => demo.mutate()}
                    disabled={busy}
                    whileHover={{ y: -2 }}
                    whileTap={{ scale: 0.97 }}
                    className="group relative flex h-14 w-full cursor-pointer items-center justify-center gap-2 overflow-hidden rounded-2xl bg-white/5 font-semibold ring-1 ring-white/12 transition hover:ring-volt/50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <span aria-hidden className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-volt/15 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
                    {demo.isPending ? (
                      <>
                        <motion.span className="h-4 w-4 rounded-full border-2 border-volt/30 border-t-volt" animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 0.8, ease: 'linear' }} />
                        Opening the demo venue…
                      </>
                    ) : (
                      <>
                        <Sparkles className="h-5 w-5 text-volt" /> Try demo venue owner
                      </>
                    )}
                  </motion.button>
                  <p className="mt-3 text-center text-xs text-muted">Signs you in as the owner of a seeded Kochi venue with live bookings.</p>

                  <p className="mt-8 text-center text-sm text-muted">
                    New to Pytch? Sign in with your number — we’ll walk you through listing your venue.
                  </p>
                </motion.section>
              ) : (
                <motion.section key="otp" custom={1} variants={slide} initial="enter" animate="center" exit="exit" aria-labelledby="pl-otp-title">
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
                  <h1 id="pl-otp-title" className="text-3xl leading-tight font-bold sm:text-4xl">
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
                    {session?.devCode && (
                      <motion.button
                        type="button"
                        onClick={fillDevCode}
                        initial={{ opacity: 0, y: 8, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        transition={{ delay: 0.2 }}
                        className="mt-4 inline-flex cursor-pointer items-center gap-2 rounded-full bg-volt/12 px-4 py-2 text-sm font-medium text-volt ring-1 ring-volt/35 transition hover:bg-volt/20"
                      >
                        <Wand2 className="h-4 w-4" />
                        Demo code: <span className="font-mono tracking-widest">{session.devCode}</span>
                        <span className="text-volt/70">· tap to fill</span>
                      </motion.button>
                    )}
                    <Button type="submit" size="lg" block className="mt-6" loading={verify.isPending} disabled={code.length !== 6 || busy}>
                      Verify & continue
                    </Button>
                  </form>
                  {session && <ResendRow resendAt={session.resendAt} pending={requestOtp.isPending} onResend={() => requestOtp.mutate(session.phone)} />}
                </motion.section>
              )}
            </AnimatePresence>
          </div>
        </div>

        <p className="flex items-center justify-center gap-1.5 text-center text-xs text-muted">
          <ShieldCheck className="h-3.5 w-3.5 text-mint" /> Sessions are separate from the player app. Staff only see the venues they’re assigned.
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
