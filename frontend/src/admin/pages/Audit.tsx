import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query'
import { ChevronRight, Link2, ShieldAlert, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { ErrorState, PageHeader } from '@/components/ui/States'
import { cn } from '@/lib/cn'
import type { AuditEntry, ChainVerification } from '@/types/admin'
import { JsonDiff } from '../components/bits'
import { DataTable, Pagination, type Column } from '../components/DataTable'
import { Callout } from '../components/Dialogs'
import { Field, Mono, Panel, SearchInput, Select, TextInput, Toolbar } from '../components/ui'
import { adminApi } from '../lib/api'
import { dateTimeSec } from '../lib/format'
import { useDebounced, useUrlState } from '../lib/hooks'

const LIMIT = 50
/** Used until GET /admin/audit/target-types answers (mirrors admin/services/system.py AUDIT_TARGET_TYPES). */
const FALLBACK_TARGET_TYPES = [
  'admin', 'approval', 'approval_request', 'booking', 'broadcast', 'channel_feed', 'coupon', 'payment', 'pitch', 'provider',
  'provider_api_key', 'provider_member', 'provider_webhook', 'session', 'setting', 'settlement', 'slot_block', 'sport',
  'sync_conflict', 'turf', 'user',
]
const ACTOR_TONE: Record<AuditEntry['actor_type'], 'volt' | 'electric' | 'grape' | 'neutral' | 'sun'> = {
  admin: 'volt',
  provider: 'electric',
  user: 'neutral',
  system: 'grape',
  api_key: 'sun',
}

export default function Audit() {
  const [f, set] = useUrlState({ actor: '', action: '', target_type: '', target_id: '', from: '', to: '', offset: '0' })
  const actor = useDebounced(f.actor.trim(), 300)
  const action = useDebounced(f.action.trim(), 300)
  const targetId = useDebounced(f.target_id.trim(), 300)
  const offset = Number(f.offset) || 0
  const [open, setOpen] = useState<string | null>(null)

  const q = useQuery({
    queryKey: ['admin', 'audit', { actor, action, t: f.target_type, targetId, from: f.from, to: f.to, offset }],
    queryFn: () =>
      adminApi.audit.list({
        actor: actor || undefined,
        action: action || undefined,
        target_type: f.target_type || undefined,
        target_id: targetId || undefined,
        from: f.from || undefined,
        to: f.to || undefined,
        limit: LIMIT,
        offset,
      }),
    placeholderData: keepPreviousData,
  })

  const verify = useMutation({ mutationFn: adminApi.audit.verify, meta: { silent: false } })
  // every target type the backend writes (+ any other value present in the log)
  const targetTypes = useQuery({ queryKey: ['admin', 'audit', 'target-types'], queryFn: adminApi.audit.targetTypes, staleTime: 10 * 60_000 })
  const targetOptions = [...new Set([...(targetTypes.data ?? FALLBACK_TARGET_TYPES), ...(f.target_type ? [f.target_type] : [])])].sort()

  const columns: Column<AuditEntry>[] = [
    {
      key: 'exp',
      header: <span className="sr-only">Expand</span>,
      cell: (e) => <ChevronRight className={cn('h-4 w-4 text-subtle transition-transform', open === String(e.id) && 'rotate-90')} />,
      className: 'w-6 pr-0',
    },
    { key: 'id', header: '#', cell: (e) => <Mono className="text-xs text-subtle">{e.id}</Mono>, hideBelow: 'md' },
    { key: 'when', header: 'When (IST)', cell: (e) => <span className="num text-xs whitespace-nowrap text-muted">{dateTimeSec(e.occurred_at)}</span> },
    {
      key: 'actor',
      header: 'Actor',
      cell: (e) => (
        <div className="flex min-w-0 items-center gap-1.5">
          <Chip tone={ACTOR_TONE[e.actor_type] ?? 'neutral'} size="xs">
            {e.actor_type.replace('_', ' ')}
          </Chip>
          <span className="truncate text-xs">{e.actor_label}</span>
        </div>
      ),
    },
    { key: 'action', header: 'Action', cell: (e) => <Mono className="text-xs font-medium text-fg">{e.action}</Mono> },
    {
      key: 'summary',
      header: 'Summary',
      cell: (e) => (
        <div className="min-w-0 max-w-md">
          <div className="truncate text-sm">{e.summary}</div>
          {e.target_type && (
            <div className="truncate font-mono text-[11px] text-subtle">
              {e.target_type}:{e.target_id}
            </div>
          )}
        </div>
      ),
      hideBelow: 'sm',
    },
    { key: 'ip', header: 'IP', cell: (e) => <Mono className="text-xs text-muted">{e.ip ?? '—'}</Mono>, hideBelow: 'xl' },
  ]

  return (
    <div>
      <PageHeader
        eyebrow="Platform"
        title="Audit log"
        subtitle="Append-only and hash-chained — every admin, partner and system action, in order."
        actions={
          <Button variant="secondary" size="sm" loading={verify.isPending} onClick={() => verify.mutate()}>
            <Link2 className="h-4 w-4" /> Verify chain
          </Button>
        }
      />
      {verify.data && <ChainResult r={verify.data} />}

      <Toolbar className="items-end">
        <Field label="Actor" className="w-full sm:w-52">
          <SearchInput value={f.actor} onChange={(v) => set({ actor: v })} placeholder="email or name" />
        </Field>
        <Field label="Action" className="w-full sm:w-52">
          <SearchInput value={f.action} onChange={(v) => set({ action: v })} placeholder="e.g. payment.refund" />
        </Field>
        <Field label="Target">
          <Select value={f.target_type} onChange={(e) => set({ target_type: e.target.value })} className="w-44">
            <option value="">Any</option>
            {targetOptions.map((t) => (
              <option key={t} value={t}>
                {t.replace(/_/g, ' ')}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Target id" className="w-full sm:w-56">
          <TextInput value={f.target_id} onChange={(e) => set({ target_id: e.target.value })} className="font-mono text-xs" spellCheck={false} />
        </Field>
        <Field label="From">
          <TextInput type="date" value={f.from} onChange={(e) => set({ from: e.target.value })} className="w-40" />
        </Field>
        <Field label="To">
          <TextInput type="date" value={f.to} min={f.from || undefined} onChange={(e) => set({ to: e.target.value })} className="w-40" />
        </Field>
      </Toolbar>

      <Panel flush>
        {q.isError ? (
          <div className="p-5">
            <ErrorState error={q.error} onRetry={() => q.refetch()} />
          </div>
        ) : (
          <>
            <DataTable
              rows={q.data?.items}
              columns={columns}
              rowKey={(e) => String(e.id)}
              loading={q.isLoading}
              dim={q.isPlaceholderData}
              expanded={open}
              onRowClick={(e) => setOpen((o) => (o === String(e.id) ? null : String(e.id)))}
              renderExpanded={(e) => (
                <div className="space-y-3">
                  <p className="text-sm sm:hidden">{e.summary}</p>
                  <JsonDiff value={e.changes} />
                  <div className="flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-subtle">
                    <span>
                      Row hash <Mono className="break-all text-muted">{e.hash}</Mono>
                    </span>
                    {e.ip && (
                      <span>
                        IP <Mono className="text-muted">{e.ip}</Mono>
                      </span>
                    )}
                  </div>
                </div>
              )}
              empty="No audit entries match these filters."
              caption="Audit log"
            />
            <Pagination total={q.data?.total ?? 0} limit={LIMIT} offset={offset} onChange={(o) => set({ offset: String(o) }, false)} />
          </>
        )}
      </Panel>
    </div>
  )
}

function ChainResult({ r }: { r: ChainVerification }) {
  return r.ok ? (
    <Callout tone="mint" icon={<ShieldCheck className="h-4 w-4" />} title="Chain intact" className="mb-4">
      {r.checked.toLocaleString('en-IN')} entries verified — every row’s hash matches its predecessor.
    </Callout>
  ) : (
    <Callout tone="flare" icon={<ShieldAlert className="h-4 w-4" />} title="Chain broken" className="mb-4">
      Verification failed at entry <span className="num font-semibold">#{r.broken_at}</span> after checking {r.checked.toLocaleString('en-IN')} rows. Treat as a security incident: preserve the database and escalate.
    </Callout>
  )
}
