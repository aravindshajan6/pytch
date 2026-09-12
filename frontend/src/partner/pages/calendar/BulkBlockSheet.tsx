import { useMutation } from '@tanstack/react-query'
import { CheckCircle2, CircleAlert, Wrench } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import { Sheet } from '@/components/ui/Sheet'
import { errorMessage } from '@/lib/api/client'
import { cn } from '@/lib/cn'
import { formatWhen, pluralize } from '@/lib/format'
import type { Pitch } from '@/types/api'
import type { BlockSource, BulkBlockResult } from '@/types/partner'
import { partnerApi } from '../../api/endpoints'
import { ChoiceChips, Field, Select, TextInput, inputCls } from '../../components/kit'
import { MANUAL_SOURCES, SOURCES } from '../../lib/sources'
import { addDays, dayDiff, hhmmLabel } from '../../lib/time'

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function hoursBetween(open: string, close: string): string[] {
  const [oh] = open.split(':').map(Number)
  let [ch] = close.split(':').map(Number)
  if (ch! <= oh!) ch = 24
  return Array.from({ length: ch! - oh! + 1 }, (_, i) => `${String(oh! + i).padStart(2, '0')}:00`)
}

export function BulkBlockSheet({
  open,
  onClose,
  pitches,
  turf,
  today,
  onDone,
}: {
  open: boolean
  onClose: () => void
  pitches: Pitch[]
  turf: { name: string; open_time: string; close_time: string }
  today: string
  onDone: () => void
}) {
  return (
    <Sheet open={open} onClose={onClose} title="Bulk block" description={`Close ${turf.name} pitches on a schedule — e.g. relining every Monday morning.`} size="lg">
      {open && <BulkForm pitches={pitches} turf={turf} today={today} onClose={onClose} onDone={onDone} />}
    </Sheet>
  )
}

