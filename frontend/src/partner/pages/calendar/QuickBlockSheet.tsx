import { useMutation } from '@tanstack/react-query'
import { AlertTriangle, Ban, CalendarCheck2, Minus, Plus, RefreshCw } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import { Segmented } from '@/components/ui/Segmented'
import { Sheet } from '@/components/ui/Sheet'
import { errorMessage, isApiError } from '@/lib/api/client'
import { cn } from '@/lib/cn'
import { formatINR } from '@/lib/format'
import type { Pitch } from '@/types/api'
import type { BlockKind, BlockSource, CalendarCell, OfflinePaymentMode, SlotBlockOut } from '@/types/partner'
import { partnerApi } from '../../api/endpoints'
import { ChoiceChips, Field, MoneyInput, TextInput } from '../../components/kit'
import { moneyError, rupeesToPaise } from '../../lib/money'
import { OTHER_APPS, PAYMENT_MODES, SOURCES } from '../../lib/sources'
import { dayLabel, hhmmLabel, istTimeOf } from '../../lib/time'
import { toE164 } from '../../lib/validation'

export interface QuickBlockTarget {
  pitch: Pitch
  date: string
  /** consecutive bookable cells from the tapped slot onward */
  run: CalendarCell[]
  /** initially selected number of cells (drag selection) */
  count: number
  presetSource?: BlockSource | null
}

const BOOKING_SOURCES: BlockSource[] = ['walk_in', 'phone', 'playo', 'hudle', 'khelomore', 'other_app']
/** "Block / close" reasons: a closure, or a slot held back for another app. Walk-ins/phone are bookings, not reasons. */
const BLOCK_REASONS: BlockSource[] = ['maintenance', 'playo', 'hudle', 'khelomore', 'other_app']
/** Money for app bookings was taken by the app; walk-ins and phone bookings usually pay at the desk. */
const defaultMode = (s: BlockSource): OfflinePaymentMode => (OTHER_APPS.includes(s) ? 'online_other' : 'cash')

export function QuickBlockSheet({
  target,
  onClose,
  onDone,
  onConflict,
}: {
  target: QuickBlockTarget | null
  onClose: () => void
  onDone: (b: SlotBlockOut) => void
  /** slot(s) got taken meanwhile — parent refreshes & flashes */
  onConflict: (slotIds: string[]) => void
}) {
  return (
    <Sheet
      open={!!target}
      onClose={onClose}
      size="md"
      title={target ? `${target.pitch.name} · ${dayLabel(target.date, 'EEE, d MMM')}` : undefined}
      description={target ? 'Book a customer in or close the pitch' : undefined}
    >
      {target && <QuickBlockForm key={`${target.run[0]?.slot_id}-${target.count}`} target={target} onClose={onClose} onDone={onDone} onConflict={onConflict} />}
    </Sheet>
  )
}

