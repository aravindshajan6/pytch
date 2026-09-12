/**
 * Partner-portal building blocks on top of the shared UI kit (src/components/ui/*).
 */
import {
  Ban,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Clock,
  Copy,
  Eye,
  EyeOff,
  Hourglass,
  Loader2,
  RotateCcw,
  XCircle,
  type LucideIcon,
} from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { forwardRef, useId, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Sheet } from '@/components/ui/Sheet'
import { cn } from '@/lib/cn'
import { alpha } from '@/lib/color'
import { copyText } from '../lib/copy'
import { sanitizeRupees } from '../lib/money'
import { sourceMeta } from '../lib/sources'
import { rangePreset, type RangeKey } from '../lib/time'

// ───────────── Layout ─────────────

export function Panel({
  title,
  subtitle,
  actions,
  children,
  className,
  bodyClassName,
  id,
}: {
  title?: React.ReactNode
  subtitle?: React.ReactNode
  actions?: React.ReactNode
  children: React.ReactNode
  className?: string
  bodyClassName?: string
  id?: string
}) {
  return (
    <section id={id} className={cn('glass rounded-3xl shadow-card', className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-start justify-between gap-3 px-5 pt-5 sm:px-6">
          <div className="min-w-0">
            {title && <h2 className="font-display text-base font-semibold tracking-tight">{title}</h2>}
            {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
          </div>
          {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={cn('p-5 sm:p-6', (title || actions) && 'pt-4 sm:pt-4', bodyClassName)}>{children}</div>
    </section>
  )
}

export function PageTitle({
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
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      className="mb-5 flex flex-wrap items-end justify-between gap-3 sm:mb-6"
    >
      <div className="min-w-0">
        {eyebrow && <div className="mb-1.5 text-[11px] font-bold tracking-[0.2em] text-volt uppercase">{eyebrow}</div>}
        <h1 className="text-xl font-bold sm:text-2xl lg:text-3xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </motion.header>
  )
}

// ───────────── Numbers ─────────────

export function KpiTile({
  label,
  value,
  hint,
  icon: Icon,
  accent = 'var(--color-volt)',
  className,
}: {
  label: string
  value: React.ReactNode
  hint?: React.ReactNode
  icon?: LucideIcon
  accent?: string
  className?: string
}) {
  return (
    <div className={cn('relative min-w-0 overflow-hidden rounded-2xl bg-white/4 p-4 ring-1 ring-white/8', className)}>
      <div className="flex items-start justify-between gap-2">
        <span className="min-w-0 pt-0.5 text-[11px] leading-tight font-semibold tracking-wider break-words text-muted uppercase">{label}</span>
        {Icon && (
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg" style={{ background: alpha(accent, 0.12), color: accent }}>
            <Icon className="h-4 w-4" />
          </span>
        )}
      </div>
      <div className="mt-1.5 truncate font-mono text-xl font-semibold tracking-tight sm:text-2xl">{value}</div>
      {hint && <div className="mt-0.5 line-clamp-2 text-xs text-muted">{hint}</div>}
    </div>
  )
}

// ───────────── Badges ─────────────

export function SourceBadge({ source, size = 'sm', className }: { source: string; size?: 'xs' | 'sm'; className?: string }) {
  const s = sourceMeta(source)
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full font-medium whitespace-nowrap text-fg/85',
        size === 'xs' ? 'h-5 px-2 text-[10px]' : 'h-6 px-2.5 text-[11px]',
        className,
      )}
      style={{ background: alpha(s.color, 0.12), boxShadow: `inset 0 0 0 1px ${alpha(s.color, 0.35)}` }}
    >
      <s.icon className={size === 'xs' ? 'h-3 w-3' : 'h-3.5 w-3.5'} style={{ color: s.color }} aria-hidden />
      {s.label}
    </span>
  )
}

type Tone = 'good' | 'warn' | 'bad' | 'info' | 'neutral' | 'volt'

const TONE: Record<Tone, { cls: string; icon: LucideIcon }> = {
  good: { cls: 'bg-mint/12 text-mint ring-mint/30', icon: CheckCircle2 },
  warn: { cls: 'bg-sun/14 text-sun ring-sun/35', icon: Clock },
  bad: { cls: 'bg-flare/14 text-flare ring-flare/35', icon: XCircle },
  info: { cls: 'bg-electric/12 text-electric ring-electric/30', icon: Hourglass },
  neutral: { cls: 'bg-white/6 text-fg/75 ring-white/12', icon: Check },
  volt: { cls: 'bg-volt/12 text-volt ring-volt/30', icon: CheckCircle2 },
}

const STATUS: Record<string, { tone: Tone; label: string; icon?: LucideIcon }> = {
  // bookings / lobbies
  confirmed: { tone: 'good', label: 'Confirmed' },
  completed: { tone: 'neutral', label: 'Completed' },
  cancelled: { tone: 'bad', label: 'Cancelled', icon: Ban },
  expired: { tone: 'neutral', label: 'Expired', icon: Clock },
  forming: { tone: 'info', label: 'Forming' },
  pending_payment: { tone: 'warn', label: 'Awaiting payment' },
  active: { tone: 'good', label: 'Active' },
  // payment
  paid: { tone: 'good', label: 'Paid' },
  partially_paid: { tone: 'warn', label: 'Part-paid' },
  pending: { tone: 'warn', label: 'Pending' },
  unpaid: { tone: 'bad', label: 'Unpaid', icon: CircleAlert },
  refunded: { tone: 'neutral', label: 'Refunded', icon: RotateCcw },
  // provider
  approved: { tone: 'good', label: 'Approved' },
  rejected: { tone: 'bad', label: 'Rejected' },
  suspended: { tone: 'bad', label: 'Suspended', icon: Ban },
  // settlements
  draft: { tone: 'info', label: 'Being prepared' },
  failed: { tone: 'bad', label: 'Failed' },
  // feeds / conflicts / team
  ok: { tone: 'good', label: 'Healthy' },
  error: { tone: 'bad', label: 'Failing', icon: CircleAlert },
  open: { tone: 'bad', label: 'Open', icon: CircleAlert },
  resolved: { tone: 'good', label: 'Resolved' },
  ignored: { tone: 'neutral', label: 'Ignored' },
  obsolete: { tone: 'neutral', label: 'Closed automatically', icon: Check },
  conflicted: { tone: 'warn', label: 'Clashed', icon: CircleAlert },
  invited: { tone: 'info', label: 'Invited' },
  removed: { tone: 'neutral', label: 'Removed', icon: Ban },
  revoked: { tone: 'neutral', label: 'Revoked', icon: Ban },
  paused: { tone: 'warn', label: 'Paused' },
}

/** Status chip: colour + icon + text (never colour alone). */
export function StatusPill({ status, label, tone, className }: { status: string; label?: string; tone?: Tone; className?: string }) {
  const def = STATUS[status] ?? { tone: 'neutral' as Tone, label: status.replace(/_/g, ' ') }
  const t = TONE[tone ?? def.tone]
  const Icon = def.icon ?? t.icon
  return (
    <span className={cn('inline-flex h-6 items-center gap-1 rounded-full px-2 text-[11px] font-semibold whitespace-nowrap capitalize ring-1', t.cls, className)}>
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {label ?? def.label}
    </span>
  )
}

// ───────────── Forms ─────────────

export function Field({
  label,
  hint,
  error,
  children,
  className,
  htmlFor,
  optional,
}: {
  label: React.ReactNode
  hint?: React.ReactNode
  error?: string | null
  children: React.ReactNode
  className?: string
  htmlFor?: string
  optional?: boolean
}) {
  return (
    <div className={cn('min-w-0', className)}>
      <label htmlFor={htmlFor} className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold tracking-wide text-muted">
        {label}
        {optional && <span className="font-normal text-muted">(optional)</span>}
      </label>
      {children}
      <AnimatePresence initial={false} mode="wait">
        {error ? (
          <motion.p key="e" role="alert" initial={{ opacity: 0, y: -3 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-1.5 text-xs text-flare">
            {error}
          </motion.p>
        ) : hint ? (
          <motion.p key="h" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="mt-1.5 text-xs text-muted">
            {hint}
          </motion.p>
        ) : null}
      </AnimatePresence>
    </div>
  )
}

export const inputCls =
  'h-11 w-full rounded-xl bg-white/5 px-3.5 text-[15px] text-fg ring-1 ring-white/10 transition outline-none placeholder:text-subtle focus:bg-white/8 focus:ring-2 focus:ring-volt/70 disabled:opacity-60 aria-[invalid=true]:ring-flare/70'

export const TextInput = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function TextInput(
  { className, ...props },
  ref,
) {
  return <input ref={ref} className={cn(inputCls, className)} {...props} />
})

/** ₹ amount: digits and one decimal point (2 places) only — "1.2.3" can't turn into "₹NaN". */
export function MoneyInput({
  id,
  value,
  onChange,
  placeholder,
  invalid,
  className,
}: {
  id?: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  invalid?: boolean
  className?: string
}) {
  return (
    <div className={cn('relative', className)}>
      <span className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 font-mono text-muted" aria-hidden>
        ₹
      </span>
      <TextInput
        id={id}
        inputMode="decimal"
        autoComplete="off"
        value={value}
        placeholder={placeholder || '0'}
        onChange={(e) => onChange(sanitizeRupees(e.target.value))}
        aria-invalid={invalid || undefined}
        className="pl-8 font-mono"
      />
    </div>
  )
}

export function Select({
  value,
  onChange,
  options,
  className,
  id,
  disabled,
  'aria-label': ariaLabel,
}: {
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
  className?: string
  id?: string
  disabled?: boolean
  'aria-label'?: string
}) {
  return (
    <div className={cn('relative min-w-0', className)}>
      <select
        id={id}
        aria-label={ariaLabel}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className={cn(inputCls, 'cursor-pointer appearance-none truncate pr-9')}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value} className="bg-ink-800 text-fg">
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 text-muted" />
    </div>
  )
}

/** Big, thumb-friendly choice chips (single or multi select). */
export function ChoiceChips<T extends string>({
  options,
  value,
  onChange,
  className,
  size = 'md',
}: {
  options: { value: T; label: React.ReactNode; icon?: LucideIcon; color?: string }[]
  value: T | T[]
  onChange: (v: T) => void
  className?: string
  size?: 'sm' | 'md'
}) {
  const selected = (v: T) => (Array.isArray(value) ? value.includes(v) : value === v)
  return (
    <div className={cn('flex flex-wrap gap-2', className)} role="group">
      {options.map((o) => {
        const on = selected(o.value)
        return (
          <motion.button
            key={o.value}
            type="button"
            aria-pressed={on}
            whileTap={{ scale: 0.95 }}
            onClick={() => onChange(o.value)}
            className={cn(
              'inline-flex cursor-pointer items-center gap-1.5 rounded-xl font-medium ring-1 transition-colors',
              size === 'sm' ? 'h-9 px-3 text-xs' : 'h-11 px-3.5 text-sm',
              on ? 'bg-volt/14 text-fg ring-2 ring-volt/80' : 'bg-white/4 text-fg/75 ring-white/10 hover:bg-white/8 hover:text-fg',
            )}
          >
            {o.icon && <o.icon className="h-4 w-4" style={o.color ? { color: o.color } : undefined} aria-hidden />}
            {o.label}
            {on && <Check className="h-3.5 w-3.5 text-volt" aria-hidden />}
          </motion.button>
        )
      })}
    </div>
  )
}

// ───────────── Dialogs ─────────────

export function ConfirmSheet({
  open,
  onClose,
  title,
  description,
  confirmLabel = 'Confirm',
  danger,
  pending,
  onConfirm,
  children,
}: {
  open: boolean
  onClose: () => void
  title: string
  description?: React.ReactNode
  confirmLabel?: string
  danger?: boolean
  pending?: boolean
  onConfirm: () => void
  children?: React.ReactNode
}) {
  return (
    <Sheet open={open} onClose={onClose} title={title} description={description} size="sm">
      {children}
      <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={onClose} disabled={pending}>
          Keep it
        </Button>
        <Button variant={danger ? 'danger' : 'primary'} loading={pending} onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </div>
    </Sheet>
  )
}

// ───────────── Copy / secrets ─────────────

export function CopyField({ value, label, masked, className }: { value: string; label?: string; masked?: boolean; className?: string }) {
  const [shown, setShown] = useState(!masked)
  const [copied, setCopied] = useState(false)
  const id = useId()
  return (
    <div className={cn('min-w-0', className)}>
      {label && (
        <label htmlFor={id} className="mb-1.5 block text-xs font-semibold text-muted">
          {label}
        </label>
      )}
      <div className="flex min-w-0 items-center gap-1 rounded-xl bg-white/5 p-1 ring-1 ring-white/10">
        <input
          id={id}
          readOnly
          value={shown ? value : '•'.repeat(Math.min(32, value.length))}
          onFocus={(e) => e.currentTarget.select()}
          className="h-9 min-w-0 flex-1 bg-transparent px-2.5 font-mono text-[13px] text-fg outline-none"
        />
        {masked && (
          <button
            type="button"
            onClick={() => setShown((s) => !s)}
            aria-label={shown ? 'Hide' : 'Show'}
            className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted transition hover:bg-white/8 hover:text-fg"
          >
            {shown ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        )}
        <button
          type="button"
          onClick={async () => {
            await copyText(value)
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
          }}
          className="flex h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg bg-white/8 px-3 text-xs font-semibold transition hover:bg-white/12"
        >
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span key={copied ? 'y' : 'n'} initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.5, opacity: 0 }}>
              {copied ? <Check className="h-4 w-4 text-mint" /> : <Copy className="h-4 w-4" />}
            </motion.span>
          </AnimatePresence>
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  )
}

