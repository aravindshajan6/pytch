import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Ban, LogOut, RotateCcw, ShieldOff, Wallet } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { toast } from 'sonner'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { Segmented } from '@/components/ui/Segmented'
import { ErrorState, PageLoader } from '@/components/ui/States'
import type { AdminUserDetail, UserStatus } from '@/types/admin'
import { Can, MaskedPhone, When } from '../../components/bits'
import { bookingColumns, paymentColumns } from '../../components/columns'
import { DataTable } from '../../components/DataTable'
import { DetailHeader } from '../../components/DetailHeader'
import { Callout, ConfirmDialog } from '../../components/Dialogs'
import { Field, KV, Money, Panel, StatusChip, Tabs, TextInput } from '../../components/ui'
import { errorMessage, isApiError } from '@/lib/api/http'
import { adminApi } from '../../lib/api'
import { isSilentError } from '../../lib/errors'
import { dateShort, dateTime, inr, rupeesToPaise, titleCase } from '../../lib/format'
import { isApprovalQueued } from '../../lib/http'
import { useCan, useSession } from '../../lib/session'

type Tab = 'bookings' | 'payments' | 'wallet'

export default function PlayerDetail() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const can = useCan()
  const qc = useQueryClient()
  const [tab, setTab] = useState<Tab>('bookings')
  const [dialog, setDialog] = useState<null | 'suspend' | 'ban' | 'reinstate' | 'wallet' | 'logout'>(null)

  const q = useQuery({ queryKey: ['admin', 'users', 'detail', id], queryFn: () => adminApi.users.get(id), enabled: !!id })
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['admin', 'users'] })
  }

  if (q.isLoading) return <PageLoader />
  if (q.isError || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />
  const u = q.data

  return (
    <div className="space-y-5">
      <DetailHeader
        back="/players"
        backLabel="Players"
        leading={<Avatar user={u.public ?? { id: u.id, name: u.name, avatar_url: null }} size="lg" />}
        title={u.name || 'Unnamed player'}
        meta={
          <>
            <StatusChip status={u.status} />
            {u.is_provider_member && (
              <Chip tone="electric" size="xs">
                Venue partner
              </Chip>
            )}
            <span>Joined {dateShort(u.created_at)}</span>
            <span>·</span>
            <span>
              Last seen <When iso={u.last_seen_at} />
            </span>
          </>
        }
        actions={
          <>
            <Can perm="wallet.adjust">
              <Button variant="secondary" size="sm" onClick={() => setDialog('wallet')}>
                <Wallet className="h-4 w-4" /> Adjust credits
              </Button>
            </Can>
            <Can perm="users.manage">
              <Button variant="secondary" size="sm" onClick={() => setDialog('logout')}>
                <LogOut className="h-4 w-4" /> Log out everywhere
              </Button>
              {u.status === 'active' ? (
                <>
                  <Button variant="outline" size="sm" onClick={() => setDialog('suspend')}>
                    <ShieldOff className="h-4 w-4" /> Suspend
                  </Button>
                  <Button variant="danger" size="sm" onClick={() => setDialog('ban')}>
                    <Ban className="h-4 w-4" /> Ban
                  </Button>
                </>
              ) : (
                <Button size="sm" onClick={() => setDialog('reinstate')}>
                  <RotateCcw className="h-4 w-4" /> Reinstate
                </Button>
              )}
            </Can>
          </>
        }
      />

      {u.status !== 'active' && (
        <Callout tone="flare" title={u.status === 'banned' ? 'Account banned' : 'Account suspended'}>
          {u.status_reason ?? 'No reason recorded.'}
          {u.suspended_until && <> · until {dateTime(u.suspended_until)}</>}
        </Callout>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        <Panel title="Profile" className="lg:col-span-2">
          <KV
            cols={3}
            items={[
              ['Phone', <MaskedPhone key="p" phone={u.phone} full />],
              ['Home area', u.home_area ?? '—'],
              ['Level', <span key="l" className="num">{u.level}</span>],
              ['TrueSkill', <span key="t" className="num">{u.true_skill == null ? 'Unrated' : Math.round(u.true_skill)}</span>],
              ['Matches played', <span key="m" className="num">{u.matches_played}</span>],
              ['Credits balance', <Money key="w" paise={u.wallet_balance_paise} className="text-fg" />],
              ['Active sessions', <span key="s" className="num">{u.active_sessions}</span>],
              ['Tier', titleCase(u.public?.tier ?? '—')],
              ['Player ID', <code key="id" className="font-mono text-xs text-muted">{u.id}</code>],
            ]}
          />
        </Panel>
        <Panel title="Reliability">
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                ['Hosted', u.stats.hosted, false],
                ['Subbed in', u.stats.subs, false],
                ['Drop-outs', u.stats.dropouts, u.stats.dropouts > 2],
                ['No-shows', u.stats.no_shows, u.stats.no_shows > 0],
                ['Ratings received', u.stats.ratings_received, false],
              ] as const
            ).map(([label, v, warn]) => (
              <div key={label} className="rounded-xl bg-white/4 p-3 ring-1 ring-white/8">
                <div className="text-[11px] text-muted">{label}</div>
                <div className={`mt-0.5 text-lg font-semibold ${warn ? 'text-sun' : ''}`}>{v}</div>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <Panel flush>
        <Tabs<Tab>
          className="px-3 sm:px-4"
          value={tab}
          onChange={setTab}
          tabs={[
            { value: 'bookings', label: 'Recent bookings', count: u.recent_bookings.length },
            { value: 'payments', label: 'Payments', count: u.recent_payments.length },
            { value: 'wallet', label: 'Credits ledger', count: u.wallet.length },
          ]}
        />
        {tab === 'bookings' && (
          <DataTable
            rows={u.recent_bookings}
            columns={bookingColumns({ host: false })}
            rowKey={(b) => b.id}
            onRowClick={can('bookings.view') ? (b) => navigate(`/bookings/${b.id}`) : undefined}
            empty="No bookings yet."
            maxHeight="max-h-[480px]"
          />
        )}
        {tab === 'payments' && (
          <DataTable
            rows={u.recent_payments}
            columns={paymentColumns({ user: false })}
            rowKey={(p) => p.id}
            onRowClick={can('payments.view') ? (p) => navigate(`/payments?q=${encodeURIComponent(p.id)}`) : undefined}
            empty="No payments yet."
            maxHeight="max-h-[480px]"
          />
        )}
        {tab === 'wallet' && (
          <DataTable
            rows={u.wallet.map((w, i) => ({ ...w, _k: `${w.created_at}-${i}` }))}
            rowKey={(w) => w._k}
            maxHeight="max-h-[480px]"
            empty="No credit movements."
            columns={[
              { key: 'when', header: 'When', cell: (w) => <span className="text-xs text-muted">{dateTime(w.created_at)}</span> },
              { key: 'kind', header: 'Kind', cell: (w) => <Chip size="xs">{titleCase(w.kind)}</Chip> },
              { key: 'note', header: 'Note', cell: (w) => <span className="text-sm">{w.note}</span>, hideBelow: 'sm' },
              {
                key: 'amt',
                header: 'Amount',
                align: 'right',
                cell: (w) => <span className={`num ${w.amount_paise >= 0 ? 'text-mint' : 'text-flare'}`}>{w.amount_paise >= 0 ? '+' : ''}{(w.amount_paise / 100).toLocaleString('en-IN')}</span>,
              },
            ]}
          />
        )}
      </Panel>

      <StatusDialog user={u} mode={dialog === 'suspend' || dialog === 'ban' || dialog === 'reinstate' ? dialog : null} onClose={() => setDialog(null)} onDone={refresh} />
      <WalletDialog user={u} open={dialog === 'wallet'} onClose={() => setDialog(null)} onDone={refresh} />
      <LogoutAllDialog user={u} open={dialog === 'logout'} onClose={() => setDialog(null)} onDone={refresh} />
    </div>
  )
}

function StatusDialog({ user, mode, onClose, onDone }: { user: AdminUserDetail; mode: 'suspend' | 'ban' | 'reinstate' | null; onClose: () => void; onDone: () => void }) {
  const [until, setUntil] = useState('')
  const m = useMutation({
    mutationFn: (reason: string) => {
      const status: UserStatus = mode === 'suspend' ? 'suspended' : mode === 'ban' ? 'banned' : 'active'
      return adminApi.users.setStatus(user.id, { status, reason, until: mode === 'suspend' && until ? new Date(until).toISOString() : null })
    },
    onSuccess: () => {
      toast.success(mode === 'reinstate' ? 'Account reinstated' : mode === 'ban' ? 'Account banned — sessions revoked' : 'Account suspended — sessions revoked')
      onDone()
      onClose()
      setUntil('')
    },
  })
  const title = mode === 'suspend' ? `Suspend ${user.name}?` : mode === 'ban' ? `Ban ${user.name}?` : `Reinstate ${user.name}?`
  return (
    <ConfirmDialog
      open={!!mode}
      onClose={onClose}
      title={title}
      description={
        mode === 'reinstate'
          ? 'They’ll be able to sign in and book again.'
          : 'All of their sessions are revoked immediately and they can’t book or join games.'
      }
      tone={mode === 'reinstate' ? 'primary' : 'danger'}
      confirmLabel={mode === 'suspend' ? 'Suspend account' : mode === 'ban' ? 'Ban permanently' : 'Reinstate'}
      reason
      loading={m.isPending}
      onConfirm={(r) => m.mutate(r)}
    >
      {mode === 'suspend' && (
        <Field label="Suspended until (optional — your local time)" hint="Leave empty for an open-ended suspension.">
          <TextInput type="datetime-local" value={until} min={new Date().toISOString().slice(0, 16)} onChange={(e) => setUntil(e.target.value)} />
        </Field>
      )}
    </ConfirmDialog>
  )
}

const SUPPORT_CAP_PAISE = 50_000 // ₹500 per adjustment (support)

function WalletDialog({ user, open, onClose, onDone }: { user: AdminUserDetail; open: boolean; onClose: () => void; onDone: () => void }) {
  const role = useSession((s) => s.me?.role)
  const threshold = useDualApprovalThreshold()
  const [dir, setDir] = useState<'credit' | 'debit'>('credit')
  const [amount, setAmount] = useState('')
  const [limit, setLimit] = useState<string | null>(null)
  const paise = rupeesToPaise(amount)
  const capped = role === 'support' && paise > SUPPORT_CAP_PAISE
  const valid = Number.isFinite(paise) && paise > 0 && !capped && (dir === 'credit' || paise <= user.wallet_balance_paise)
  const needsApproval = dir === 'credit' && threshold != null && Number.isFinite(paise) && paise > threshold
  const close = () => {
    setLimit(null)
    onClose()
  }
  const m = useMutation({
    mutationFn: (reason: string) => adminApi.users.wallet(user.id, { amount_paise: dir === 'credit' ? paise : -paise, reason }),
    meta: { silent: true },
    onSuccess: (res) => {
      // 202 APPROVAL_REQUIRED: the http layer already toasted "Sent for second-admin approval" (link to Approvals)
      if (!isApprovalQueued(res)) toast.success(dir === 'credit' ? 'Credits granted' : 'Credits deducted')
      onDone()
      close()
      setAmount('')
    },
    onError: (e) => {
      if (isApiError(e, 'LIMIT_REACHED')) {
        setLimit(e.message) // daily caps (₹1,000 per player / ₹5,000 per support admin) — keep the dialog open
        return
      }
      if (!isSilentError(e)) toast.error(errorMessage(e))
    },
  })
  return (
    <ConfirmDialog
      open={open}
      onClose={close}
      title="Adjust Pytch Credits"
      description={
        <>
          Current balance <Money paise={user.wallet_balance_paise} className="text-fg" />. Credits are promotional — non-withdrawable and platform-funded.
        </>
      }
      tone="primary"
      confirmLabel={dir === 'credit' ? (needsApproval ? 'Request approval' : 'Grant credits') : 'Deduct credits'}
      reason
      loading={m.isPending}
      confirmDisabled={!valid}
      onConfirm={(r) => {
        setLimit(null)
        m.mutate(r)
      }}
    >
      <Segmented<'credit' | 'debit'>
        value={dir}
        onChange={(v) => {
          setDir(v)
          setLimit(null)
        }}
        size="sm"
        options={[
          { value: 'credit', label: '+ Credit' },
          { value: 'debit', label: '− Debit' },
        ]}
      />
      <Field
        label="Amount (₹)"
        error={capped ? 'Support can adjust at most ₹500 per change.' : dir === 'debit' && paise > user.wallet_balance_paise ? 'More than the current balance.' : undefined}
        hint={role === 'support' ? 'Your role: at most ₹500 per change, ₹1,000 per player and ₹5,000 in total per day.' : undefined}
      >
        <TextInput
          inputMode="decimal"
          value={amount}
          onChange={(e) => {
            setAmount(e.target.value.replace(/[^\d.]/g, ''))
            setLimit(null)
          }}
          placeholder="0"
          className="num text-lg"
        />
      </Field>
      {needsApproval && (
        <Callout tone="electric" title="Needs a second admin">
          Credits above {inr(threshold!)} are queued for maker–checker approval — the player is credited once a different admin approves it in{' '}
          <Link to="/approvals" className="font-medium text-volt hover:underline">
            Approvals
          </Link>
          .
        </Callout>
      )}
      {limit && (
        <Callout tone="flare" title="Daily limit reached">
          {limit}
        </Callout>
      )}
    </ConfirmDialog>
  )
}

/** Dual-approval threshold (same setting as refunds) — only readable with settings.view; null otherwise. */
function useDualApprovalThreshold() {
  const can = useCan()
  const settings = useQuery({ queryKey: ['admin', 'settings'], queryFn: adminApi.settings.list, enabled: can('settings.view'), staleTime: 5 * 60_000 })
  const s = settings.data?.find((x) => x.key === 'refund_dual_approval_paise')
  return typeof s?.value === 'number' ? s.value : null
}

function LogoutAllDialog({ user, open, onClose, onDone }: { user: AdminUserDetail; open: boolean; onClose: () => void; onDone: () => void }) {
  const m = useMutation({
    mutationFn: () => adminApi.users.logoutAll(user.id),
    onSuccess: () => {
      toast.success('All sessions revoked')
      onDone()
      onClose()
    },
  })
  return (
    <ConfirmDialog
      open={open}
      onClose={onClose}
      title="Log out everywhere?"
      description={`Revokes all ${user.active_sessions} active session(s) for ${user.name}, on the player app and partner portal. They can sign in again with OTP.`}
      confirmLabel="Revoke sessions"
      loading={m.isPending}
      onConfirm={() => m.mutate()}
    />
  )
}
