import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, ArrowRight, BadgeCheck, Check, Info, LocateFixed, LogOut, MapPin } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { Logo } from '@/components/layout/Logo'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { TierBadge, SportBadge } from '@/components/ui/PlayerBits'
import { Segmented } from '@/components/ui/Segmented'
import { Skeleton } from '@/components/ui/States'
import { ThemeToggle } from '@/components/ui/ThemeToggle'
import { useMe } from '@/hooks/useMe'
import { useMeta } from '@/hooks/useMeta'
import { errorMessage } from '@/lib/api/client'
import { api } from '@/lib/api/endpoints'
import { qk } from '@/lib/api/queryKeys'
import { celebrate } from '@/lib/celebrate'
import { cn } from '@/lib/cn'
import { SPORTS, SPORT_LIST } from '@/lib/sports'
import { useAuth } from '@/stores/auth'
import { requestGps, useLocationStore } from '@/stores/location'
import type { AreaMeta, DominantFoot, SkillLevel, Sport, SportMeta, UserMe } from '@/types/api'
import { AuthBackdrop } from './AuthBackdrop'

const STEPS = ['Name', 'Sports', 'Your game', 'Home turf', 'Done'] as const

const POSITIONS: Record<Sport, string[]> = {
  football: ['Goalkeeper', 'Defender', 'Midfielder', 'Forward', 'Anywhere'],
  cricket: ['Batter', 'Bowler', 'All-rounder', 'Wicket-keeper'],
  badminton: ['Singles', 'Doubles', 'Mixed'],
  pickleball: ['Singles', 'Doubles'],
  basketball: ['Guard', 'Forward', 'Center'],
}

const LEVELS: { value: SkillLevel; emoji: string; label: string; hint: string }[] = [
  { value: 'beginner', emoji: '🌱', label: 'Beginner', hint: 'Just getting into it' },
  { value: 'intermediate', emoji: '⚡', label: 'Intermediate', hint: 'Play most weeks' },
  { value: 'advanced', emoji: '🔥', label: 'Advanced', hint: 'Club or college level' },
  { value: 'pro', emoji: '🏆', label: 'Pro', hint: 'Competitive / academy' },
]

/** Used only if /meta is unavailable. */
const FALLBACK_AREAS: AreaMeta[] = [
  { name: 'Kaloor', lat: 9.9975, lng: 76.2926 },
  { name: 'Edappally', lat: 10.0261, lng: 76.3083 },
  { name: 'Kakkanad', lat: 10.0159, lng: 76.3419 },
  { name: 'Palarivattom', lat: 10.0033, lng: 76.3074 },
  { name: 'Vyttila', lat: 9.9696, lng: 76.3183 },
  { name: 'Kadavanthra', lat: 9.9667, lng: 76.2999 },
  { name: 'Panampilly Nagar', lat: 9.9577, lng: 76.2966 },
  { name: 'Fort Kochi', lat: 9.9658, lng: 76.2421 },
]

interface Draft {
  name: string
  sports: Sport[]
  position: string | null
  level: SkillLevel | null
  foot: DominantFoot | null
  area: string | null
  lat: number | null
  lng: number | null
}

const isDefaultName = (n: string) => /^player\s*\d*$/i.test(n.trim())

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371
  const dLat = ((b.lat - a.lat) * Math.PI) / 180
  const dLng = ((b.lng - a.lng) * Math.PI) / 180
  const s = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(s))
}

function safeNext(next: string | null) {
  return next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/onboarding') ? next : '/app'
}

