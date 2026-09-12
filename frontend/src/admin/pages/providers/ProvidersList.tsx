import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { PauseCircle } from 'lucide-react'
import { useMemo } from 'react'
import { useNavigate } from 'react-router'
import { Segmented } from '@/components/ui/Segmented'
import { ErrorState, PageHeader } from '@/components/ui/States'
import type { AdminProviderRow } from '@/types/admin'
import type { ProviderStatus } from '@/types/partner'
import { MaskedPhone, When } from '../../components/bits'
import { DataTable, type Column } from '../../components/DataTable'
import { Money, Panel, SearchInput, StatusChip, Tabs, Toolbar } from '../../components/ui'
import { adminApi } from '../../lib/api'
import { bpsToPct } from '../../lib/format'
import { useDebounced, useUrlState } from '../../lib/hooks'

type View = 'applications' | 'all'

export default function ProvidersList() {
  const navigate = useNavigate()
  const [f, set] = useUrlState({ view: 'applications', q: '', status: 'all' })
  const view = (f.view === 'all' ? 'all' : 'applications') as View
  const q = useDebounced(f.q.trim(), 300)

  const pending = useQuery({
    queryKey: ['admin', 'providers', 'list', { status: 'pending' }],
    queryFn: () => adminApi.providers.list({ status: 'pending' }),
  })
  const all = useQuery({
    queryKey: ['admin', 'providers', 'list', { q, status: f.status }],
    queryFn: () => adminApi.providers.list({ q: q || undefined, status: f.status === 'all' ? undefined : f.status }),
    enabled: view === 'all',
    placeholderData: keepPreviousData,
  })

  // applications queue: oldest first (first come, first reviewed)
  const queue = useMemo(() => [...(pending.data ?? [])].sort((a, b) => a.created_at.localeCompare(b.created_at)), [pending.data])
  const active = view === 'applications' ? pending : all
  const rows = view === 'applications' ? queue : all.data

  const columns: Column<AdminProviderRow>[] = [
    {
      key: 'name',
      header: 'Provider',
      cell: (p) => (
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 truncate font-medium">
            {p.name}
            {p.payouts_on_hold && <PauseCircle className="h-3.5 w-3.5 shrink-0 text-sun" aria-label="Payouts on hold" />}
          </div>
          <div className="truncate text-xs text-muted">{p.city}</div>
        </div>
      ),
      sortValue: (p) => p.name.toLowerCase(),
    },
    {
      key: 'contact',
      header: 'Contact',
      cell: (p) => (
        <div className="min-w-0">
          <div className="truncate text-sm">{p.contact_name}</div>
          <MaskedPhone phone={p.contact_phone} className="text-xs text-muted" />
        </div>
      ),
      hideBelow: 'md',
    },
    { key: 'status', header: 'Status', cell: (p) => <StatusChip status={p.status} /> },
    { key: 'venues', header: 'Venues', align: 'right', cell: (p) => <span className="num">{p.venue_count}</span>, sortValue: (p) => p.venue_count, hideBelow: 'sm' },
    { key: 'comm', header: 'Commission', align: 'right', cell: (p) => <span className="num">{bpsToPct(p.commission_bps)}</span>, sortValue: (p) => p.commission_bps, hideBelow: 'lg' },
    { key: 'gmv', header: 'GMV 30d', align: 'right', cell: (p) => <Money paise={p.gmv_30d_paise} />, sortValue: (p) => p.gmv_30d_paise, hideBelow: 'md' },
    {
      key: 'conf',
      header: 'Conflicts',
      align: 'right',
      cell: (p) => <span className={`num ${p.open_conflicts ? 'text-sun' : 'text-muted'}`}>{p.open_conflicts}</span>,
      sortValue: (p) => p.open_conflicts,
      hideBelow: 'lg',
    },
    { key: 'applied', header: view === 'applications' ? 'Applied' : 'Since', cell: (p) => <When iso={p.created_at} className="text-xs text-muted" />, sortValue: (p) => p.created_at, hideBelow: 'sm' },
  ]

  return (
    <div>
      <PageHeader eyebrow="People" title="Providers" subtitle="Venue partners — review applications, manage terms and payouts." />
      <Panel flush>
        <Tabs<View>
          className="px-3 sm:px-4"
          value={view}
          onChange={(v) => set({ view: v })}
          tabs={[
            { value: 'applications', label: 'Applications queue', count: pending.data?.length ?? null },
            { value: 'all', label: 'All providers' },
          ]}
        />
        {view === 'all' && (
          <Toolbar className="mt-3 mb-0 px-4 sm:px-5">
            <SearchInput value={f.q} onChange={(v) => set({ q: v })} placeholder="Name, city or contact" className="w-full sm:w-72" />
            <Segmented<ProviderStatus | 'all'>
              value={f.status as ProviderStatus | 'all'}
              onChange={(v) => set({ status: v })}
              size="sm"
              options={[
                { value: 'all', label: 'All' },
                { value: 'approved', label: 'Approved' },
                { value: 'pending', label: 'Pending' },
                { value: 'suspended', label: 'Suspended' },
                { value: 'rejected', label: 'Rejected' },
              ]}
            />
          </Toolbar>
        )}
        {active.isError ? (
          <div className="p-5">
            <ErrorState error={active.error} onRetry={() => active.refetch()} />
          </div>
        ) : (
          <DataTable
            rows={rows}
            columns={columns}
            rowKey={(p) => p.id}
            loading={active.isLoading}
            dim={view === 'all' && all.isPlaceholderData}
            onRowClick={(p) => navigate(`/providers/${p.id}`)}
            empty={view === 'applications' ? 'No applications waiting — the queue is clear.' : 'No providers match these filters.'}
            caption="Providers"
          />
        )}
      </Panel>
    </div>
  )
}