function BulkForm({
  pitches,
  turf,
  today,
  onClose,
  onDone,
}: {
  pitches: Pitch[]
  turf: { open_time: string; close_time: string }
  today: string
  onClose: () => void
  onDone: () => void
}) {
  const hours = useMemo(() => hoursBetween(turf.open_time.slice(0, 5), turf.close_time.slice(0, 5)), [turf.open_time, turf.close_time])
  const [pitchIds, setPitchIds] = useState<string[]>(pitches.map((p) => p.id))
  const [from, setFrom] = useState(today)
  const [to, setTo] = useState(addDays(today, 27))
  const [timeFrom, setTimeFrom] = useState(hours[0] ?? '06:00')
  const [timeTo, setTimeTo] = useState(hours[2] ?? '08:00')
  const [weekdays, setWeekdays] = useState<number[]>([0])
  const [source, setSource] = useState<BlockSource>('maintenance')
  const [notes, setNotes] = useState('')
  const [result, setResult] = useState<BulkBlockResult | null>(null)

  const span = dayDiff(to, from) + 1
  const errors = {
    pitches: pitchIds.length === 0 ? 'Pick at least one pitch.' : null,
    range: span < 1 ? 'End date is before start.' : span > 62 ? 'At most 62 days at a time.' : null,
    time: timeTo <= timeFrom ? 'End time must be after start time.' : null,
    weekdays: weekdays.length === 0 ? 'Pick at least one weekday.' : null,
  }
  const valid = !Object.values(errors).some(Boolean)

  const run = useMutation({
    mutationFn: () =>
      partnerApi.blocks.bulk({
        pitch_ids: pitchIds,
        date_from: from,
        date_to: to,
        time_from: timeFrom,
        time_to: timeTo,
        weekdays: [...weekdays].sort(),
        kind: 'block',
        source,
        notes: notes.trim() || null,
      }),
    onSuccess: (r) => {
      setResult(r)
      onDone()
      toast.success(`${pluralize(r.slots, 'hour')} blocked`, {
        description: [r.created > 1 ? `${r.created} blocks` : null, r.skipped.length ? `${pluralize(r.skipped.length, 'hour')} skipped — already taken` : null]
          .filter(Boolean)
          .join(' · ') || undefined,
      })
    },
    onError: (e) => toast.error('Bulk block failed', { description: errorMessage(e) }),
  })

  if (result) {
    return (
      <div>
        <div className="flex items-center gap-3 rounded-2xl bg-mint/10 p-4 ring-1 ring-mint/30">
          <CheckCircle2 className="h-6 w-6 shrink-0 text-mint" />
          <div>
            <div className="font-semibold">
              {pluralize(result.slots, 'hour')} blocked{result.created > 1 ? ` · ${result.created} blocks` : ''}
            </div>
            <div className="text-sm text-muted">They’re closed on Pytch and every export feed.</div>
          </div>
        </div>
        {result.skipped.length > 0 && (
          <div className="mt-4">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <CircleAlert className="h-4 w-4 text-sun" /> {pluralize(result.skipped.length, 'hour')} skipped — never overridden
            </div>
            <p className="mt-1 text-xs text-muted">These hours already had a booking or block. Move those customers first if you need the pitch closed.</p>
            <ul className="mt-3 max-h-64 divide-y divide-white/6 overflow-y-auto rounded-2xl bg-white/[0.03] ring-1 ring-white/8">
              {result.skipped.map((s) => (
                <li key={s.slot_id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                  <span className="font-mono text-xs">{formatWhen(s.start_at)}</span>
                  <span className="truncate text-xs text-muted">{s.label ?? s.reason.replace(/_/g, ' ')}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="mt-5 flex gap-2">
          <Button variant="secondary" onClick={() => setResult(null)}>
            Block more
          </Button>
          <Button className="flex-1" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    )
  }

  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v])

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (valid) run.mutate()
      }}
      className="space-y-4"
    >
      <Field label="Pitches" error={errors.pitches}>
        <ChoiceChips size="sm" options={pitches.map((p) => ({ value: p.id, label: p.name }))} value={pitchIds} onChange={(id) => setPitchIds((l) => toggle(l, id))} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="From date" htmlFor="bb-from" error={errors.range}>
          <input id="bb-from" type="date" value={from} min={today} onChange={(e) => e.target.value && setFrom(e.target.value)} className={cn(inputCls, 'font-mono')} />
        </Field>
        <Field label="To date (inclusive)" htmlFor="bb-to" hint={!errors.range ? `${span} day${span === 1 ? '' : 's'}` : undefined}>
          <input id="bb-to" type="date" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} className={cn(inputCls, 'font-mono')} />
        </Field>
        <Field label="From" htmlFor="bb-tf" error={errors.time}>
          <Select id="bb-tf" value={timeFrom} onChange={setTimeFrom} options={hours.slice(0, -1).map((h) => ({ value: h, label: hhmmLabel(h) }))} />
        </Field>
        <Field label="Until" htmlFor="bb-tt">
          <Select id="bb-tt" value={timeTo} onChange={setTimeTo} options={hours.slice(1).map((h) => ({ value: h, label: hhmmLabel(h) }))} />
        </Field>
      </div>
      <Field label="Repeat on" error={errors.weekdays}>
        <ChoiceChips size="sm" options={WEEKDAYS.map((d, i) => ({ value: String(i), label: d }))} value={weekdays.map(String)} onChange={(d) => setWeekdays((l) => toggle(l, Number(d)))} />
      </Field>
      <Field label="Reason">
        <ChoiceChips
          size="sm"
          options={MANUAL_SOURCES.filter((s) => s !== 'walk_in').map((s) => ({ value: s, label: SOURCES[s].label.replace(' / WhatsApp', ''), icon: SOURCES[s].icon, color: SOURCES[s].color }))}
          value={source}
          onChange={setSource}
        />
      </Field>
      <Field label="Notes" htmlFor="bb-notes" optional>
        <TextInput id="bb-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Weekly relining and turf brushing" />
      </Field>
      <div className="flex items-start gap-2.5 rounded-2xl bg-white/[0.03] p-3.5 text-xs text-muted ring-1 ring-white/8">
        <Wrench className="mt-0.5 h-4 w-4 shrink-0" />
        Slots that already have a booking or block are skipped, never overridden. You’ll see the list afterwards.
      </div>
      <div className="flex gap-2">
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" className="flex-1" size="lg" disabled={!valid} loading={run.isPending}>
          Block {weekdays.length ? [...weekdays].sort().map((d) => WEEKDAYS[d]).join(', ') : ''} {hhmmLabel(timeFrom)}–{hhmmLabel(timeTo)}
        </Button>
      </div>
    </form>
  )
}
