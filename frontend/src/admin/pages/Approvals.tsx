import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Stamp, UserRound, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useState } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { EmptyState, ErrorState, PageHeader, Skeleton } from '@/components/ui/States'
import type { ApprovalOut, WalletAdjustApprovalPayload } from '@/types/admin'
import { JsonDiff, When } from '../components/bits'
import { ConfirmDialog } from '../components/Dialogs'
import { Attribution, Field, KV, Money, Mono, StatusChip, Tabs, TextArea } from '../components/ui'
import { adminApi } from '../lib/api'
import { dateTime, shortId } from '../lib/format'
import { useUrlState } from '../lib/hooks'
import { useSession } from '../lib/session'

type Status = ApprovalOut['status']

const TARGET_LINK: Record<string, (id: string) => string> = {
  payment: (id) => `/payments?open=${id}&q=${id}`,
  provider: (id) => `/providers/${id}`,
  booking: (id) => `/bookings/${id}`,
  user: (id) => `/players/${id}`,
  settlement: (id) => `/settlements/${id}`,
}

export default function Approvals() {
  const [f, set] = useUrlState({ status: 'pending' })
  const status = (['pending', 'approved', 'rejected', 'failed'].includes(f.status) ? f.status : 'pending') as Status
  const q = useQuery({ queryKey: ['admin', 'approvals', status], queryFn: () => adminApi.approvals.list(status), refetchInterval: status === 'pending' ? 30_000 : false })

  return (
    <div>
      <PageHeader
        eyebrow="Maker–checker"
        title="Approvals"
        subtitle="Sensitive actions requested by one admin run only after a different admin approves them."
      />
      <Tabs<Status>
        className="mb-5"
        value={status}
        onChange={(v) => set({ status: v })}
        tabs={[
          { value: 'pending', label: 'Pending', count: status === 'pending' ? (q.data?.length ?? null) : null },
          { value: 'approved', label: 'Approved' },
          { value: 'rejected', label: 'Rejected' },
          { value: 'failed', label: 'Failed' },
        ]}
      />
      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : q.isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-40" />
          ))}
        </div>
      ) : !q.data?.length ? (
        <EmptyState
          icon={<Stamp className="mx-auto h-10 w-10 text-subtle" />}
          title={status === 'pending' ? 'Nothing waiting for approval' : `No ${status} requests`}
          description={status === 'pending' ? 'Large refunds, large credit grants, source-refund cancellations and provider bank changes land here for a second pair of eyes.' : undefined}
        />
      ) : (
        <div className="space-y-3">
          <AnimatePresence initial={false}>
            {q.data.map((a) => (
              <ApprovalCard key={a.id} a={a} />
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  )
}

function ApprovalCard({ a }: { a: ApprovalOut }) {
  const me = useSession((s) => s.me)
  const qc = useQueryClient()
  const [dialog, setDialog] = useState<'approve' | 'reject' | null>(null)
  const [note, setNote] = useState('')
  const mine = !!me && a.requested_by.toLowerCase() === me.email.toLowerCase()
  const link = TARGET_LINK[a.target_type]?.(a.target_id)

  const decide = useMutation({
    mutationFn: ({ kind, text }: { kind: 'approve' | 'reject'; text: string }) =>
      kind === 'approve' ? adminApi.approvals.approve(a.id, text) : adminApi.approvals.reject(a.id, text),
    onSuccess: (res, { kind }) => {
      if (res?.status === 'failed') toast.error('Approved, but the action failed to execute — see the failure note')
      else toast.success(kind === 'approve' ? 'Approved and executed' : 'Request rejected')
      qc.invalidateQueries({ queryKey: ['admin', 'approvals'] })
      qc.invalidateQueries({ queryKey: ['admin', 'system'] })
      qc.invalidateQueries({ queryKey: ['admin', 'payments'] })
      qc.invalidateQueries({ queryKey: ['admin', 'providers'] })
      qc.invalidateQueries({ queryKey: ['admin', 'users'] })
      qc.invalidateQueries({ queryKey: ['admin', 'bookings'] })
      setDialog(null)
      setNote('')
    },
  })

  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, height: 0, marginTop: 0 }}
      className="glass overflow-hidden rounded-2xl shadow-card"
    >
      <div className="flex flex-wrap items-start justify-between gap-4 p-4 sm:p-5">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Chip tone="grape" size="xs" title={a.action}>
              {ACTION_LABEL[a.action] ?? a.action}
            </Chip>
            <StatusChip status={a.status} />
            {mine && (
              <Chip tone="electric" size="xs">
                <UserRound className="h-3 w-3" /> You requested this
              </Chip>
            )}
          </div>
          <h3 className="mt-2 font-sans text-base font-semibold tracking-normal">{a.summary}</h3>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
            <span>
              by <span className="text-fg/85">{a.requested_by}</span> · <When iso={a.created_at} />
            </span>
            <span>
              target{' '}
              {link ? (
                <Link to={link} className="font-mono text-volt hover:underline">
                  {a.target_type}:{shortId(a.target_id)}
                </Link>
              ) : (
                <Mono>
                  {a.target_type}:{shortId(a.target_id)}
                </Mono>
              )}
            </span>
          </div>
        </div>
        {a.status === 'pending' && (
          <div className="flex shrink-0 flex-col items-end gap-1.5">
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={mine} onClick={() => setDialog('reject')}>
                <X className="h-4 w-4" /> Reject
              </Button>
              <Button size="sm" disabled={mine} onClick={() => setDialog('approve')}>
                <Check className="h-4 w-4" /> Approve
              </Button>
            </div>
            {mine && <span className="text-[11px] text-subtle">A different admin must decide.</span>}
          </div>
        )}
      </div>
      <div className="border-t border-white/6 bg-white/[0.015] px-4 py-4 sm:px-5">
        {a.action === 'wallet.adjust' ? <WalletAdjustDetails a={a} /> : <JsonDiff value={a.payload} />}
        {a.status === 'failed' && a.result && (
          <p className="mt-3 rounded-lg bg-flare/10 px-3 py-2 text-xs text-flare ring-1 ring-flare/25">
            Execution failed{typeof a.result.error === 'string' ? `: ${a.result.error}` : ''}
          </p>
        )}
        {a.status !== 'pending' && (
          <div className="mt-3 space-y-1">
            <Attribution
              items={[
                ['Decided by', a.decided_by],
                ['at', a.decided_at ? dateTime(a.decided_at) : null],
              ]}
            />
            {a.decision_note && <p className="text-xs text-fg/80">“{a.decision_note}”</p>}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={dialog === 'approve'}
        onClose={() => setDialog(null)}
        title="Approve and execute?"
        description={`${a.summary}. The action runs immediately under your name as checker, and needs your authenticator code.`}
        tone="primary"
        confirmLabel="Approve & execute"
        loading={decide.isPending}
        onConfirm={() => decide.mutate({ kind: 'approve', text: note.trim() })}
      >
        <Field label="Note (optional)">
          <TextArea value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
        </Field>
      </ConfirmDialog>
      <ConfirmDialog
        open={dialog === 'reject'}
        onClose={() => setDialog(null)}
        title="Reject this request?"
        description="Nothing is executed. The requester sees your note."
        confirmLabel="Reject request"
        reason
        reasonLabel="Note to the requester (audited)"
        loading={decide.isPending}
        onConfirm={(r) => decide.mutate({ kind: 'reject', text: r })}
      />
    </motion.article>
  )
}

const ACTION_LABEL: Record<string, string> = {
  'payment.refund': 'Refund',
  'wallet.adjust': 'Credits grant',
  'booking.cancel': 'Cancellation',
  'provider.bank_change': 'Bank change',
}

/** `wallet.adjust`: a manual Pytch Credits grant above the dual-approval threshold (credits the player on approve). */
function WalletAdjustDetails({ a }: { a: ApprovalOut }) {
  const p = a.payload as Partial<WalletAdjustApprovalPayload>
  const amount = typeof p.amount_paise === 'number' ? p.amount_paise : 0
  const debit = p.direction === 'debit' || amount < 0
  const items: [string, React.ReactNode][] = [
    ['Direction', <span key="d" className={debit ? 'text-flare' : 'text-mint'}>{debit ? '− Debit' : '+ Credit'}</span>],
    ['Amount', <Money key="a" paise={Math.abs(amount)} className="text-base font-semibold" />],
    [
      'Player',
      <Link key="p" to={`/players/${a.target_id}`} className="text-volt hover:underline">
        {p.player_name ?? `player:${shortId(a.target_id)}`}
      </Link>,
    ],
    ['Reason', p.reason ?? '—'],
    ...(typeof p.balance_paise === 'number' ? ([['Balance when requested', <Money key="b" paise={p.balance_paise} />]] as [string, React.ReactNode][]) : []),
  ]
  return <KV items={items} cols={2} />
}
