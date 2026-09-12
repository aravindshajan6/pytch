import { useMutation, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Camera, Flame, RefreshCcw } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import { Stepper, Switch } from '@/components/ui/Form'
import { Sheet } from '@/components/ui/Sheet'
import { useMeta } from '@/hooks/useMeta'
import { errorMessage } from '@/lib/api/client'
import { SPORTS, SPORT_LIST } from '@/lib/sports'
import { pluralize } from '@/lib/format'
import type { Sport } from '@/types/api'
import type { PartnerPitch, PartnerVenue, PitchInput } from '@/types/partner'
import { partnerApi } from '../../api/endpoints'
import { pk } from '../../api/keys'
import { ChoiceChips, ConfirmSheet, Field, MoneyInput, TextInput } from '../../components/kit'
import { describeApiError } from '../../lib/errors'
import { moneyError, paiseToRupees, rupeesToPaise } from '../../lib/money'

const DEFAULT_CAPACITY: Record<string, number> = { '5v5': 10, '7v7': 14, singles: 2, doubles: 4, nets: 6, box: 12, '3v3': 6 }

export function PitchSheet({ venue, pitch, onClose }: { venue: PartnerVenue; pitch: PartnerPitch | 'new' | null; onClose: () => void }) {
  return (
    <Sheet open={!!pitch} onClose={onClose} title={pitch === 'new' ? 'Add a pitch' : pitch ? `Edit ${pitch.name}` : ''} description={venue.name} size="md">
      {pitch && <PitchForm key={pitch === 'new' ? 'new' : pitch.id} venue={venue} pitch={pitch === 'new' ? null : pitch} onClose={onClose} />}
    </Sheet>
  )
}

const toPaise = (v: string) => rupeesToPaise(v) ?? 0

