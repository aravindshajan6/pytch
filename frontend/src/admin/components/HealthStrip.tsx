import { CircleCheck, CircleX, TriangleAlert } from 'lucide-react'
import { Link } from 'react-router'
import { cn } from '@/lib/cn'
import type { SystemHealth } from '@/types/admin'
import { healthItems, type HealthLevel } from '../lib/health'

export function LevelIcon({ level, className }: { level: HealthLevel; className?: string }) {
  const I = level === 'ok' ? CircleCheck : level === 'warn' ? TriangleAlert : CircleX
  return <I className={cn('h-3.5 w-3.5 shrink-0', level === 'ok' ? 'text-mint' : level === 'warn' ? 'text-sun' : 'text-flare', className)} aria-label={level === 'ok' ? 'OK' : level === 'warn' ? 'Attention' : 'Problem'} />
}

/** Compact one-line system status (icon + label + value, never colour alone). */
export function HealthStrip({ health, loading }: { health: SystemHealth | undefined; loading?: boolean }) {
  if (!health)
    return <div className={cn('glass h-12 rounded-2xl', loading && 'skeleton')} aria-busy={loading} />
  const items = healthItems(health)
  const worst = items.some((i) => i.level === 'bad') ? 'bad' : items.some((i) => i.level === 'warn') ? 'warn' : 'ok'
  return (
    <div className="glass flex flex-wrap items-center gap-x-5 gap-y-2 rounded-2xl px-4 py-3 text-xs shadow-card">
      <Link to="/system" className="inline-flex items-center gap-1.5 font-semibold text-fg hover:underline">
        <LevelIcon level={worst} className="h-4 w-4" />
        {worst === 'ok' ? 'All systems normal' : worst === 'warn' ? 'Needs attention' : 'Incident'}
      </Link>
      <span className="hidden h-4 w-px bg-white/10 sm:block" />
      {items.map((i) => {
        const body = (
          <>
            <LevelIcon level={i.level} />
            <span className="text-muted">{i.label}</span>
            <span className="num text-fg">{i.value}</span>
          </>
        )
        return i.to && i.level !== 'ok' ? (
          <Link key={i.key} to={i.to} className="inline-flex items-center gap-1.5 hover:underline">
            {body}
          </Link>
        ) : (
          <span key={i.key} className="inline-flex items-center gap-1.5">
            {body}
          </span>
        )
      })}
    </div>
  )
}