export default function OnboardingPage() {
  const { user } = useMe()
  const meta = useMeta()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const logout = useAuth((s) => s.logout)

  const [step, setStep] = useState(0)
  const [dir, setDir] = useState(1)
  const [draft, setDraft] = useState<Draft>(() => fromUser(user))
  const headingRef = useRef<HTMLHeadingElement>(null)

  const sports: SportMeta[] = useMemo(
    () => meta.data?.sports ?? SPORT_LIST.map((key) => ({ key, label: SPORTS[key].label, emoji: SPORTS[key].emoji, formats: [] })),
    [meta.data],
  )
  const areas = meta.data?.areas ?? (meta.isError ? FALLBACK_AREAS : null)

  const patch = (p: Partial<Draft>) => setDraft((d) => ({ ...d, ...p }))

  const valid = [
    draft.name.trim().length >= 2 && draft.name.trim().length <= 40 && !isDefaultName(draft.name),
    draft.sports.length > 0,
    draft.level !== null,
    draft.area !== null || (draft.lat !== null && draft.lng !== null),
    true,
  ][step]

  const save = useMutation({
    mutationFn: () =>
      api.users.update({
        name: draft.name.trim(),
        preferred_sports: draft.sports,
        position: draft.position,
        self_skill_level: draft.level,
        dominant_foot: draft.sports.includes('football') ? draft.foot : null,
        home_area: draft.area,
        home_lat: draft.lat,
        home_lng: draft.lng,
        onboarded: true,
      }),
    onSuccess: (updated: UserMe) => {
      useAuth.getState().setUser(updated)
      qc.setQueryData(qk.me, updated)
      if (updated.home_lat != null && updated.home_lng != null && useLocationStore.getState().source !== 'gps')
        useLocationStore.getState().set(updated.home_lat, updated.home_lng, 'home', updated.home_area ?? 'Home')
      navigate(safeNext(params.get('next')), { replace: true })
    },
    onError: (e) => toast.error('Couldn’t save your profile', { description: errorMessage(e) }),
  })

  const go = (to: number) => {
    setDir(to > step ? 1 : -1)
    setStep(to)
  }
  const next = () => {
    if (!valid) return
    if (step === STEPS.length - 1) save.mutate()
    else go(step + 1)
  }

  // hydrate the draft if the profile arrives after first paint (and nothing was typed yet)
  const hydrated = useRef(!!user)
  useEffect(() => {
    if (hydrated.current || !user) return
    hydrated.current = true
    setDraft((d) => (d.name || d.sports.length ? d : fromUser(user)))
  }, [user])

  // move focus to the new step's heading for screen readers (step 0 keeps the name input's autofocus)
  const shownStep = useRef(step)
  useEffect(() => {
    if (shownStep.current === step) return
    shownStep.current = step
    headingRef.current?.focus({ preventScroll: true })
    if (step === STEPS.length - 1) celebrate()
  }, [step])

  return (
    <div className="relative flex min-h-dvh flex-col">
      <AuthBackdrop />
      <header className="mx-auto flex w-full max-w-3xl items-center justify-between px-5 pt-6 sm:px-8">
        <Logo to="/" />
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              logout()
              navigate('/login', { replace: true })
            }}
            className="flex cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1 text-sm text-muted transition hover:bg-white/5 hover:text-fg"
          >
            <LogOut className="h-4 w-4" /> Log out
          </button>
          <ThemeToggle className="h-9 w-9 rounded-lg [&_svg]:h-[18px] [&_svg]:w-[18px]" />
        </div>
      </header>

      <div className="mx-auto w-full max-w-3xl px-5 pt-8 sm:px-8">
        <div className="flex items-center justify-between text-xs font-semibold tracking-wider text-muted uppercase">
          <span>
            Step {step + 1} of {STEPS.length}
          </span>
          <span className="text-fg/70">{STEPS[step]}</span>
        </div>
        <div className="mt-3 grid grid-cols-5 gap-1.5" role="progressbar" aria-valuemin={1} aria-valuemax={STEPS.length} aria-valuenow={step + 1} aria-label="Onboarding progress">
          {STEPS.map((s, i) => (
            <div key={s} className="h-1.5 overflow-hidden rounded-full bg-white/8">
              <motion.div
                className="h-full rounded-full bg-gradient-to-r from-volt to-mint"
                initial={false}
                animate={{ width: i <= step ? '100%' : '0%' }}
                transition={{ type: 'spring', stiffness: 120, damping: 20, delay: i === step ? 0.1 : 0 }}
              />
            </div>
          ))}
        </div>
      </div>

      <form
        className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-5 pt-10 pb-8 sm:px-8"
        onSubmit={(e) => {
          e.preventDefault()
          next()
        }}
      >
        <div className="relative flex-1">
          <AnimatePresence mode="wait" custom={dir}>
            <motion.section
              key={step}
              custom={dir}
              variants={slide}
              initial="enter"
              animate="center"
              exit="exit"
              aria-labelledby="step-title"
            >
              {step === 0 && (
                <StepName
                  headingRef={headingRef}
                  name={draft.name}
                  userId={user?.id ?? 'me'}
                  onChange={(name) => patch({ name })}
                  defaultName={user?.name && isDefaultName(user.name) ? user.name : null}
                />
              )}
              {step === 1 && (
                <StepSports
                  headingRef={headingRef}
                  sports={sports}
                  selected={draft.sports}
                  onToggle={(s) =>
                    patch({
                      sports: draft.sports.includes(s) ? draft.sports.filter((x) => x !== s) : [...draft.sports, s],
                      position: null,
                    })
                  }
                />
              )}
              {step === 2 && <StepGame headingRef={headingRef} draft={draft} patch={patch} />}
              {step === 3 && <StepArea headingRef={headingRef} draft={draft} patch={patch} areas={areas} />}
              {step === 4 && <StepDone headingRef={headingRef} draft={draft} userId={user?.id ?? 'me'} />}
            </motion.section>
          </AnimatePresence>
        </div>

        <div className="sticky bottom-0 mt-10 -mx-5 flex items-center justify-between gap-3 bg-gradient-to-t from-ink-900 via-ink-900/90 to-transparent px-5 pt-6 pb-2 sm:static sm:mx-0 sm:bg-none sm:px-0">
          <Button type="button" variant="ghost" onClick={() => go(step - 1)} disabled={step === 0 || save.isPending} className={cn(step === 0 && 'invisible')}>
            <ArrowLeft className="h-4 w-4" /> Back
          </Button>
          <Button type="submit" size="lg" disabled={!valid} loading={save.isPending} className="min-w-44">
            {step === STEPS.length - 1 ? 'Start playing' : 'Continue'}
            {!save.isPending && <ArrowRight className="h-5 w-5" />}
          </Button>
        </div>
      </form>
    </div>
  )
}

