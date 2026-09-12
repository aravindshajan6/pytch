import { useQuery } from '@tanstack/react-query'
import { Clock, Cpu, Database, RefreshCw, Server, Webhook } from 'lucide-react'
import { Link } from 'react-router'
import { Button } from '@/components/ui/Button'
import { ErrorState, PageHeader, Skeleton } from '@/components/ui/States'
import { cn } from '@/lib/cn'
import { LevelIcon } from '../components/HealthStrip'
import { When } from '../components/bits'
import { Panel } from '../components/ui'
import { adminApi, qk } from '../lib/api'
import { dateTime, titleCase } from '../lib/format'
import { healthItems, type HealthLevel } from '../lib/health'

const ICONS: Record<string, typeof Server> = { db: Database, redis: Server, worker: Cpu, webhooks: Webhook }

export default function System() {
  const q = useQuery({ queryKey: qk.health, queryFn: adminApi.system.health, refetchInterval: 15_000 })
  const h = q.data
  const items = h ? healthItems(h) : []
  const worst: HealthLevel = items.some((i) => i.level === 'bad') ? 'bad' : items.some((i) => i.level === 'warn') ? 'warn' : 'ok'

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Platform"
        title="System health"
        subtitle="Live status of the API’s dependencies and background jobs. Refreshes every 15 seconds."
        actions={
          <Button variant="secondary" size="sm" onClick={() => q.refetch()} loading={q.isFetching}>
            <RefreshCw className="h-4 w-4" /> Refresh
          </Button>
        }
      />
      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !h ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      ) : (
        <>
          <div
            className={cn(
              'flex items-center gap-3 rounded-2xl p-4 ring-1',
              worst === 'ok' ? 'bg-mint/8 ring-mint/25' : worst === 'warn' ? 'bg-sun/8 ring-sun/25' : 'bg-flare/10 ring-flare/30',
            )}
          >
            <LevelIcon level={worst} className="h-5 w-5" />
            <div>
              <div className="font-semibold">{worst === 'ok' ? 'All systems operational' : worst === 'warn' ? 'Some things need attention' : 'Service disruption'}</div>
              <div className="text-xs text-muted">
                {h.websocket_connections.toLocaleString('en-IN')} live websocket connections · checked <When iso={new Date(q.dataUpdatedAt).toISOString()} />
              </div>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {items.map((i) => {
              const Icon = ICONS[i.key]
              const body = (
                <div
                  className={cn(
                    'glass h-full rounded-2xl p-4 shadow-card ring-1 transition',
                    i.level === 'bad' ? 'ring-flare/40' : i.level === 'warn' ? 'ring-sun/30' : 'ring-transparent',
                    i.to && 'hover:ring-white/15',
                  )}
                >
                  <div className="flex items-center justify-between text-xs text-muted">
                    <span className="inline-flex items-center gap-1.5">
                      {Icon && <Icon className="h-3.5 w-3.5" />}
                      {i.label}
                    </span>
                    <LevelIcon level={i.level} />
                  </div>
                  <div className="mt-2 text-xl font-semibold">{i.value}</div>
                </div>
              )
              return i.to ? (
                <Link key={i.key} to={i.to} className="block">
                  {body}
                </Link>
              ) : (
                <div key={i.key}>{body}</div>
              )
            })}
          </div>

          <Panel title="Background jobs" description="Last successful run of each scheduled job">
            {h.jobs.length === 0 ? (
              <p className="text-sm text-muted">No job runs recorded yet.</p>
            ) : (
              <ul className="divide-y divide-white/6">
                {h.jobs.map((j) => {
                  const age = j.last_run_at ? Date.now() - Date.parse(j.last_run_at) : null
                  const level: HealthLevel = age == null ? 'warn' : age > 6 * 3600_000 ? 'warn' : 'ok'
                  return (
                    <li key={j.name} className="flex items-center justify-between gap-3 py-2.5">
                      <span className="inline-flex items-center gap-2 text-sm">
                        <LevelIcon level={level} />
                        <code className="font-mono text-xs">{j.name}</code>
                        <span className="hidden text-xs text-muted sm:inline">{titleCase(j.name)}</span>
                      </span>
                      <span className="inline-flex items-center gap-1.5 text-xs text-muted" title={dateTime(j.last_run_at)}>
                        <Clock className="h-3.5 w-3.5" />
                        {j.last_run_at ? <When iso={j.last_run_at} /> : 'never'}
                      </span>
                    </li>
                  )
                })}
              </ul>
            )}
          </Panel>
        </>
      )}
    </div>
  )
}
