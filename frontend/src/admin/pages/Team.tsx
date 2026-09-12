import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { KeyRound, Lock, LogOut, MoreHorizontal, Power, RectangleEllipsis, ShieldCheck, ShieldOff, UserPlus } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { Sheet } from '@/components/ui/Sheet'
import { ErrorState, PageHeader } from '@/components/ui/States'
import type { AdminAccountOut, AdminRole, CreatedAdmin, ResetPasswordResult } from '@/types/admin'
import { When } from '../components/bits'
import { DataTable, type Column } from '../components/DataTable'
import { Callout, ConfirmDialog } from '../components/Dialogs'
import { Checkbox, CopyButton, Field, Panel, Select, TextInput } from '../components/ui'
import { adminApi } from '../lib/api'
import { ROLE_LABEL } from '../lib/format'
import { useSession } from '../lib/session'

const ROLES: AdminRole[] = ['super_admin', 'ops', 'finance', 'support', 'marketing', 'read_only']
const ROLE_HINT: Record<AdminRole, string> = {
  super_admin: 'Everything, including roles and config',
  ops: 'Venues, onboarding, bookings, coupons, catalog',
  finance: 'Refunds, settlements, payouts, approvals, exports',
  support: 'Look-ups, credits up to ₹500',
  marketing: 'Coupons, broadcasts, analytics',
  read_only: 'Dashboards and read-only views',
}

type Action = { kind: 'role'; admin: AdminAccountOut; role: AdminRole } | { kind: 'active' | 'mfa' | 'sessions' | 'password'; admin: AdminAccountOut }

