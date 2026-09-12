import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BadgeCheck, Check, CheckCircle2, MapPin, PauseCircle, Pencil, Plus, RotateCcw, ShieldOff, XCircle } from 'lucide-react'
import { useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { ErrorState, PageLoader } from '@/components/ui/States'
import { SPORTS } from '@/lib/sports'
import type { AdminProviderDetail, AdminVenueRow } from '@/types/admin'
import type { Sport } from '@/types/api'
import { Can, JsonTable, MaskedPhone } from '../../components/bits'
import { settlementColumns } from '../../components/columns'
import { DataTable } from '../../components/DataTable'
import { DetailHeader } from '../../components/DetailHeader'
import { Callout, ConfirmDialog } from '../../components/Dialogs'
import { Attribution, ChipToggle, Field, KV, Panel, SearchInput, Select, StatusChip, TextArea, TextInput } from '../../components/ui'
import { adminApi } from '../../lib/api'
import { bpsToPct, dateShort, dateTime, titleCase } from '../../lib/format'
import { useDebounced } from '../../lib/hooks'
import { useCan } from '../../lib/session'
import { CreateVenueDrawer } from './CreateVenueDrawer'

type DialogKind = 'approve' | 'reject' | 'suspend' | 'reinstate' | 'terms' | 'venues' | 'create-venue' | null

export default function ProviderDetail() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const can = useCan()
  const qc = useQueryClient()
  const [dialog, setDialog] = useState<DialogKind>(null)
  const [venueFrom, setVenueFrom] = useState<{ index: number | null | undefined; n: number }>({ index: undefined, n: 0 })
  const createVenue = (index: number | null | undefined) => {
    setVenueFrom((v) => ({ index, n: v.n + 1 })) // new key → fresh form
    setDialog('create-venue')
  }
  const q = useQuery({ queryKey: ['admin', 'providers', 'detail', id], queryFn: () => adminApi.providers.get(id), enabled: !!id })
  const done = () => {
    qc.invalidateQueries({ queryKey: ['admin', 'providers'] })
    qc.invalidateQueries({ queryKey: ['admin', 'venues'] })
    setDialog(null)
  }

  if (q.isLoading) return <PageLoader />
  if (q.isError || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />
  const p = q.data

  return (
    <div className="space-y-5">
      <DetailHeader
        back="/providers"
        backLabel="Providers"
        title={p.name}
        meta={
          <>
            <StatusChip status={p.status} />
            {p.kyc_verified ? (
              <Chip tone="mint" size="xs">
                <BadgeCheck className="h-3 w-3" /> KYC verified
              </Chip>
            ) : (
              <Chip tone="sun" size="xs">
                KYC pending
              </Chip>
            )}
            {p.payouts_on_hold && (
              <Chip tone="sun" size="xs">
                <PauseCircle className="h-3 w-3" /> Payouts on hold
              </Chip>
            )}
            <span>
              {p.city} · applied {dateShort(p.created_at)}
            </span>
          </>
        }
        actions={
          <Can perm="providers.manage">
            {/* only pending applications can be reviewed (a rejected applicant re-applies from the portal) */}
            {p.status === 'pending' && (
              <>
                <Button variant="outline" size="sm" onClick={() => setDialog('reject')}>
                  <XCircle className="h-4 w-4" /> Reject
                </Button>
                <Button size="sm" onClick={() => setDialog('approve')}>
                  <CheckCircle2 className="h-4 w-4" /> Approve
                </Button>
              </>
            )}
            {p.status === 'approved' && (
              <Button variant="danger" size="sm" onClick={() => setDialog('suspend')}>
                <ShieldOff className="h-4 w-4" /> Suspend
              </Button>
            )}
            {p.status === 'suspended' && (
              <Button size="sm" onClick={() => setDialog('reinstate')}>
                <RotateCcw className="h-4 w-4" /> Reinstate
              </Button>
            )}
            <Button variant="secondary" size="sm" onClick={() => setDialog('terms')}>
              <Pencil className="h-4 w-4" /> Terms
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setDialog('venues')}>
              <MapPin className="h-4 w-4" /> Assign venues
            </Button>
            {p.status !== 'rejected' && (
              <Button variant="secondary" size="sm" onClick={() => createVenue(undefined)}>
                <Plus className="h-4 w-4" /> Create venue
              </Button>
            )}
          </Can>
        }
      />

      {p.status_reason && p.status !== 'approved' && (
        <Callout tone={p.status === 'pending' ? 'sun' : 'flare'} title={`Status note (${p.status})`}>
          {p.status_reason}
        </Callout>
      )}
      {p.payouts_on_hold && (
        <Callout tone="sun" title="Payouts on hold">
          Bank details changed recently — payouts resume once a second admin approves the change in Approvals.
        </Callout>
      )}

      <div className="grid gap-5 xl:grid-cols-3">
        <Panel title="Business & contact" className="xl:col-span-2">
          <KV
            cols={3}
            items={[
              ['Legal name', p.legal_name ?? '—'],
              ['Entity type', titleCase(p.entity_type) || '—'],
              ['GSTIN', p.gstin ? <code className="font-mono text-xs">{p.gstin}</code> : '—'],
              ['Contact', p.contact_name],
              ['Phone', <MaskedPhone key="ph" phone={p.contact_phone} full />],
              ['Email', p.contact_email ?? '—'],
              ['Address', p.address ?? '—'],
              ['City', p.city],
              ['Slug', <code key="s" className="font-mono text-xs text-muted">{p.slug}</code>],
            ]}
          />
        </Panel>
        <Panel title="Commercial terms & KYC">
          <KV
            cols={1}
            items={[
              ['Commission', <span key="c" className="num text-base font-semibold">{bpsToPct(p.commission_bps)}</span>],
              ['Settlement cycle', titleCase(p.settlement_cycle)],
              ['PAN', p.pan_last4 ? <span className="num">•••• {p.pan_last4}</span> : <span className="text-sun">Not provided (TDS 5%)</span>],
              [
                'Bank account',
                p.bank_account_last4 ? (
                  <span>
                    {p.bank_account_name ?? '—'} · <span className="num">•••• {p.bank_account_last4}</span> · <span className="num">{p.bank_ifsc ?? '—'}</span>
                  </span>
                ) : (
                  '—'
                ),
              ],
              ['Razorpay Route account', p.razorpay_account_id ? <code className="font-mono text-xs">{p.razorpay_account_id}</code> : '—'],
            ]}
          />
          {p.notes && <p className="mt-4 rounded-xl bg-white/4 p-3 text-xs whitespace-pre-wrap text-fg/80 ring-1 ring-white/8">{p.notes}</p>}
          <div className="mt-4">
            <Attribution
              items={[
                ['Reviewed by', p.reviewed_by],
                ['on', p.reviewed_at ? dateTime(p.reviewed_at) : null],
              ]}
            />
          </div>
        </Panel>
      </div>

      {p.status !== 'rejected' && pendingApplicationVenues(p) > 0 && can('providers.manage') && (
        <Callout tone="sun" title={`${pendingApplicationVenues(p)} application venue${pendingApplicationVenues(p) === 1 ? '' : 's'} not created yet`}>
          Venues from the application aren’t bookable until you create them (with confirmed map pins and prices).
        </Callout>
      )}

      <ApplicationPanel provider={p} canCreate={can('providers.manage') && p.status !== 'rejected'} onCreate={createVenue} />

      <div className="grid gap-5 xl:grid-cols-2">
        <Panel flush title="Venues" description={`${p.venues.length} assigned`}>
          <DataTable<AdminVenueRow>
            rows={p.venues}
            rowKey={(v) => v.id}
            maxHeight="max-h-96"
            empty="No venues assigned yet."
            onRowClick={can('venues.view') ? (v) => navigate(`/venues?q=${encodeURIComponent(v.name)}`) : undefined}
            columns={[
              {
                key: 'n',
                header: 'Venue',
                cell: (v) => (
                  <div>
                    <div className="font-medium">{v.name}</div>
                    <div className="text-xs text-muted">{v.area}</div>
                  </div>
                ),
              },
              { key: 'sports', header: 'Sports', cell: (v) => <span className="text-sm">{v.sports.map((s) => SPORTS[s as Sport]?.emoji ?? s).join(' ')}</span>, hideBelow: 'sm' },
              { key: 'p', header: 'Pitches', align: 'right', cell: (v) => <span className="num">{v.pitch_count}</span> },
              { key: 'a', header: 'Status', cell: (v) => <StatusChip status={v.is_active ? 'active' : 'inactive'} /> },
            ]}
          />
        </Panel>
        <Panel flush title="Team" description="Partner-portal members">
          <DataTable
            rows={p.members.map((m, i) => ({ ...m, _k: `${m.phone}-${i}` }))}
            rowKey={(m) => m._k}
            maxHeight="max-h-96"
            empty="No members."
            columns={[
              { key: 'n', header: 'Member', cell: (m) => <span className="font-medium">{m.name ?? 'Invited'}</span> },
              { key: 'ph', header: 'Phone', cell: (m) => <MaskedPhone phone={m.phone} /> },
              { key: 'r', header: 'Role', cell: (m) => <span className="text-xs capitalize">{m.role}</span> },
              { key: 's', header: 'Status', cell: (m) => <StatusChip status={m.status} /> },
            ]}
          />
        </Panel>
      </div>

      <Panel flush title="Settlements">
        <DataTable
          rows={p.settlements}
          rowKey={(s) => s.id}
          columns={settlementColumns({ provider: false })}
          maxHeight="max-h-96"
          empty="No settlements generated yet."
          onRowClick={can('payouts.view') ? (s) => navigate(`/settlements/${s.id}`) : undefined}
        />
      </Panel>

      <ReviewDialog provider={p} kind={dialog === 'approve' || dialog === 'reject' ? dialog : null} onClose={() => setDialog(null)} onDone={done} />
      <StatusChangeDialog provider={p} kind={dialog === 'suspend' || dialog === 'reinstate' ? dialog : null} onClose={() => setDialog(null)} onDone={done} />
      <TermsDialog provider={p} open={dialog === 'terms'} onClose={() => setDialog(null)} onDone={done} />
      <AssignVenuesDialog provider={p} open={dialog === 'venues'} onClose={() => setDialog(null)} onDone={done} />
      {dialog === 'create-venue' && (
        <CreateVenueDrawer key={venueFrom.n} provider={p} initialIndex={venueFrom.index} open onClose={() => setDialog(null)} onDone={done} />
      )}
    </div>
  )
}

