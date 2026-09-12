import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Power, RotateCcw, SlidersHorizontal } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import { Switch } from '@/components/ui/Form'
import { ErrorState, PageHeader, Skeleton } from '@/components/ui/States'
import { cn } from '@/lib/cn'
import type { SettingOut } from '@/types/admin'
import { When } from '../components/bits'
import { Callout, ConfirmDialog } from '../components/Dialogs'
import { Panel, TextInput } from '../components/ui'
import { adminApi } from '../lib/api'
import { inr, paiseToRupeesInput, rupeesToPaise } from '../lib/format'
import { useCan } from '../lib/session'

const KILL_SWITCHES = ['bookings_enabled', 'signups_enabled', 'partner_signups_enabled', 'maintenance_banner']
type Value = SettingOut['value']

const display = (s: SettingOut, v: Value) => {
  if (v === null || v === undefined || v === '') return '—'
  if (s.type === 'bool') return v ? 'On' : 'Off'
  if (s.type === 'money') return inr(Number(v))
  return String(v)
}

export default function Settings() {
  const can = useCan()
  const editable = can('settings.manage')
  const q = useQuery({ queryKey: ['admin', 'settings'], queryFn: adminApi.settings.list })
  const [pending, setPending] = useState<{ s: SettingOut; value: Value } | null>(null)

  const kills = (q.data ?? []).filter((s) => KILL_SWITCHES.includes(s.key))
  const rules = (q.data ?? []).filter((s) => !KILL_SWITCHES.includes(s.key))

  return (
    <div className="space-y-5">
      <PageHeader eyebrow="Platform" title="Settings" subtitle="Live configuration. Every change needs a reason and your authenticator code, and is written to the audit log." />
      {!editable && (
        <Callout tone="electric" title="Read-only">
          Your role can view settings but not change them.
        </Callout>
      )}
      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : q.isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-44" />
          <Skeleton className="h-72" />
        </div>
      ) : (
        <>
          <section aria-labelledby="kill-title" className="rounded-2xl bg-flare/[0.06] p-4 ring-1 ring-flare/25 sm:p-5">
            <div className="mb-4 flex items-center gap-2">
              <Power className="h-4 w-4 text-flare" />
              <h2 id="kill-title" className="font-sans text-sm font-semibold tracking-normal text-flare">
                Kill switches
              </h2>
              <span className="text-xs text-muted">— take effect for every user within seconds</span>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              {kills.map((s) => (
                <KillSwitch key={s.key} s={s} editable={editable} onChange={(value) => setPending({ s, value })} />
              ))}
            </div>
          </section>

          <Panel title={<span className="inline-flex items-center gap-2"><SlidersHorizontal className="h-4 w-4 text-muted" /> Business rules</span>} flush>
            <ul className="divide-y divide-white/6">
              {rules.map((s) => (
                <SettingRow key={s.key} s={s} editable={editable} onSave={(value) => setPending({ s, value })} />
              ))}
            </ul>
          </Panel>
        </>
      )}
      <ChangeDialog pending={pending} onClose={() => setPending(null)} />
    </div>
  )
}

function KillSwitch({ s, editable, onChange }: { s: SettingOut; editable: boolean; onChange: (v: Value) => void }) {
  if (s.type !== 'bool') {
    // maintenance banner (text): empty = no banner
    return (
      <div className="glass rounded-xl p-4 md:col-span-2">
        <SettingEditor key={String(s.value)} s={s} editable={editable} onSave={onChange} compact />
      </div>
    )
  }
  const on = !!s.value
  return (
    <div className={cn('flex items-start justify-between gap-4 rounded-xl p-4 ring-1 transition-colors', on ? 'glass ring-white/8' : 'bg-flare/12 ring-flare/40')}>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium">{s.label}</span>
          <span
            className={cn(
              'rounded-md px-1.5 py-0.5 text-[10px] font-bold tracking-[0.12em] uppercase',
              on ? 'bg-mint/12 text-mint ring-1 ring-mint/30' : 'bg-flare text-snow',
            )}
          >
            {on ? 'Live' : 'Stopped'}
          </span>
        </div>
        <p className="mt-1 text-xs text-muted">{s.description}</p>
        <Meta s={s} />
      </div>
      <Switch checked={on} onChange={(v) => onChange(v)} disabled={!editable} tone={on ? 'volt' : 'flare'} label={`${s.label}: ${on ? 'on' : 'off'}`} />
    </div>
  )
}

function Meta({ s }: { s: SettingOut }) {
  if (!s.updated_by && !s.updated_at) return null
  return (
    <p className="mt-1.5 text-[11px] text-subtle">
      Changed {s.updated_at && <When iso={s.updated_at} />} {s.updated_by && <>by {s.updated_by}</>}
    </p>
  )
}

function SettingRow({ s, editable, onSave }: { s: SettingOut; editable: boolean; onSave: (v: Value) => void }) {
  return (
    <li className="px-4 py-4 sm:px-5">
      {/* remount when the server value changes so local edits reset */}
      <SettingEditor key={String(s.value)} s={s} editable={editable} onSave={onSave} />
    </li>
  )
}

