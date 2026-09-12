import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, ArrowRightLeft, CheckCircle2, EyeOff, ShieldCheck, type LucideIcon } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import { Segmented } from '@/components/ui/Segmented'
import { ErrorState } from '@/components/ui/States'
import { errorMessage } from '@/lib/api/client'
import { cn } from '@/lib/cn'
import { alpha } from '@/lib/color'
import { formatDateLong, timeAgo } from '@/lib/format'
import type { SyncConflictOut } from '@/types/partner'
import { partnerApi, type ConflictResolution } from '../../api/endpoints'
import { pk } from '../../api/keys'
import { Panel, SkeletonRows, StatusPill, TextInput } from '../../components/kit'
import { SOURCES, sourceMeta } from '../../lib/sources'
import { dayLabel, hhmmLabel, istDateOf, istTimeOf } from '../../lib/time'
import { useCan } from '../../stores/partnerAuth'

const RESOLUTION_LABEL: Record<ConflictResolution, string> = {
  kept_pytch: 'Kept the Pytch booking',
  moved_external: 'Moved the external booking',
  ignored: 'Ignored',
}

export function ConflictsSection({ openCount }: { openCount: number }) {
  const [tab, setTab] = useState<'open' | 'resolved'>('open')
  const q = useQuery({ queryKey: pk.conflicts(tab === 'open' ? 'open' : undefined), queryFn: () => partnerApi.channels.conflicts(tab === 'open' ? 'open' : undefined) })
  const list = (q.data ?? []).filter((c) => (tab === 'open' ? c.status === 'open' : c.status !== 'open'))
  return (
    <Panel
      id="conflicts"
      title={
        <span className="flex items-center gap-2">
          Conflict centre
          {openCount > 0 && <span className="rounded-full bg-flare px-2 py-0.5 font-sans text-[11px] font-bold text-snow">{openCount} open</span>}
        </span>
      }
      subtitle="When an imported booking lands on a slot that’s already taken, the booking that was there first keeps it. Decide what happens to the other."
      actions={
        <Segmented
          size="sm"
          className="pp-seg [&_button]:whitespace-nowrap"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'open', label: 'Open' },
            { value: 'resolved', label: 'History' },
          ]}
        />
      }
    >
      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data ? (
        <SkeletonRows rows={2} />
      ) : list.length === 0 ? (
        <div className="flex items-center gap-3 rounded-2xl bg-mint/8 p-4 ring-1 ring-mint/25">
          <ShieldCheck className="h-6 w-6 shrink-0 text-mint" />
          <div>
            <div className="text-sm font-semibold">{tab === 'open' ? 'No conflicts — every channel agrees' : 'No resolved conflicts yet'}</div>
            <div className="text-xs text-muted">
              {tab === 'open'
                ? 'We check every import against Pytch bookings and alert you within a minute. Clashes that sort themselves out (a game is cancelled, a feed removed) close automatically.'
                : 'Resolved conflicts are kept here for your records.'}
            </div>
          </div>
        </div>
      ) : (
        <ul className="space-y-3">
          <AnimatePresence initial={false}>
            {list.map((c) => (
              <motion.li key={c.id} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: 40, height: 0, marginTop: 0 }}>
                <ConflictCard c={c} />
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}
    </Panel>
  )
}

const range = (s: string, e: string) => `${dayLabel(istDateOf(s), 'EEE d MMM')} · ${hhmmLabel(istTimeOf(s))}–${hhmmLabel(istTimeOf(e))}`

/** The booking that holds the slot — a Pytch game (confirmed or still collecting payments) or another block. */
function holder(c: SyncConflictOut): { color: string; icon: LucideIcon; label: string; title: string; note: string } {
  if (c.holder_kind === 'block' && c.holder_source) {
    const s = sourceMeta(c.holder_source)
    return { color: s.color, icon: s.icon, label: `${s.label} · kept`, title: c.holder_label ?? s.label, note: 'Logged first — it keeps the slot' }
  }
  const pytch = { color: SOURCES.pytch.color, icon: SOURCES.pytch.icon, title: c.lobby_title ?? c.holder_label ?? 'Pytch booking' }
  switch (c.lobby_status) {
    case 'forming':
      return { ...pytch, label: 'Pytch game · holding', note: 'Players are still paying — if it expires, the slot frees up' }
    case 'expired':
    case 'cancelled':
      return { ...pytch, label: `Pytch game · ${c.lobby_status}`, note: 'This game no longer holds the slot' }
    case 'confirmed':
    case 'completed':
      return { ...pytch, label: 'Pytch booking · kept', note: 'Confirmed first — players have paid' }
    default:
      return { ...pytch, label: c.holder_kind === 'pytch' ? 'Pytch booking · kept' : 'Existing booking · kept', title: c.holder_label ?? c.lobby_title ?? 'Existing booking', note: 'Booked first — it keeps the slot' }
  }
}

