import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  Cable,
  Check,
  Landmark,
  LogOut,
  MapPin,
  Plus,
  Send,
  Trash2,
  UserRound,
  type LucideIcon,
} from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { toast } from 'sonner'
import { Logo } from '@/components/layout/Logo'
import { Button } from '@/components/ui/Button'
import { Stepper, Switch } from '@/components/ui/Form'
import { ThemeToggle } from '@/components/ui/ThemeToggle'
import { AuthBackdrop } from '@/features/auth/AuthBackdrop'
import { useMeta } from '@/hooks/useMeta'
import { errorMessage, isApiError } from '@/lib/api/client'
import { cn } from '@/lib/cn'
import { SPORT_LIST, sportInfo } from '@/lib/sports'
import type { Sport } from '@/types/api'
import type { ApplicationVenue, BlockSource, PartnerMe, ProviderApplication } from '@/types/partner'
import { partnerApi } from '../api/endpoints'
import { pk } from '../api/keys'
import { ChoiceChips, Field, Select, TextInput } from '../components/kit'
import { applyDraftKey } from '../lib/drafts'
import { SOURCES } from '../lib/sources'
import { EMAIL_RE, GSTIN_RE, IFSC_RE } from '../lib/validation'
import { useLogout } from '../session'
import { usePartnerAuth } from '../stores/partnerAuth'

const ENTITY_TYPES = [
  { value: 'individual', label: 'Individual' },
  { value: 'proprietorship', label: 'Proprietorship' },
  { value: 'partnership', label: 'Partnership' },
  { value: 'llp', label: 'LLP' },
  { value: 'company', label: 'Company' },
] as const
type EntityType = (typeof ENTITY_TYPES)[number]['value']

/** Where else they sell — mapped onto BlockSource so channel setup can pre-fill. */
const LISTED_ON: { value: BlockSource; label: string }[] = [
  { value: 'playo', label: 'Playo' },
  { value: 'hudle', label: 'Hudle' },
  { value: 'khelomore', label: 'KheloMore' },
  { value: 'other_app', label: 'Another app' },
  { value: 'phone', label: 'Phone / WhatsApp' },
  { value: 'walk_in', label: 'Walk-ins' },
]

interface Draft {
  business_name: string
  legal_name: string
  entity_type: EntityType | ''
  gstin: string
  city: string
  contact_name: string
  contact_email: string
  address: string
  venues: ApplicationVenue[]
  bank_account_name: string
  bank_ifsc: string
  bank_account_last4: string
  listed_on: BlockSource[]
}

const emptyVenue = (): ApplicationVenue => ({ name: '', area: '', address: '', sports: ['football'], pitch_count: 1, has_indoor: false, notes: '' })

const EMPTY: Draft = {
  business_name: '',
  legal_name: '',
  entity_type: '',
  gstin: '',
  city: 'Kochi',
  contact_name: '',
  contact_email: '',
  address: '',
  venues: [emptyVenue()],
  bank_account_name: '',
  bank_ifsc: '',
  bank_account_last4: '',
  listed_on: [],
}

interface Saved {
  draft: Draft
  step: number
}

/** This account's saved progress on this device (drafts are per user — see lib/drafts). */
function loadDraft(key: string): Saved {
  try {
    localStorage.removeItem('pytch-partner-apply-draft') // the old device-wide draft leaked between accounts
    const raw = localStorage.getItem(key)
    if (!raw) return { draft: EMPTY, step: 0 }
    const saved = JSON.parse(raw) as Partial<Saved>
    return { draft: { ...EMPTY, ...saved.draft }, step: Math.min(Math.max(0, Number(saved.step) || 0), STEPS.length) }
  } catch {
    return { draft: EMPTY, step: 0 }
  }
}

/** "Player 1234" is the placeholder name of a fresh login — never a contact name. */
const isPlaceholderName = (name: string | undefined, isDefault?: boolean) => !name || !!isDefault || /^player \d{4}$/i.test(name.trim())

