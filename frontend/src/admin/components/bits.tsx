import { Eye, EyeOff, Lock } from 'lucide-react'
import { useEffect, useState } from 'react'
import { cn } from '@/lib/cn'
import { formatDistanceToNowStrict } from 'date-fns'
import type { AdminPermission } from '@/types/admin'
import { dateTime, formatPhone, inr, isMaskedPhone, maskPhone } from '../lib/format'
import { useCan } from '../lib/session'

/**
 * Phone numbers are masked by default. Revealing is a deliberate click (keyboard accessible),
 * re-masks itself after 20 s, and the full number is never put in the DOM until revealed.
 */
export function MaskedPhone({ phone, className, full }: { phone: string | null | undefined; className?: string; full?: boolean }) {
  const [shown, setShown] = useState(false)
  useEffect(() => {
    if (!shown) return
    const t = setTimeout(() => setShown(false), 20_000)
    return () => clearTimeout(t)
  }, [shown])
  if (!phone) return <span className="text-subtle">—</span>
  // masked server-side for this role — nothing to reveal
  if (isMaskedPhone(phone)) return <span className={cn('num', className)} title="Masked for your role">{phone}</span>
  if (full) return <span className={cn('num', className)}>{formatPhone(phone)}</span>
  return (
    <span className={cn('inline-flex items-center gap-1', className)}>
      <span className="num">{shown ? formatPhone(phone) : maskPhone(phone)}</span>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          setShown((s) => !s)
        }}
        onKeyDown={(e) => e.stopPropagation()}
        title={shown ? 'Hide number' : 'Reveal full number (only when needed for this case)'}
        aria-label={shown ? 'Hide phone number' : 'Reveal phone number'}
        className="cursor-pointer rounded p-0.5 text-subtle opacity-60 transition hover:text-fg hover:opacity-100 focus-visible:opacity-100"
      >
        {shown ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
      </button>
    </span>
  )
}

/** Relative time with the absolute IST timestamp on hover. */
export function When({ iso, className }: { iso: string | null | undefined; className?: string }) {
  if (!iso) return <span className="text-subtle">—</span>
  return (
    <time dateTime={iso} title={dateTime(iso)} className={cn('whitespace-nowrap', className)}>
      {formatDistanceToNowStrict(new Date(iso), { addSuffix: true })}
    </time>
  )
}

/** Render children only if the operator has the permission (server enforces regardless). */
export function Can({ perm, children, fallback = null }: { perm: AdminPermission | AdminPermission[]; children: React.ReactNode; fallback?: React.ReactNode }) {
  const can = useCan()
  const perms = Array.isArray(perm) ? perm : [perm]
  return <>{perms.every(can) ? children : fallback}</>
}

export function NoAccess({ perm }: { perm?: string }) {
  return (
    <div className="flex min-h-[40vh] flex-col items-center justify-center text-center">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-white/5 ring-1 ring-white/10">
        <Lock className="h-5 w-5 text-muted" />
      </div>
      <h2 className="text-lg font-semibold">Not available for your role</h2>
      <p className="mt-1 max-w-sm text-sm text-muted">
        {perm ? (
          <>
            This area needs the <code className="font-mono text-fg">{perm}</code> permission.
          </>
        ) : (
          'Ask a super admin if you need access.'
        )}
      </p>
    </div>
  )
}

// ───────────── JSON view / diff ─────────────

type Json = null | boolean | number | string | Json[] | { [k: string]: Json }

function fmt(v: unknown, key?: string): string {
  if (v === undefined) return '—'
  if (typeof v === 'number' && key && /_paise$/.test(key)) return `${inr(v)} (${v})`
  if (key && /_bps$/.test(key) && typeof v === 'number') return `${v / 100}% (${v} bps)`
  if (typeof v === 'string') return v
  return JSON.stringify(v)
}

/** Extract a before/after pair from common audit/approval payload shapes. */
function beforeAfter(obj: Record<string, unknown>): { before: Record<string, unknown>; after: Record<string, unknown> } | null {
  const b = (obj.before ?? obj.old ?? obj.from) as unknown
  const a = (obj.after ?? obj.new ?? obj.to) as unknown
  if ((b && typeof b === 'object') || (a && typeof a === 'object')) {
    return { before: (b as Record<string, unknown>) ?? {}, after: (a as Record<string, unknown>) ?? {} }
  }
  // {field: {old, new}} / {field: [old, new]}
  const entries = Object.entries(obj)
  if (
    entries.length &&
    entries.every(
      ([, v]) =>
        (Array.isArray(v) && v.length === 2) ||
        (v && typeof v === 'object' && !Array.isArray(v) && ('old' in (v as object) || 'new' in (v as object) || 'before' in (v as object))),
    )
  ) {
    const before: Record<string, unknown> = {}
    const after: Record<string, unknown> = {}
    for (const [k, v] of entries) {
      if (Array.isArray(v)) {
        before[k] = v[0]
        after[k] = v[1]
      } else {
        const o = v as Record<string, unknown>
        before[k] = o.old ?? o.before
        after[k] = o.new ?? o.after
      }
    }
    return { before, after }
  }
  return null
}

/** Field-level diff (before → after) when the payload has that shape, else a key/value view. */
export function JsonDiff({ value, className }: { value: Record<string, unknown> | null | undefined; className?: string }) {
  if (!value || Object.keys(value).length === 0) return <p className="text-xs text-subtle">No field changes recorded.</p>
  const pair = beforeAfter(value)
  if (!pair) return <JsonTable value={value} className={className} />
  const keys = Array.from(new Set([...Object.keys(pair.before), ...Object.keys(pair.after)]))
  const rest = Object.fromEntries(Object.entries(value).filter(([k]) => !['before', 'after', 'old', 'new', 'from', 'to'].includes(k) && !keys.includes(k)))
  return (
    <div className={cn('space-y-3', className)}>
      <div className="overflow-x-auto rounded-xl ring-1 ring-white/8">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-[10px] tracking-wider text-subtle uppercase">
              <th className="px-3 py-2 font-semibold">Field</th>
              <th className="px-3 py-2 font-semibold">Before</th>
              <th className="px-3 py-2 font-semibold">After</th>
            </tr>
          </thead>
          <tbody>
            {keys.map((k) => {
              const b = fmt(pair.before[k], k)
              const a = fmt(pair.after[k], k)
              const changed = b !== a
              return (
                <tr key={k} className="border-t border-white/6 align-top">
                  <td className="px-3 py-2 font-mono text-muted">{k}</td>
                  <td className={cn('px-3 py-2 font-mono break-all', changed ? 'text-flare line-through decoration-flare/40' : 'text-fg/70')}>{b}</td>
                  <td className={cn('px-3 py-2 font-mono break-all', changed ? 'text-mint' : 'text-fg/70')}>{a}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {Object.keys(rest).length > 0 && <JsonTable value={rest} />}
    </div>
  )
}

export function JsonTable({ value, className }: { value: Record<string, unknown>; className?: string }) {
  return (
    <div className={cn('overflow-x-auto rounded-xl ring-1 ring-white/8', className)}>
      <table className="w-full text-xs">
        <tbody>
          {Object.entries(value).map(([k, v]) => (
            <tr key={k} className="border-t border-white/6 align-top first:border-t-0">
              <td className="w-1/3 px-3 py-2 font-mono text-muted">{k}</td>
              <td className="px-3 py-2 font-mono break-all whitespace-pre-wrap text-fg/85">
                {v && typeof v === 'object' ? JSON.stringify(v as Json, null, 2) : fmt(v, k)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