function ConflictCard({ c }: { c: SyncConflictOut }) {
  const qc = useQueryClient()
  const manager = useCan('manager')
  const [choice, setChoice] = useState<ConflictResolution | null>(null)
  const [note, setNote] = useState('')
  const ext = sourceMeta(c.source)
  const kept = holder(c)
  const resolve = useMutation({
    mutationFn: () => partnerApi.channels.resolveConflict(c.id, choice!, note),
    onSuccess: () => {
      toast.success('Conflict resolved', { description: RESOLUTION_LABEL[choice!] })
      qc.invalidateQueries({ queryKey: ['partner', 'channels'] })
      qc.invalidateQueries({ queryKey: pk.calendarAll })
      qc.invalidateQueries({ queryKey: ['partner', 'dashboard'] })
    },
    onError: (e) => toast.error('Couldn’t resolve', { description: errorMessage(e) }),
  })
  const open = c.status === 'open'

  return (
    <div className={cn('rounded-2xl p-4 ring-1', open ? 'bg-flare/[0.05] ring-flare/30' : 'bg-white/[0.03] ring-white/8')}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold">
          {open && <AlertTriangle className="h-4 w-4 text-flare" />}
          {c.pitch_name} · {c.turf_name}
        </div>
        <span className="text-xs text-muted">
          {open ? `Detected ${timeAgo(c.created_at)}` : <StatusPill status={c.status} label={c.resolution ? RESOLUTION_LABEL[c.resolution] : undefined} />}
        </span>
      </div>

      <div className="mt-3 grid items-stretch gap-2 sm:grid-cols-[1fr_auto_1fr]">
        <div className="rounded-xl p-3" style={{ background: alpha(kept.color, 0.07), boxShadow: `inset 3px 0 0 ${kept.color}` }}>
          <div className="flex items-center gap-1.5 text-[11px] font-bold tracking-wider text-muted uppercase">
            <kept.icon className="h-3.5 w-3.5" style={{ color: kept.color }} /> {kept.label}
          </div>
          <div className="mt-1 truncate text-sm font-semibold">{kept.title}</div>
          <div className="text-xs text-muted">{kept.note}</div>
        </div>
        <div className="flex items-center justify-center text-muted" aria-hidden>
          <ArrowRightLeft className="h-4 w-4 rotate-90 sm:rotate-0" />
        </div>
        <div className="rounded-xl p-3" style={{ background: alpha(ext.color, 0.07), boxShadow: `inset 3px 0 0 ${ext.color}` }}>
          <div className="flex items-center gap-1.5 text-[11px] font-bold tracking-wider text-muted uppercase">
            <ext.icon className="h-3.5 w-3.5" style={{ color: ext.color }} /> {ext.label} · overlapping
          </div>
          <div className="mt-1 line-clamp-2 text-sm font-semibold">{c.summary || 'Busy'}</div>
          <div className="text-xs text-muted">{range(c.external_start_at, c.external_end_at)}</div>
          {c.external_ref && <div className="mt-0.5 truncate font-mono text-[10px] text-muted">ref {c.external_ref}</div>}
        </div>
      </div>

      {open && manager && (
        <div className="mt-4">
          <div className="text-xs font-semibold text-muted">What did you do?</div>
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            {(
              [
                { v: 'kept_pytch', icon: CheckCircle2, t: c.holder_kind === 'block' ? 'Kept the first booking' : 'Kept the Pytch booking', d: `I’ll tell the ${ext.label} customer` },
                { v: 'moved_external', icon: ArrowRightLeft, t: 'Moved the other booking', d: 'Rebooked them on another slot/pitch' },
                { v: 'ignored', icon: EyeOff, t: 'Not a real clash', d: 'Duplicate or test entry' },
              ] as const
            ).map((o) => (
              <button
                key={o.v}
                type="button"
                aria-pressed={choice === o.v}
                onClick={() => setChoice(o.v)}
                className={cn(
                  'flex cursor-pointer items-start gap-2.5 rounded-xl p-3 text-left ring-1 transition',
                  choice === o.v ? 'bg-volt/12 ring-2 ring-volt/80' : 'bg-white/[0.03] ring-white/10 hover:bg-white/8',
                )}
              >
                <o.icon className={cn('mt-0.5 h-4 w-4 shrink-0', choice === o.v ? 'text-volt' : 'text-muted')} />
                <span>
                  <span className="block text-sm font-semibold">{o.t}</span>
                  <span className="block text-xs text-muted">{o.d}</span>
                </span>
              </button>
            ))}
          </div>
          <AnimatePresence>
            {choice && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                <div className="flex flex-col gap-2 pt-3 sm:flex-row">
                  <TextInput value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note for your records (optional)" aria-label="Resolution note" className="flex-1" />
                  <Button onClick={() => resolve.mutate()} loading={resolve.isPending}>
                    Mark as resolved
                  </Button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          <p className="mt-3 text-xs text-muted">
            Marking it resolved records your decision for the audit trail — it doesn’t cancel or move anything on Pytch by itself. Need to give the slot to the other customer instead? Contact Pytch partner support — the Pytch players get an automatic refund and a nearby alternative.
          </p>
        </div>
      )}
      {!open && (
        <div className="mt-2 text-xs text-muted">
          Logged {formatDateLong(c.created_at)}
          {c.resolution_note && <> · {c.resolution_note}</>}
        </div>
      )}
    </div>
  )
}
