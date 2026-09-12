import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Crown, Lock, MoreHorizontal, UserPlus, Users } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { Sheet } from '@/components/ui/Sheet'
import { EmptyState, ErrorState } from '@/components/ui/States'
import { errorMessage } from '@/lib/api/client'
import { cn } from '@/lib/cn'
import { timeAgo } from '@/lib/format'
import type { PartnerMemberOut, PartnerRole } from '@/types/partner'
import { partnerApi } from '../api/endpoints'
import { pk } from '../api/keys'
import { ChoiceChips, ConfirmSheet, Field, PageTitle, SkeletonRows, StatusPill, TextInput } from '../components/kit'
import { useVenues } from '../hooks'
import { toE164 } from '../lib/validation'
import { ROLE_LABEL } from '../session'
import { useCan, usePartnerAuth } from '../stores/partnerAuth'

type StaffRole = Exclude<PartnerRole, 'owner'>

const roleTone = (r: PartnerRole) =>
  r === 'owner' ? 'bg-sun/12 text-sun ring-sun/30' : r === 'manager' ? 'bg-electric/12 text-electric ring-electric/30' : 'bg-white/6 text-fg/75 ring-white/12'

const ROLES: { value: StaffRole; label: string; can: string }[] = [
  { value: 'manager', label: 'Manager', can: 'Everything except payouts setup, API keys and team changes' },
  { value: 'staff', label: 'Front desk', can: 'Calendar, walk-ins, blocks and the bookings list' },
]

export default function TeamPage() {
  const owner = useCan('owner')
  const me = usePartnerAuth((s) => s.user)
  const team = useQuery({ queryKey: pk.team, queryFn: partnerApi.team.list })
  const venues = useVenues()
  const [inviting, setInviting] = useState(false)
  const [editing, setEditing] = useState<PartnerMemberOut | null>(null)
  const venueName = (id: string) => venues.data?.find((v) => v.id === id)?.name ?? 'Venue'
  const members = (team.data ?? []).filter((m) => m.status !== 'removed')

  return (
    <div>
      <PageTitle
        title="Team"
        subtitle="Give your front desk and managers their own logins — everyone signs in with their own phone number."
        actions={
          owner && (
            <Button onClick={() => setInviting(true)}>
              <UserPlus className="h-4 w-4" /> Invite
            </Button>
          )
        }
      />
      {!owner && (
        <p className="mb-4 flex items-center gap-2 rounded-2xl bg-white/[0.03] p-3 text-sm text-muted ring-1 ring-white/8">
          <Lock className="h-4 w-4" /> Only the owner can invite people or change roles.
        </p>
      )}

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        {[{ value: 'owner', label: 'Owner', can: 'Everything, including payouts, API keys and team' }, ...ROLES].map((r) => (
          <div key={r.value} className="rounded-2xl bg-white/[0.03] p-4 ring-1 ring-white/8">
            <div className="flex items-center gap-2 text-sm font-semibold">
              {r.value === 'owner' && <Crown className="h-4 w-4 text-sun" />}
              {r.label}
            </div>
            <p className="mt-1 text-xs text-muted">{r.can}</p>
          </div>
        ))}
      </div>

      {team.isError ? (
        <ErrorState error={team.error} onRetry={() => team.refetch()} />
      ) : !team.data ? (
        <SkeletonRows rows={4} />
      ) : members.length === 0 ? (
        <EmptyState icon={<Users className="mx-auto h-10 w-10 text-muted" />} title="Just you so far" description="Invite your front-desk staff so they can log walk-ins from their own phones." />
      ) : (
        <ul className="glass divide-y divide-white/6 overflow-hidden rounded-3xl">
          {members.map((m) => {
            const self = m.user?.id === me?.id
            return (
              <li key={m.id} className="flex items-center gap-3 p-4">
                <Avatar user={m.user ?? { id: m.phone, name: m.phone.slice(-4), avatar_url: null }} size="md" showVerified={false} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate font-semibold">{m.user?.name ?? 'Invited'}</span>
                    {self && <span className="rounded-md bg-white/8 px-1.5 text-[10px] font-bold text-muted uppercase">You</span>}
                    {m.status === 'invited' && <StatusPill status="invited" label="Waiting for first login" />}
                  </div>
                  <div className="font-mono text-xs text-muted">{m.phone}</div>
                  <div className="mt-1 truncate text-xs text-muted">
                    {m.turf_ids ? m.turf_ids.map(venueName).join(', ') : 'All venues'} · added {timeAgo(m.created_at)}
                  </div>
                </div>
                <span className={cn('hidden shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 sm:inline-flex', roleTone(m.role))}>
                  {m.role === 'owner' && <Crown className="h-3.5 w-3.5" />}
                  {ROLE_LABEL[m.role]}
                </span>
                {owner && m.role !== 'owner' && (
                  <Button size="icon" variant="ghost" onClick={() => setEditing(m)} aria-label={`Manage ${m.user?.name ?? m.phone}`}>
                    <MoreHorizontal className="h-5 w-5" />
                  </Button>
                )}
              </li>
            )
          })}
        </ul>
      )}

      <InviteSheet open={inviting} onClose={() => setInviting(false)} />
      <EditMemberSheet member={editing} onClose={() => setEditing(null)} />
    </div>
  )
}

