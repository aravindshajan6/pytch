import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Wand2 } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import { ErrorState, PageHeader } from '@/components/ui/States'
import { istDate } from '@/lib/format'
import type { AdminSettlementRow } from '@/types/admin'
import type { SettlementStatus } from '@/types/partner'
import { Can } from '../../components/bits'
import { settlementColumns } from '../../components/columns'
import { DataTable } from '../../components/DataTable'
import { ConfirmDialog } from '../../components/Dialogs'
import { Field, Money, Panel, Select, Tabs, TextInput } from '../../components/ui'
import { adminApi } from '../../lib/api'
import { inr } from '../../lib/format'
import { useUrlState } from '../../lib/hooks'

type Tab = SettlementStatus | 'all'

export default function Settlements() {
  const navigate = useNavigate()
  const [f, set] = useUrlState({ status: 'draft', provider_id: '' })
  const status = f.status as Tab
  const [generate, setGenerate] = useState(false)
  const q = useQuery({
    queryKey: ['admin', 'settlements', 'list', { status, provider: f.provider_id }],
    queryFn: () => adminApi.settlements.list({ status: status === 'all' ? undefined : status, provider_id: f.provider_id || undefined }),
  })
  const rows = q.data ?? []
  const total = rows.reduce((s, r) => s + r.net_payable_paise, 0)

  return (
    <div>
      <PageHeader
        eyebrow="Money"
        title="Settlements"
        subtitle="Per-provider payout statements: generate → approve (a different admin) → pay."
        actions={
          <Can perm="payouts.manage">
            <Button size="sm" onClick={() => setGenerate(true)}>
              <Wand2 className="h-4 w-4" /> Generate
            </Button>
          </Can>
        }
      />
      <Panel flush>
        <Tabs<Tab>
          className="px-3 sm:px-4"
          value={status}
          onChange={(v) => set({ status: v })}
          tabs={[
            { value: 'draft', label: 'Draft' },
            { value: 'approved', label: 'Approved · to pay' },
            { value: 'paid', label: 'Paid' },
            { value: 'failed', label: 'Failed' },
            { value: 'all', label: 'All' },
          ]}
        />
        {rows.length > 0 && (
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1 px-4 pt-3 text-xs text-muted sm:px-5">
            <span>
              <span className="num text-fg">{rows.length}</span> statements
            </span>
            <span>
              Net payable <Money paise={total} className="font-semibold text-fg" />
            </span>
          </div>
        )}
        {q.isError ? (
          <div className="p-5">
            <ErrorState error={q.error} onRetry={() => q.refetch()} />
          </div>
        ) : (
          <DataTable<AdminSettlementRow>
            rows={q.data}
            loading={q.isLoading}
            rowKey={(s) => s.id}
            columns={settlementColumns()}
            onRowClick={(s) => navigate(`/settlements/${s.id}`)}
            empty={status === 'draft' ? 'No drafts. Generate statements for a period to start a payout run.' : 'Nothing here.'}
            caption="Settlements"
          />
        )}
      </Panel>
      <GenerateDialog open={generate} onClose={() => setGenerate(false)} onDone={() => set({ status: 'draft' })} />
    </div>
  )
}

function GenerateDialog({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const qc = useQueryClient()
  const [start, setStart] = useState(istDate(-7))
  const [end, setEnd] = useState(istDate(-1))
  const [provider, setProvider] = useState('')
  const providers = useQuery({ queryKey: ['admin', 'providers', 'list', { status: 'approved' }], queryFn: () => adminApi.providers.list({ status: 'approved' }), enabled: open })
  const valid = !!start && !!end && start <= end && end < istDate(0)
  const m = useMutation({
    mutationFn: () => adminApi.settlements.generate({ period_start: start, period_end: end, provider_id: provider || null }),
    onSuccess: (res) => {
      const n = Array.isArray(res) ? res.length : (res as { created?: number })?.created
      toast.success(n != null ? `${n} draft statement${n === 1 ? '' : 's'} generated` : 'Statements generated')
      qc.invalidateQueries({ queryKey: ['admin', 'settlements'] })
      onDone()
      onClose()
    },
  })
  return (
    <ConfirmDialog
      open={open}
      onClose={onClose}
      title="Generate settlement statements"
      description="Creates draft statements from bookings whose hold window has passed. Already-settled bookings are never included twice."
      tone="primary"
      confirmLabel="Generate drafts"
      confirmDisabled={!valid}
      loading={m.isPending}
      onConfirm={() => m.mutate()}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Period start">
          <TextInput type="date" value={start} max={end} onChange={(e) => setStart(e.target.value)} />
        </Field>
        <Field label="Period end" error={end >= istDate(0) ? 'Must be before today' : undefined}>
          <TextInput type="date" value={end} min={start} max={istDate(-1)} onChange={(e) => setEnd(e.target.value)} />
        </Field>
      </div>
      <Field label="Provider" hint="Leave on “All” to generate for every approved provider.">
        <Select value={provider} onChange={(e) => setProvider(e.target.value)} className="w-full">
          <option value="">All approved providers</option>
          {(providers.data ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} — {inr(p.gmv_30d_paise, true)} GMV 30d
            </option>
          ))}
        </Select>
      </Field>
    </ConfirmDialog>
  )
}
