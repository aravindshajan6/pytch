/**
 * Manual sync with the venue's other booking apps (Playo, Hudle, …):
 *  - <MirrorAlerts/>   live toast + chime on every screen when a PYTCH booking takes a slot ("block it on your
 *                      other apps") or gives it back ("free it"), from the partner-only `venue:<id>` channel;
 *  - <MirrorTodoButton/> top-bar checklist of PYTCH bookings not yet ticked off as mirrored;
 *  - <MirrorTodoCard/>   the same list on the dashboard.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bell, BellOff, Check, ListChecks, RotateCcw } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { create } from 'zustand'
import { Sheet } from '@/components/ui/Sheet'
import { cn } from '@/lib/cn'
import { formatDay, formatSlotRange } from '@/lib/format'
import { useChannel } from '@/lib/realtime'
import type { MirrorTaskEvent } from '@/types/api'
import type { MirrorTask } from '@/types/partner'
import { partnerApi } from '../api/endpoints'
import { pk } from '../api/keys'
import { useVenues } from '../hooks'
import { chimeEnabled, playChime, setChimeEnabled } from '../lib/chime'
import { Panel } from './kit'

const useMirrorSheet = create<{ open: boolean; setOpen: (open: boolean) => void }>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}))

const when = (t: Pick<MirrorTaskEvent, 'start_at' | 'end_at'>) => `${formatDay(t.start_at)} · ${formatSlotRange(t.start_at, t.end_at)}`
const verb = (t: Pick<MirrorTaskEvent, 'action'>) => (t.action === 'block' ? 'Block it' : 'Free it')

export function useMirrorTasks() {
  return useQuery({ queryKey: pk.mirror('open'), queryFn: () => partnerApi.mirror.list('open'), refetchInterval: 60_000 })
}

function useMirrorUpdate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, done }: { id: string; done: boolean }) => partnerApi.mirror.update(id, done),
    onMutate: async ({ id, done }) => {
      if (!done) return
      await qc.cancelQueries({ queryKey: pk.mirror('open') })
      qc.setQueryData<MirrorTask[]>(pk.mirror('open'), (old) => old?.filter((t) => t.id !== id))
    },
    onSettled: () => qc.invalidateQueries({ queryKey: pk.mirrorAll }),
    onError: () => toast.error("Couldn't update that to-do — try again"),
  })
}

// ───────────────────────── live alerts ─────────────────────────

export function MirrorAlerts() {
  const venues = useVenues().data ?? []
  const qc = useQueryClient()
  const update = useMirrorUpdate()
  const seen = useRef(new Set<string>())

  const onEvent = (event: string, t: MirrorTaskEvent) => {
    qc.invalidateQueries({ queryKey: pk.mirrorAll })
    qc.invalidateQueries({ queryKey: pk.calendarAll })
    if (event === 'mirror.task' && t.status === 'open') {
      if (seen.current.has(t.id)) return
      seen.current.add(t.id)
      playChime(t.action === 'block' ? 'up' : 'down')
      toast(t.action === 'block' ? `New PYTCH booking · ${when(t)}` : `PYTCH booking released · ${when(t)}`, {
        id: `mirror-${t.id}`,
        description: `${t.pitch_name} · ${t.turf_name} — ${verb(t).toLowerCase()} on your other apps.`,
        duration: 20_000,
        action: {
          label: t.action === 'block' ? 'Blocked ✓' : 'Freed ✓',
          onClick: () => update.mutate({ id: t.id, done: true }),
        },
      })
    } else if (event === 'mirror.task_closed') {
      toast.dismiss(`mirror-${t.id}`)
      toast(`Released before you blocked it · ${when(t)}`, {
        description: `${t.pitch_name} · ${t.turf_name} — nothing to change on your other apps.`,
        duration: 8_000,
      })
    } else if (event === 'mirror.task_updated' && t.status === 'done') {
      toast.dismiss(`mirror-${t.id}`) // ticked off on another screen
    }
  }

  return (
    <>
      {venues.map((v) => (
        <VenueListener key={v.id} turfId={v.id} onEvent={onEvent} />
      ))}
    </>
  )
}

function VenueListener({ turfId, onEvent }: { turfId: string; onEvent: (event: string, t: MirrorTaskEvent) => void }) {
  useChannel(`venue:${turfId}`, (m) => {
    if (m.event === 'mirror.task' || m.event === 'mirror.task_closed' || m.event === 'mirror.task_updated') {
      onEvent(m.event, m.data as MirrorTaskEvent)
    }
  })
  return null
}

// ───────────────────────── checklist ─────────────────────────

export function MirrorTodoButton({ className }: { className?: string }) {
  const tasks = useMirrorTasks().data ?? []
  const { open, setOpen } = useMirrorSheet()
  const n = tasks.length
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          'relative flex h-9 items-center gap-1.5 rounded-full px-3 text-xs font-semibold ring-1 transition',
          n > 0 ? 'bg-volt/12 text-volt ring-volt/35 hover:bg-volt/20' : 'bg-white/5 text-fg/70 ring-white/10 hover:bg-white/10',
          className,
        )}
        aria-label={n > 0 ? `${n} bookings to mirror on your other apps` : 'Other apps to-do'}
      >
        <ListChecks className="h-4 w-4" />
        <span className="hidden sm:inline">Other apps</span>
        <AnimatePresence initial={false}>
          {n > 0 && (
            <motion.span
              key={n}
              initial={{ scale: 0.4, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="flex h-5 min-w-5 items-center justify-center rounded-full bg-volt px-1.5 text-[10px] font-bold text-ink-950"
            >
              {n > 9 ? '9+' : n}
            </motion.span>
          )}
        </AnimatePresence>
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Blocked on other apps?" description="Tick off each PYTCH booking once you've matched it on Playo, Hudle and the rest." size="md">
        <SoundToggle />
        <MirrorList />
        <RecentlyDone />
      </Sheet>
    </>
  )
}

export function MirrorTodoCard() {
  const q = useMirrorTasks()
  const setOpen = useMirrorSheet((s) => s.setOpen)
  const tasks = q.data ?? []
  if (!q.data || tasks.length === 0) return null
  return (
    <Panel
      title="Blocked on other apps?"
      subtitle={`${tasks.length} PYTCH booking${tasks.length === 1 ? '' : 's'} still to match on your other apps`}
      actions={
        <button type="button" onClick={() => setOpen(true)} className="text-xs font-semibold text-volt hover:underline">
          See all
        </button>
      }
    >
      <MirrorList limit={4} />
    </Panel>
  )
}

function MirrorList({ limit }: { limit?: number }) {
  const q = useMirrorTasks()
  const update = useMirrorUpdate()
  const tasks = (q.data ?? []).slice(0, limit)
  if (q.isLoading) return <div className="skeleton h-24 rounded-2xl" />
  if (tasks.length === 0)
    return (
      <div className="flex flex-col items-center gap-2 rounded-2xl bg-white/[0.03] px-4 py-8 text-center ring-1 ring-white/8">
        <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-mint/15 text-mint">
          <Check className="h-5 w-5" />
        </span>
        <p className="font-semibold">All clear</p>
        <p className="max-w-xs text-sm text-muted">Every PYTCH booking is matched on your other apps.</p>
      </div>
    )
  return (
    <ul className="space-y-2">
      <AnimatePresence initial={false}>
        {tasks.map((t) => (
          <motion.li
            key={t.id}
            layout
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, x: 24 }}
            className="flex items-center gap-3 rounded-2xl bg-white/[0.04] p-3 ring-1 ring-white/8"
          >
            <span
              className={cn(
                'shrink-0 rounded-lg px-2 py-1 text-[10px] font-bold tracking-wide uppercase',
                t.action === 'block' ? 'bg-volt/15 text-volt' : 'bg-sun/15 text-sun',
              )}
            >
              {t.action === 'block' ? 'Block' : 'Free'}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold">{when(t)}</span>
              <span className="block truncate text-xs text-muted">
                {t.pitch_name} · {t.turf_name} · <span className="font-mono">{t.booking_code}</span>
              </span>
            </span>
            <button
              type="button"
              onClick={() => update.mutate({ id: t.id, done: true })}
              className="flex h-11 shrink-0 items-center gap-1.5 rounded-xl bg-white/6 px-3 text-xs font-semibold ring-1 ring-white/10 transition hover:bg-volt hover:text-ink-950"
              aria-label={`${verb(t)} done for ${t.pitch_name} ${when(t)}`}
            >
              <Check className="h-4 w-4" /> Done
            </button>
          </motion.li>
        ))}
      </AnimatePresence>
    </ul>
  )
}

function RecentlyDone() {
  const [show, setShow] = useState(false)
  const q = useQuery({ queryKey: pk.mirror('done'), queryFn: () => partnerApi.mirror.list('done'), enabled: show })
  const update = useMirrorUpdate()
  return (
    <div className="mt-4 border-t border-white/8 pt-3">
      <button type="button" onClick={() => setShow((v) => !v)} className="text-xs font-semibold text-muted hover:text-fg">
        {show ? 'Hide' : 'Show'} recently ticked off
      </button>
      {show && (
        <ul className="mt-2 space-y-1.5">
          {(q.data ?? []).slice(0, 10).map((t) => (
            <li key={t.id} className="flex items-center gap-2 text-xs text-muted">
              <Check className="h-3.5 w-3.5 shrink-0 text-mint" />
              <span className="min-w-0 flex-1 truncate">
                {t.action === 'block' ? 'Blocked' : 'Freed'} · {when(t)} · {t.pitch_name}
                {t.resolved_by_name ? ` · by ${t.resolved_by_name.split(' ')[0]}` : ''}
              </span>
              <button type="button" onClick={() => update.mutate({ id: t.id, done: false })} className="flex items-center gap-1 font-semibold hover:text-fg">
                <RotateCcw className="h-3 w-3" /> Undo
              </button>
            </li>
          ))}
          {q.data?.length === 0 && <li className="text-xs text-muted">Nothing ticked off yet.</li>}
        </ul>
      )}
    </div>
  )
}

function SoundToggle() {
  const [on, setOn] = useState(chimeEnabled)
  return (
    <button
      type="button"
      onClick={() => {
        setChimeEnabled(!on)
        setOn(!on)
        if (!on) playChime('up')
      }}
      className="mb-3 flex items-center gap-1.5 text-xs font-semibold text-muted hover:text-fg"
      aria-pressed={on}
    >
      {on ? <Bell className="h-3.5 w-3.5" /> : <BellOff className="h-3.5 w-3.5" />}
      Alert sound {on ? 'on' : 'off'}
    </button>
  )
}
