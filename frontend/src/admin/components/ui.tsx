/* Admin console primitives — dense, calm, theme-aware. Built on the shared PYTCH UI kit. */
import { Check, ChevronDown, Copy, Search, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { forwardRef, useEffect, useId, useState } from 'react'
import { createPortal } from 'react-dom'
import { toast } from 'sonner'
import { Chip, type ChipProps } from '@/components/ui/Chip'
import { cn } from '@/lib/cn'
import { inr } from '../lib/format'

// ───────────── Layout ─────────────

export function Panel({
  title,
  description,
  actions,
  children,
  className,
  bodyClassName,
  flush,
  id,
}: {
  title?: React.ReactNode
  description?: React.ReactNode
  actions?: React.ReactNode
  children?: React.ReactNode
  className?: string
  bodyClassName?: string
  /** No body padding (tables that run edge to edge). */
  flush?: boolean
  id?: string
}) {
  return (
    <section id={id} className={cn('glass relative min-w-0 rounded-2xl shadow-card', className)}>
      {(title || actions) && (
        <div className="flex flex-wrap items-start justify-between gap-3 px-4 pt-4 sm:px-5">
          <div className="min-w-0">
            {title && <h2 className="font-sans text-sm font-semibold tracking-normal text-fg">{title}</h2>}
            {description && <p className="mt-0.5 text-xs text-muted">{description}</p>}
          </div>
          {actions && <div className="flex max-w-full min-w-0 flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className={cn(flush ? 'pt-3' : 'p-4 sm:p-5', title && !flush && 'pt-3 sm:pt-3', bodyClassName)}>{children}</div>
    </section>
  )
}

export function Toolbar({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('mb-4 flex flex-wrap items-center gap-2', className)}>{children}</div>
}

// ───────────── Form controls ─────────────

export const TextInput = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(
  function TextInput({ className, invalid, ...props }, ref) {
    return (
      <input
        ref={ref}
        className={cn(
          'h-10 w-full min-w-0 rounded-xl bg-white/5 px-3 text-sm text-fg ring-1 ring-white/10 transition outline-none placeholder:text-subtle focus:bg-white/8 focus:ring-2 focus:ring-volt/70 disabled:opacity-50',
          invalid && 'ring-flare/70 focus:ring-flare',
          className,
        )}
        {...props}
      />
    )
  },
)

export const TextArea = forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(function TextArea(
  { className, ...props },
  ref,
) {
  return (
    <textarea
      ref={ref}
      className={cn(
        'min-h-20 w-full resize-y rounded-xl bg-white/5 p-3 text-sm text-fg ring-1 ring-white/10 transition outline-none placeholder:text-subtle focus:ring-2 focus:ring-volt/70',
        className,
      )}
      {...props}
    />
  )
})

export function Select({
  className,
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & { children: React.ReactNode }) {
  return (
    <div className={cn('relative inline-flex min-w-0', className)}>
      <select
        className="h-10 w-full min-w-0 cursor-pointer appearance-none rounded-xl bg-white/5 pr-9 pl-3 text-sm text-fg ring-1 ring-white/10 transition outline-none focus:ring-2 focus:ring-volt/70 disabled:opacity-50 [&>option]:bg-ink-800 [&>option]:text-fg"
        {...props}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 text-muted" />
    </div>
  )
}

export function Field({
  label,
  hint,
  error,
  children,
  className,
  htmlFor,
  required,
}: {
  label: React.ReactNode
  hint?: React.ReactNode
  error?: React.ReactNode
  children: React.ReactNode
  className?: string
  htmlFor?: string
  required?: boolean
}) {
  return (
    <div className={cn('min-w-0', className)}>
      <label htmlFor={htmlFor} className="mb-1.5 block text-xs font-medium text-muted">
        {label}
        {required && <span className="text-flare"> *</span>}
      </label>
      {children}
      {error ? (
        <p className="mt-1 text-xs text-flare" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="mt-1 text-xs text-subtle">{hint}</p>
      ) : null}
    </div>
  )
}

export function SearchInput({
  value,
  onChange,
  placeholder,
  className,
  autoFocus,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  className?: string
  autoFocus?: boolean
}) {
  return (
    <div className={cn('relative min-w-0', className)}>
      <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-subtle" />
      <TextInput
        type="search"
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="pl-9"
        spellCheck={false}
        autoComplete="off"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label="Clear search"
          className="absolute top-1/2 right-2 -translate-y-1/2 cursor-pointer rounded-md p-1 text-subtle hover:text-fg"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  )
}

/** Compact check box with label. */
export function Checkbox({
  checked,
  onChange,
  label,
  disabled,
  className,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: React.ReactNode
  disabled?: boolean
  className?: string
}) {
  const id = useId()
  return (
    <label htmlFor={id} className={cn('inline-flex cursor-pointer items-center gap-2 text-sm select-none', disabled && 'opacity-50', className)}>
      <span className="relative inline-flex">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
          className="peer h-4.5 w-4.5 cursor-pointer appearance-none rounded-md bg-white/6 ring-1 ring-white/20 transition checked:bg-volt checked:ring-volt focus-visible:outline-2 focus-visible:outline-volt"
        />
        <Check className="pointer-events-none absolute inset-0 m-auto h-3.5 w-3.5 text-ink-950 opacity-0 peer-checked:opacity-100" strokeWidth={3} />
      </span>
      {label}
    </label>
  )
}

/** Toggle chips for multi-select (sports, venues…). */
export function ChipToggle({
  active,
  onClick,
  children,
  disabled,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full px-3 text-xs font-medium transition disabled:opacity-40',
        active ? 'bg-volt/15 text-volt ring-1 ring-volt/50' : 'bg-white/5 text-fg/75 ring-1 ring-white/10 hover:bg-white/10',
      )}
    >
      {active && <Check className="h-3 w-3" strokeWidth={3} />}
      {children}
    </button>
  )
}

// ───────────── Data display ─────────────

const STATUS_TONE: Record<string, ChipProps['tone']> = {
  active: 'mint',
  approved: 'mint',
  confirmed: 'mint',
  completed: 'electric',
  paid: 'mint',
  captured: 'mint',
  processed: 'mint',
  applied: 'mint',
  ok: 'mint',
  resolved: 'mint',
  pending: 'sun',
  pending_payment: 'sun',
  forming: 'sun',
  draft: 'sun',
  created: 'sun',
  invited: 'sun',
  held: 'sun',
  open: 'sun',
  suspended: 'flare',
  banned: 'flare',
  rejected: 'flare',
  failed: 'flare',
  cancelled: 'neutral',
  expired: 'neutral',
  refunded: 'grape',
  partially_refunded: 'grape',
  reversed: 'grape',
  removed: 'neutral',
  inactive: 'neutral',
  ignored: 'neutral',
}

export function StatusChip({ status, className }: { status: string | null | undefined; className?: string }) {
  const s = (status ?? 'unknown').toLowerCase()
  return (
    <Chip tone={STATUS_TONE[s] ?? 'neutral'} size="xs" className={cn('capitalize', className)}>
      {s.replace(/_/g, ' ')}
    </Chip>
  )
}

export function Money({ paise, className, compact }: { paise: number | null | undefined; className?: string; compact?: boolean }) {
  return <span className={cn('num', className)}>{inr(paise, compact)}</span>
}

export function Mono({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn('font-mono text-[0.92em]', className)}>{children}</span>
}

/** Definition list for detail views. */
export function KV({ items, className, cols = 2 }: { items: [React.ReactNode, React.ReactNode][]; className?: string; cols?: 1 | 2 | 3 }) {
  return (
    <dl
      className={cn(
        'grid gap-x-6 gap-y-3',
        cols === 1 ? 'grid-cols-1' : cols === 2 ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1 sm:grid-cols-2 xl:grid-cols-3',
        className,
      )}
    >
      {items.map(([k, v], i) => (
        <div key={i} className="min-w-0">
          <dt className="text-[11px] font-medium tracking-wide text-subtle uppercase">{k}</dt>
          <dd className="mt-0.5 text-sm break-words text-fg">{v ?? '—'}</dd>
        </div>
      ))}
    </dl>
  )
}

export function CopyButton({ value, label = 'Copy', className }: { value: string; label?: string; className?: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value)
          setDone(true)
          setTimeout(() => setDone(false), 1500)
        } catch {
          toast.error('Clipboard unavailable — select and copy manually')
        }
      }}
      className={cn(
        'inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg bg-white/5 px-2.5 text-xs font-medium text-fg/80 ring-1 ring-white/10 transition hover:bg-white/10',
        className,
      )}
    >
      {done ? <Check className="h-3.5 w-3.5 text-mint" /> : <Copy className="h-3.5 w-3.5" />}
      {done ? 'Copied' : label}
    </button>
  )
}

