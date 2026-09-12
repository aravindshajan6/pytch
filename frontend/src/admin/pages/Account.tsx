import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { KeyRound, Laptop, LogOut, ShieldCheck, Smartphone } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { ErrorState, PageHeader, Skeleton } from '@/components/ui/States'
import { ThemeSelector } from '@/components/ui/ThemeToggle'
import { errorMessage, isApiError } from '@/lib/api/http'
import type { AdminSessionOut } from '@/types/admin'
import { When } from '../components/bits'
import { Callout, ConfirmDialog } from '../components/Dialogs'
import { NewPasswordFields, PasswordInput } from '../components/PasswordFields'
import { Field, KV, Panel } from '../components/ui'
import { adminApi } from '../lib/api'
import { logout } from '../lib/http'
import { ROLE_LABEL, dateTime } from '../lib/format'
import { newPasswordValid } from '../lib/password'
import { useSession } from '../lib/session'

function deviceLabel(ua: string | null) {
  if (!ua) return { label: 'Unknown device', mobile: false }
  const mobile = /Mobile|Android|iPhone|iPad/i.test(ua)
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser'
  const os = /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'macOS' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Linux/.test(ua) ? 'Linux' : ''
  return { label: `${browser}${os ? ` on ${os}` : ''}`, mobile }
}

export default function Account() {
  const me = useSession((s) => s.me)
  const qc = useQueryClient()
  const sessions = useQuery({ queryKey: ['admin', 'me', 'sessions'], queryFn: adminApi.auth.sessions })
  const [revoke, setRevoke] = useState<AdminSessionOut | null>(null)
  const revokeM = useMutation({
    mutationFn: (s: AdminSessionOut) => adminApi.auth.revokeSession(s.id),
    onSuccess: (_r, s) => {
      setRevoke(null)
      if (s.current) {
        void logout('You ended this session.')
        return
      }
      toast.success('Session revoked')
      qc.invalidateQueries({ queryKey: ['admin', 'me', 'sessions'] })
    },
  })

  if (!me) return null
  return (
    <div className="space-y-5">
      <PageHeader eyebrow="Account" title="My account" subtitle="Your profile, password, two-factor and active sessions." />
      <div className="grid gap-5 xl:grid-cols-3">
        <Panel title="Profile" className="xl:col-span-2">
          <KV
            cols={3}
            items={[
              ['Name', me.name],
              ['Email', me.email],
              ['Role', <Chip key="r" tone="volt" size="xs">{ROLE_LABEL[me.role] ?? me.role}</Chip>],
              ['Previous sign-in', me.previous_login_at ? dateTime(me.previous_login_at) : 'None — this is your first'],
              ['From IP', <code key="ip" className="font-mono text-xs">{me.previous_login_ip ?? '—'}</code>],
              [
                'Two-factor',
                me.mfa_enrolled ? (
                  <Chip key="m" tone="mint" size="xs">
                    <ShieldCheck className="h-3 w-3" /> Authenticator app
                  </Chip>
                ) : (
                  <Chip key="m" tone="flare" size="xs">
                    Not set up
                  </Chip>
                ),
              ],
            ]}
          />
          <div className="mt-5 border-t border-white/6 pt-4">
            <div className="mb-2 text-xs font-medium text-muted">Permissions ({me.permissions.length})</div>
            <div className="flex flex-wrap gap-1.5">
              {me.permissions.map((p) => (
                <code key={p} className="rounded-md bg-white/5 px-1.5 py-0.5 font-mono text-[11px] text-fg/80 ring-1 ring-white/8">
                  {p}
                </code>
              ))}
            </div>
          </div>
        </Panel>
        <Panel title="Appearance">
          <ThemeSelector />
          <p className="mt-3 text-xs text-muted">Stored on this device only. Your session itself is never stored in the browser.</p>
          <div className="mt-5 rounded-xl bg-white/4 p-3 text-xs text-muted ring-1 ring-white/8">
            Lost your authenticator? Use a recovery code at sign-in, then ask a super admin to reset two-factor so you can enrol a new device.
          </div>
        </Panel>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <ChangePassword email={me.email} name={me.name} />
        <Panel title="Active sessions" description="Up to 3 concurrent sessions. Idle sessions end after 15 minutes; all end after 12 hours.">
          {sessions.isError ? (
            <ErrorState error={sessions.error} onRetry={() => sessions.refetch()} />
          ) : sessions.isLoading ? (
            <Skeleton className="h-40" />
          ) : (
            <ul className="space-y-2">
              {(sessions.data ?? []).map((s) => {
                const d = deviceLabel(s.user_agent)
                const Icon = d.mobile ? Smartphone : Laptop
                return (
                  <li key={s.id} className="flex items-center gap-3 rounded-xl bg-white/4 p-3 ring-1 ring-white/8">
                    <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/5 ring-1 ring-white/10">
                      <Icon className="h-4 w-4 text-muted" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 text-sm font-medium">
                        {d.label}
                        {s.current && (
                          <Chip tone="volt" size="xs">
                            This session
                          </Chip>
                        )}
                      </div>
                      <div className="truncate text-xs text-muted">
                        <code className="font-mono">{s.ip ?? 'unknown IP'}</code> · started <When iso={s.created_at} /> · active <When iso={s.last_seen_at} />
                      </div>
                    </div>
                    <Button variant={s.current ? 'outline' : 'ghost'} size="sm" onClick={() => setRevoke(s)}>
                      <LogOut className="h-3.5 w-3.5" /> {s.current ? 'Sign out' : 'Revoke'}
                    </Button>
                  </li>
                )
              })}
            </ul>
          )}
        </Panel>
      </div>

      <ConfirmDialog
        open={!!revoke}
        onClose={() => setRevoke(null)}
        title={revoke?.current ? 'Sign out of this session?' : 'Revoke this session?'}
        description={revoke?.current ? 'You’ll return to the sign-in screen.' : 'That device is signed out on its next request.'}
        confirmLabel={revoke?.current ? 'Sign out' : 'Revoke'}
        loading={revokeM.isPending}
        onConfirm={() => revoke && revokeM.mutate(revoke)}
      />
    </div>
  )
}

function ChangePassword({ email, name }: { email: string; name: string }) {
  const qc = useQueryClient()
  const [current, setCurrent] = useState('')
  const [pw, setPw] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const valid = current.length > 0 && newPasswordValid(pw, confirm, { email, name, current })
  const m = useMutation({
    mutationFn: () => adminApi.auth.changePassword(current, pw),
    meta: { silent: true },
    onSuccess: () => {
      toast.success('Password changed — your other sessions were signed out')
      setCurrent('')
      setPw('')
      setConfirm('')
      setError(null)
      qc.invalidateQueries({ queryKey: ['admin', 'me', 'sessions'] })
    },
    onError: (e) => {
      if (!isApiError(e, 'STEP_UP_CANCELLED')) setError(errorMessage(e))
    },
  })
  return (
    <Panel title={<span className="inline-flex items-center gap-2"><KeyRound className="h-4 w-4 text-muted" /> Change password</span>}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          if (valid) m.mutate()
        }}
      >
        <Field label="Current password" htmlFor="acc-current">
          <PasswordInput id="acc-current" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        </Field>
        <NewPasswordFields value={pw} confirm={confirm} onChange={setPw} onConfirmChange={setConfirm} email={email} name={name} current={current || undefined} />
        {error && <Callout tone="flare">{error}</Callout>}
        <div className="flex justify-end">
          <Button type="submit" size="sm" disabled={!valid} loading={m.isPending}>
            Update password
          </Button>
        </div>
      </form>
    </Panel>
  )
}