function QuickBlockForm({
  target,
  onClose,
  onDone,
  onConflict,
}: {
  target: QuickBlockTarget
  onClose: () => void
  onDone: (b: SlotBlockOut) => void
  onConflict: (slotIds: string[]) => void
}) {
  const preset = target.presetSource ?? null
  const [count, setCount] = useState(Math.max(1, Math.min(target.count, target.run.length)))
  const [kind, setKind] = useState<BlockKind>(preset === 'maintenance' ? 'block' : 'booking')
  const [source, setSource] = useState<BlockSource>(preset ?? 'walk_in')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [notes, setNotes] = useState('')
  const [mode, setModeState] = useState<OfflinePaymentMode>(defaultMode(preset ?? 'walk_in'))
  const [modeTouched, setModeTouched] = useState(false)
  const setMode = (m: OfflinePaymentMode) => {
    setModeState(m)
    setModeTouched(true)
  }
  const pickSource = (s: BlockSource) => {
    setSource(s)
    if (!modeTouched) setModeState(defaultMode(s))
  }
  const cells = target.run.slice(0, count)
  const suggested = cells.reduce((n, c) => n + c.price_paise, 0)
  const [amount, setAmount] = useState<string>('')
  const [takenError, setTakenError] = useState<string | null>(null)
  const [phoneError, setPhoneError] = useState<string | null>(null)
  const [amountError, setAmountError] = useState<string | null>(null)

  const start = cells[0]?.start_at
  const end = cells[cells.length - 1]?.end_at
  const minutes = start && end ? (Date.parse(end) - Date.parse(start)) / 60000 : 0
  const isApp = OTHER_APPS.includes(source)
  const amountPaise = amount === '' ? suggested : (rupeesToPaise(amount) ?? 0)

  const durations = useMemo(() => {
    const out: { n: number; label: string }[] = []
    let mins = 0
    target.run.forEach((c, i) => {
      mins += (Date.parse(c.end_at) - Date.parse(c.start_at)) / 60000
      if (i < 6) out.push({ n: i + 1, label: mins % 60 === 0 ? `${mins / 60}h` : `${Math.floor(mins / 60) ? `${Math.floor(mins / 60)}h ` : ''}${mins % 60}m` })
    })
    return out
  }, [target.run])

  const create = useMutation({
    mutationFn: () => {
      let customer_phone: string | null = null
      if (kind === 'booking' && phone.trim()) {
        customer_phone = toE164(phone)
        if (!customer_phone) throw new Error('PHONE')
      }
      return partnerApi.blocks.create({
        pitch_id: target.pitch.id,
        start_at: start!,
        end_at: end!,
        kind,
        source,
        customer_name: kind === 'booking' ? name.trim() || null : null,
        customer_phone,
        amount_paise: kind === 'booking' ? Math.max(0, amountPaise) : 0,
        payment_mode: kind === 'booking' ? mode : null,
        notes: notes.trim() || null,
      })
    },
    onSuccess: (b) => {
      const s = SOURCES[b.source]
      toast.success(kind === 'booking' ? `${s.label} booking saved` : 'Slot blocked', {
        description: `${target.pitch.name} · ${hhmmLabel(istTimeOf(b.start_at))}–${hhmmLabel(istTimeOf(b.end_at))}. It’s now unavailable on Pytch.`,
      })
      onDone(b)
    },
    onError: (e) => {
      if (e instanceof Error && e.message === 'PHONE') {
        setPhoneError('Enter a 10-digit Indian mobile, or leave it empty.')
        return
      }
      if (isApiError(e, 'SLOT_LOCKED') || isApiError(e, 'SLOT_UNAVAILABLE')) {
        const ids = ((e.details as { slot_ids?: string[] } | null)?.slot_ids ?? cells.map((c) => c.slot_id)) as string[]
        setTakenError(
          isApiError(e, 'SLOT_LOCKED')
            ? 'Someone is checking out this slot on Pytch right now. The calendar has refreshed — try a different time or wait a minute.'
            : 'This time was just booked on Pytch. The calendar has refreshed with the latest bookings.',
        )
        onConflict(ids)
        return
      }
      toast.error('Couldn’t save', { description: errorMessage(e) })
    },
  })

  if (!start || !end) {
    return (
      <div className="py-6 text-center">
        <Ban className="mx-auto h-8 w-8 text-flare" />
        <p className="mt-3 font-semibold">This slot isn’t free any more</p>
        <p className="mt-1 text-sm text-muted">It was taken while you were looking. Pick another time.</p>
        <Button className="mt-5" variant="secondary" onClick={onClose}>
          Back to calendar
        </Button>
      </div>
    )
  }

  const sourceOptions = (kind === 'booking' ? BOOKING_SOURCES : BLOCK_REASONS).map((s) => ({
    value: s,
    label: SOURCES[s].label.replace(' / WhatsApp', ''),
    icon: SOURCES[s].icon,
    color: SOURCES[s].color,
  }))

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        const bad = kind === 'booking' && amount !== '' ? moneyError(amount) : null
        setAmountError(bad)
        if (!bad && !create.isPending) create.mutate()
      }}
    >
      {/* When */}
      <div className="font-display text-2xl font-bold tracking-tight">
        {hhmmLabel(istTimeOf(start))} <span className="text-muted">–</span> {hhmmLabel(istTimeOf(end))}
      </div>

      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={() => setCount((c) => Math.max(1, c - 1))}
          disabled={count <= 1}
          aria-label="Shorter"
          className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-xl bg-white/6 ring-1 ring-white/10 transition hover:bg-white/12 disabled:opacity-30"
        >
          <Minus className="h-4 w-4" />
        </button>
        <div className="no-scrollbar flex min-w-0 flex-1 gap-1.5 overflow-x-auto py-0.5">
          {durations.map((d) => (
            <button
              key={d.n}
              type="button"
              onClick={() => setCount(d.n)}
              aria-pressed={count === d.n}
              className={cn(
                'h-11 min-w-12 shrink-0 cursor-pointer rounded-xl px-3 font-mono text-sm font-semibold ring-1 transition',
                count === d.n ? 'bg-volt text-ink-950 ring-volt' : 'bg-white/4 text-fg/80 ring-white/10 hover:bg-white/8',
              )}
            >
              {d.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setCount((c) => Math.min(target.run.length, c + 1))}
          disabled={count >= target.run.length}
          aria-label="Longer"
          className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-xl bg-white/6 ring-1 ring-white/10 transition hover:bg-white/12 disabled:opacity-30"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>
      <p className="mt-1.5 text-xs text-muted">
        {minutes >= 60 ? `${minutes / 60} hour${minutes === 60 ? '' : 's'}` : `${minutes} min`}
        {target.run.length > count ? ` · free until ${hhmmLabel(istTimeOf(target.run[target.run.length - 1]!.end_at))}` : ' · next slot is taken'}
      </p>

      <AnimatePresence>
        {takenError && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            role="alert"
            className="mt-4 flex gap-2.5 rounded-2xl bg-flare/10 p-3.5 text-sm ring-1 ring-flare/35"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-flare" />
            <div className="min-w-0">
              <div className="font-semibold">Slot just got taken</div>
              <p className="mt-0.5 text-muted">{takenError}</p>
              <button type="button" onClick={onClose} className="mt-2 inline-flex cursor-pointer items-center gap-1.5 text-xs font-semibold text-volt">
                <RefreshCw className="h-3.5 w-3.5" /> Back to the updated calendar
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <Segmented<BlockKind>
        className="pp-seg mt-5 w-full [&_button]:whitespace-nowrap"
        value={kind}
        onChange={(k) => {
          setKind(k)
          if (k === 'block' && !BLOCK_REASONS.includes(source)) setSource('maintenance')
          if (k === 'booking' && !BOOKING_SOURCES.includes(source)) pickSource('walk_in')
        }}
        options={[
          { value: 'booking', label: <><CalendarCheck2 className="h-4 w-4" /> Booking</> },
          { value: 'block', label: <><Ban className="h-4 w-4" /> Block / close</> },
        ]}
      />

      <Field label={kind === 'booking' ? 'Where did it come from?' : 'Reason'} className="mt-4">
        <ChoiceChips size="sm" options={sourceOptions} value={source} onChange={pickSource} />
      </Field>

      <AnimatePresence initial={false}>
        {kind === 'booking' && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
            <div className="grid gap-3 pt-4 sm:grid-cols-2">
              <Field label="Customer name" htmlFor="qb-name" optional={isApp}>
                <TextInput id="qb-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={isApp ? `${SOURCES[source].label} booking` : 'e.g. Arjun'} autoComplete="off" />
              </Field>
              <Field label="Phone" htmlFor="qb-phone" optional error={phoneError}>
                <TextInput
                  id="qb-phone"
                  type="tel"
                  inputMode="tel"
                  value={phone}
                  onChange={(e) => {
                    setPhone(e.target.value)
                    setPhoneError(null)
                  }}
                  placeholder="98765 43210"
                  className="font-mono"
                  aria-invalid={!!phoneError}
                />
              </Field>
              <Field label="Amount" htmlFor="qb-amt" error={amountError} hint={amount === '' ? `Suggested from your rate card: ${formatINR(suggested)}` : undefined}>
                <MoneyInput
                  id="qb-amt"
                  value={amount}
                  onChange={(v) => {
                    setAmount(v)
                    setAmountError(null)
                  }}
                  placeholder={String(suggested / 100)}
                  invalid={!!amountError}
                />
              </Field>
              <Field label="Payment" className="sm:col-span-2">
                <ChoiceChips size="sm" options={PAYMENT_MODES.map((p) => ({ value: p.value, label: p.label }))} value={mode} onChange={setMode} />
              </Field>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <Field label="Notes" htmlFor="qb-notes" optional className="mt-4">
        <TextInput id="qb-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={kind === 'block' ? 'e.g. Relining the D-box' : 'e.g. Bringing own ball, 10 players'} />
      </Field>

      <div className="sticky -bottom-6 z-10 -mx-6 mt-5 border-t border-white/8 bg-[var(--glass-strong-to)] px-6 pt-3 pb-1">
        <div className="mb-2 flex items-center justify-between text-xs text-muted">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ background: SOURCES[source].color }} />
            {SOURCES[source].label} · {kind === 'booking' ? 'booking' : 'block'}
          </span>
          {kind === 'booking' && <span className="font-mono text-fg">{formatINR(Math.max(0, amountPaise))}</span>}
        </div>
        <Button type="submit" block size="lg" loading={create.isPending} disabled={!!takenError}>
          {kind === 'booking' ? `Save ${SOURCES[source].label.replace(' / WhatsApp', '').toLowerCase()} booking` : `Block ${hhmmLabel(istTimeOf(start))}–${hhmmLabel(istTimeOf(end))}`}
        </Button>
        <p className="mt-2 text-center text-[11px] text-muted">
          Locks the slot{count > 1 ? 's' : ''} everywhere on Pytch instantly{isApp ? ` — mirror of your ${SOURCES[source].label} booking` : ''}.
        </p>
      </div>
    </form>
  )
}