/** Horizontal meter; the unfilled track is a lighter step of the same hue. */
export function Meter({ value, tone = 'volt', className, label }: { value: number; tone?: 'volt' | 'sun' | 'flare' | 'electric'; className?: string; label?: string }) {
  const color = { volt: 'var(--color-volt)', sun: 'var(--color-sun)', flare: 'var(--color-flare)', electric: 'var(--color-electric)' }[tone]
  const v = Math.max(0, Math.min(1, value))
  return (
    <div
      className={cn('h-1.5 w-full overflow-hidden rounded-full', className)}
      style={{ background: `color-mix(in srgb, ${color} 16%, transparent)` }}
      role="meter"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(v * 100)}
      aria-label={label}
    >
      <div className="h-full rounded-full transition-[width] duration-700" style={{ width: `${v * 100}%`, background: color }} />
    </div>
  )
}

// ───────────── Tabs ─────────────

export function Tabs<T extends string>({
  value,
  onChange,
  tabs,
  className,
}: {
  value: T
  onChange: (v: T) => void
  tabs: { value: T; label: React.ReactNode; count?: number | null; hidden?: boolean }[]
  className?: string
}) {
  const id = useId()
  return (
    <div role="tablist" className={cn('no-scrollbar flex gap-1 overflow-x-auto border-b border-white/8', className)}>
      {tabs
        .filter((t) => !t.hidden)
        .map((t) => {
          const active = t.value === value
          return (
            <button
              key={t.value}
              role="tab"
              type="button"
              aria-selected={active}
              onClick={() => onChange(t.value)}
              className={cn(
                'relative inline-flex h-10 shrink-0 cursor-pointer items-center gap-2 px-3 text-sm font-medium transition-colors',
                active ? 'text-fg' : 'text-muted hover:text-fg',
              )}
            >
              {t.label}
              {t.count != null && (
                <span className={cn('num rounded-md px-1.5 py-0.5 text-[10px]', active ? 'bg-volt/15 text-volt' : 'bg-white/6 text-muted')}>
                  {t.count}
                </span>
              )}
              {active && <motion.span layoutId={`tab-${id}`} className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-volt" />}
            </button>
          )
        })}
    </div>
  )
}

// ───────────── Drawer (right-side detail panel) ─────────────

export function Drawer({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  width = 'max-w-xl',
}: {
  open: boolean
  onClose: () => void
  title: React.ReactNode
  subtitle?: React.ReactNode
  children: React.ReactNode
  footer?: React.ReactNode
  width?: string
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[900]" role="dialog" aria-modal aria-label={typeof title === 'string' ? title : undefined}>
          <motion.div
            className="absolute inset-0 bg-ink-950/60 backdrop-blur-[2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.aside
            className={cn('glass-strong absolute inset-y-0 right-0 flex w-full flex-col shadow-2xl', width)}
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', stiffness: 380, damping: 40 }}
          >
            <div className="flex items-start justify-between gap-3 border-b border-white/8 px-5 py-4">
              <div className="min-w-0">
                <h2 className="truncate font-sans text-base font-semibold tracking-normal">{title}</h2>
                {subtitle && <div className="mt-0.5 text-xs text-muted">{subtitle}</div>}
              </div>
              <button onClick={onClose} aria-label="Close" className="-mr-1 cursor-pointer rounded-lg p-1.5 text-muted hover:bg-white/8 hover:text-fg">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
            {footer && <div className="border-t border-white/8 px-5 py-3">{footer}</div>}
          </motion.aside>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  )
}

// ───────────── Misc ─────────────

export function Dot({ tone }: { tone: 'ok' | 'warn' | 'bad' | 'off' }) {
  const c = { ok: 'bg-mint', warn: 'bg-sun', bad: 'bg-flare', off: 'bg-subtle' }[tone]
  return <span aria-hidden className={cn('inline-block h-2 w-2 shrink-0 rounded-full', c)} />
}

export function SectionLabel({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('mb-2 text-[11px] font-semibold tracking-[0.14em] text-subtle uppercase', className)}>{children}</div>
}

/** Who/when footer for detail views (maker–checker transparency). */
export function Attribution({ items }: { items: [string, string | null | undefined][] }) {
  const shown = items.filter(([, v]) => v)
  if (!shown.length) return null
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-subtle">
      {shown.map(([k, v]) => (
        <span key={k}>
          {k} <span className="text-muted">{v}</span>
        </span>
      ))}
    </div>
  )
}
