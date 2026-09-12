import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Camera, Check, Clock, ImagePlus, Info, Pencil, Plus, Star, Trash2, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import { SportBadge } from '@/components/ui/PlayerBits'
import { Segmented } from '@/components/ui/Segmented'
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States'
import { TurfArt } from '@/components/ui/TurfArt'
import { errorMessage } from '@/lib/api/client'
import { cn } from '@/lib/cn'
import { formatINR, pluralize } from '@/lib/format'
import type { PartnerPitch, PartnerVenue, VenueUpdate } from '@/types/partner'
import { partnerApi } from '../../api/endpoints'
import { pk } from '../../api/keys'
import { ChoiceChips, Field, Panel, StatusPill, TextInput, inputCls } from '../../components/kit'
import { useVenues } from '../../hooks'
import { apiFieldErrors, describeApiError } from '../../lib/errors'
import { hhmmLabel } from '../../lib/time'
import { PitchSheet } from './PitchSheet'

type Tab = 'details' | 'pitches' | 'photos'

const AMENITIES = ['Floodlights', 'Parking', 'Changing rooms', 'Washrooms', 'Drinking water', 'Showers', 'Cafe', 'First aid', 'Equipment rental', 'Seating', 'Wi-Fi', 'CCTV']

export default function VenueEditPage() {
  const { turfId } = useParams()
  const venues = useVenues()
  const venue = venues.data?.find((v) => v.id === turfId)
  const [tab, setTab] = useState<Tab>('details')

  if (venues.isError) return <ErrorState error={venues.error} onRetry={() => venues.refetch()} />
  if (!venues.data) return <Skeleton className="h-96 rounded-3xl" />
  if (!venue) return <EmptyState title="Venue not found" description="It may belong to another venue account." action={<Link to="/partner/venues" className="font-semibold text-volt">Back to venues</Link>} />

  return (
    <div>
      <Link to="/partner/venues" className="-ml-2 mb-3 inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm text-muted hover:bg-white/5 hover:text-fg">
        <ArrowLeft className="h-4 w-4" /> Venues
      </Link>
      <TurfArt seed={venue.id} sport={venue.sports[0]} src={venue.cover_url} className="mb-5 h-36 rounded-3xl sm:h-44">
        <div className="flex h-full flex-col justify-end p-5">
          <div className="flex flex-wrap items-center gap-2">
            {!venue.is_active && <StatusPill status="paused" label="Hidden from players" />}
          </div>
          <h1 className="mt-1 font-display text-2xl font-bold text-snow sm:text-3xl">{venue.name}</h1>
          <p className="text-sm text-snow/75">
            {venue.area} · {venue.pitches.length} pitch{venue.pitches.length === 1 ? '' : 'es'} · {hhmmLabel(venue.open_time.slice(0, 5))}–{hhmmLabel(venue.close_time.slice(0, 5))}
          </p>
        </div>
      </TurfArt>

      <Segmented<Tab>
        className="pp-seg mb-5 max-w-full [&_button]:whitespace-nowrap"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'details', label: 'Details' },
          { value: 'pitches', label: `Pitches · ${venue.pitches.length}` },
          { value: 'photos', label: 'Photos' },
        ]}
      />

      <AnimatePresence mode="wait">
        <motion.div key={tab} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.18 }}>
          {tab === 'details' && <DetailsForm key={venue.id} venue={venue} />}
          {tab === 'pitches' && <PitchList venue={venue} />}
          {tab === 'photos' && <PhotosForm key={venue.id} venue={venue} />}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}

const VENUE_FIELDS: Record<string, string> = {
  name: 'Venue name',
  description: 'Description',
  address: 'Address',
  phone: 'Front-desk phone',
  open_time: 'Opens',
  close_time: 'Closes',
  amenities: 'Amenities',
  photos: 'Photos',
  cover_url: 'Cover photo',
}

/** Digits (and a leading +) once spaces, dashes, dots and brackets are dropped — the API normalises the same way. */
const PHONE_OK = (v: string) => /^\+?\d{6,15}$/.test(v.replace(/[\s\-().]/g, ''))

