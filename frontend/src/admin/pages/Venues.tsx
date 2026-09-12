import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Star } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { Switch } from '@/components/ui/Form'
import { Segmented } from '@/components/ui/Segmented'
import { ErrorState, PageHeader } from '@/components/ui/States'
import { cn } from '@/lib/cn'
import { SPORTS } from '@/lib/sports'
import type { AdminVenueRow } from '@/types/admin'
import type { Sport } from '@/types/api'
import { DataTable, type Column } from '../components/DataTable'
import { ConfirmDialog } from '../components/Dialogs'
import { Panel, SearchInput, Toolbar } from '../components/ui'
import { adminApi } from '../lib/api'
import { useDebounced, useUrlState } from '../lib/hooks'
import { useCan } from '../lib/session'

export default function Venues() {
  const can = useCan()
  const qc = useQueryClient()
  const manage = can('venues.manage')
  const [f, set] = useUrlState({ q: '', active: 'all' })
  const q = useDebounced(f.q.trim(), 300)
  const [confirm, setConfirm] = useState<AdminVenueRow | null>(null)

  const query = useQuery({
    queryKey: ['admin', 'venues', 'list', { q, active: f.active }],
    queryFn: () => adminApi.venues.list({ q: q || undefined, active: f.active === 'all' ? undefined : f.active === 'active' }),
    placeholderData: keepPreviousData,
  })

  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: { is_active?: boolean; is_featured?: boolean } }) => adminApi.venues.update(id, body),
    onMutate: async ({ id, body }) => {
      // optimistic toggle; rolled back on error
      const key = ['admin', 'venues', 'list', { q, active: f.active }]
      await qc.cancelQueries({ queryKey: key })
      const prev = qc.getQueryData<AdminVenueRow[]>(key)
      qc.setQueryData<AdminVenueRow[]>(key, (rows) => rows?.map((r) => (r.id === id ? { ...r, ...body } : r)))
      return { prev, key }
    },
    onError: (_e, _v, ctx) => ctx && qc.setQueryData(ctx.key, ctx.prev),
    onSuccess: (_d, { body }) => {
      toast.success(body.is_active === false ? 'Venue deactivated' : body.is_active ? 'Venue activated' : body.is_featured ? 'Featured on Discover' : 'Removed from featured')
      setConfirm(null)
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['admin', 'venues'] }),
  })

  const columns: Column<AdminVenueRow>[] = [
    {
      key: 'name',
      header: 'Venue',
      cell: (v) => (
        <div className="min-w-0">
          <div className="truncate font-medium">{v.name}</div>
          <div className="truncate text-xs text-muted">
            {v.area} · <span className="font-mono">{v.slug}</span>
          </div>
        </div>
      ),
      sortValue: (v) => v.name.toLowerCase(),
    },
    {
      key: 'provider',
      header: 'Provider',
      cell: (v) =>
        v.provider_id && can('providers.view') ? (
          <Link to={`/providers/${v.provider_id}`} onClick={(e) => e.stopPropagation()} className="text-sm hover:text-volt hover:underline">
            {v.provider_name}
          </Link>
        ) : (
          <span className="text-sm text-muted">{v.provider_name ?? 'Unassigned'}</span>
        ),
      sortValue: (v) => v.provider_name ?? '',
      hideBelow: 'md',
    },
    {
      key: 'sports',
      header: 'Sports',
      cell: (v) => (
        <span className="text-sm" title={v.sports.map((s) => SPORTS[s as Sport]?.label ?? s).join(', ')}>
          {v.sports.map((s) => SPORTS[s as Sport]?.emoji ?? s).join(' ')}
        </span>
      ),
      hideBelow: 'lg',
    },
    { key: 'pitches', header: 'Pitches', align: 'right', cell: (v) => <span className="num">{v.pitch_count}</span>, sortValue: (v) => v.pitch_count, hideBelow: 'sm' },
    { key: 'rating', header: 'Rating', align: 'right', cell: (v) => <span className="num">{v.rating_avg ? v.rating_avg.toFixed(1) : '—'}</span>, sortValue: (v) => v.rating_avg, hideBelow: 'lg' },
    {
      key: 'b30',
      header: 'Bookings 30d',
      align: 'right',
      cell: (v) => <span className="num">{(v.bookings_30d ?? 0).toLocaleString('en-IN')}</span>,
      sortValue: (v) => v.bookings_30d ?? 0,
      hideBelow: 'md',
    },
    {
      key: 'featured',
      header: 'Featured',
      align: 'center',
      cell: (v) => (
        <button
          type="button"
          disabled={!manage || update.isPending}
          onClick={(e) => {
            e.stopPropagation()
            update.mutate({ id: v.id, body: { is_featured: !v.is_featured } })
          }}
          aria-pressed={v.is_featured}
          aria-label={v.is_featured ? `Unfeature ${v.name}` : `Feature ${v.name}`}
          className="cursor-pointer rounded-lg p-1.5 transition hover:bg-white/8 disabled:cursor-default disabled:hover:bg-transparent"
        >
          <Star className={cn('h-4 w-4', v.is_featured ? 'fill-sun text-sun' : 'text-subtle')} />
        </button>
      ),
      sortValue: (v) => (v.is_featured ? 1 : 0),
    },
    {
      key: 'active',
      header: 'Live',
      align: 'center',
      cell: (v) => (
        <div className="inline-flex" onClick={(e) => e.stopPropagation()}>
          <Switch
            checked={v.is_active}
            disabled={!manage || update.isPending}
            label={v.is_active ? `Deactivate ${v.name}` : `Activate ${v.name}`}
            onChange={(next) => (next ? update.mutate({ id: v.id, body: { is_active: true } }) : setConfirm(v))}
          />
        </div>
      ),
      sortValue: (v) => (v.is_active ? 1 : 0),
    },
  ]

  return (
    <div>
      <PageHeader eyebrow="Marketplace" title="Venues" subtitle="Everything listed on Pytch. Deactivated venues disappear from Discover and can’t be booked." />
      <Toolbar>
        <SearchInput value={f.q} onChange={(v) => set({ q: v })} placeholder="Venue, area or provider" className="w-full sm:w-80" />
        <Segmented
          value={f.active}
          onChange={(v) => set({ active: v })}
          size="sm"
          options={[
            { value: 'all', label: 'All' },
            { value: 'active', label: 'Live' },
            { value: 'inactive', label: 'Inactive' },
          ]}
        />
      </Toolbar>
      <Panel flush>
        {query.isError ? (
          <div className="p-5">
            <ErrorState error={query.error} onRetry={() => query.refetch()} />
          </div>
        ) : (
          <DataTable rows={query.data} columns={columns} rowKey={(v) => v.id} loading={query.isLoading} dim={query.isPlaceholderData} empty="No venues match." caption="Venues" />
        )}
      </Panel>
      <ConfirmDialog
        open={!!confirm}
        onClose={() => setConfirm(null)}
        title={`Deactivate ${confirm?.name ?? 'venue'}?`}
        description="It disappears from Discover and search immediately. Existing bookings are not cancelled — handle those from Bookings if needed."
        confirmLabel="Deactivate"
        loading={update.isPending}
        onConfirm={() => confirm && update.mutate({ id: confirm.id, body: { is_active: false } })}
      />
    </div>
  )
}
