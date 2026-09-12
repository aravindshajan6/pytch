import { formatDistanceToNowStrict } from 'date-fns'
import type { SystemHealth } from '@/types/admin'

export type HealthLevel = 'ok' | 'warn' | 'bad'

export interface HealthItem {
  key: string
  label: string
  value: string
  level: HealthLevel
  to?: string
}

const WORKER_STALE_MS = 3 * 60_000

export function healthItems(h: SystemHealth): HealthItem[] {
  const hb = h.worker_heartbeat_at ? Date.now() - Date.parse(h.worker_heartbeat_at) : null
  return [
    { key: 'db', label: 'Database', value: h.db ? 'Up' : 'Down', level: h.db ? 'ok' : 'bad' },
    { key: 'redis', label: 'Redis', value: h.redis ? 'Up' : 'Down', level: h.redis ? 'ok' : 'bad' },
    {
      key: 'worker',
      label: 'Worker',
      value: h.worker_heartbeat_at ? formatDistanceToNowStrict(new Date(h.worker_heartbeat_at), { addSuffix: true }) : 'No heartbeat',
      level: hb == null ? 'bad' : hb > WORKER_STALE_MS * 3 ? 'bad' : hb > WORKER_STALE_MS ? 'warn' : 'ok',
    },
    { key: 'webhooks', label: 'Pending webhooks', value: String(h.pending_webhooks), level: h.pending_webhooks > 50 ? 'bad' : h.pending_webhooks > 0 ? 'warn' : 'ok' },
    { key: 'feeds', label: 'Failing feeds', value: String(h.failing_feeds), level: h.failing_feeds > 0 ? 'warn' : 'ok' },
    { key: 'conflicts', label: 'Open conflicts', value: String(h.open_conflicts), level: h.open_conflicts > 0 ? 'warn' : 'ok', to: '/bookings' },
    { key: 'approvals', label: 'Pending approvals', value: String(h.pending_approvals), level: h.pending_approvals > 0 ? 'warn' : 'ok', to: '/approvals' },
    {
      key: 'audit',
      label: 'Audit chain',
      value: h.audit_chain_ok == null ? 'Not checked' : h.audit_chain_ok ? 'Intact' : 'Broken',
      level: h.audit_chain_ok === false ? 'bad' : h.audit_chain_ok == null ? 'warn' : 'ok',
      to: '/audit',
    },
  ]
}