function useUpdateVenue(venue: PartnerVenue, onFieldErrors?: (errors: Record<string, string>) => void) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: VenueUpdate) => partnerApi.venues.update(venue.id, body),
    onSuccess: (v) => {
      qc.setQueryData<PartnerVenue[]>(pk.venues, (list) => list?.map((x) => (x.id === v.id ? v : x)))
      qc.invalidateQueries({ queryKey: pk.venues })
      onFieldErrors?.({})
      toast.success('Venue updated', { description: 'Players see the changes right away.' })
    },
    onError: (e) => {
      onFieldErrors?.(apiFieldErrors(e))
      toast.error('Couldn’t save', { description: describeApiError(e, VENUE_FIELDS) ?? errorMessage(e) })
    },
  })
}

function DetailsForm({ venue }: { venue: PartnerVenue }) {
  const [errors, setErrors] = useState<Record<string, string>>({})
  const save = useUpdateVenue(venue, setErrors)
  const clear = (k: string) =>
    errors[k] &&
    setErrors((e) => {
      const next = { ...e }
      delete next[k]
      return next
    })
  const [name, setName] = useState(venue.name)
  const [description, setDescription] = useState(venue.description ?? '')
  const [address, setAddress] = useState(venue.address)
  const [phone, setPhone] = useState(venue.phone ?? '')
  const [open, setOpen] = useState(venue.open_time.slice(0, 5))
  const [close, setClose] = useState(venue.close_time.slice(0, 5))
  const [amenities, setAmenities] = useState<string[]>(venue.amenities)
  const [custom, setCustom] = useState('')
  const all = [...new Set([...AMENITIES, ...venue.amenities, ...amenities])]
  const dirty =
    name !== venue.name ||
    description !== (venue.description ?? '') ||
    address !== venue.address ||
    phone !== (venue.phone ?? '') ||
    open !== venue.open_time.slice(0, 5) ||
    close !== venue.close_time.slice(0, 5) ||
    amenities.join('|') !== venue.amenities.join('|')
  const hoursError = close !== '00:00' && close <= open ? 'Closing time must be after opening (use 12:00 AM for midnight).' : null
  const phoneError = phone.trim() && !PHONE_OK(phone.trim()) ? 'Digits only — e.g. +91 98765 43210 or 0484 234 5678.' : null

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (hoursError || phoneError) return
        save.mutate({ name: name.trim(), description: description.trim(), address: address.trim(), phone: phone.trim() || null, open_time: open, close_time: close, amenities })
      }}
      className="grid gap-5 lg:grid-cols-[1.4fr_1fr] [&>*]:min-w-0"
    >
      <Panel title="About the venue" subtitle="Shown on your Pytch venue page.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Venue name" htmlFor="vd-n" className="sm:col-span-2" error={errors.name}>
            <TextInput
              id="vd-n"
              value={name}
              onChange={(e) => {
                setName(e.target.value)
                clear('name')
              }}
              required
              minLength={2}
              aria-invalid={!!errors.name}
            />
          </Field>
          <Field label="Description" htmlFor="vd-d" className="sm:col-span-2" hint={`${description.length}/600`} error={errors.description}>
            <textarea
              id="vd-d"
              value={description}
              maxLength={600}
              onChange={(e) => {
                setDescription(e.target.value)
                clear('description')
              }}
              rows={4}
              className={cn(inputCls, 'h-auto resize-none py-3')}
              placeholder="FIFA-grade turf, floodlit till midnight, 2 min from the metro."
            />
          </Field>
          <Field label="Address" htmlFor="vd-a" className="sm:col-span-2" error={errors.address}>
            <TextInput
              id="vd-a"
              value={address}
              onChange={(e) => {
                setAddress(e.target.value)
                clear('address')
              }}
              aria-invalid={!!errors.address}
            />
          </Field>
          <Field label="Front-desk phone" htmlFor="vd-p" optional hint="Shown to players who booked." error={phoneError ?? errors.phone}>
            <TextInput
              id="vd-p"
              type="tel"
              value={phone}
              onChange={(e) => {
                setPhone(e.target.value)
                clear('phone')
              }}
              className="font-mono"
              placeholder="+91 98765 43210"
              aria-invalid={!!(phoneError ?? errors.phone)}
            />
          </Field>
        </div>
      </Panel>

      <div className="space-y-5">
        <Panel title="Opening hours" subtitle="New slots are created inside these hours.">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Opens" htmlFor="vd-o" error={hoursError ?? errors.open_time ?? errors.close_time}>
              <input id="vd-o" type="time" step={1800} value={open} onChange={(e) => setOpen(e.target.value)} className={cn(inputCls, 'font-mono')} />
            </Field>
            <Field label="Closes" htmlFor="vd-c">
              <input id="vd-c" type="time" step={1800} value={close} onChange={(e) => setClose(e.target.value)} className={cn(inputCls, 'font-mono')} />
            </Field>
          </div>
          <p className="mt-3 flex items-start gap-2 text-xs text-muted">
            <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Existing bookings are never moved. Changing hours affects slots generated from now on.
          </p>
        </Panel>
        <Panel title="Amenities">
          <ChoiceChips size="sm" options={all.map((a) => ({ value: a, label: a }))} value={amenities} onChange={(a) => setAmenities((l) => (l.includes(a) ? l.filter((x) => x !== a) : [...l, a]))} />
          {errors.amenities && (
            <p role="alert" className="mt-2 text-xs text-flare">
              {errors.amenities}
            </p>
          )}
          <div className="mt-3 flex gap-2">
            <TextInput value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="Add your own" className="h-10 text-sm" aria-label="Custom amenity" />
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="h-10"
              disabled={!custom.trim()}
              onClick={() => {
                const a = custom.trim()
                if (a && !amenities.includes(a)) setAmenities((l) => [...l, a])
                setCustom('')
              }}
            >
              <Plus className="h-4 w-4" /> Add
            </Button>
          </div>
        </Panel>
      </div>

      {errors._form && (
        <p role="alert" className="text-sm text-flare lg:col-span-2">
          {errors._form}
        </p>
      )}
      <SaveBar dirty={dirty} pending={save.isPending} />
    </form>
  )
}

