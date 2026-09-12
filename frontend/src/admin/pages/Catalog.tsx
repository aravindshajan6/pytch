import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Pencil, Plus, X } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { Switch } from '@/components/ui/Form'
import { EmptyState, ErrorState, PageHeader, Skeleton } from '@/components/ui/States'
import { cn } from '@/lib/cn'
import type { SportCatalogOut } from '@/types/admin'
import { ConfirmDialog } from '../components/Dialogs'
import { Field, TextInput } from '../components/ui'
import { adminApi } from '../lib/api'

export default function Catalog() {
  const q = useQuery({ queryKey: ['admin', 'catalog', 'sports'], queryFn: adminApi.catalog.sports })
  const [editing, setEditing] = useState<SportCatalogOut | 'new' | null>(null)
  const rows = [...(q.data ?? [])].sort((a, b) => a.sort_order - b.sort_order || a.label.localeCompare(b.label))

  return (
    <div>
      <PageHeader
        eyebrow="Marketplace"
        title="Sports catalog"
        subtitle="Sports and formats offered across the apps (feeds the public /meta). Disabling hides a sport from new games."
        actions={
          <Button size="sm" onClick={() => setEditing('new')}>
            <Plus className="h-4 w-4" /> Add sport
          </Button>
        }
      />
      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : q.isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-36" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState title="No sports configured" />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((s) => (
            <article key={s.key} className={cn('glass rounded-2xl p-4 shadow-card transition-opacity', !s.is_active && 'opacity-55')}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/5 text-2xl ring-1 ring-white/10">{s.emoji}</span>
                  <div>
                    <div className="font-semibold">{s.label}</div>
                    <div className="font-mono text-xs text-muted">
                      {s.key} · order {s.sort_order}
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setEditing(s)}
                  aria-label={`Edit ${s.label}`}
                  className="cursor-pointer rounded-lg p-1.5 text-muted hover:bg-white/8 hover:text-fg"
                >
                  <Pencil className="h-4 w-4" />
                </button>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {s.formats.map((f) => (
                  <Chip key={f} size="xs">
                    {f}
                  </Chip>
                ))}
                {!s.is_active && (
                  <Chip tone="flare" size="xs">
                    Disabled
                  </Chip>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
      {editing && <SportEditor sport={editing === 'new' ? null : editing} existing={rows.map((r) => r.key)} onClose={() => setEditing(null)} />}
    </div>
  )
}

function SportEditor({ sport, existing, onClose }: { sport: SportCatalogOut | null; existing: string[]; onClose: () => void }) {
  const qc = useQueryClient()
  const [key, setKey] = useState(sport?.key ?? '')
  const [label, setLabel] = useState(sport?.label ?? '')
  const [emoji, setEmoji] = useState(sport?.emoji ?? '')
  const [formats, setFormats] = useState<string[]>(sport?.formats ?? [])
  const [fmt, setFmt] = useState('')
  const [active, setActive] = useState(sport?.is_active ?? true)
  const [order, setOrder] = useState(String(sport?.sort_order ?? existing.length * 10))
  const keyValid = /^[a-z][a-z0-9_]{1,23}$/.test(key) && (sport || !existing.includes(key))
  const valid = keyValid && label.trim().length > 0 && emoji.trim().length > 0 && formats.length > 0

  const m = useMutation({
    mutationFn: () => adminApi.catalog.put(key, { label: label.trim(), emoji: emoji.trim(), formats, is_active: active, sort_order: Number(order) || 0 }),
    onSuccess: () => {
      toast.success(sport ? 'Sport updated' : 'Sport added')
      qc.invalidateQueries({ queryKey: ['admin', 'catalog'] })
      onClose()
    },
  })
  const addFormat = () => {
    const f = fmt.trim()
    if (f && !formats.includes(f) && formats.length < 12) setFormats([...formats, f])
    setFmt('')
  }

  return (
    <ConfirmDialog
      open
      onClose={onClose}
      title={sport ? `Edit ${sport.label}` : 'Add a sport'}
      tone="primary"
      confirmLabel={sport ? 'Save' : 'Add sport'}
      confirmDisabled={!valid}
      loading={m.isPending}
      onConfirm={() => m.mutate()}
    >
      <div className="grid gap-4 sm:grid-cols-[1fr_6rem]">
        <Field label="Label">
          <TextInput value={label} onChange={(e) => setLabel(e.target.value)} maxLength={40} autoFocus />
        </Field>
        <Field label="Emoji">
          <TextInput value={emoji} onChange={(e) => setEmoji(e.target.value)} maxLength={8} className="text-center text-lg" />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Key" hint={sport ? 'Keys can’t change' : 'lowercase, e.g. futsal'} error={!sport && key && !keyValid ? 'Invalid or already used' : undefined}>
          <TextInput value={key} disabled={!!sport} onChange={(e) => setKey(e.target.value.toLowerCase())} className="font-mono" spellCheck={false} />
        </Field>
        <Field label="Sort order">
          <TextInput inputMode="numeric" value={order} onChange={(e) => setOrder(e.target.value.replace(/\D/g, ''))} className="num" />
        </Field>
      </div>
      <Field label="Formats" hint="Press Enter to add (e.g. 5v5, doubles).">
        <div className="flex flex-wrap items-center gap-1.5 rounded-xl bg-white/5 p-2 ring-1 ring-white/10">
          {formats.map((f) => (
            <span key={f} className="inline-flex h-7 items-center gap-1 rounded-full bg-white/8 pr-1 pl-2.5 text-xs">
              {f}
              <button type="button" onClick={() => setFormats(formats.filter((x) => x !== f))} aria-label={`Remove ${f}`} className="cursor-pointer rounded-full p-0.5 hover:bg-white/10">
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          <input
            value={fmt}
            onChange={(e) => setFmt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ',') {
                e.preventDefault()
                addFormat()
              }
            }}
            onBlur={addFormat}
            maxLength={20}
            className="h-7 min-w-24 flex-1 bg-transparent px-1 text-sm outline-none"
            placeholder="Add format"
          />
        </div>
      </Field>
      <div className="flex items-center justify-between rounded-xl bg-white/4 px-4 py-3 ring-1 ring-white/8">
        <span className="text-sm">Offered in apps</span>
        <Switch checked={active} onChange={setActive} label="Active" />
      </div>
    </ConfirmDialog>
  )
}