/** Venue scope: null = every venue (incl. ones added later) · a non-empty list = only those. Never silently widened. */
const scopeError = (v: string[] | null) => (v !== null && v.length === 0 ? 'Pick at least one venue — or “All venues”.' : null)

function VenueScope({ value, onChange }: { value: string[] | null; onChange: (v: string[] | null) => void }) {
  const venues = useVenues().data ?? []
  if (venues.length <= 1) return null
  const all = value === null
  const error = scopeError(value)
  return (
    <Field label="Venues they can see" error={error} hint={all ? 'Every venue, including ones you add later.' : `Only these: ${value.length} of ${venues.length} venues`}>
      <ChoiceChips
        size="sm"
        options={[{ value: '__all', label: 'All venues' }, ...venues.map((v) => ({ value: v.id, label: v.name }))]}
        value={all ? ['__all'] : value}
        onChange={(id) => {
          // "All venues" is its own explicit choice; picking a venue switches to "only these"
          if (id === '__all') return onChange(all ? [] : null)
          const cur = value ?? []
          onChange(cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id])
        }}
      />
    </Field>
  )
}

function InviteSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const [phone, setPhone] = useState('')
  const [role, setRole] = useState<StaffRole>('staff')
  const [scope, setScope] = useState<string[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const invite = useMutation({
    mutationFn: (e164: string) => partnerApi.team.invite({ phone: e164, role, turf_ids: scope }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: pk.team })
      toast.success('Invite sent', { description: 'They get access the first time they log in to the partner portal with that number.' })
      setPhone('')
      onClose()
    },
    onError: (e) => setError(errorMessage(e)),
  })
  return (
    <Sheet open={open} onClose={onClose} title="Invite a team member" description="No password to share — they log in with an OTP on their own phone." size="md">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          const e164 = toE164(phone)
          if (!e164) return setError('Enter a 10-digit Indian mobile number.')
          if (scopeError(scope)) return
          invite.mutate(e164)
        }}
      >
        <Field label="Mobile number" htmlFor="inv-p" error={error}>
          <div className="flex items-center gap-2">
            <span className="flex h-11 items-center rounded-xl bg-white/5 px-3 font-mono text-sm text-muted ring-1 ring-white/10">+91</span>
            <TextInput
              id="inv-p"
              type="tel"
              inputMode="numeric"
              value={phone}
              onChange={(e) => {
                setPhone(e.target.value)
                setError(null)
              }}
              placeholder="98765 43210"
              className="font-mono"
              autoFocus
            />
          </div>
        </Field>
        <Field label="Role">
          <div className="grid gap-2 sm:grid-cols-2">
            {ROLES.map((r) => (
              <button
                key={r.value}
                type="button"
                aria-pressed={role === r.value}
                onClick={() => setRole(r.value)}
                className={cn('cursor-pointer rounded-xl p-3 text-left ring-1 transition', role === r.value ? 'bg-volt/12 ring-2 ring-volt/80' : 'bg-white/[0.03] ring-white/10 hover:bg-white/8')}
              >
                <div className="text-sm font-semibold">{r.label}</div>
                <div className="text-xs text-muted">{r.can}</div>
              </button>
            ))}
          </div>
        </Field>
        <VenueScope value={scope} onChange={setScope} />
        <Button type="submit" block size="lg" loading={invite.isPending} disabled={!!scopeError(scope)}>
          Send invite
        </Button>
      </form>
    </Sheet>
  )
}

function EditMemberSheet({ member, onClose }: { member: PartnerMemberOut | null; onClose: () => void }) {
  return (
    <Sheet open={!!member} onClose={onClose} title={member?.user?.name ?? member?.phone ?? ''} description={member?.phone} size="md">
      {member && <EditMemberForm key={member.id} member={member} onClose={onClose} />}
    </Sheet>
  )
}

function EditMemberForm({ member, onClose }: { member: PartnerMemberOut; onClose: () => void }) {
  const qc = useQueryClient()
  const [role, setRole] = useState<StaffRole>(member.role === 'owner' ? 'manager' : member.role)
  const [scope, setScope] = useState<string[] | null>(member.turf_ids)
  const [confirm, setConfirm] = useState(false)
  const save = useMutation({
    mutationFn: () => partnerApi.team.update(member.id, { role, turf_ids: scope }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: pk.team })
      toast.success('Access updated')
      onClose()
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const remove = useMutation({
    mutationFn: () => partnerApi.team.remove(member.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: pk.team })
      toast.success('Removed', { description: 'They lose access to your business straight away.' })
      setConfirm(false)
      onClose()
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  return (
    <div className="space-y-4">
      <Field label="Role">
        <ChoiceChips options={ROLES.map((r) => ({ value: r.value, label: r.label }))} value={role} onChange={setRole} />
      </Field>
      <p className="-mt-2 text-xs text-muted">{ROLES.find((r) => r.value === role)?.can}</p>
      <VenueScope value={scope} onChange={setScope} />
      <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-between">
        <Button variant="outline" className="hover:border-flare/60 hover:text-flare" onClick={() => setConfirm(true)}>
          Remove from team
        </Button>
        <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!!scopeError(scope)}>
          Save changes
        </Button>
      </div>
      <ConfirmSheet
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Remove this person?"
        description="They lose access to your business immediately. If this was their only venue account, they’re signed out of the partner portal too."
        confirmLabel="Remove"
        danger
        pending={remove.isPending}
        onConfirm={() => remove.mutate()}
      />
    </div>
  )
}
