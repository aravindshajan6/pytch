import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router'
import { ErrorState, PageHeader } from '@/components/ui/States'
import { bookingColumns } from '../../components/columns'
import { DataTable, Pagination } from '../../components/DataTable'
import { Field, Panel, SearchInput, Select, TextInput, Toolbar } from '../../components/ui'
import { adminApi } from '../../lib/api'
import { useDebounced, useUrlState } from '../../lib/hooks'

const LIMIT = 25
const STATUSES = ['pending_payment', 'confirmed', 'completed', 'cancelled', 'expired']

export default function BookingsList() {
  const navigate = useNavigate()
  const [f, set] = useUrlState({ q: '', status: '', from: '', to: '', offset: '0' })
  const q = useDebounced(f.q.trim(), 300)
  const offset = Number(f.offset) || 0

  const query = useQuery({
    queryKey: ['admin', 'bookings', 'list', { q, status: f.status, from: f.from, to: f.to, offset }],
    queryFn: () =>
      adminApi.bookings.list({ q: q || undefined, status: f.status || undefined, from: f.from || undefined, to: f.to || undefined, limit: LIMIT, offset }),
    placeholderData: keepPreviousData,
  })

  return (
    <div>
      <PageHeader eyebrow="Marketplace" title="Bookings" subtitle="Every Pytch booking — search by booking code, host, venue or phone." />
      <Toolbar className="items-end">
        <Field label="Search" className="w-full sm:w-72">
          <SearchInput value={f.q} onChange={(v) => set({ q: v })} placeholder="e.g. PY-7K2Q or host name" />
        </Field>
        <Field label="Status">
          <Select value={f.status} onChange={(e) => set({ status: e.target.value })} className="w-40">
            <option value="">Any status</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.replace(/_/g, ' ')}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="From">
          <TextInput type="date" value={f.from} onChange={(e) => set({ from: e.target.value })} className="w-40" />
        </Field>
        <Field label="To">
          <TextInput type="date" value={f.to} min={f.from || undefined} onChange={(e) => set({ to: e.target.value })} className="w-40" />
        </Field>
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
              columns={bookingColumns()}
              rowKey={(b) => b.id}
              loading={query.isLoading}
              dim={query.isPlaceholderData}
              onRowClick={(b) => navigate(`/bookings/${b.id}`)}
              empty="No bookings match these filters."
              caption="Bookings"
            />
            <Pagination total={query.data?.total ?? 0} limit={LIMIT} offset={offset} onChange={(o) => set({ offset: String(o) }, false)} />
          </>
        )}
      </Panel>
    </div>
  )
}
