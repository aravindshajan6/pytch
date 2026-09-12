import { useMutation, useQuery } from '@tanstack/react-query'
import { Check, ExternalLink, LocateFixed, MapPin, Plus, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { errorMessage } from '@/lib/api/http'
import { cn } from '@/lib/cn'
import { SPORTS, SPORT_LIST } from '@/lib/sports'
import type { AdminApplicationVenue, AdminCreateVenue, AdminProviderDetail } from '@/types/admin'
import type { Sport } from '@/types/api'
import { Callout } from '../../components/Dialogs'
import { Checkbox, Drawer, Field, Select, TextArea, TextInput } from '../../components/ui'
import { adminApi, qk } from '../../lib/api'
import { fieldErrors, isSilentError } from '../../lib/errors'
import { rupeesToPaise } from '../../lib/format'

/** Formats per sport — mirrors backend core/constants.py SPORTS (the server validates against it). */
const FORMATS: Record<Sport, string[]> = {
  football: ['5v5', '7v7'],
  cricket: ['nets', 'box'],
  badminton: ['singles', 'doubles'],
  pickleball: ['doubles'],
  basketball: ['3v3', '5v5'],
}
const DEFAULT_CAPACITY: Record<string, number> = { '5v5': 10, '7v7': 14, singles: 2, doubles: 4, nets: 6, box: 12, '3v3': 6 }
const COURT_SPORTS = new Set<Sport>(['badminton', 'pickleball', 'basketball'])
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/

interface PitchDraft {
  key: string
  name: string
  sport: Sport
  format: string
  capacity: string
  price: string
  peak: string
  is_indoor: boolean
  has_camera: boolean
  camera_price: string
}

interface VenueDraft {
  application_index: number | null
  name: string
  area: string
  address: string
  lat: string
  lng: string
  description: string
  phone: string
  open_time: string
  close_time: string
  pitches: PitchDraft[]
}

const isSport = (s: string): s is Sport => (SPORT_LIST as string[]).includes(s)
let seq = 0
const key = () => `p${++seq}`

function pitchDraft(sport: Sport, i: number, indoor = false): PitchDraft {
  const format = FORMATS[sport][0]
  return {
    key: key(),
    name: `${COURT_SPORTS.has(sport) ? 'Court' : 'Pitch'} ${i + 1}`,
    sport,
    format,
    capacity: String(DEFAULT_CAPACITY[format] ?? 10),
    price: '', // the application has no prices — the admin enters what was agreed with the partner
    peak: '',
    is_indoor: indoor,
    has_camera: false,
    camera_price: '',
  }
}

function fromApplication(v: AdminApplicationVenue | null): VenueDraft {
  const sports = (v?.sports ?? []).filter(isSport)
  const list: Sport[] = sports.length ? sports : ['football']
  const count = Math.max(1, Math.min(v?.pitch_count ?? 1, 30))
  return {
    application_index: v?.index ?? null,
    name: v?.name ?? '',
    area: v?.area ?? '',
    address: v?.address ?? '',
    lat: v?.lat != null ? String(v.lat) : '',
    lng: v?.lng != null ? String(v.lng) : '',
    description: v?.notes ?? '',
    phone: '',
    open_time: '06:00',
    close_time: '23:00',
    pitches: Array.from({ length: count }, (_, i) => pitchDraft(list[i % list.length], i, !!v?.has_indoor)),
  }
}

/**
 * Onboard a venue for a provider — usually one entry of its partner application, prefilled here and
 * confirmed/edited by the admin (coordinates must be confirmed: there's no geocoding). Creates the venue,
 * its pitches and 14 days of bookable slots (POST /admin/providers/{id}/venues, step-up, audited).
 */
export function CreateVenueDrawer({
  provider,
  initialIndex,
  open,
  onClose,
  onDone,
}: {
  provider: AdminProviderDetail
  /** application entry to prefill from (undefined → the first one not created yet; null → blank) */
  initialIndex?: number | null
  open: boolean
  onClose: () => void
  onDone: () => void
}) {
  const pending = provider.application_venues.filter((v) => !v.turf_id)
  const [draft, setDraft] = useState<VenueDraft>(() =>
    fromApplication(initialIndex === null ? null : (pending.find((v) => v.index === initialIndex) ?? pending[0] ?? null)),
  )
  const [confirmed, setConfirmed] = useState(false)
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({})
  const meta = useQuery({ queryKey: qk.meta, queryFn: adminApi.meta, staleTime: Infinity, enabled: open })
  const areaCentre = meta.data?.areas.find((a) => a.name.toLowerCase() === draft.area.trim().toLowerCase())

  const pick = (v: AdminApplicationVenue | null) => {
    setDraft(fromApplication(v))
    setConfirmed(false)
    setServerErrors({})
  }
  const patch = (p: Partial<VenueDraft>) => {
    setDraft((d) => ({ ...d, ...p }))
    setServerErrors({})
  }
  const patchPitch = (k: string, p: Partial<PitchDraft>) => patch({ pitches: draft.pitches.map((x) => (x.key === k ? { ...x, ...p } : x)) })

  const errors = useMemo(() => validate(draft), [draft])
  const err = (field: string) => serverErrors[field] ?? errors[field]
  const valid = Object.keys(errors).length === 0 && confirmed

  const create = useMutation({
    mutationFn: () => adminApi.providers.createVenue(provider.id, toBody(draft)),
    meta: { silent: true },
    onSuccess: () => {
      toast.success(`${draft.name.trim()} created — ${draft.pitches.length} pitch${draft.pitches.length === 1 ? '' : 'es'} with 14 days of slots`)
      onDone()
      onClose()
    },
    onError: (e) => {
      const f = fieldErrors(e)
      setServerErrors(Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v.replace(/^Value error, /, '')])))
      if (!isSilentError(e)) toast.error(errorMessage(e))
    },
  })

  const lat = Number(draft.lat)
  const lng = Number(draft.lng)
  const hasPin = draft.lat !== '' && draft.lng !== '' && Number.isFinite(lat) && Number.isFinite(lng)

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width="max-w-3xl"
      title="Create venue"
      subtitle={`For ${provider.name} · creates the venue, its pitches and 14 days of bookable slots`}
      footer={
        <div className="flex flex-wrap items-center justify-end gap-2">
          {!confirmed && Object.keys(errors).length === 0 && <span className="mr-auto text-xs text-sun">Confirm the map pin to continue.</span>}
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" disabled={!valid} loading={create.isPending} onClick={() => create.mutate()}>
            Create venue
          </Button>
        </div>
      }
    >
      <div className="space-y-6">
        {provider.application_venues.length > 0 && (
          <section>
            <div className="mb-2 text-xs font-medium text-muted">From the application</div>
            <div className="grid gap-2 sm:grid-cols-2">
              {provider.application_venues.map((v) => {
                const active = draft.application_index === v.index
                return (
                  <button
                    key={v.index}
                    type="button"
                    disabled={!!v.turf_id}
                    onClick={() => pick(v)}
                    aria-pressed={active}
                    className={cn(
                      'cursor-pointer rounded-xl p-3 text-left ring-1 transition disabled:cursor-not-allowed disabled:opacity-60',
                      active ? 'bg-volt/10 ring-volt/50' : 'bg-white/4 ring-white/8 hover:bg-white/6',
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-medium">{v.name}</span>
                      {v.turf_id ? (
                        <Chip tone="mint" size="xs">
                          <Check className="h-3 w-3" /> Created
                        </Chip>
                      ) : (
                        active && <Chip tone="volt" size="xs">Selected</Chip>
                      )}
                    </div>
                    <div className="mt-0.5 truncate text-xs text-muted">
                      {v.area} · {v.pitch_count} pitch{v.pitch_count === 1 ? '' : 'es'} · {v.sports.map((s) => SPORTS[s as Sport]?.emoji ?? s).join(' ')}
                    </div>
                  </button>
                )
              })}
              <button
                type="button"
                onClick={() => pick(null)}
                aria-pressed={draft.application_index === null}
                className={cn(
                  'flex cursor-pointer items-center gap-2 rounded-xl p-3 text-left text-sm ring-1 transition',
                  draft.application_index === null ? 'bg-volt/10 ring-volt/50' : 'bg-white/4 ring-white/8 hover:bg-white/6',
                )}
              >
                <Plus className="h-4 w-4 text-muted" /> A venue not in the application
              </button>
            </div>
          </section>
        )}

        <section className="grid gap-4 sm:grid-cols-2">
          <Field label="Venue name" required error={err('name')}>
            <TextInput value={draft.name} onChange={(e) => patch({ name: e.target.value })} maxLength={120} />
          </Field>
          <Field label="Area" required error={err('area')} hint="Neighbourhood shown on Discover, e.g. Kaloor">
            <TextInput value={draft.area} onChange={(e) => patch({ area: e.target.value })} maxLength={80} />
          </Field>
          <Field label="Address" required error={err('address')} className="sm:col-span-2">
            <TextInput value={draft.address} onChange={(e) => patch({ address: e.target.value })} maxLength={255} />
          </Field>
        </section>

        <section className="space-y-3 rounded-2xl bg-white/[0.03] p-4 ring-1 ring-white/8">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <MapPin className="h-4 w-4 text-volt" /> Map pin
            </div>
            {areaCentre && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  patch({ lat: String(areaCentre.lat), lng: String(areaCentre.lng) })
                  setConfirmed(false)
                }}
              >
                <LocateFixed className="h-4 w-4" /> Start from {areaCentre.name} centre
              </Button>
            )}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Latitude" required error={err('lat')}>
              <TextInput
                inputMode="decimal"
                value={draft.lat}
                onChange={(e) => {
                  patch({ lat: e.target.value.replace(/[^\d.-]/g, '') })
                  setConfirmed(false)
                }}
                placeholder="9.9816"
                className="num"
              />
            </Field>
            <Field label="Longitude" required error={err('lng')}>
              <TextInput
                inputMode="decimal"
                value={draft.lng}
                onChange={(e) => {
                  patch({ lng: e.target.value.replace(/[^\d.-]/g, '') })
                  setConfirmed(false)
                }}
                placeholder="76.2999"
                className="num"
              />
            </Field>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Checkbox checked={confirmed} onChange={setConfirmed} disabled={!hasPin} label="I checked this pin against the venue’s address" />
            {hasPin && (
              <a
                href={`https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=17/${lat}/${lng}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs font-medium text-volt hover:underline"
              >
                Open in OpenStreetMap <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
          <p className="text-xs text-subtle">There’s no geocoding — players navigate with this pin. It must be inside the service area.</p>
        </section>

        <section className="grid gap-4 sm:grid-cols-3">
          <Field label="Opens" error={err('open_time')}>
            <TextInput type="time" step={3600} value={draft.open_time} onChange={(e) => patch({ open_time: e.target.value })} />
          </Field>
          <Field label="Closes" error={err('close_time')} hint="00:00 = midnight">
            <TextInput type="time" step={3600} value={draft.close_time} onChange={(e) => patch({ close_time: e.target.value })} />
          </Field>
          <Field label="Front desk phone" error={err('phone')}>
            <TextInput inputMode="tel" value={draft.phone} onChange={(e) => patch({ phone: e.target.value })} placeholder="Optional" />
          </Field>
          <Field label="Description" className="sm:col-span-3">
            <TextArea value={draft.description} onChange={(e) => patch({ description: e.target.value })} maxLength={2000} placeholder="Optional — shown on the venue page" />
          </Field>
        </section>

        <section className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm font-semibold">Pitches ({draft.pitches.length})</div>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={draft.pitches.length >= 30}
              onClick={() => patch({ pitches: [...draft.pitches, pitchDraft(draft.pitches.at(-1)?.sport ?? 'football', draft.pitches.length)] })}
            >
              <Plus className="h-4 w-4" /> Add pitch
            </Button>
          </div>
          {err('pitches') && <p className="text-xs text-flare">{err('pitches')}</p>}
          {draft.pitches.map((p, i) => (
            <div key={p.key} className="space-y-3 rounded-2xl bg-white/[0.03] p-4 ring-1 ring-white/8">
              <div className="grid gap-3 sm:grid-cols-4">
                <Field label="Name" error={err(`pitches.${i}.name`)}>
                  <TextInput value={p.name} onChange={(e) => patchPitch(p.key, { name: e.target.value })} maxLength={80} />
                </Field>
                <Field label="Sport">
                  <Select
                    value={p.sport}
                    onChange={(e) => {
                      const sport = e.target.value as Sport
                      const format = FORMATS[sport][0]
                      patchPitch(p.key, { sport, format, capacity: String(DEFAULT_CAPACITY[format] ?? p.capacity) })
                    }}
                    className="w-full"
                  >
                    {SPORT_LIST.map((s) => (
                      <option key={s} value={s}>
                        {SPORTS[s].emoji} {SPORTS[s].label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Format" error={err(`pitches.${i}.format`)}>
                  <Select value={p.format} onChange={(e) => patchPitch(p.key, { format: e.target.value, capacity: String(DEFAULT_CAPACITY[e.target.value] ?? p.capacity) })} className="w-full">
                    {FORMATS[p.sport].map((f) => (
                      <option key={f} value={f}>
                        {f}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Players" error={err(`pitches.${i}.capacity`)}>
                  <TextInput inputMode="numeric" value={p.capacity} onChange={(e) => patchPitch(p.key, { capacity: e.target.value.replace(/\D/g, '') })} className="num" />
                </Field>
              </div>
              <div className="grid gap-3 sm:grid-cols-4">
                <Field label="Price / hour (₹)" error={err(`pitches.${i}.price_per_hour_paise`)}>
                  <TextInput inputMode="decimal" value={p.price} onChange={(e) => patchPitch(p.key, { price: e.target.value.replace(/[^\d.]/g, '') })} placeholder="1200" className="num" />
                </Field>
                <Field label="Peak / hour (₹)" hint="Evenings 5–10 PM & weekends" error={err(`pitches.${i}.peak_price_per_hour_paise`)}>
                  <TextInput inputMode="decimal" value={p.peak} onChange={(e) => patchPitch(p.key, { peak: e.target.value.replace(/[^\d.]/g, '') })} placeholder="1500" className="num" />
                </Field>
                <div className="flex flex-col justify-center gap-2 pt-4">
                  <Checkbox checked={p.is_indoor} onChange={(b) => patchPitch(p.key, { is_indoor: b })} label="Indoor / covered" />
                  <Checkbox checked={p.has_camera} onChange={(b) => patchPitch(p.key, { has_camera: b, camera_price: b ? p.camera_price : '' })} label="Camera" />
                </div>
                {p.has_camera ? (
                  <Field label="Recording price (₹)" error={err(`pitches.${i}.camera_price_paise`)}>
                    <TextInput inputMode="decimal" value={p.camera_price} onChange={(e) => patchPitch(p.key, { camera_price: e.target.value.replace(/[^\d.]/g, '') })} placeholder="0" className="num" />
                  </Field>
                ) : (
                  <div className="flex items-end justify-end">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={draft.pitches.length <= 1}
                      onClick={() => patch({ pitches: draft.pitches.filter((x) => x.key !== p.key) })}
                      aria-label={`Remove ${p.name || 'pitch'}`}
                    >
                      <Trash2 className="h-4 w-4" /> Remove
                    </Button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </section>

        <Callout tone="electric" title="What happens next">
          The venue goes live on Discover once {provider.name} is approved and the venue is active. The partner is notified and can fine-tune prices,
          photos and hours in their portal.
        </Callout>
      </div>
    </Drawer>
  )
}

function validate(d: VenueDraft): Record<string, string> {
  const e: Record<string, string> = {}
  if (d.name.trim().length < 2) e.name = 'At least 2 characters'
  if (d.area.trim().length < 2) e.area = 'At least 2 characters'
  if (d.address.trim().length < 5) e.address = 'At least 5 characters'
  const lat = Number(d.lat)
  const lng = Number(d.lng)
  if (d.lat === '' || !Number.isFinite(lat) || lat < -90 || lat > 90) e.lat = 'Enter the latitude'
  if (d.lng === '' || !Number.isFinite(lng) || lng < -180 || lng > 180) e.lng = 'Enter the longitude'
  if (!HHMM.test(d.open_time)) e.open_time = 'HH:MM'
  if (!HHMM.test(d.close_time)) e.close_time = 'HH:MM'
  else if (d.close_time !== '00:00' && d.close_time <= d.open_time) e.close_time = 'Must be after opening'
  if (d.phone.trim() && !/^\+?[0-9]{6,15}$/.test(d.phone.replace(/[\s\-().]/g, ''))) e.phone = '6–15 digits'
  if (!d.pitches.length) e.pitches = 'Add at least one pitch'
  const names = new Set<string>()
  d.pitches.forEach((p, i) => {
    const n = p.name.trim().toLowerCase()
    if (!n) e[`pitches.${i}.name`] = 'Required'
    else if (names.has(n)) e[`pitches.${i}.name`] = 'Names must be unique'
    names.add(n)
    const cap = Number(p.capacity)
    if (!Number.isInteger(cap) || cap < 2 || cap > 40) e[`pitches.${i}.capacity`] = '2–40'
    if (!(rupeesToPaise(p.price) >= 100)) e[`pitches.${i}.price_per_hour_paise`] = 'At least ₹1'
    if (!(rupeesToPaise(p.peak) >= 100)) e[`pitches.${i}.peak_price_per_hour_paise`] = 'At least ₹1'
    if (p.has_camera && p.camera_price && !Number.isFinite(rupeesToPaise(p.camera_price))) e[`pitches.${i}.camera_price_paise`] = 'Enter an amount'
  })
  return e
}

function toBody(d: VenueDraft): AdminCreateVenue {
  return {
    application_index: d.application_index,
    name: d.name.trim(),
    area: d.area.trim(),
    address: d.address.trim(),
    lat: Number(d.lat),
    lng: Number(d.lng),
    description: d.description.trim(),
    phone: d.phone.trim() || null,
    open_time: d.open_time,
    close_time: d.close_time,
    pitches: d.pitches.map((p) => ({
      name: p.name.trim(),
      sport: p.sport,
      format: p.format,
      capacity: Number(p.capacity),
      is_indoor: p.is_indoor,
      has_camera: p.has_camera,
      camera_price_paise: p.has_camera && p.camera_price ? rupeesToPaise(p.camera_price) : 0,
      price_per_hour_paise: rupeesToPaise(p.price),
      peak_price_per_hour_paise: rupeesToPaise(p.peak),
    })),
  }
}