/** "Shown once" secret reveal — must be acknowledged before closing. */
export function SecretOnceSheet({
  open,
  onClose,
  title,
  secret,
  description,
  children,
}: {
  open: boolean
  onClose: () => void
  title: string
  secret: string | null
  description: React.ReactNode
  children?: React.ReactNode
}) {
  const [ack, setAck] = useState(false)
  return (
    <Sheet open={open} onClose={() => ack && onClose()} dismissible={ack} title={title} size="md">
      <div className="rounded-2xl bg-sun/10 p-3.5 text-sm text-fg ring-1 ring-sun/35">
        <div className="flex gap-2.5">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-sun" />
          <div>{description}</div>
        </div>
      </div>
      {secret && <CopyField value={secret} className="mt-4" />}
      {children}
      <label className="mt-5 flex cursor-pointer items-center gap-3 text-sm">
        <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="h-5 w-5 accent-[var(--color-volt)]" />
        I’ve copied it somewhere safe
      </label>
      <Button block className="mt-4" disabled={!ack} onClick={onClose}>
        Done
      </Button>
    </Sheet>
  )
}

// ───────────── Lists ─────────────

export function Pagination({ total, limit, offset, onChange }: { total: number; limit: number; offset: number; onChange: (offset: number) => void }) {
  if (total <= limit) return null
  const page = Math.floor(offset / limit) + 1
  const pages = Math.ceil(total / limit)
  const btn = 'flex h-10 w-10 cursor-pointer items-center justify-center rounded-xl bg-white/5 ring-1 ring-white/10 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-35'
  return (
    <nav className="mt-4 flex items-center justify-between gap-3 text-sm" aria-label="Pagination">
      <span className="text-muted">
        <span className="font-mono text-fg">{offset + 1}</span>–<span className="font-mono text-fg">{Math.min(total, offset + limit)}</span> of{' '}
        <span className="font-mono text-fg">{total}</span>
      </span>
      <div className="flex items-center gap-2">
        <button type="button" className={btn} disabled={page <= 1} onClick={() => onChange(Math.max(0, offset - limit))} aria-label="Previous page">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="font-mono text-xs text-muted">
          {page}/{pages}
        </span>
        <button type="button" className={btn} disabled={page >= pages} onClick={() => onChange(offset + limit)} aria-label="Next page">
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </nav>
  )
}

