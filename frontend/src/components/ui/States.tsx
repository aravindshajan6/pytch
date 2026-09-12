import { AlertTriangle, Loader2 } from 'lucide-react'
import { motion } from 'motion/react'
import { cn } from '@/lib/cn'
import { ApiError, errorMessage } from '@/lib/api/http'
import { Button } from './Button'

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton rounded-2xl', className)} />
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('h-5 w-5 animate-spin text-volt', className)} />
}

export function PageLoader() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <motion.div
        className="h-10 w-10 rounded-full border-2 border-volt/20 border-t-volt"
        animate={{ rotate: 360 }}
        transition={{ repeat: Infinity, duration: 0.8, ease: 'linear' }}
      />
    </div>
  )
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ReactNode
  title: string
  description?: string
  action?: React.ReactNode
  className?: string
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn('flex flex-col items-center justify-center rounded-3xl border border-dashed border-white/10 px-6 py-14 text-center', className)}
    >
      {icon && <div className="mb-4 text-5xl">{icon}</div>}
      <h3 className="text-lg font-semibold">{title}</h3>
      {description && <p className="mt-2 max-w-sm text-sm text-muted">{description}</p>}
      {action && <div className="mt-6">{action}</div>}
    </motion.div>
  )
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <EmptyState
      icon={<AlertTriangle className="mx-auto h-10 w-10 text-flare" />}
      title="Couldn't load this"
      description={errorMessage(error)}
      action={onRetry && <Button variant="secondary" onClick={onRetry}>Try again</Button>}
    />
  )
}

/**
 * Why a single resource (a player, an alert, a recording…) failed to load. 404s and malformed ids
 * (400/422) mean "there's nothing here", 403 means "not yours to see" — retrying won't change either.
 * Everything else (offline, 5xx, rate limits) is worth a retry.
 */
function loadErrorKind(error: unknown): 'not_found' | 'forbidden' | 'retryable' {
  if (!(error instanceof ApiError)) return 'retryable'
  if (error.status === 404 || error.status === 400 || error.status === 422) return 'not_found'
  if (error.status === 403) return 'forbidden'
  return 'retryable'
}

interface StateCopy {
  icon?: React.ReactNode
  title: string
  description?: string
}

/**
 * Error state for a page that loads one resource: friendly not-found / no-access empty states with
 * a way out (no pointless "Try again"), and the regular retryable `ErrorState` otherwise.
 */
export function ResourceErrorState({
  error,
  onRetry,
  notFound,
  forbidden,
  action,
}: {
  error: unknown
  onRetry: () => void
  notFound: StateCopy
  /** defaults to a generic "not available to you" */
  forbidden?: StateCopy
  /** the way out shown on the not-found / forbidden states */
  action: React.ReactNode
}) {
  const kind = loadErrorKind(error)
  if (kind === 'retryable') return <ErrorState error={error} onRetry={onRetry} />
  const copy =
    kind === 'forbidden'
      ? (forbidden ?? { icon: '🔒', title: "This isn't available to you", description: errorMessage(error) })
      : notFound
  return <EmptyState icon={copy.icon} title={copy.title} description={copy.description} action={action} />
}

export function PageHeader({
  title,
  subtitle,
  actions,
  eyebrow,
}: {
  title: React.ReactNode
  subtitle?: React.ReactNode
  actions?: React.ReactNode
  eyebrow?: React.ReactNode
}) {
  return (
    <motion.header
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      className="mb-6 flex flex-wrap items-end justify-between gap-4"
    >
      <div>
        {eyebrow && <div className="mb-2 text-xs font-semibold tracking-[0.2em] text-volt uppercase">{eyebrow}</div>}
        <h1 className="text-2xl font-bold sm:text-3xl">{title}</h1>
        {subtitle && <p className="mt-1.5 text-sm text-muted sm:text-base">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </motion.header>
  )
}

export function Stat({ label, value, hint, className }: { label: string; value: React.ReactNode; hint?: string; className?: string }) {
  return (
    <div className={cn('rounded-2xl bg-white/4 p-4 ring-1 ring-white/8', className)}>
      <div className="text-[11px] font-semibold tracking-wider text-muted uppercase">{label}</div>
      <div className="mt-1 font-display text-2xl font-semibold">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-subtle">{hint}</div>}
    </div>
  )
}