function PitchForm({ venue, pitch, onClose }: { venue: PartnerVenue; pitch: PartnerPitch | null; onClose: () => void }) {
  const qc = useQueryClient()
  const meta = useMeta()
  const sports = meta.data?.sports ?? SPORT_LIST.map((k) => ({ key: k, label: SPORTS[k].label, emoji: SPORTS[k].emoji, formats: ['5v5'] }))
  const [name, setName] = useState(pitch?.name ?? `Pitch ${String.fromCharCode(65 + venue.pitches.length)}`)
  const [sport, setSport] = useState<Sport>(pitch?.sport ?? venue.sports[0] ?? 'football')
  const formats = sports.find((s) => s.key === sport)?.formats ?? []
  const [format, setFormat] = useState(pitch?.format ?? formats[0] ?? '5v5')
  const [capacity, setCapacity] = useState(pitch?.capacity ?? DEFAULT_CAPACITY[format] ?? 10)
  const [indoor, setIndoor] = useState(pitch?.is_indoor ?? false)
  const [camera, setCamera] = useState(pitch?.has_camera ?? false)
  const [cameraPrice, setCameraPrice] = useState(paiseToRupees(pitch?.camera_price_paise ?? 0))
  const [base, setBase] = useState(paiseToRupees(pitch?.price_per_hour_paise ?? 0))
  const [peak, setPeak] = useState(paiseToRupees(pitch?.peak_price_per_hour_paise ?? 0))
  const [active, setActive] = useState(pitch?.is_active ?? true)
  const [confirmOff, setConfirmOff] = useState(false)
  const upcoming = pitch?.upcoming_bookings ?? 0
  const switchingOff = !!pitch && pitch.is_active && !active
  const [applyFuture, setApplyFuture] = useState(true)
  const priceChanged = !!pitch && (toPaise(base) !== pitch.price_per_hour_paise || toPaise(peak) !== pitch.peak_price_per_hour_paise)

  const errors = {
    name: name.trim().length < 1 ? 'Give it a name players recognise.' : null,
    base: moneyError(base, { max: 10_000_000 }) ?? (toPaise(base) < 100 ? 'Enter the hourly price.' : null),
    peak: moneyError(peak, { max: 10_000_000 }) ?? (toPaise(peak) && toPaise(peak) < toPaise(base) ? 'Peak is usually at least the base price.' : null),
    camera: camera ? moneyError(cameraPrice, { max: 1_000_000 }) : null,
  }
  const valid = !errors.name && !errors.base && !moneyError(peak) && !errors.camera

  const save = useMutation({
    mutationFn: () => {
      const body: PitchInput = {
        name: name.trim(),
        sport,
        format,
        capacity,
        is_indoor: indoor,
        has_camera: camera,
        camera_price_paise: camera ? toPaise(cameraPrice) : 0,
        price_per_hour_paise: toPaise(base),
        peak_price_per_hour_paise: toPaise(peak) || toPaise(base),
      }
      if (pitch) return partnerApi.venues.updatePitch(pitch.id, { ...body, is_active: active, apply_to_future_slots: priceChanged && applyFuture })
      return partnerApi.venues.addPitch(venue.id, body)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: pk.venues })
      qc.invalidateQueries({ queryKey: pk.calendarAll })
      qc.invalidateQueries({ queryKey: pk.channels })
      toast.success(pitch ? 'Pitch updated' : 'Pitch added', { description: pitch ? (priceChanged && applyFuture ? 'Open future slots were re-priced.' : undefined) : '14 days of slots are open for booking.' })
      onClose()
    },
    onError: (e) => toast.error('Couldn’t save', { description: describeApiError(e, PITCH_FIELDS) ?? errorMessage(e) }),
  })

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (!valid) return
        if (switchingOff && upcoming > 0) setConfirmOff(true) // say what happens to the games already booked
        else save.mutate()
      }}
      className="space-y-4"
    >
      <Field label="Name" htmlFor="pi-n" error={errors.name}>
        <TextInput id="pi-n" value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Sport">
        <ChoiceChips
          size="sm"
          options={sports.map((s) => ({ value: s.key, label: `${s.emoji} ${s.label}` }))}
          value={sport}
          onChange={(s) => {
            setSport(s)
            const f = sports.find((x) => x.key === s)?.formats[0]
            if (f) {
              setFormat(f)
              setCapacity(DEFAULT_CAPACITY[f] ?? capacity)
            }
          }}
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Format">
          <ChoiceChips
            size="sm"
            options={formats.map((f) => ({ value: f, label: f }))}
            value={format}
            onChange={(f) => {
              setFormat(f)
              setCapacity(DEFAULT_CAPACITY[f] ?? capacity)
            }}
          />
        </Field>
        <Field label="Players for a full game">
          <Stepper value={capacity} onChange={setCapacity} min={2} max={30} />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Base price / hour" htmlFor="pi-b" error={errors.base}>
          <MoneyInput id="pi-b" value={base} onChange={setBase} />
        </Field>
        <Field label={<><Flame className="h-3.5 w-3.5 text-sun" /> Peak price / hour</>} htmlFor="pi-p" error={errors.peak} hint="Evenings & weekends">
          <MoneyInput id="pi-p" value={peak} onChange={setPeak} placeholder={base} />
        </Field>
      </div>

      {priceChanged && (
        <label className="flex cursor-pointer items-start gap-3 rounded-2xl bg-electric/8 p-3.5 ring-1 ring-electric/25">
          <Switch checked={applyFuture} onChange={setApplyFuture} label="Apply to future open slots" />
          <span className="text-sm">
            <span className="flex items-center gap-1.5 font-semibold">
              <RefreshCcw className="h-3.5 w-3.5" /> Apply to future open slots
            </span>
            <span className="text-muted">Re-prices slots that are still free. Existing bookings keep the price they were booked at.</span>
          </span>
        </label>
      )}

      <div className="divide-y divide-white/6 rounded-2xl bg-white/[0.03] px-4 ring-1 ring-white/8">
        <ToggleRow label="Indoor / covered" hint="Rain-proof — Pytch suggests it when storms hit." checked={indoor} onChange={setIndoor} />
        <ToggleRow label={<><Camera className="h-4 w-4" /> Match camera</>} hint="Players can add a recorded highlight reel." checked={camera} onChange={setCamera} />
        {camera && (
          <div className="py-3">
            <Field label="Camera fee per game" htmlFor="pi-c">
              <MoneyInput id="pi-c" value={cameraPrice} onChange={setCameraPrice} />
            </Field>
          </div>
        )}
        {pitch && <ToggleRow label="Bookable" hint="Turn off to hide this pitch from players (existing bookings stay)." checked={active} onChange={setActive} />}
        {switchingOff && upcoming > 0 && (
          <p className="flex items-start gap-2 pb-3 text-xs text-sun" role="status">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {pluralize(upcoming, 'booking')} still to play on this pitch. They stay on your calendar (marked “Not bookable”) — nothing new can be booked.
          </p>
        )}
      </div>

      <div className="flex gap-2 pt-1">
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" className="flex-1" size="lg" disabled={!valid} loading={save.isPending}>
          {pitch ? 'Save pitch' : 'Add pitch'}
        </Button>
      </div>
      <ConfirmSheet
        open={confirmOff}
        onClose={() => setConfirmOff(false)}
        title={`Switch off ${pitch?.name ?? 'this pitch'}?`}
        description={`${pluralize(upcoming, 'booking')} (Pytch games and bookings you logged) are still to be played here. They stay booked and keep showing on your calendar as “Not bookable” — players just can’t book anything new. Move or cancel them separately if the pitch is really closing.`}
        confirmLabel="Switch off"
        danger
        pending={save.isPending}
        onConfirm={() => save.mutate(undefined, { onSettled: () => setConfirmOff(false) })}
      />
    </form>
  )
}

const PITCH_FIELDS: Record<string, string> = {
  name: 'Name',
  format: 'Format',
  capacity: 'Players',
  price_per_hour_paise: 'Base price',
  peak_price_per_hour_paise: 'Peak price',
  camera_price_paise: 'Camera fee',
}

function ToggleRow({ label, hint, checked, onChange }: { label: React.ReactNode; hint: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 text-sm font-semibold">{label}</div>
        <div className="text-xs text-muted">{hint}</div>
      </div>
      <Switch checked={checked} onChange={onChange} label={typeof label === 'string' ? label : undefined} />
    </div>
  )
}
