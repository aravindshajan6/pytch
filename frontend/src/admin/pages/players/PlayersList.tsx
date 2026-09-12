import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query'
import { FileDown } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { istDate } from '@/lib/format'
import { ConfirmDialog } from '../../components/Dialogs'
import { Chip } from '@/components/ui/Chip'
import { Segmented } from '@/components/ui/Segmented'
import { ErrorState, PageHeader } from '@/components/ui/States'
import type { AdminUserRow, UserStatus } from '@/types/admin'
import { Can, MaskedPhone, When } from '../../components/bits'
import { DataTable, Pagination, type Column } from '../../components/DataTable'
import { Money, Panel, SearchInput, StatusChip, Toolbar } from '../../components/ui'
import { adminApi } from '../../lib/api'
import { dateShort } from '../../lib/format'
import { useDebounced, useUrlState } from '../../lib/hooks'

const LIMIT = 25

export default function PlayersList() {
  const navigate = useNavigate()
  const [f, set] = useUrlState({ q: '', status: 'all', offset: '0' })
  const q = useDebounced(f.q.trim(), 300)
  const offset = Number(f.offset) || 0

  const query = useQuery({
    queryKey: ['admin', 'users', { q, status: f.status, offset }],
    queryFn: () => adminApi.users.list({ q: q || undefined, status: f.status === 'all' ? undefined : f.status, limit: LIMIT, offset }),
    placeholderData: keepPreviousData,
  })

  const [exporting, setExporting] = useState(false)
  const exportM = useMutation({
    mutationFn: () =>
      adminApi.users.exportCsv({ q: q || undefined, status: f.status === 'all' ? undefined : f.status }, `pytch-players-${istDate(0)}.csv`),
    onSuccess: () => {
      toast.success('Export downloaded')
      setExporting(false)
    },
  })

  const columns: Column<AdminUserRow>[] = [
    {
      key: 'name',
      header: 'Player',
      cell: (u) => (
        <div className="flex min-w-0 items-center gap-3">
          <Avatar user={{ id: u.id, name: u.name || '?', avatar_url: null }} size="sm" />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 truncate font-medium">
              {u.name || 'Unnamed'}
              {u.is_provider_member && (
                <Chip tone="electric" size="xs">
                  Partner
                </Chip>
              )}
            </div>
            <div className="truncate text-xs text-muted">{u.home_area ?? '—'}</div>
          </div>
        </div>
      ),
      sortValue: (u) => u.name.toLowerCase(),
    },
    { key: 'phone', header: 'Phone', cell: (u) => <MaskedPhone phone={u.phone} />, hideBelow: 'sm' },
    { key: 'status', header: 'Status', cell: (u) => <StatusChip status={u.status} /> },
    {
      key: 'level',
      header: 'Lvl · TS',
      align: 'right',
      cell: (u) => (
        <span className="num text-xs">
          {u.level} · {u.true_skill == null ? '—' : Math.round(u.true_skill)}
        </span>
      ),
      sortValue: (u) => u.level,
      hideBelow: 'lg',
    },
    { key: 'matches', header: 'Matches', align: 'right', cell: (u) => <span className="num">{u.matches_played}</span>, sortValue: (u) => u.matches_played, hideBelow: 'md' },
    { key: 'wallet', header: 'Credits', align: 'right', cell: (u) => <Money paise={u.wallet_balance_paise} />, sortValue: (u) => u.wallet_balance_paise, hideBelow: 'md' },
    { key: 'joined', header: 'Joined', cell: (u) => <span className="text-xs text-muted">{dateShort(u.created_at)}</span>, sortValue: (u) => u.created_at, hideBelow: 'xl' },
    { key: 'seen', header: 'Last seen', cell: (u) => <When iso={u.last_seen_at} className="text-xs text-muted" />, sortValue: (u) => u.last_seen_at, hideBelow: 'lg' },
  ]

  return (
    <div>
      <PageHeader
        eyebrow="People"
        title="Players"
        subtitle="Look up accounts, review activity and act on reports."
        actions={
          <Can perm="data.export">
            <Button variant="secondary" size="sm" onClick={() => setExporting(true)}>
              <FileDown className="h-4 w-4" /> Export CSV
            </Button>
          </Can>
        }
      />
      <ConfirmDialog
        open={exporting}
        onClose={() => setExporting(false)}
        title="Export players to CSV?"
        description="The file contains personal data (names, phone numbers). The export is recorded in the audit log under your name and needs your authenticator code. Store it only on an encrypted, company-managed device."
        tone="primary"
        confirmLabel="Export"
        loading={exportM.isPending}
        onConfirm={() => exportM.mutate()}
      />
      <Toolbar>
        <SearchInput value={f.q} onChange={(v) => set({ q: v })} placeholder="Name or phone number" className="w-full sm:w-80" />
        <Segmented<UserStatus | 'all'>
          value={f.status as UserStatus | 'all'}
          onChange={(v) => set({ status: v })}
          size="sm"
          options={[
            { value: 'all', label: 'All' },
            { value: 'active', label: 'Active' },
            { value: 'suspended', label: 'Suspended' },
            { value: 'banned', label: 'Banned' },
          ]}
        />
      </Toolbar>
      <Panel flush>
        {query.isError ? (
          <div className="p-5">
            <ErrorState error={query.error} onRetry={() => query.refetch()} />
          </div>
        ) : (
          <>
            <DataTable
              rows={query.data?.items}
              columns={columns}
              rowKey={(u) => u.id}
              loading={query.isLoading}
              dim={query.isPlaceholderData}
              onRowClick={(u) => navigate(`/players/${u.id}`)}
              empty={q ? `No players match “${q}”.` : 'No players yet.'}
              caption="Players"
            />
            <Pagination total={query.data?.total ?? 0} limit={LIMIT} offset={offset} onChange={(o) => set({ offset: String(o) }, false)} />
          </>
        )}
      </Panel>
    </div>
  )
}