function SaveBar({ dirty, pending }: { dirty: boolean; pending: boolean }) {
  return (
    <AnimatePresence>
      {dirty && (
        <motion.div
          initial={{ y: 40, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 40, opacity: 0 }}
          className="glass-strong sticky bottom-24 z-20 flex items-center justify-between gap-3 rounded-2xl p-3 pl-4 shadow-card lg:bottom-4 lg:col-span-2"
        >
          <span className="text-sm text-muted">You have unsaved changes</span>
          <Button type="submit" loading={pending}>
            <Check className="h-4 w-4" /> Save
          </Button>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function PitchList({ venue }: { venue: PartnerVenue }) {
  const [editing, setEditing] = useState<PartnerPitch | 'new' | null>(null)
  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-sm text-muted">Base price applies off-peak; peak price applies to evening & weekend slots.</p>
        <Button onClick={() => setEditing('new')}>
          <Plus className="h-4 w-4" /> Add pitch
        </Button>
      </div>
      {venue.pitches.length === 0 ? (
        <EmptyState title="No pitches yet" description="Add your first pitch — we’ll open 14 days of slots for it straight away." />
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {venue.pitches.map((p) => (
            <li key={p.id} className={cn('glass flex items-start gap-4 rounded-2xl p-4', !p.is_active && 'opacity-70')}>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{p.name}</span>
                  <SportBadge sport={p.sport} format={p.format} />
                  {!p.is_active && <StatusPill status="paused" label="Not bookable" />}
                </div>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
                  <span>{p.capacity} players</span>
                  {!!p.upcoming_bookings && <span>{pluralize(p.upcoming_bookings, 'upcoming booking')}</span>}
                  <span>{p.is_indoor ? 'Indoor' : 'Outdoor'}</span>
                  {p.has_camera && (
                    <span className="flex items-center gap-1">
                      <Camera className="h-3.5 w-3.5" /> Camera {formatINR(p.camera_price_paise)}
                    </span>
                  )}
                </div>
                <div className="mt-3 flex gap-2">
                  <span className="rounded-lg bg-white/5 px-2.5 py-1 text-xs ring-1 ring-white/10">
                    Base <b className="font-mono">{formatINR(p.price_per_hour_paise)}</b>/h
                  </span>
                  <span className="rounded-lg bg-sun/10 px-2.5 py-1 text-xs ring-1 ring-sun/30">
                    Peak <b className="font-mono">{formatINR(p.peak_price_per_hour_paise)}</b>/h
                  </span>
                </div>
              </div>
              <Button variant="secondary" size="sm" onClick={() => setEditing(p)} aria-label={`Edit ${p.name}`}>
                <Pencil className="h-3.5 w-3.5" /> Edit
              </Button>
            </li>
          ))}
        </ul>
      )}
      <PitchSheet venue={venue} pitch={editing} onClose={() => setEditing(null)} />
    </div>
  )
}

function PhotosForm({ venue }: { venue: PartnerVenue }) {
  const save = useUpdateVenue(venue)
  const [photos, setPhotos] = useState<string[]>(venue.photos)
  const [cover, setCover] = useState<string | null>(venue.cover_url)
  const [url, setUrl] = useState('')
  const [error, setError] = useState<string | null>(null)
  const dirty = photos.join('|') !== venue.photos.join('|') || cover !== venue.cover_url

  const add = () => {
    const u = url.trim()
    try {
      const parsed = new URL(u)
      if (parsed.protocol !== 'https:') throw new Error()
    } catch {
      setError('Paste a full https:// image link.')
      return
    }
    if (photos.includes(u)) return setError('Already added.')
    setPhotos((p) => [...p, u])
    if (!cover) setCover(u)
    setUrl('')
    setError(null)
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        save.mutate({ photos, cover_url: cover })
      }}
      className="space-y-5"
    >
      <Panel title="Photos" subtitle="Bright, wide shots of each pitch sell more slots. The cover appears on search results.">
        <div className="flex flex-col gap-2 sm:flex-row">
          <Field label="Image link" htmlFor="ph-url" error={error} className="flex-1">
            <TextInput
              id="ph-url"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value)
                setError(null)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  add()
                }
              }}
              placeholder="https://…/pitch-a.jpg"
              inputMode="url"
            />
          </Field>
          <Button type="button" variant="secondary" className="sm:mt-6" onClick={add} disabled={!url.trim()}>
            <ImagePlus className="h-4 w-4" /> Add photo
          </Button>
        </div>
        {photos.length === 0 ? (
          <div className="mt-5 flex items-center gap-3 rounded-2xl border border-dashed border-white/12 p-6 text-sm text-muted">
            <Info className="h-5 w-5 shrink-0" /> No photos yet — players see generated pitch art until you add some.
          </div>
        ) : (
          <ul className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-3">
            {photos.map((p) => (
              <li key={p} className={cn('group relative overflow-hidden rounded-2xl ring-2', cover === p ? 'ring-volt' : 'ring-transparent')}>
                <TurfArt seed={p} src={p} className="aspect-[4/3]" />
                <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 p-2" data-theme="dark">
                  <button
                    type="button"
                    onClick={() => setCover(p)}
                    className={cn('flex h-8 cursor-pointer items-center gap-1 rounded-lg px-2 text-xs font-semibold', cover === p ? 'bg-volt text-ink-950' : 'bg-ink-900/70 text-fg backdrop-blur')}
                  >
                    <Star className="h-3.5 w-3.5" /> {cover === p ? 'Cover' : 'Make cover'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPhotos((l) => l.filter((x) => x !== p))
                      if (cover === p) setCover(null)
                    }}
                    aria-label="Remove photo"
                    className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg bg-ink-900/70 text-fg backdrop-blur hover:text-flare"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      {dirty && (
        <div className="glass-strong sticky bottom-24 z-20 flex items-center justify-between gap-3 rounded-2xl p-3 pl-4 shadow-card lg:bottom-4">
          <span className="text-sm text-muted">Unsaved photo changes</span>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setPhotos(venue.photos)
                setCover(venue.cover_url)
              }}
            >
              <X className="h-4 w-4" /> Discard
            </Button>
            <Button type="submit" loading={save.isPending}>
              <Check className="h-4 w-4" /> Save
            </Button>
          </div>
        </div>
      )}
    </form>
  )
}