const STEPS: { key: string; title: string; icon: LucideIcon; blurb: string }[] = [
  { key: 'business', title: 'Business', icon: Building2, blurb: 'Who runs the venue' },
  { key: 'contact', title: 'Contact', icon: UserRound, blurb: 'How we reach you' },
  { key: 'venues', title: 'Venues', icon: MapPin, blurb: 'What you’re listing' },
  { key: 'bank', title: 'Payouts', icon: Landmark, blurb: 'Where money goes' },
  { key: 'channels', title: 'Channels', icon: Cable, blurb: 'Where else you sell' },
]

type Errors = Record<string, string>

function validate(step: number, d: Draft): Errors {
  const e: Errors = {}
  if (step === 0) {
    if (d.business_name.trim().length < 2) e.business_name = 'Enter the name customers know you by.'
    if (d.gstin && !GSTIN_RE.test(d.gstin)) e.gstin = 'GSTIN is 15 characters, e.g. 32ABCDE1234F1Z5.'
    if (!d.city.trim()) e.city = 'Which city are you in?'
  }
  if (step === 1) {
    if (d.contact_name.trim().length < 2) e.contact_name = 'Who should we call about this application?'
    if (d.contact_email && !EMAIL_RE.test(d.contact_email)) e.contact_email = 'That email doesn’t look right.'
    if (d.address.trim().length < 6) e.address = 'Enter your business address.'
  }
  if (step === 2) {
    d.venues.forEach((v, i) => {
      if (v.name.trim().length < 2) e[`v${i}.name`] = 'Venue name is required.'
      if (!v.area) e[`v${i}.area`] = 'Pick the area.'
      if (v.address.trim().length < 6) e[`v${i}.address`] = 'Street address, please.'
      if (v.sports.length === 0) e[`v${i}.sports`] = 'Pick at least one sport.'
    })
  }
  if (step === 3) {
    if (d.bank_ifsc && !IFSC_RE.test(d.bank_ifsc)) e.bank_ifsc = 'IFSC is 11 characters, e.g. HDFC0001234.'
    if (d.bank_account_last4 && !/^\d{4}$/.test(d.bank_account_last4)) e.bank_account_last4 = 'Exactly the last 4 digits.'
    const anyBank = d.bank_account_name || d.bank_ifsc || d.bank_account_last4
    if (anyBank && !(d.bank_account_name && d.bank_ifsc && d.bank_account_last4)) e.bank = 'Fill all three bank fields, or leave them all empty for now.'
  }
  return Object.fromEntries(Object.entries(e).filter(([, v]) => v))
}

function toPayload(d: Draft): ProviderApplication {
  const opt = (s: string) => s.trim() || null
  return {
    business_name: d.business_name.trim(),
    legal_name: opt(d.legal_name),
    gstin: opt(d.gstin),
    entity_type: d.entity_type || null,
    contact_name: d.contact_name.trim(),
    contact_email: opt(d.contact_email),
    city: d.city.trim(),
    address: d.address.trim(),
    venues: d.venues.map((v) => ({ ...v, name: v.name.trim(), address: v.address.trim(), notes: v.notes?.trim() || null })),
    bank_account_name: opt(d.bank_account_name),
    bank_ifsc: opt(d.bank_ifsc),
    bank_account_last4: opt(d.bank_account_last4),
    listed_on: d.listed_on,
  }
}

// ───────────── page ─────────────