function fromUser(u: UserMe | null): Draft {
  return {
    name: u && !isDefaultName(u.name) ? u.name : '',
    sports: u?.preferred_sports ?? [],
    position: u?.position ?? null,
    level: u?.self_skill_level ?? null,
    foot: u?.dominant_foot ?? null,
    area: u?.home_area ?? null,
    lat: u?.home_lat ?? null,
    lng: u?.home_lng ?? null,
  }
}

const slide = {
  enter: (d: number) => ({ opacity: 0, x: d * 60, filter: 'blur(6px)' }),
  center: { opacity: 1, x: 0, filter: 'blur(0px)', transition: { type: 'spring' as const, stiffness: 240, damping: 28 } },
  exit: (d: number) => ({ opacity: 0, x: d * -60, filter: 'blur(6px)', transition: { duration: 0.18 } }),
}

type HeadingRef = React.RefObject<HTMLHeadingElement | null>

function StepHeading({ headingRef, eyebrow, title, sub }: { headingRef: HeadingRef; eyebrow: string; title: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="mb-8">
      <div className="mb-2 text-xs font-bold tracking-[0.22em] text-volt uppercase">{eyebrow}</div>
      <h1 id="step-title" ref={headingRef} tabIndex={-1} className="text-3xl leading-tight font-bold outline-none sm:text-4xl">
        {title}
      </h1>
      {sub && <p className="mt-3 max-w-lg text-muted">{sub}</p>}
    </div>
  )
}

/** Light mode lifts the translucent choice tiles onto solid white surfaces (dark keeps its tint). */
const LIGHT_SURFACE = '[[data-theme=light]_&]:bg-ink-800 [[data-theme=light]_&]:shadow-card'

const stagger = { hidden: {}, show: { transition: { staggerChildren: 0.05, delayChildren: 0.08 } } }
const pop = { hidden: { opacity: 0, y: 14, scale: 0.96 }, show: { opacity: 1, y: 0, scale: 1, transition: { type: 'spring' as const, stiffness: 300, damping: 24 } } }

