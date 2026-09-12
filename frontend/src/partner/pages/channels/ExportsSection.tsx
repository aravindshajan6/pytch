import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link2, Link2Off, RotateCw, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import { errorMessage } from '@/lib/api/client'
import type { Pitch } from '@/types/api'
import type { ExportOut } from '@/types/partner'
import { partnerApi } from '../../api/endpoints'
import { pk } from '../../api/keys'
import { ConfirmSheet, CopyField, Panel } from '../../components/kit'
import { useCan } from '../../stores/partnerAuth'

type PitchRow = Pitch & { turf_name: string }

export function ExportsSection({ exports, pitches }: { exports: ExportOut[]; pitches: PitchRow[] }) {
  const qc = useQueryClient()
  const manager = useCan('manager')
  const [confirm, setConfirm] = useState<{ kind: 'rotate' | 'disable'; row: ExportOut } | null>(null)

  // one row per pitch, even if the API hasn't created an export entry yet
  const rows: ExportOut[] = [
    ...exports,
    ...pitches.filter((p) => !exports.some((e) => e.pitch_id === p.id)).map((p) => ({ pitch_id: p.id, pitch_name: p.name, turf_name: p.turf_name, ical_url: null })),
  ]

  const rotate = useMutation({
    mutationFn: (pitchId: string) => partnerApi.channels.rotateExport(pitchId),
    onSuccess: (e, _v) => {
      qc.setQueryData(pk.channels, (o: { exports: ExportOut[] } | undefined) => (o ? { ...o, exports: [...o.exports.filter((x) => x.pitch_id !== e.pitch_id), e] } : o))
      qc.invalidateQueries({ queryKey: pk.channels })
      toast.success(confirm?.kind === 'rotate' ? 'New link created — the old one has stopped working' : 'Export link created')
      setConfirm(null)
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const disable = useMutation({
    mutationFn: (pitchId: string) => partnerApi.channels.disableExport(pitchId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: pk.channels })
      toast.success('Export disabled')
      setConfirm(null)
    },
    onError: (e) => toast.error(errorMessage(e)),
  })

  return (
    <Panel id="export" title="Export your Pytch calendar" subtitle="A private iCal link per pitch — subscribe from Google, Apple or Outlook calendar to see every booking on your phone.">
      <div className="mb-4 flex gap-2.5 rounded-2xl bg-sun/8 p-3.5 text-sm ring-1 ring-sun/30">
        <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-sun" />
        <p className="text-muted">
          <b className="text-fg">For viewing, not for preventing double bookings.</b> Google Calendar refreshes subscribed feeds only every 8–24 hours (Apple: minutes). Treat this Pytch
          calendar as the live source of truth.
        </p>
      </div>
      {rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted">Add a pitch first.</p>
      ) : (
        <ul className="space-y-2.5">
          {rows.map((r) => (
            <li key={r.pitch_id} className="rounded-2xl bg-white/[0.03] p-4 ring-1 ring-white/8">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="font-semibold">{r.pitch_name}</div>
                  <div className="text-xs text-muted">{r.turf_name}</div>
                </div>
                {r.ical_url ? (
                  manager && (
                    <div className="flex gap-1.5">
                      <Button size="sm" variant="ghost" onClick={() => setConfirm({ kind: 'rotate', row: r })}>
                        <RotateCw className="h-3.5 w-3.5" /> Rotate
                      </Button>
                      <Button size="sm" variant="ghost" className="hover:text-flare" onClick={() => setConfirm({ kind: 'disable', row: r })}>
                        <Link2Off className="h-3.5 w-3.5" /> Disable
                      </Button>
                    </div>
                  )
                ) : (
                  manager && (
                    <Button size="sm" variant="secondary" onClick={() => rotate.mutate(r.pitch_id)} loading={rotate.isPending && rotate.variables === r.pitch_id}>
                      <Link2 className="h-3.5 w-3.5" /> Create link
                    </Button>
                  )
                )}
              </div>
              {r.ical_url && <CopyField value={r.ical_url} masked className="mt-3" />}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-4 text-xs text-muted">Feeds show only “Booked” busy times — never customer names or phone numbers. Anyone with a link can read it, so rotate it if it leaks.</p>

      <ConfirmSheet
        open={!!confirm}
        onClose={() => setConfirm(null)}
        title={confirm?.kind === 'rotate' ? 'Rotate this link?' : 'Disable this export?'}
        description={
          confirm?.kind === 'rotate'
            ? 'A new secret link is created and the current one stops working immediately. Update any calendar that subscribes to it.'
            : 'Calendars subscribed to this link stop receiving updates.'
        }
        confirmLabel={confirm?.kind === 'rotate' ? 'Rotate link' : 'Disable'}
        danger={confirm?.kind === 'disable'}
        pending={rotate.isPending || disable.isPending}
        onConfirm={() => confirm && (confirm.kind === 'rotate' ? rotate.mutate(confirm.row.pitch_id) : disable.mutate(confirm.row.pitch_id))}
      />
    </Panel>
  )
}