export function RangeControl({
  from,
  to,
  onChange,
  today,
  presets = ['7d', '30d', 'mtd', 'last_month', '90d'],
}: {
  from: string
  to: string
  onChange: (from: string, to: string) => void
  today: string
  presets?: RangeKey[]
}) {
  const LABEL: Record<RangeKey, string> = {
    today: 'Today',
    '7d': '7 days',
    '30d': '30 days',
    '90d': '90 days',
    mtd: 'This month',
    last_month: 'Last month',
    next7: 'Next 7 days',
  }
  const active = presets.find((p) => {
    const [f, t] = rangePreset(p, today)
    return f === from && t === to
  })
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <div className="no-scrollbar -mx-1 flex max-w-full gap-1.5 overflow-x-auto px-1 py-0.5">
        {presets.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => onChange(...rangePreset(p, today))}
            aria-pressed={active === p}
            className={cn(
              'h-9 shrink-0 cursor-pointer rounded-full px-3.5 text-xs font-semibold transition',
              active === p ? 'bg-volt text-ink-950' : 'bg-white/5 text-fg/75 ring-1 ring-white/10 hover:bg-white/10',
            )}
          >
            {LABEL[p]}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-1.5 text-xs text-muted">
        <input
          type="date"
          aria-label="From date"
          value={from}
          max={to}
          onChange={(e) => e.target.value && onChange(e.target.value, to < e.target.value ? e.target.value : to)}
          className={cn(inputCls, 'h-9 w-[9.5rem] px-2.5 font-mono text-xs')}
        />
        <span>→</span>
        <input
          type="date"
          aria-label="To date"
          value={to}
          min={from}
          onChange={(e) => e.target.value && onChange(from > e.target.value ? e.target.value : from, e.target.value)}
          className={cn(inputCls, 'h-9 w-[9.5rem] px-2.5 font-mono text-xs')}
        />
      </div>
    </div>
  )
}

export function InlineSpinner({ className }: { className?: string }) {
  return <Loader2 className={cn('h-4 w-4 animate-spin text-muted', className)} />
}

export function SkeletonRows({ rows = 5, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn('space-y-2.5', className)}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton h-14 rounded-2xl" />
      ))}
    </div>
  )
}

/** Small key/value row used in detail sheets. */
export function KV({ k, v, mono }: { k: React.ReactNode; v: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 text-sm">
      <span className="shrink-0 text-muted">{k}</span>
      <span className={cn('min-w-0 text-right font-medium break-words', mono && 'font-mono')}>{v}</span>
    </div>
  )
}