const pendingApplicationVenues = (p: AdminProviderDetail) => p.application_venues.filter((v) => !v.turf_id).length

function ApplicationPanel({ provider, canCreate, onCreate }: { provider: AdminProviderDetail; canCreate: boolean; onCreate: (index: number) => void }) {
  const application = provider.application ?? {}
  const venues = provider.application_venues
  const rest = Object.fromEntries(Object.entries(application).filter(([k]) => k !== 'venues' && k !== 'created_turfs'))
  if (!venues.length && !Object.keys(rest).length) return null
  return (
    <Panel title="Application" description="As submitted by the partner — create each venue to make it bookable">
      {venues.length > 0 && (
        <div className="mb-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {venues.map((v) => (
            <div key={v.index} className="flex flex-col rounded-xl bg-white/4 p-3 ring-1 ring-white/8">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 font-medium">{v.name}</div>
                {v.turf_id ? (
                  <Chip tone="mint" size="xs">
                    <Check className="h-3 w-3" /> Created
                  </Chip>
                ) : (
                  <Chip tone="sun" size="xs">
                    Not created
                  </Chip>
                )}
              </div>
              <div className="text-xs text-muted">
                {v.area} {v.address ? `· ${v.address}` : ''}
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
                {v.sports.map((s) => (
                  <Chip key={s} size="xs">
                    {SPORTS[s as Sport]?.emoji} {SPORTS[s as Sport]?.label ?? s}
                  </Chip>
                ))}
                <Chip size="xs">
                  {v.pitch_count} pitch{v.pitch_count === 1 ? '' : 'es'}
                </Chip>
                {v.has_indoor && <Chip size="xs">Indoor</Chip>}
                {v.lat != null && v.lng != null && (
                  <Chip size="xs">
                    <MapPin className="h-3 w-3" /> pin given
                  </Chip>
                )}
              </div>
              {v.notes && <p className="mt-2 text-xs text-fg/70">{v.notes}</p>}
              <div className="mt-auto pt-3">
                {v.turf_id ? (
                  <span className="text-xs text-muted">
                    Live as <span className="text-fg/85">{v.turf_name ?? 'a venue'}</span>
                  </span>
                ) : (
                  canCreate && (
                    <Button size="sm" variant="secondary" onClick={() => onCreate(v.index)}>
                      <Plus className="h-4 w-4" /> Create venue
                    </Button>
                  )
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      {Object.keys(rest).length > 0 && <JsonTable value={rest} />}
    </Panel>
  )
}

function ReviewDialog({ provider, kind, onClose, onDone }: { provider: AdminProviderDetail; kind: 'approve' | 'reject' | null; onClose: () => void; onDone: () => void }) {
  const [pctStr, setPct] = useState(String(provider.commission_bps / 100))
  const bps = Math.round(Number(pctStr) * 100)
  const validPct = Number.isFinite(bps) && bps >= 0 && bps <= 5000
  const m = useMutation({
    mutationFn: (reason: string) =>
      adminApi.providers.review(provider.id, kind === 'approve' ? { decision: 'approve', commission_bps: bps, reason: reason || null } : { decision: 'reject', reason }),
    onSuccess: () => {
      toast.success(kind === 'approve' ? `${provider.name} approved — they can now use the partner portal` : 'Application rejected')
      onDone()
    },
  })
  return (
    <ConfirmDialog
      open={!!kind}
      onClose={onClose}
      title={kind === 'approve' ? `Approve ${provider.name}?` : `Reject ${provider.name}?`}
      description={
        kind === 'approve'
          ? 'The owner gets full partner-portal access and their venues can take Pytch bookings.'
          : 'The applicant sees your reason on their “under review” screen.'
      }
      tone={kind === 'approve' ? 'primary' : 'danger'}
      confirmLabel={kind === 'approve' ? 'Approve provider' : 'Reject application'}
      reason={kind === 'reject'}
      reasonLabel="Reason (shown to the applicant and audited)"
      confirmDisabled={kind === 'approve' && !validPct}
      loading={m.isPending}
      onConfirm={(r) => m.mutate(r)}
    >
      {kind === 'approve' && (
        <Field label="Commission (%)" hint="Charged on gross pitch fees; 18% GST applies on top. Max 50%." error={!validPct ? 'Enter 0–50' : undefined}>
          <TextInput inputMode="decimal" value={pctStr} onChange={(e) => setPct(e.target.value.replace(/[^\d.]/g, ''))} className="num w-32" />
        </Field>
      )}
    </ConfirmDialog>
  )
}

function StatusChangeDialog({ provider, kind, onClose, onDone }: { provider: AdminProviderDetail; kind: 'suspend' | 'reinstate' | null; onClose: () => void; onDone: () => void }) {
  const m = useMutation({
    mutationFn: (reason: string) => adminApi.providers.setStatus(provider.id, { status: kind === 'suspend' ? 'suspended' : 'approved', reason }),
    onSuccess: () => {
      toast.success(kind === 'suspend' ? 'Provider suspended' : 'Provider reinstated')
      onDone()
    },
  })
  return (
    <ConfirmDialog
      open={!!kind}
      onClose={onClose}
      title={kind === 'suspend' ? `Suspend ${provider.name}?` : `Reinstate ${provider.name}?`}
      description={
        kind === 'suspend'
          ? 'Partner-portal access stops immediately and their venues stop taking new Pytch bookings. Existing bookings are kept.'
          : 'Restores partner-portal access and bookings.'
      }
      tone={kind === 'suspend' ? 'danger' : 'primary'}
      confirmLabel={kind === 'suspend' ? 'Suspend provider' : 'Reinstate'}
      reason
      loading={m.isPending}
      onConfirm={(r) => m.mutate(r)}
    />
  )
}

function TermsDialog({ provider, open, onClose, onDone }: { provider: AdminProviderDetail; open: boolean; onClose: () => void; onDone: () => void }) {
  const [pctStr, setPct] = useState(String(provider.commission_bps / 100))
  const [cycle, setCycle] = useState(provider.settlement_cycle)
  const [acc, setAcc] = useState(provider.razorpay_account_id ?? '')
  const [notes, setNotes] = useState(provider.notes ?? '')
  const bps = Math.round(Number(pctStr) * 100)
  const accValid = !acc || /^acc_[A-Za-z0-9]{6,36}$/.test(acc)
  const valid = Number.isFinite(bps) && bps >= 0 && bps <= 5000 && accValid
  const m = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = {}
      if (bps !== provider.commission_bps) body.commission_bps = bps
      if (cycle !== provider.settlement_cycle) body.settlement_cycle = cycle
      if ((acc || null) !== provider.razorpay_account_id) body.razorpay_account_id = acc || null
      if ((notes || null) !== provider.notes) body.notes = notes || null
      return adminApi.providers.update(provider.id, body)
    },
    onSuccess: () => {
      toast.success('Terms updated')
      onDone()
    },
  })
  const changed =
    bps !== provider.commission_bps || cycle !== provider.settlement_cycle || (acc || null) !== provider.razorpay_account_id || (notes || null) !== provider.notes
  return (
    <ConfirmDialog
      open={open}
      onClose={onClose}
      title="Commercial terms"
      description="Changes apply to future settlement periods. Every change is audited and needs your authenticator code."
      tone="primary"
      confirmLabel="Save terms"
      confirmDisabled={!valid || !changed}
      loading={m.isPending}
      onConfirm={() => m.mutate()}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Commission (%)" error={!(bps >= 0 && bps <= 5000) ? 'Enter 0–50' : undefined}>
          <TextInput inputMode="decimal" value={pctStr} onChange={(e) => setPct(e.target.value.replace(/[^\d.]/g, ''))} className="num" />
        </Field>
        <Field label="Settlement cycle">
          <Select value={cycle} onChange={(e) => setCycle(e.target.value as typeof cycle)} className="w-full">
            <option value="weekly">Weekly</option>
            <option value="biweekly">Every two weeks</option>
            <option value="monthly">Monthly</option>
          </Select>
        </Field>
      </div>
      <Field label="Razorpay Route linked account" error={!accValid ? 'Format: acc_XXXXXXXX' : undefined} hint="Needed for automatic Route payouts.">
        <TextInput value={acc} onChange={(e) => setAcc(e.target.value.trim())} placeholder="acc_…" className="font-mono" spellCheck={false} />
      </Field>
      <Field label="Internal notes">
        <TextArea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={5000} />
      </Field>
    </ConfirmDialog>
  )
}

function AssignVenuesDialog({ provider, open, onClose, onDone }: { provider: AdminProviderDetail; open: boolean; onClose: () => void; onDone: () => void }) {
  const [search, setSearch] = useState('')
  const q = useDebounced(search.trim(), 250)
  const [selected, setSelected] = useState<Set<string>>(() => new Set(provider.venues.map((v) => v.id)))
  const venues = useQuery({ queryKey: ['admin', 'venues', 'list', { q, assign: true }], queryFn: () => adminApi.venues.list({ q: q || undefined }), enabled: open })
  // the endpoint takes the complete list: this provider's venues left unticked are unassigned
  const unassigning = provider.venues.filter((v) => !selected.has(v.id))
  const moving = (venues.data ?? []).filter((v) => selected.has(v.id) && v.provider_id && v.provider_id !== provider.id)
  const affected = [...unassigning, ...moving].reduce((n, v) => n + (v.upcoming_bookings ?? 0), 0)
  const m = useMutation({
    mutationFn: () => adminApi.providers.assignTurfs(provider.id, [...selected]),
    onSuccess: () => {
      toast.success(unassigning.length ? `Venue assignment saved — ${unassigning.length} unassigned` : 'Venue assignment saved')
      onDone()
    },
  })
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  const upcoming = (n: number | undefined) => (n ? ` · ${n} upcoming game${n === 1 ? '' : 's'}` : '')
  return (
    <ConfirmDialog
      open={open}
      onClose={onClose}
      title="Assign venues"
      description={`Ticked venues belong to ${provider.name}: a venue owned by another provider moves here, and this provider’s unticked venues are unassigned. This changes ownership (who gets paid and sees the bookings) — existing bookings are kept.`}
      tone="primary"
      confirmLabel={unassigning.length ? `Save (${selected.size}) · unassign ${unassigning.length}` : `Save (${selected.size})`}
      loading={m.isPending}
      onConfirm={() => m.mutate()}
    >
      <SearchInput value={search} onChange={setSearch} placeholder="Search venues" />
      <div className="max-h-72 space-y-1 overflow-y-auto">
        {(venues.data ?? []).map((v) => (
          <label key={v.id} className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 hover:bg-white/5">
            <input type="checkbox" checked={selected.has(v.id)} onChange={() => toggle(v.id)} className="h-4 w-4 accent-[var(--color-volt)]" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{v.name}</span>
              <span className="block truncate text-xs text-muted">
                {v.area}
                {v.provider_name && v.provider_id !== provider.id ? ` · currently ${v.provider_name}` : ''}
                {upcoming(v.upcoming_bookings)}
              </span>
            </span>
            {v.provider_id && v.provider_id !== provider.id && selected.has(v.id) && (
              <Chip tone="sun" size="xs">
                Moves
              </Chip>
            )}
            {v.provider_id === provider.id && !selected.has(v.id) && (
              <Chip tone="flare" size="xs">
                Unassigns
              </Chip>
            )}
          </label>
        ))}
        {venues.isLoading && <p className="py-4 text-center text-sm text-muted">Loading venues…</p>}
      </div>
      {unassigning.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {unassigning.map((v) => (
            <ChipToggle key={v.id} active={false} onClick={() => toggle(v.id)}>
              Unassigning {v.name}
              {upcoming(v.upcoming_bookings)} — keep
            </ChipToggle>
          ))}
        </div>
      )}
      {affected > 0 && (
        <Callout tone="sun" title={`${affected} upcoming game${affected === 1 ? '' : 's'} at the venues changing owner`}>
          They still take place. Their payout follows the venue’s new owner (or no one, if unassigned) — tell the partners before you save.
        </Callout>
      )}
    </ConfirmDialog>
  )
}