export default function Team() {
  const me = useSession((s) => s.me)
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['admin', 'team'], queryFn: adminApi.team.list })
  const [creating, setCreating] = useState(false)
  const [created, setCreated] = useState<CreatedAdmin | null>(null)
  const [action, setAction] = useState<Action | null>(null)
  const [reset, setReset] = useState<CreatedAdmin | null>(null)
  const isSuper = me?.role === 'super_admin'

  const run = useMutation({
    mutationFn: async (a: Action) => {
      if (a.kind === 'role') return adminApi.team.update(a.admin.id, { role: a.role })
      if (a.kind === 'active') return adminApi.team.update(a.admin.id, { is_active: !a.admin.is_active })
      if (a.kind === 'mfa') return adminApi.team.resetMfa(a.admin.id)
      if (a.kind === 'password') return adminApi.team.resetPassword(a.admin.id)
      return adminApi.team.revokeSessions(a.admin.id)
    },
    onSuccess: (r, a) => {
      qc.invalidateQueries({ queryKey: ['admin', 'team'] })
      setAction(null)
      if (a.kind === 'password') {
        setReset(r as ResetPasswordResult)
        return
      }
      toast.success(
        a.kind === 'role'
          ? `${a.admin.name} is now ${ROLE_LABEL[a.role]}`
          : a.kind === 'active'
            ? a.admin.is_active
              ? 'Account deactivated — sessions revoked'
              : 'Account reactivated'
            : a.kind === 'mfa'
              ? 'Two-factor reset — they’ll enrol again at next sign-in'
              : 'All sessions revoked',
      )
    },
  })

  const superAdmins = (q.data ?? []).filter((a) => a.role === 'super_admin' && a.is_active).length

  const columns: Column<AdminAccountOut>[] = [
    {
      key: 'name',
      header: 'Admin',
      cell: (a) => (
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 truncate font-medium">
            {a.name}
            {a.id === me?.id && (
              <Chip tone="electric" size="xs">
                You
              </Chip>
            )}
          </div>
          <div className="truncate text-xs text-muted">{a.email}</div>
        </div>
      ),
      sortValue: (a) => a.name.toLowerCase(),
    },
    {
      key: 'role',
      header: 'Role',
      cell: (a) => (
        <div onClick={(e) => e.stopPropagation()}>
          <Select
            value={a.role}
            disabled={a.id === me?.id || !a.is_active}
            onChange={(e) => setAction({ kind: 'role', admin: a, role: e.target.value as AdminRole })}
            aria-label={`Role for ${a.name}`}
            className="w-40"
            title={a.id === me?.id ? 'You can’t change your own role' : undefined}
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </Select>
        </div>
      ),
      sortValue: (a) => a.role,
    },
    {
      key: 'security',
      header: 'Security',
      cell: (a) => (
        <div className="flex flex-wrap gap-1">
          {a.mfa_enrolled ? (
            <Chip tone="mint" size="xs">
              <ShieldCheck className="h-3 w-3" /> MFA
            </Chip>
          ) : (
            <Chip tone="sun" size="xs">
              <ShieldOff className="h-3 w-3" /> No MFA
            </Chip>
          )}
          {a.locked && (
            <Chip tone="flare" size="xs">
              <Lock className="h-3 w-3" /> Locked
            </Chip>
          )}
          {!a.is_active && <Chip size="xs">Deactivated</Chip>}
        </div>
      ),
    },
    { key: 'last', header: 'Last sign-in', cell: (a) => <When iso={a.last_login_at} className="text-xs text-muted" />, sortValue: (a) => a.last_login_at, hideBelow: 'md' },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (a) => (a.id === me?.id ? <span className="text-[11px] text-subtle">Manage in My account</span> : <RowMenu admin={a} canResetPassword={isSuper} onAction={setAction} />),
    },
  ]

  return (
    <div>
      <PageHeader
        eyebrow="Platform"
        title="Admin team"
        subtitle="Least-privilege roles. No self-signup: new admins get a one-time password and must set up two-factor at first sign-in."
        actions={
          <Button size="sm" onClick={() => setCreating(true)}>
            <UserPlus className="h-4 w-4" /> Add admin
          </Button>
        }
      />
      {superAdmins === 1 && (
        <Callout tone="sun" className="mb-4" title="Only one active super admin">
          Keep at least two super admins so MFA resets and approvals never depend on a single person.
        </Callout>
      )}
      <Panel flush>
        {q.isError ? (
          <div className="p-5">
            <ErrorState error={q.error} onRetry={() => q.refetch()} />
          </div>
        ) : (
          <DataTable rows={q.data} columns={columns} rowKey={(a) => a.id} loading={q.isLoading} rowClassName={(a) => (a.is_active ? undefined : 'opacity-55')} empty="No admins." caption="Admin accounts" />
        )}
      </Panel>

      <CreateAdminDialog
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(c) => {
          setCreating(false)
          setCreated(c)
          qc.invalidateQueries({ queryKey: ['admin', 'team'] })
        }}
      />
      <TempPasswordSheet created={created} onClose={() => setCreated(null)} />
      <TempPasswordSheet
        created={reset}
        onClose={() => setReset(null)}
        title="Password reset"
        note="Their sessions were signed out. They sign in with this password and their authenticator, then must choose a new password."
      />

      {action && (
        <ConfirmDialog
          open
          onClose={() => setAction(null)}
          title={
            action.kind === 'role'
              ? `Make ${action.admin.name} ${ROLE_LABEL[action.role]}?`
              : action.kind === 'active'
                ? `${action.admin.is_active ? 'Deactivate' : 'Reactivate'} ${action.admin.name}?`
                : action.kind === 'mfa'
                  ? `Reset two-factor for ${action.admin.name}?`
                  : action.kind === 'password'
                    ? `Reset the password of ${action.admin.name}?`
                    : `Sign ${action.admin.name} out everywhere?`
          }
          description={
            action.kind === 'role'
              ? `${ROLE_HINT[action.role]}. They’re signed out of every session right away and get the new role when they sign in again.`
              : action.kind === 'active'
                ? action.admin.is_active
                  ? 'They lose access immediately and all their sessions are revoked.'
                  : 'They can sign in again with their existing credentials.'
                : action.kind === 'mfa'
                  ? 'Their authenticator and recovery codes stop working; they must enrol again at next sign-in. Confirm their identity out-of-band first.'
                  : action.kind === 'password'
                    ? 'Their current password stops working and every session is signed out. You get a one-time temporary password to share over a separate secure channel; they must change it at next sign-in. Two-factor stays as it is. Confirm their identity out-of-band first.'
                    : 'Revokes every active console session for this admin.'
          }
          tone={action.kind === 'role' || (action.kind === 'active' && !action.admin.is_active) ? 'primary' : 'danger'}
          confirmLabel="Confirm"
          loading={run.isPending}
          onConfirm={() => run.mutate(action)}
        />
      )}
    </div>
  )
}