// ───────────────────────────── Step 1: name ─────────────────────────────

function StepName({
  headingRef,
  name,
  userId,
  onChange,
  defaultName,
}: {
  headingRef: HeadingRef
  name: string
  userId: string
  onChange: (v: string) => void
  defaultName: string | null
}) {
  const trimmed = name.trim()
  return (
    <>
      <StepHeading headingRef={headingRef} eyebrow="Welcome to PYTCH" title={<>What do teammates <span className="text-volt">call you?</span></>} sub="This is what shows up on lobby seats, the leaderboard and your player card." />
      <div className="flex items-center gap-5">
        <motion.div key={trimmed.slice(0, 2)} initial={{ scale: 0.8, rotate: -8 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 400, damping: 18 }}>
          <Avatar user={{ id: userId, name: trimmed || '?', avatar_url: null }} size="xl" />
        </motion.div>
        <div className="flex-1">
          <label htmlFor="ob-name" className="sr-only">
            Your name
          </label>
          <input
            id="ob-name"
            autoFocus
            autoComplete="name"
            value={name}
            maxLength={40}
            onChange={(e) => onChange(e.target.value)}
            placeholder={defaultName ? 'e.g. Arjun Menon' : 'Your name'}
            className="w-full border-b-2 border-white/15 bg-transparent pb-2 font-display text-2xl text-fg transition outline-none placeholder:text-subtle focus:border-volt sm:text-3xl"
          />
          <div className="mt-2 flex justify-between text-xs text-subtle">
            <span>{trimmed.length > 0 && trimmed.length < 2 ? 'A little longer…' : isDefaultName(name) && name ? 'Pick something your squad knows you by' : 'First name is fine'}</span>
            <span className="font-mono">{name.length}/40</span>
          </div>
        </div>
      </div>
    </>
  )
}

// ───────────────────────────── Step 2: sports ─────────────────────────────

