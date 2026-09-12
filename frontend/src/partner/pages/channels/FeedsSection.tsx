import { useMutation, useQueryClient } from '@tanstack/react-query'
import { CalendarSync, Pause, Play, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import { Sheet } from '@/components/ui/Sheet'
import { errorMessage } from '@/lib/api/client'
import { timeAgo } from '@/lib/format'
import type { Pitch } from '@/types/api'
import type { BlockSource, FeedOut } from '@/types/partner'
import { partnerApi } from '../../api/endpoints'
import { pk } from '../../api/keys'
import { ChoiceChips, ConfirmSheet, Field, Panel, Select, SourceBadge, StatusPill, TextInput } from '../../components/kit'
import { SOURCES } from '../../lib/sources'
import { useCan } from '../../stores/partnerAuth'

type PitchRow = Pitch & { turf_name: string }

export function FeedsSection({ feeds, pitches }: { feeds: FeedOut[]; pitches: PitchRow[] }) {
  const qc = useQueryClient()
  const manager = useCan('manager')
  const [adding, setAdding] = useState(false)
  const [deleting, setDeleting] = useState<FeedOut | null>(null)
  const invalidate = () => qc.invalidateQueries({ queryKey: pk.channels })

  const sync = useMutation({
    mutationFn: (id: string) => partnerApi.channels.syncFeed(id),
    onSuccess: (f) => {
      invalidate()
      qc.invalidateQueries({ queryKey: pk.calendarAll })
      if (f.last_status === 'error') toast.error('Sync failed', { description: f.last_error ?? undefined })
      else toast.success('Synced', { description: `${f.last_event_count} upcoming event${f.last_event_count === 1 ? '' : 's'} on ${f.pitch_name}` })
    },
    onError: (e) => toast.error('Sync failed', { description: errorMessage(e) }),
  })
  const toggle = useMutation({
    mutationFn: (f: FeedOut) => partnerApi.channels.updateFeed(f.id, { is_active: !f.is_active }),
    onSuccess: (f) => {
      invalidate()
      toast.success(f.is_active ? 'Feed resumed' : 'Feed paused')
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const remove = useMutation({
    mutationFn: (id: string) => partnerApi.channels.deleteFeed(id),
    onSuccess: () => {
      invalidate()
      qc.invalidateQueries({ queryKey: pk.calendarAll })
      setDeleting(null)
      toast.success('Feed removed', { description: 'Its imported blocks were released.' })
    },
    onError: (e) => toast.error(errorMessage(e)),
  })

  return (
    <Panel
      id="import"
      title="Import calendars"
      subtitle="Pull busy times from any iCal feed (Google Calendar ‘secret address’, other booking software) into a pitch. Checked every 5 minutes."
      actions={
        manager && (
          <Button size="sm" onClick={() => setAdding(true)} disabled={pitches.length === 0}>
            <Plus className="h-4 w-4" /> Add feed
          </Button>
        )
      }
    >
      {feeds.length === 0 ? (
        <div className="flex flex-col items-center rounded-2xl border border-dashed border-white/12 px-4 py-8 text-center">
          <CalendarSync className="h-8 w-8 text-muted" />
          <p className="mt-3 text-sm font-semibold">No calendars imported</p>
          <p className="mt-1 max-w-sm text-xs text-muted">Keep bookings in a Google Calendar? Paste its secret iCal address and those events block the pitch here automatically.</p>
        </div>
      ) : (
        <ul className="space-y-2.5">
          {feeds.map((f) => (
            <li key={f.id} className="rounded-2xl bg-white/[0.03] p-4 ring-1 ring-white/8">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{f.name}</span>
                    <SourceBadge source={f.source} size="xs" />
                  </div>
                  <div className="mt-1 text-xs text-muted">
                    → {f.pitch_name} · {f.turf_name}
                  </div>
                  <div className="mt-1 truncate font-mono text-[11px] text-muted">{f.url_hint}</div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {!f.is_active ? <StatusPill status="paused" /> : f.last_status ? <StatusPill status={f.last_status} /> : <StatusPill status="pending" label="First sync pending" />}
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs text-muted">
                  {f.last_synced_at ? `Synced ${timeAgo(f.last_synced_at)} · ${f.last_event_count} upcoming event${f.last_event_count === 1 ? '' : 's'}` : 'Not synced yet'}
                </span>
                <div className="flex gap-1.5">
                  <Button size="sm" variant="secondary" onClick={() => sync.mutate(f.id)} loading={sync.isPending && sync.variables === f.id} disabled={!f.is_active}>
                    <RefreshCw className="h-3.5 w-3.5" /> Sync now
                  </Button>
                  {manager && (
                    <>
                      <Button size="sm" variant="ghost" onClick={() => toggle.mutate(f)} aria-label={f.is_active ? 'Pause feed' : 'Resume feed'}>
                        {f.is_active ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                        <span className="hidden sm:inline">{f.is_active ? 'Pause' : 'Resume'}</span>
                      </Button>
                      <Button size="sm" variant="ghost" className="hover:text-flare" onClick={() => setDeleting(f)} aria-label="Remove feed">
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </>
                  )}
                </div>
              </div>
              {f.last_status === 'error' && f.last_error && (
                <p className="mt-3 rounded-xl bg-flare/8 px-3 py-2 text-xs text-flare ring-1 ring-flare/25" role="alert">
                  {f.last_error}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      <AddFeedSheet open={adding} onClose={() => setAdding(false)} pitches={pitches} onAdded={invalidate} />
      <ConfirmSheet
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title="Remove this feed?"
        description="Blocks it imported are released, and those times become bookable on Pytch again."
        confirmLabel="Remove feed"
        danger
        pending={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
      />
    </Panel>
  )
}

const FEED_SOURCES: BlockSource[] = ['ical', 'playo', 'hudle', 'khelomore', 'other_app']

function AddFeedSheet({ open, onClose, pitches, onAdded }: { open: boolean; onClose: () => void; pitches: PitchRow[]; onAdded: () => void }) {
  const [pitchId, setPitchId] = useState('')
  const [name, setName] = useState('')
  const [source, setSource] = useState<BlockSource>('ical')
  const [url, setUrl] = useState('')
  const [urlError, setUrlError] = useState<string | null>(null)
  const pid = pitchId || pitches[0]?.id || ''

  const create = useMutation({
    mutationFn: (u: string) => partnerApi.channels.createFeed({ pitch_id: pid, name: name.trim() || 'Imported calendar', source, url: u }),
    onSuccess: (f) => {
      onAdded()
      toast.success('Calendar connected', { description: `${f.last_event_count} upcoming event${f.last_event_count === 1 ? '' : 's'} found for ${f.pitch_name}.` })
      setUrl('')
      setName('')
      onClose()
    },
    onError: (e) => setUrlError(errorMessage(e)),
  })

  const submit = () => {
    const u = url.trim().replace(/^webcal:\/\//i, 'https://')
    try {
      const parsed = new URL(u)
      if (parsed.protocol !== 'https:') throw new Error()
    } catch {
      setUrlError('Paste the full https:// (or webcal://) address of the calendar.')
      return
    }
    setUrl(u)
    create.mutate(u)
  }

  return (
    <Sheet open={open} onClose={onClose} title="Import a calendar" description="We fetch it once now to check it works, then every 5 minutes." size="md">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <Field label="Block this pitch" htmlFor="fd-p">
          <Select id="fd-p" value={pid} onChange={setPitchId} options={pitches.map((p) => ({ value: p.id, label: `${p.name} · ${p.turf_name}` }))} />
        </Field>
        <Field label="Calendar address (iCal / .ics)" htmlFor="fd-u" error={urlError} hint="Google Calendar: Settings → your calendar → ‘Secret address in iCal format’.">
          <TextInput
            id="fd-u"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value)
              setUrlError(null)
            }}
            placeholder="https://calendar.google.com/calendar/ical/…/basic.ics"
            className="font-mono text-sm"
            inputMode="url"
            autoComplete="off"
          />
        </Field>
        <Field label="Name" htmlFor="fd-n" optional>
          <TextInput id="fd-n" value={name} onChange={(e) => setName(e.target.value)} placeholder="Front-desk Google Calendar" />
        </Field>
        <Field label="Tag imported bookings as">
          <ChoiceChips size="sm" options={FEED_SOURCES.map((s) => ({ value: s, label: SOURCES[s].label, icon: SOURCES[s].icon, color: SOURCES[s].color }))} value={source} onChange={setSource} />
        </Field>
        <p className="text-xs text-muted">
          The address is stored encrypted and never shown in full again. Each event blocks its hours on the pitch, and its <b className="text-fg">title is imported as the booking label</b> you see on the
          calendar — only you and your team see it, never players or export feeds. Descriptions, attendees and locations are ignored.
        </p>
        <Button type="submit" block size="lg" loading={create.isPending} disabled={!url.trim() || !pid}>
          Connect calendar
        </Button>
      </form>
    </Sheet>
  )
}