export default function ApplyPage() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const logout = useLogout()
  const hasMemberships = usePartnerAuth((s) => s.memberships.length > 0)
  const user = usePartnerAuth((s) => s.user)
  const draftKey = applyDraftKey(user?.id)
  const [saved] = useState(() => loadDraft(draftKey))
  const [draft, setDraft] = useState<Draft>(saved.draft)
  const [step, setStep] = useState(saved.step) // a reload resumes on the same step
  const [dir, setDir] = useState(1)
  const [errors, setErrors] = useState<Errors>({})
  const review = step === STEPS.length

  useEffect(() => {
    try {
      localStorage.setItem(draftKey, JSON.stringify({ draft, step } satisfies Saved))
    } catch {
      /* private mode */
    }
  }, [draft, step, draftKey])

  // pre-fill the contact name from the account once — unless it's still the generated "Player 1234"
  useEffect(() => {
    if (!isPlaceholderName(user?.name, user?.name_is_default) && !draft.contact_name) setDraft((d) => ({ ...d, contact_name: user!.name }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.name])

  const clearErrors = (...keys: string[]) => {
    if (keys.some((k) => errors[k])) setErrors((e) => Object.fromEntries(Object.entries(e).filter(([k]) => !keys.includes(k))))
  }
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => {
    setDraft((d) => ({ ...d, [k]: v }))
    // any bank field edit may fix the "fill all three" rule too
    clearErrors(k as string, ...(String(k).startsWith('bank_') ? ['bank'] : []))
  }

  const submit = useMutation({
    mutationFn: () => partnerApi.apply(toPayload(draft)),
    onSuccess: (membership) => {
      const s = usePartnerAuth.getState()
      const memberships = [...s.memberships.filter((m) => m.provider_id !== membership.provider_id), membership]
      usePartnerAuth.setState({ memberships, providerId: membership.provider_id })
      // keep the cached /me in step, or the gate would re-apply the stale (empty) list before refetching
      qc.setQueryData<PartnerMe>(pk.me, (me) => (me ? { ...me, memberships } : me))
      qc.removeQueries({ queryKey: pk.provider })
      qc.invalidateQueries({ queryKey: pk.all })
      localStorage.removeItem(draftKey)
      toast.success('Application sent', { description: 'We’ll review it within 2 working days.' })
      navigate('/partner', { replace: true })
    },
    onError: (e) => {
      toast.error(isApiError(e, 'VALIDATION_ERROR') ? 'Some details need fixing' : 'Couldn’t submit', { description: errorMessage(e) })
    },
  })

  const go = (to: number) => {
    if (to > step) {
      for (let s = step; s < Math.min(to, STEPS.length); s++) {
        const errs = validate(s, draft)
        if (Object.keys(errs).length) {
          setErrors(errs)
          setDir(s > step ? 1 : -1)
          setStep(s)
          return
        }
      }
    }
    setErrors({})
    setDir(to > step ? 1 : -1)
    setStep(to)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  return (
    <div className="relative min-h-dvh">
      <AuthBackdrop />
      <header className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-4 sm:px-6">
        <div className="flex items-center gap-2">
          <Logo to="/" />
          <span className="rounded-md bg-volt/12 px-1.5 py-0.5 text-[10px] font-bold tracking-[0.14em] text-volt uppercase ring-1 ring-volt/30">Partner</span>
        </div>
        <div className="flex items-center gap-2">
          {hasMemberships && (
            <Link to="/partner" className="hidden rounded-lg px-3 py-2 text-sm text-muted hover:bg-white/5 hover:text-fg sm:inline">
              Back to portal
            </Link>
          )}
          <ThemeToggle className="h-9 w-9 rounded-lg [&_svg]:h-[18px] [&_svg]:w-[18px]" />
          <button type="button" onClick={logout} aria-label="Log out" className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg text-muted hover:bg-white/8 hover:text-flare">
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 pb-36 sm:px-6 sm:pb-16">
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
          <div className="text-[11px] font-bold tracking-[0.2em] text-volt uppercase">List your venue on Pytch</div>
          <h1 className="mt-2 text-2xl leading-tight font-bold sm:text-3xl">Partner application</h1>
          <p className="mt-2 text-sm text-muted">Takes about 4 minutes. Your progress is saved on this device.</p>
        </motion.div>

        <StepRail step={step} onJump={(i) => i < step && go(i)} />

        <div className="glass mt-5 overflow-hidden rounded-3xl shadow-card">
          <AnimatePresence mode="wait" custom={dir} initial={false}>
            <motion.div
              key={step}
              custom={dir}
              initial={{ opacity: 0, x: dir * 36 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: dir * -36 }}
              transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
              className="p-5 sm:p-7"
            >
              {step === 0 && <BusinessStep d={draft} set={set} errors={errors} />}
              {step === 1 && <ContactStep d={draft} set={set} errors={errors} />}
              {step === 2 && <VenuesStep d={draft} setDraft={setDraft} errors={errors} clearErrors={clearErrors} />}
              {step === 3 && <BankStep d={draft} set={set} errors={errors} />}
              {step === 4 && <ChannelsStep d={draft} set={set} />}
              {review && <ReviewStep d={draft} onEdit={go} />}
            </motion.div>
          </AnimatePresence>
        </div>

        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-white/8 bg-ink-900/90 px-4 py-3 backdrop-blur-xl safe-bottom sm:static sm:mt-5 sm:border-0 sm:bg-transparent sm:p-0 sm:backdrop-blur-none">
          <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
            <Button variant="ghost" onClick={() => go(step - 1)} disabled={step === 0 || submit.isPending}>
              <ArrowLeft className="h-4 w-4" /> Back
            </Button>
            {review ? (
              <Button size="lg" loading={submit.isPending} onClick={() => submit.mutate()}>
                <Send className="h-4 w-4" /> Submit application
              </Button>
            ) : (
              <Button size="lg" onClick={() => go(step + 1)}>
                {step === STEPS.length - 1 ? 'Review' : 'Continue'} <ArrowRight className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </main>
    </div>
  )
}

function StepRail({ step, onJump }: { step: number; onJump: (i: number) => void }) {
  return (
    <ol className="mt-6 flex items-center gap-1.5 sm:gap-2" aria-label="Application steps">
      {STEPS.map((s, i) => {
        const done = i < step
        const current = i === step
        return (
          <li key={s.key} className="min-w-0 flex-1">
            <button type="button" onClick={() => onJump(i)} disabled={!done} className={cn('group w-full text-left', done && 'cursor-pointer')} aria-current={current ? 'step' : undefined}>
              <div className="h-1.5 overflow-hidden rounded-full bg-white/8">
                <motion.div className="h-full rounded-full bg-volt" initial={false} animate={{ width: done ? '100%' : current ? '45%' : '0%' }} transition={{ type: 'spring', stiffness: 120, damping: 20 }} />
              </div>
              <div className={cn('mt-2 hidden items-center gap-1.5 text-xs font-semibold sm:flex', current ? 'text-fg' : done ? 'text-volt' : 'text-muted')}>
                {done ? <Check className="h-3.5 w-3.5" /> : <s.icon className="h-3.5 w-3.5" />}
                {s.title}
              </div>
            </button>
          </li>
        )
      })}
      <li className="sr-only">{step < STEPS.length ? `Step ${step + 1} of ${STEPS.length}: ${STEPS[step]!.title}` : 'Review'}</li>
    </ol>
  )
}

function StepHead({ icon: Icon, title, text }: { icon: LucideIcon; title: string; text: string }) {
  return (
    <div className="mb-6 flex items-start gap-3">
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-volt/12 text-volt ring-1 ring-volt/30">
        <Icon className="h-5 w-5" />
      </span>
      <div>
        <h2 className="font-display text-lg font-semibold">{title}</h2>
        <p className="mt-0.5 text-sm text-muted">{text}</p>
      </div>
    </div>
  )
}

type SetFn = <K extends keyof Draft>(k: K, v: Draft[K]) => void

function BusinessStep({ d, set, errors }: { d: Draft; set: SetFn; errors: Errors }) {
  const gstOk = d.gstin.length === 15 && GSTIN_RE.test(d.gstin)
  return (
    <>
      <StepHead icon={Building2} title="Your business" text="The name players will see, and the legal details we need for invoices." />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Business / brand name" htmlFor="ap-bn" error={errors.business_name} className="sm:col-span-2">
          <TextInput id="ap-bn" value={d.business_name} onChange={(e) => set('business_name', e.target.value)} placeholder="e.g. Goal Box Kochi" aria-invalid={!!errors.business_name} autoFocus />
        </Field>
        <Field label="Registered legal name" htmlFor="ap-ln" optional hint="As on your GST / bank records.">
          <TextInput id="ap-ln" value={d.legal_name} onChange={(e) => set('legal_name', e.target.value)} placeholder="Goal Box Sports LLP" />
        </Field>
        <Field label="City" htmlFor="ap-city" error={errors.city}>
          <TextInput id="ap-city" value={d.city} onChange={(e) => set('city', e.target.value)} aria-invalid={!!errors.city} />
        </Field>
        <Field label="Entity type" className="sm:col-span-2" optional>
          <ChoiceChips size="sm" options={ENTITY_TYPES.map((t) => ({ value: t.value, label: t.label }))} value={d.entity_type} onChange={(v) => set('entity_type', d.entity_type === v ? '' : v)} />
        </Field>
        <Field
          label="GSTIN"
          htmlFor="ap-gst"
          optional
          error={errors.gstin}
          hint={gstOk ? `Looks valid · state code ${d.gstin.slice(0, 2)}${d.gstin.startsWith('32') ? ' (Kerala)' : ''}` : 'Needed for TCS credit on your settlements. You can add it later.'}
          className="sm:col-span-2"
        >
          <div className="relative">
            <TextInput
              id="ap-gst"
              value={d.gstin}
              onChange={(e) => set('gstin', e.target.value.toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 15))}
              placeholder="32ABCDE1234F1Z5"
              className="pr-16 font-mono tracking-wider uppercase"
              aria-invalid={!!errors.gstin}
              autoComplete="off"
            />
            <span className={cn('absolute top-1/2 right-3 -translate-y-1/2 font-mono text-xs', gstOk ? 'text-mint' : 'text-muted')}>
              {gstOk ? <Check className="h-4 w-4" /> : `${d.gstin.length}/15`}
            </span>
          </div>
        </Field>
      </div>
    </>
  )
}

function ContactStep({ d, set, errors }: { d: Draft; set: SetFn; errors: Errors }) {
  const phone = usePartnerAuth((s) => s.user?.phone)
  return (
    <>
      <StepHead icon={UserRound} title="Contact" text="The person our partner team talks to during onboarding." />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Contact name" htmlFor="ap-cn" error={errors.contact_name}>
          <TextInput id="ap-cn" value={d.contact_name} onChange={(e) => set('contact_name', e.target.value)} aria-invalid={!!errors.contact_name} autoComplete="name" />
        </Field>
        <Field label="Mobile" hint="Your login number — verified by OTP.">
          <TextInput value={phone ?? ''} disabled className="font-mono" />
        </Field>
        <Field label="Email" htmlFor="ap-em" optional error={errors.contact_email} className="sm:col-span-2" hint="Statements and payout advice go here.">
          <TextInput id="ap-em" type="email" value={d.contact_email} onChange={(e) => set('contact_email', e.target.value)} placeholder="owner@goalbox.in" aria-invalid={!!errors.contact_email} autoComplete="email" />
        </Field>
        <Field label="Business address" htmlFor="ap-ad" error={errors.address} className="sm:col-span-2">
          <textarea
            id="ap-ad"
            value={d.address}
            onChange={(e) => set('address', e.target.value)}
            rows={3}
            placeholder="Building, street, area, PIN"
            aria-invalid={!!errors.address}
            className="w-full resize-none rounded-xl bg-white/5 p-3.5 text-[15px] text-fg ring-1 ring-white/10 outline-none placeholder:text-subtle focus:ring-2 focus:ring-volt/70 aria-[invalid=true]:ring-flare/70"
          />
        </Field>
      </div>
    </>
  )
}

function VenuesStep({
  d,
  setDraft,
  errors,
  clearErrors,
}: {
  d: Draft
  setDraft: React.Dispatch<React.SetStateAction<Draft>>
  errors: Errors
  clearErrors: (...keys: string[]) => void
}) {
  const meta = useMeta()
  const areas = meta.data?.areas.map((a) => a.name) ?? []
  const sports = meta.data?.sports.map((s) => s.key) ?? SPORT_LIST
  const sport = (k: string) => sportInfo(k, meta.data?.sports.find((s) => s.key === k))
  const patch = (i: number, p: Partial<ApplicationVenue>) => {
    setDraft((dr) => ({ ...dr, venues: dr.venues.map((v, j) => (j === i ? { ...v, ...p } : v)) }))
    clearErrors(...Object.keys(p).map((k) => `v${i}.${k}`)) // fixing a field clears its error straight away
  }
  return (
    <>
      <StepHead icon={MapPin} title="Your venues" text="Add each location you run. You’ll set pitches, prices and photos after approval." />
      <div className="space-y-4">
        <AnimatePresence initial={false}>
          {d.venues.map((v, i) => (
            <motion.div
              key={i}
              layout
              initial={{ opacity: 0, y: 12, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96, height: 0 }}
              className="rounded-2xl bg-white/[0.03] p-4 ring-1 ring-white/10 sm:p-5"
            >
              <div className="mb-4 flex items-center justify-between">
                <span className="flex items-center gap-2 text-sm font-semibold">
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/8 font-mono text-xs">{i + 1}</span>
                  {v.name || 'New venue'}
                </span>
                {d.venues.length > 1 && (
                  <button
                    type="button"
                    onClick={() => {
                      setDraft((dr) => ({ ...dr, venues: dr.venues.filter((_, j) => j !== i) }))
                      clearErrors(...Object.keys(errors).filter((k) => k.startsWith('v')))
                    }}
                    className="flex h-9 cursor-pointer items-center gap-1.5 rounded-lg px-2.5 text-xs text-muted hover:bg-flare/10 hover:text-flare"
                  >
                    <Trash2 className="h-4 w-4" /> Remove
                  </button>
                )}
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Venue name" error={errors[`v${i}.name`]} htmlFor={`ap-v${i}-n`}>
                  <TextInput id={`ap-v${i}-n`} value={v.name} onChange={(e) => patch(i, { name: e.target.value })} placeholder="Goal Box Kakkanad" aria-invalid={!!errors[`v${i}.name`]} />
                </Field>
                <Field label="Area" error={errors[`v${i}.area`]} htmlFor={`ap-v${i}-a`}>
                  <Select id={`ap-v${i}-a`} value={v.area} onChange={(a) => patch(i, { area: a })} options={[{ value: '', label: 'Choose an area…' }, ...areas.map((a) => ({ value: a, label: a }))]} />
                </Field>
                <Field label="Street address" error={errors[`v${i}.address`]} htmlFor={`ap-v${i}-ad`} className="sm:col-span-2">
                  <TextInput id={`ap-v${i}-ad`} value={v.address} onChange={(e) => patch(i, { address: e.target.value })} placeholder="Near Infopark Phase 1, Kakkanad" aria-invalid={!!errors[`v${i}.address`]} />
                </Field>
                <Field label="Sports" error={errors[`v${i}.sports`]} className="sm:col-span-2">
                  <ChoiceChips
                    size="sm"
                    options={sports.map((s) => ({ value: s, label: `${sport(s).emoji} ${sport(s).label}` }))}
                    value={v.sports}
                    onChange={(s: Sport) => patch(i, { sports: v.sports.includes(s) ? v.sports.filter((x) => x !== s) : [...v.sports, s] })}
                  />
                </Field>
                <Field label="Pitches / courts">
                  <Stepper value={v.pitch_count} onChange={(n) => patch(i, { pitch_count: n })} min={1} max={20} />
                </Field>
                <Field label="Indoor / covered">
                  <div className="flex h-10 items-center gap-3">
                    <Switch checked={v.has_indoor} onChange={(b) => patch(i, { has_indoor: b })} label="Has indoor or covered pitches" />
                    <span className="text-sm text-muted">{v.has_indoor ? 'Yes — rain-proof' : 'Open-air only'}</span>
                  </div>
                </Field>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
        {d.venues.length < 10 && (
          <button
            type="button"
            onClick={() => setDraft((dr) => ({ ...dr, venues: [...dr.venues, emptyVenue()] }))}
            className="flex h-14 w-full cursor-pointer items-center justify-center gap-2 rounded-2xl border border-dashed border-white/15 text-sm font-semibold text-muted transition hover:border-volt/50 hover:text-volt"
          >
            <Plus className="h-4 w-4" /> Add another venue
          </button>
        )}
      </div>
    </>
  )
}

function BankStep({ d, set, errors }: { d: Draft; set: SetFn; errors: Errors }) {
  return (
    <>
      <StepHead icon={Landmark} title="Payout account" text="Where your weekly Pytch settlements are paid. Optional now — required before your first payout." />
      <div className="mb-5 rounded-2xl bg-electric/8 p-4 text-sm ring-1 ring-electric/25">
        We only store the <b>last 4 digits</b> of your account number here. Our partner team confirms the full details with you on a verification call.
      </div>
      {errors.bank && <p className="mb-4 text-sm text-flare">{errors.bank}</p>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Account holder name" htmlFor="ap-ban" className="sm:col-span-2" optional>
          <TextInput id="ap-ban" value={d.bank_account_name} onChange={(e) => set('bank_account_name', e.target.value)} placeholder="Goal Box Sports LLP" />
        </Field>
        <Field label="IFSC" htmlFor="ap-ifsc" error={errors.bank_ifsc} optional hint={IFSC_RE.test(d.bank_ifsc) ? `Bank code ${d.bank_ifsc.slice(0, 4)} · branch ${d.bank_ifsc.slice(5)}` : undefined}>
          <TextInput
            id="ap-ifsc"
            value={d.bank_ifsc}
            onChange={(e) => set('bank_ifsc', e.target.value.toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 11))}
            placeholder="HDFC0001234"
            className="font-mono tracking-wider"
            aria-invalid={!!errors.bank_ifsc}
          />
        </Field>
        <Field label="Account number — last 4" htmlFor="ap-l4" error={errors.bank_account_last4} optional>
          <div className="flex items-center gap-2">
            <span className="font-mono text-muted">•••• ••••</span>
            <TextInput
              id="ap-l4"
              inputMode="numeric"
              value={d.bank_account_last4}
              onChange={(e) => set('bank_account_last4', e.target.value.replace(/\D/g, '').slice(0, 4))}
              placeholder="1234"
              className="w-28 font-mono tracking-[0.3em]"
              aria-invalid={!!errors.bank_account_last4}
            />
          </div>
        </Field>
      </div>
    </>
  )
}

function ChannelsStep({ d, set }: { d: Draft; set: SetFn }) {
  return (
    <>
      <StepHead icon={Cable} title="Where else do you sell?" text="So we can set up your calendar to stay consistent across every channel." />
      <ChoiceChips
        options={LISTED_ON.map((o) => ({ value: o.value, label: o.label, icon: SOURCES[o.value].icon, color: SOURCES[o.value].color }))}
        value={d.listed_on}
        onChange={(v) => set('listed_on', d.listed_on.includes(v) ? d.listed_on.filter((x) => x !== v) : [...d.listed_on, v])}
      />
      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        <Tip title="Pytch becomes your master calendar">Everything that fills a pitch lands in one live grid — bookings from Pytch lock slots instantly.</Tip>
        <Tip title="Other apps? Mirror in two taps">Playo, Hudle and KheloMore don’t offer calendar sync. When a booking comes in there, quick-block the slot here so it can’t be double-sold.</Tip>
      </div>
    </>
  )
}

function Tip({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl bg-white/[0.03] p-4 ring-1 ring-white/8">
      <div className="text-sm font-semibold">{title}</div>
      <p className="mt-1 text-sm text-muted">{children}</p>
    </div>
  )
}

function ReviewStep({ d, onEdit }: { d: Draft; onEdit: (step: number) => void }) {
  const meta = useMeta()
  const emoji = (k: string) => sportInfo(k, meta.data?.sports.find((s) => s.key === k)).emoji
  const totalPitches = useMemo(() => d.venues.reduce((n, v) => n + v.pitch_count, 0), [d.venues])
  const Section = ({ i, children }: { i: number; children: React.ReactNode }) => (
    <div className="rounded-2xl bg-white/[0.03] p-4 ring-1 ring-white/8">
      <div className="mb-2 flex items-center justify-between">
        <span className="flex items-center gap-2 text-xs font-bold tracking-wider text-muted uppercase">
          {(() => {
            const Icon = STEPS[i]!.icon
            return <Icon className="h-3.5 w-3.5" />
          })()}
          {STEPS[i]!.title}
        </span>
        <button type="button" onClick={() => onEdit(i)} className="cursor-pointer rounded-lg px-2 py-1 text-xs font-semibold text-volt hover:bg-volt/10">
          Edit
        </button>
      </div>
      <div className="text-sm">{children}</div>
    </div>
  )
  return (
    <>
      <StepHead icon={Send} title="Review & submit" text="Check everything once. Our team reviews applications within 2 working days." />
      <div className="grid gap-3 sm:grid-cols-2">
        <Section i={0}>
          <div className="font-semibold">{d.business_name}</div>
          <div className="text-muted">{[d.legal_name, ENTITY_TYPES.find((t) => t.value === d.entity_type)?.label, d.city].filter(Boolean).join(' · ')}</div>
          <div className="mt-1 font-mono text-xs text-muted">{d.gstin ? `GSTIN ${d.gstin}` : 'No GSTIN yet'}</div>
        </Section>
        <Section i={1}>
          <div className="font-semibold">{d.contact_name}</div>
          <div className="text-muted">{d.contact_email || 'No email'}</div>
          <div className="mt-1 line-clamp-2 text-xs text-muted">{d.address}</div>
        </Section>
        <Section i={2}>
          <div className="font-semibold">
            {d.venues.length} venue{d.venues.length === 1 ? '' : 's'} · {totalPitches} pitch{totalPitches === 1 ? '' : 'es'}
          </div>
          <ul className="mt-1 space-y-0.5 text-muted">
            {d.venues.map((v, i) => (
              <li key={i} className="truncate">
                {v.name} — {v.area} · {v.sports.map(emoji).join(' ')}
              </li>
            ))}
          </ul>
        </Section>
        <Section i={3}>
          {d.bank_ifsc ? (
            <>
              <div className="font-semibold">{d.bank_account_name}</div>
              <div className="font-mono text-xs text-muted">
                {d.bank_ifsc} · •••• {d.bank_account_last4}
              </div>
            </>
          ) : (
            <div className="text-muted">Add later from Settings</div>
          )}
        </Section>
        <Section i={4}>
          <div className="text-muted">{d.listed_on.length ? d.listed_on.map((s) => LISTED_ON.find((o) => o.value === s)?.label).join(', ') : 'Pytch only'}</div>
        </Section>
      </div>
      <p className="mt-5 text-xs text-muted">
        By submitting you confirm you’re authorised to list these venues and agree to Pytch’s partner terms: a commission on Pytch bookings only (never on your walk-ins or phone bookings),
        weekly settlements, and statutory TCS/TDS deductions.
      </p>
    </>
  )
}