function RowMenu({ admin, canResetPassword, onAction }: { admin: AdminAccountOut; canResetPassword: boolean; onAction: (a: Action) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', esc)
    }
  }, [open])
  const item = 'flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-white/6'
  return (
    <div ref={ref} className="relative inline-block" onClick={(e) => e.stopPropagation()}>
      <button type="button" aria-haspopup="menu" aria-expanded={open} aria-label={`Actions for ${admin.name}`} onClick={() => setOpen((o) => !o)} className="cursor-pointer rounded-lg p-1.5 text-muted hover:bg-white/8 hover:text-fg">
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {open && (
        <div role="menu" className="glass-strong absolute top-9 right-0 z-30 w-52 rounded-xl p-1.5 text-left shadow-2xl">
          <button role="menuitem" className={item} onClick={() => (setOpen(false), onAction({ kind: 'sessions', admin }))}>
            <LogOut className="h-4 w-4 text-muted" /> Revoke sessions
          </button>
          {canResetPassword && (
            <button role="menuitem" className={item} onClick={() => (setOpen(false), onAction({ kind: 'password', admin }))}>
              <RectangleEllipsis className="h-4 w-4 text-muted" /> Reset password
            </button>
          )}
          <button role="menuitem" className={item} disabled={!admin.mfa_enrolled} onClick={() => (setOpen(false), onAction({ kind: 'mfa', admin }))}>
            <KeyRound className="h-4 w-4 text-muted" /> Reset two-factor
          </button>
          <button role="menuitem" className={`${item} ${admin.is_active ? 'text-flare' : ''}`} onClick={() => (setOpen(false), onAction({ kind: 'active', admin }))}>
            <Power className="h-4 w-4" /> {admin.is_active ? 'Deactivate' : 'Reactivate'}
          </button>
        </div>
      )}
    </div>
  )
}

function CreateAdminDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (c: CreatedAdmin) => void }) {
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [role, setRole] = useState<AdminRole>('support')
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)
  const valid = emailValid && name.trim().length >= 2
  const m = useMutation({
    mutationFn: () => adminApi.team.create({ email: email.trim().toLowerCase(), name: name.trim(), role }),
    onSuccess: (c) => {
      setEmail('')
      setName('')
      setRole('support')
      onCreated(c)
    },
  })
  return (
    <ConfirmDialog
      open={open}
      onClose={onClose}
      title="Add an admin"
      description="They’ll receive a one-time password from you (out-of-band) and must change it and set up two-factor at first sign-in."
      tone="primary"
      confirmLabel="Create admin"
      confirmDisabled={!valid}
      loading={m.isPending}
      onConfirm={() => m.mutate()}
    >
      <Field label="Full name">
        <TextInput value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoFocus />
      </Field>
      <Field label="Work email" error={email && !emailValid ? 'Enter a valid email' : undefined}>
        <TextInput type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" spellCheck={false} />
      </Field>
      <Field label="Role" hint={ROLE_HINT[role]}>
        <Select value={role} onChange={(e) => setRole(e.target.value as AdminRole)} className="w-full">
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABEL[r]}
            </option>
          ))}
        </Select>
      </Field>
    </ConfirmDialog>
  )
}

/** The temporary password is shown exactly once and dropped from memory on close. */
function TempPasswordSheet({
  created,
  onClose,
  title = 'Admin created',
  note = 'Share it over a separate secure channel (never the same email). It must be changed at first sign-in.',
}: {
  created: CreatedAdmin | null
  onClose: () => void
  title?: string
  note?: string
}) {
  const [ack, setAck] = useState(false)
  const close = () => {
    setAck(false)
    onClose()
  }
  return (
    <Sheet open={!!created} onClose={() => ack && close()} dismissible={false} title={title} size="sm">
      {created && (
        <div className="space-y-4">
          <p className="text-sm text-muted">
            <span className="text-fg">{created.admin.name}</span> ({created.admin.email}) · {ROLE_LABEL[created.admin.role]}
          </p>
          <Callout tone="sun" title="One-time password — shown only now">
            {note}
          </Callout>
          <div className="flex items-center gap-2 rounded-xl bg-white/5 p-3 ring-1 ring-white/10">
            <code data-testid="temp-password" className="flex-1 font-mono text-base tracking-wider break-all select-all">
              {created.temporary_password}
            </code>
            <CopyButton value={created.temporary_password} />
          </div>
          <Checkbox checked={ack} onChange={setAck} label="I’ve stored it securely" />
          <Button block disabled={!ack} onClick={close}>
            Done
          </Button>
        </div>
      )}
    </Sheet>
  )
}