function StepSports({ headingRef, sports, selected, onToggle }: { headingRef: HeadingRef; sports: SportMeta[]; selected: Sport[]; onToggle: (s: Sport) => void }) {
  return (
    <>
      <StepHeading headingRef={headingRef} eyebrow="Pick your games" title="What do you play?" sub="Choose all that apply — we’ll tune your feed, Quick Match and bench alerts." />
      <motion.div variants={stagger} initial="hidden" animate="show" className="grid grid-cols-2 gap-3 sm:grid-cols-3" role="group" aria-label="Sports">
        {sports.map((s) => {
          const on = selected.includes(s.key)
          const color = SPORTS[s.key]?.color ?? 'var(--color-volt)'
          return (
            <motion.button
              key={s.key}
              type="button"
              variants={pop}
              whileHover={{ y: -4 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => onToggle(s.key)}
              aria-pressed={on}
              className={cn(
                'group relative flex cursor-pointer flex-col items-start overflow-hidden rounded-3xl p-4 text-left ring-1 transition-[background,box-shadow] sm:p-5',
                on ? 'bg-white/8' : 'bg-white/4 ring-white/10 hover:bg-white/6',
                LIGHT_SURFACE,
              )}
              style={on ? { boxShadow: `inset 0 0 0 2px ${color}, 0 18px 40px -18px ${color}` } : undefined}
            >
              <span aria-hidden className="pointer-events-none absolute -top-8 -right-8 h-24 w-24 rounded-full blur-2xl transition-opacity" style={{ background: color, opacity: on ? 0.28 : 0 }} />
              <motion.span
                aria-hidden
                className="text-5xl"
                animate={on ? { rotate: [0, -14, 10, 0], scale: [1, 1.2, 1] } : { rotate: 0, scale: 1 }}
                transition={{ duration: 0.5 }}
              >
                {s.emoji}
              </motion.span>
              <span className="mt-4 font-display text-lg">{s.label}</span>
              {s.formats.length > 0 && <span className="mt-0.5 text-xs text-muted">{s.formats.join(' · ')}</span>}
              <AnimatePresence>
                {on && (
                  <motion.span
                    initial={{ scale: 0, rotate: -90 }}
                    animate={{ scale: 1, rotate: 0 }}
                    exit={{ scale: 0 }}
                    transition={{ type: 'spring', stiffness: 500, damping: 20 }}
                    className="absolute top-3 right-3 flex h-6 w-6 items-center justify-center rounded-full text-ink-950"
                    style={{ background: color }}
                  >
                    <Check className="h-4 w-4" strokeWidth={3} />
                  </motion.span>
                )}
              </AnimatePresence>
            </motion.button>
          )
        })}
      </motion.div>
      <p className="mt-4 text-sm text-subtle" aria-live="polite">
        {selected.length === 0 ? 'Pick at least one.' : `${selected.length} selected`}
      </p>
    </>
  )
}

// ───────────────────────────── Step 3: position / level / foot ─────────────────────────────

function StepGame({ headingRef, draft, patch }: { headingRef: HeadingRef; draft: Draft; patch: (p: Partial<Draft>) => void }) {
  const primary = draft.sports[0] ?? 'football'
  const positions = POSITIONS[primary]
  const football = draft.sports.includes('football')
  return (
    <>
      <StepHeading headingRef={headingRef} eyebrow="Your game" title={<>How do you <span className="text-volt">play?</span></>} />

      <fieldset>
        <legend className="mb-3 text-xs font-semibold tracking-wider text-muted uppercase">
          Position <span className="normal-case">· {SPORTS[primary].emoji} {SPORTS[primary].label}</span>
        </legend>
        <div className="flex flex-wrap gap-2" role="radiogroup">
          {positions.map((p) => {
            const on = draft.position === p
            return (
              <motion.button
                key={p}
                type="button"
                role="radio"
                aria-checked={on}
                whileTap={{ scale: 0.94 }}
                onClick={() => patch({ position: on ? null : p })}
                className={cn(
                  'h-10 cursor-pointer rounded-full px-4 text-sm font-medium ring-1 transition',
                  on ? 'bg-volt text-ink-950 ring-volt shadow-[0_0_24px_-6px_color-mix(in_srgb,_var(--color-volt)_70%,_transparent)]' : 'bg-white/5 text-fg/80 ring-white/10 hover:bg-white/10',
                )}
              >
                {p}
              </motion.button>
            )
          })}
        </div>
      </fieldset>

      <fieldset className="mt-8">
        <legend className="mb-3 text-xs font-semibold tracking-wider text-muted uppercase">How good are you, honestly?</legend>
        <motion.div variants={stagger} initial="hidden" animate="show" className="grid grid-cols-2 gap-3 sm:grid-cols-4" role="radiogroup">
          {LEVELS.map((l) => {
            const on = draft.level === l.value
            return (
              <motion.button
                key={l.value}
                type="button"
                role="radio"
                aria-checked={on}
                variants={pop}
                whileHover={{ y: -3 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => patch({ level: l.value })}
                className={cn(
                  'relative cursor-pointer rounded-2xl p-4 text-left ring-1 transition',
                  on ? 'bg-volt/10 ring-2 ring-volt' : cn('bg-white/4 ring-white/10 hover:bg-white/7', LIGHT_SURFACE),
                )}
              >
                <span className="text-2xl" aria-hidden>
                  {l.emoji}
                </span>
                <span className="mt-2 block font-semibold">{l.label}</span>
                <span className="block text-xs text-muted">{l.hint}</span>
                {on && (
                  <motion.span layoutId="level-check" className="absolute top-3 right-3 flex h-5 w-5 items-center justify-center rounded-full bg-volt text-ink-950">
                    <Check className="h-3 w-3" strokeWidth={3.5} />
                  </motion.span>
                )}
              </motion.button>
            )
          })}
        </motion.div>
        <div className="mt-4 flex gap-3 rounded-2xl bg-grape/10 p-4 text-sm text-fg/85 ring-1 ring-grape/30">
          <BadgeCheck className="mt-0.5 h-5 w-5 shrink-0 text-[var(--color-grape-soft)]" />
          <p>
            <span className="font-semibold text-[#cdbbff] [[data-theme=light]_&]:text-grape">Your True Skill is earned from peer ratings</span> — this is just a starting hint so
            your first games are a fair match. After each game your teammates rate you anonymously.
          </p>
        </div>
      </fieldset>

      {football && (
        <fieldset className="mt-8">
          <legend className="mb-3 text-xs font-semibold tracking-wider text-muted uppercase">Stronger foot</legend>
          <Segmented<DominantFoot>
            value={draft.foot ?? ('' as DominantFoot)}
            onChange={(foot) => patch({ foot })}
            options={[
              { value: 'left', label: '🦶 Left' },
              { value: 'right', label: 'Right 🦶' },
              { value: 'both', label: 'Both' },
            ]}
          />
        </fieldset>
      )}
    </>
  )
}

// ───────────────────────────── Step 4: area ─────────────────────────────

function StepArea({ headingRef, draft, patch, areas }: { headingRef: HeadingRef; draft: Draft; patch: (p: Partial<Draft>) => void; areas: AreaMeta[] | null }) {
  const [locating, setLocating] = useState(false)

  const useMyLocation = async () => {
    setLocating(true)
    const pos = await requestGps()
    setLocating(false)
    if (useLocationStore.getState().source !== 'gps') {
      toast('Couldn’t get your location', { description: 'Pick your area from the list instead.' })
      return
    }
    const nearest = (areas ?? FALLBACK_AREAS).reduce<{ a: AreaMeta; d: number } | null>((best, a) => {
      const d = haversineKm(pos, a)
      return !best || d < best.d ? { a, d } : best
    }, null)
    patch({ lat: pos.lat, lng: pos.lng, area: nearest && nearest.d < 15 ? nearest.a.name : 'Near me' })
  }

  return (
    <>
      <StepHeading headingRef={headingRef} eyebrow="Home turf" title={<>Where do you <span className="text-volt">usually play?</span></>} sub="We use this for distance, Quick Match and nearby SOS alerts. Only an area — never your exact location." />

      <motion.button
        type="button"
        onClick={useMyLocation}
        disabled={locating}
        whileTap={{ scale: 0.97 }}
        className="group flex w-full cursor-pointer items-center gap-4 rounded-2xl bg-electric/10 p-4 text-left ring-1 ring-electric/30 transition hover:bg-electric/15 disabled:opacity-60"
      >
        <span className="relative flex h-11 w-11 items-center justify-center rounded-full bg-electric text-ink-950">
          {locating && <span className="absolute inset-0 animate-pulse-ring rounded-full bg-electric/60" />}
          <LocateFixed className={cn('relative h-5 w-5', locating && 'animate-spin')} />
        </span>
        <span className="flex-1">
          <span className="block font-semibold">{locating ? 'Finding you…' : 'Use my location'}</span>
          <span className="block text-sm text-muted">Snaps to the nearest area</span>
        </span>
        <ArrowRight className="h-5 w-5 text-electric transition-transform group-hover:translate-x-1" />
      </motion.button>

      <div className="mt-6 mb-3 text-xs font-semibold tracking-wider text-muted uppercase">Or pick an area</div>
      {areas ? (
        <motion.div variants={stagger} initial="hidden" animate="show" className="flex flex-wrap gap-2" role="radiogroup" aria-label="Areas">
          {areas.map((a) => {
            const on = draft.area === a.name
            return (
              <motion.button
                key={a.name}
                type="button"
                role="radio"
                aria-checked={on}
                variants={pop}
                whileTap={{ scale: 0.94 }}
                onClick={() => patch({ area: a.name, lat: a.lat, lng: a.lng })}
                className={cn(
                  'inline-flex h-10 cursor-pointer items-center gap-1.5 rounded-full px-4 text-sm font-medium ring-1 transition',
                  on ? 'bg-volt text-ink-950 ring-volt shadow-[0_0_24px_-6px_color-mix(in_srgb,_var(--color-volt)_70%,_transparent)]' : 'bg-white/5 text-fg/80 ring-white/10 hover:bg-white/10',
                )}
              >
                {on && <MapPin className="h-3.5 w-3.5" />}
                {a.name}
              </motion.button>
            )
          })}
        </motion.div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-10 w-28 rounded-full" />
          ))}
        </div>
      )}

      <AnimatePresence>
        {draft.area && (
          <motion.div
            initial={{ opacity: 0, y: 10, height: 0 }}
            animate={{ opacity: 1, y: 0, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="mt-6 flex items-center gap-3 rounded-2xl bg-white/4 p-4 ring-1 ring-white/8">
              <span className="relative flex h-10 w-10 items-center justify-center">
                <span className="absolute inset-0 animate-pulse-ring rounded-full bg-volt/40" />
                <MapPin className="relative h-5 w-5 text-volt" />
              </span>
              <div className="text-sm">
                <div className="font-semibold">{draft.area}</div>
                <div className="text-muted">Games and subs near here will find you first.</div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <p className="mt-4 flex items-center gap-1.5 text-xs text-subtle">
        <Info className="h-3.5 w-3.5" /> You can change this any time from your profile.
      </p>
    </>
  )
}

// ───────────────────────────── Step 5: done ─────────────────────────────

function StepDone({ headingRef, draft, userId }: { headingRef: HeadingRef; draft: Draft; userId: string }) {
  const level = LEVELS.find((l) => l.value === draft.level)
  return (
    <>
      <StepHeading
        headingRef={headingRef}
        eyebrow="You’re in"
        title={
          <>
            Welcome to the squad, <span className="text-volt">{draft.name.trim().split(' ')[0]}.</span>
          </>
        }
        sub="Here’s your player card. It levels up every time you play, host, sub or get rated."
      />
      <div className="flex justify-center sm:justify-start" style={{ perspective: 1000 }}>
        <motion.div
          initial={{ rotateY: -90, opacity: 0, scale: 0.9 }}
          animate={{ rotateY: 0, opacity: 1, scale: 1 }}
          transition={{ type: 'spring', stiffness: 90, damping: 14, delay: 0.15 }}
          whileHover={{ rotateY: 8, rotateX: -4 }}
          // player card: a dark collectible in both themes
          data-theme="dark"
          className="relative w-full max-w-sm overflow-hidden rounded-[1.75rem] bg-[linear-gradient(155deg,#1d2b17_0%,#0e1712_45%,#060a08_100%)] p-6 ring-1 ring-volt/40 shadow-[0_30px_80px_-24px_color-mix(in_srgb,_var(--color-volt)_45%,_transparent)]"
        >
          <div aria-hidden className="pitch-grid absolute inset-0 opacity-50" />
          <motion.div
            aria-hidden
            className="absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-white/10 to-transparent"
            initial={{ x: '-120%' }}
            animate={{ x: '400%' }}
            transition={{ duration: 1.4, delay: 0.8, ease: [0.16, 1, 0.3, 1] }}
            style={{ skewX: -15 }}
          />
          <div className="relative flex items-start justify-between">
            <div>
              <div className="font-display text-3xl text-volt/80">NEW</div>
              <div className="mt-1 text-[10px] font-bold tracking-[0.2em] text-muted">TRUE SKILL</div>
              <TierBadge tier="rookie" className="mt-2" />
            </div>
            <Avatar user={{ id: userId, name: draft.name.trim() || '?', avatar_url: null }} size="xl" className="rounded-full ring-2 ring-volt/60 ring-offset-2 ring-offset-ink-900" />
          </div>
          <div className="relative mt-5">
            <div className="font-display text-2xl leading-tight">{draft.name.trim()}</div>
            <div className="mt-1 text-sm text-muted">
              {[draft.position, draft.foot && `${draft.foot} foot`, draft.area].filter(Boolean).join(' · ') || 'Kochi'}
            </div>
          </div>
          <div className="relative mt-4 flex flex-wrap gap-1.5">
            {draft.sports.map((s) => (
              <SportBadge key={s} sport={s} />
            ))}
          </div>
          {level && (
            <div className="relative mt-5 flex items-center justify-between rounded-2xl bg-white/5 px-4 py-3 text-sm ring-1 ring-white/8">
              <span className="text-muted">Self-declared</span>
              <span className="font-semibold">
                {level.emoji} {level.label}
              </span>
            </div>
          )}
          <div className="relative mt-3 text-xs text-subtle">Play 3 rated games to unlock your True Skill.</div>
        </motion.div>
      </div>
    </>
  )
}