function SettingEditor({ s, editable, onSave, compact }: { s: SettingOut; editable: boolean; onSave: (v: Value) => void; compact?: boolean }) {
  const toText = (v: Value) => (s.type === 'money' ? paiseToRupeesInput(v as number | null) : v == null ? '' : String(v))
  const [text, setText] = useState(toText(s.value))
  const [bool, setBool] = useState(!!s.value)
  const parsed: Value =
    s.type === 'bool' ? bool : s.type === 'int' ? (text === '' ? null : Number(text)) : s.type === 'money' ? (text === '' ? null : rupeesToPaise(text)) : text
  const invalid = (s.type === 'int' || s.type === 'money') && parsed !== null && !Number.isFinite(parsed as number)
  const dirty = parsed !== s.value && !(parsed === '' && s.value == null)
  const isDefault = s.value === s.default

  return (
    <div className={cn('flex flex-col gap-3', !compact && 'lg:flex-row lg:items-center lg:justify-between')}>
      <div className="min-w-0 lg:max-w-xl">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{s.label}</span>
          <code className="font-mono text-[10px] text-subtle">{s.key}</code>
          {!isDefault && <span className="rounded-md bg-sun/12 px-1.5 py-0.5 text-[10px] font-semibold text-sun ring-1 ring-sun/30">Customised</span>}
        </div>
        <p className="mt-0.5 text-xs text-muted">{s.description}</p>
        <p className="mt-0.5 text-[11px] text-subtle">
          Default {display(s, s.default)}
          {(s.updated_by || s.updated_at) && (
            <>
              {' '}
              · changed {s.updated_at && <When iso={s.updated_at} />} {s.updated_by && <>by {s.updated_by}</>}
            </>
          )}
        </p>
      </div>
      <div className="flex items-center gap-2">
        {s.type === 'bool' ? (
          <Switch checked={bool} onChange={setBool} disabled={!editable} label={s.label} />
        ) : (
          <div className="relative">
            {s.type === 'money' && <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted">₹</span>}
            <TextInput
              value={text}
              disabled={!editable}
              onChange={(e) => setText(s.type === 'string' ? e.target.value : e.target.value.replace(s.type === 'money' ? /[^\d.]/g : /[^\d-]/g, ''))}
              inputMode={s.type === 'string' ? 'text' : 'decimal'}
              invalid={invalid}
              className={cn(s.type === 'string' ? 'w-full sm:w-96' : 'num w-36 text-right', s.type === 'money' && 'pl-7')}
              placeholder={s.type === 'string' ? 'Empty = off' : undefined}
              maxLength={s.type === 'string' ? 200 : 12}
              aria-label={s.label}
            />
          </div>
        )}
        {editable && !isDefault && !dirty && (
          <button
            type="button"
            title={`Reset to default (${display(s, s.default)})`}
            aria-label="Reset to default"
            onClick={() => onSave(s.default)}
            className="cursor-pointer rounded-lg p-2 text-muted hover:bg-white/8 hover:text-fg"
          >
            <RotateCcw className="h-4 w-4" />
          </button>
        )}
        {editable && dirty && (
          <>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setText(toText(s.value))
                setBool(!!s.value)
              }}
            >
              Undo
            </Button>
            <Button size="sm" disabled={invalid} onClick={() => onSave(s.type === 'string' ? (text.trim() || null) : parsed)}>
              Save
            </Button>
          </>
        )}
      </div>
    </div>
  )
}

function ChangeDialog({ pending, onClose }: { pending: { s: SettingOut; value: Value } | null; onClose: () => void }) {
  const qc = useQueryClient()
  const m = useMutation({
    mutationFn: ({ reason }: { reason: string }) => adminApi.settings.put(pending!.s.key, pending!.value, reason),
    onSuccess: () => {
      toast.success(`${pending?.s.label} updated`)
      qc.invalidateQueries({ queryKey: ['admin', 'settings'] })
      onClose()
    },
  })
  if (!pending) return <ConfirmDialog open={false} onClose={onClose} title="" onConfirm={() => {}} />
  const { s, value } = pending
  const kill = KILL_SWITCHES.includes(s.key) && s.type === 'bool'
  const stopping = kill && value === false
  return (
    <ConfirmDialog
      open
      onClose={onClose}
      title={stopping ? `Stop: ${s.label}?` : `Change ${s.label}?`}
      description={
        <>
          <span className="num">{display(s, s.value)}</span> → <span className="num font-semibold text-fg">{display(s, value)}</span>
          {stopping && <span className="mt-1 block text-flare">This immediately affects every user of the apps.</span>}
        </>
      }
      tone={stopping ? 'danger' : 'primary'}
      confirmLabel={stopping ? 'Stop now' : 'Apply change'}
      reason
      loading={m.isPending}
      onConfirm={(reason) => m.mutate({ reason })}
    />
  )
}
