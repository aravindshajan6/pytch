import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Ban, Pencil, Plus, Receipt, TicketPercent } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { Slider, Switch } from '@/components/ui/Form'
import { Segmented } from '@/components/ui/Segmented'
import { ErrorState, PageHeader } from '@/components/ui/States'
import { cn } from '@/lib/cn'
import { SPORTS, SPORT_LIST } from '@/lib/sports'
import type { CouponInput, CouponOut } from '@/types/admin'
import type { Sport } from '@/types/api'
import { Can, MaskedPhone } from '../components/bits'
import { DataTable, type Column } from '../components/DataTable'
import { Callout, ConfirmDialog } from '../components/Dialogs'
import { Checkbox, ChipToggle, Drawer, Field, Meter, Money, Mono, Panel, SearchInput, Select, StatusChip, TextInput, Toolbar } from '../components/ui'
import { adminApi } from '../lib/api'
import { isApprovalQueued } from '../lib/http'
import { dateShort, dateTime, inr, paiseToRupeesInput, rupeesToPaise } from '../lib/format'
import { useDebounced, useUrlState } from '../lib/hooks'
import { useCan } from '../lib/session'

const PREVIEW_SHARE = 15000 // ₹150 — a typical split share

export default function Coupons() {
  const can = useCan()
  const [f, set] = useUrlState({ q: '', active: 'all' })
  const q = useDebounced(f.q.trim(), 300)
  const [editing, setEditing] = useState<CouponOut | 'new' | null>(null)
  const [disabling, setDisabling] = useState<CouponOut | null>(null)
  const [redemptions, setRedemptions] = useState<CouponOut | null>(null)
  const qc = useQueryClient()

  const list = useQuery({
    queryKey: ['admin', 'coupons', 'list', { q, active: f.active }],
    queryFn: () => adminApi.coupons.list({ q: q || undefined, active: f.active === 'all' ? undefined : f.active === 'active' }),
    placeholderData: keepPreviousData,
  })
  const disable = useMutation({
    mutationFn: (id: string) => adminApi.coupons.disable(id),
    onSuccess: () => {
      toast.success('Coupon disabled — no new redemptions')
      qc.invalidateQueries({ queryKey: ['admin', 'coupons'] })
      setDisabling(null)
    },
  })

  const columns: Column<CouponOut>[] = [
    {
      key: 'code',
      header: 'Code',
      cell: (c) => (
        <div className="min-w-0">
          <Mono className="font-semibold text-volt">{c.code}</Mono>
          <div className="max-w-56 truncate text-xs text-muted">{c.description || describe(c)}</div>
        </div>
      ),
      sortValue: (c) => c.code,
    },
    { key: 'value', header: 'Discount', cell: (c) => <span className="text-sm whitespace-nowrap">{describe(c)}</span>, hideBelow: 'md' },
    {
      key: 'funded',
      header: 'Funded by',
      cell: (c) => (
        <span className="text-xs text-muted capitalize">
          {c.funded_by}
          {c.funded_by === 'shared' && ` · ${c.provider_share_pct}% venue`}
        </span>
      ),
      hideBelow: 'lg',
    },
    {
      key: 'usage',
      header: 'Usage',
      cell: (c) => (
        <div className="w-36">
          <div className="mb-1 flex justify-between text-[11px]">
            <span className="num">{c.used_count.toLocaleString('en-IN')}</span>
            <span className="num text-subtle">{c.usage_limit_total ? `/ ${c.usage_limit_total.toLocaleString('en-IN')}` : 'no cap'}</span>
          </div>
          <Meter
            value={c.usage_limit_total ? c.used_count / c.usage_limit_total : 0}
            tone={c.usage_limit_total && c.used_count / c.usage_limit_total > 0.9 ? 'flare' : c.usage_limit_total && c.used_count / c.usage_limit_total > 0.7 ? 'sun' : 'volt'}
            label="Redemptions used"
          />
        </div>
      ),
      sortValue: (c) => c.used_count,
    },
    { key: 'spend', header: 'Spend', align: 'right', cell: (c) => <Money paise={c.total_discount_paise} />, sortValue: (c) => c.total_discount_paise, hideBelow: 'sm' },
    {
      key: 'window',
      header: 'Valid',
      cell: (c) => (
        <span className="text-xs whitespace-nowrap text-muted">
          {c.starts_at ? dateShort(c.starts_at) : 'now'} → {c.ends_at ? dateShort(c.ends_at) : '∞'}
        </span>
      ),
      hideBelow: 'xl',
    },
    { key: 'status', header: 'Status', cell: (c) => <StatusChip status={couponStatus(c)} /> },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (c) => (
        <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          <IconBtn label="Redemptions" onClick={() => setRedemptions(c)}>
            <Receipt className="h-4 w-4" />
          </IconBtn>
          {can('coupons.manage') && (
            <>
              <IconBtn label="Edit" onClick={() => setEditing(c)}>
                <Pencil className="h-4 w-4" />
              </IconBtn>
              {c.is_active && (
                <IconBtn label="Disable" onClick={() => setDisabling(c)} danger>
                  <Ban className="h-4 w-4" />
                </IconBtn>
              )}
            </>
          )}
        </div>
      ),
    },
  ]

  return (
    <div>
      <PageHeader
        eyebrow="Growth"
        title="Coupons"
        subtitle="Discounts apply to the redeeming player’s own share. Platform-funded coupons never reduce venue payouts."
        actions={
          <Can perm="coupons.manage">
            <Button size="sm" onClick={() => setEditing('new')}>
              <Plus className="h-4 w-4" /> New coupon
            </Button>
          </Can>
        }
      />
      <Toolbar>
        <SearchInput value={f.q} onChange={(v) => set({ q: v })} placeholder="Code or description" className="w-full sm:w-72" />
        <Segmented
          value={f.active}
          onChange={(v) => set({ active: v })}
          size="sm"
          options={[
            { value: 'all', label: 'All' },
            { value: 'active', label: 'Active' },
            { value: 'inactive', label: 'Disabled' },
          ]}
        />
      </Toolbar>
      <Panel flush>
        {list.isError ? (
          <div className="p-5">
            <ErrorState error={list.error} onRetry={() => list.refetch()} />
          </div>
        ) : (
          <DataTable
            rows={list.data}
            columns={columns}
            rowKey={(c) => c.id}
            loading={list.isLoading}
            dim={list.isPlaceholderData}
            onRowClick={(c) => setRedemptions(c)}
            empty={<span className="inline-flex items-center gap-2"><TicketPercent className="h-4 w-4" /> No coupons yet.</span>}
            caption="Coupons"
          />
        )}
      </Panel>

      {editing && <CouponEditor coupon={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      <RedemptionsDrawer coupon={redemptions} onClose={() => setRedemptions(null)} />
      <ConfirmDialog
        open={!!disabling}
        onClose={() => setDisabling(null)}
        title={`Disable ${disabling?.code ?? ''}?`}
        description="Stops new redemptions immediately. Discounts already applied stay applied."
        confirmLabel="Disable coupon"
        loading={disable.isPending}
        onConfirm={() => disabling && disable.mutate(disabling.id)}
      />
    </div>
  )
}

function IconBtn({ label, onClick, children, danger }: { label: string; onClick: () => void; children: React.ReactNode; danger?: boolean }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className={cn('cursor-pointer rounded-lg p-1.5 text-muted transition hover:bg-white/8 hover:text-fg', danger && 'hover:text-flare')}
    >
      {children}
    </button>
  )
}

function describe(c: Pick<CouponOut, 'discount_type' | 'percent_off' | 'amount_off_paise' | 'max_discount_paise' | 'min_amount_paise'>) {
  const base = c.discount_type === 'percent' ? `${c.percent_off ?? 0}% off` : `${inr(c.amount_off_paise ?? 0)} off`
  const cap = c.discount_type === 'percent' && c.max_discount_paise ? ` (max ${inr(c.max_discount_paise)})` : ''
  const min = c.min_amount_paise ? ` · min ${inr(c.min_amount_paise)}` : ''
  return base + cap + min
}

function couponStatus(c: CouponOut) {
  if (!c.is_active) return 'inactive'
  const now = Date.now()
  if (c.ends_at && Date.parse(c.ends_at) < now) return 'expired'
  if (c.starts_at && Date.parse(c.starts_at) > now) return 'pending'
  if (c.usage_limit_total && c.used_count >= c.usage_limit_total) return 'expired'
  return 'active'
}

// ───────────── editor ─────────────

const toLocalInput = (iso: string | null) => {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function blank(): CouponInput {
  return {
    code: '',
    description: '',
    discount_type: 'percent',
    percent_off: 20,
    amount_off_paise: null,
    max_discount_paise: 5000,
    min_amount_paise: 0,
    starts_at: null,
    ends_at: null,
    usage_limit_total: 500,
    usage_limit_per_user: 1,
    first_booking_only: false,
    sports: [],
    turf_ids: [],
    provider_id: null,
    funded_by: 'platform',
    provider_share_pct: 0,
    is_active: true,
  }
}

function CouponEditor({ coupon, onClose }: { coupon: CouponOut | null; onClose: () => void }) {
  const qc = useQueryClient()
  const can = useCan()
  // venue-funded (provider/shared) coupons are paid from a provider's settlement: only admins who manage providers
  // may set them up (server: providers.manage + step-up, 403 otherwise)
  const canFund = can('providers.manage')
  const fundingLocked = !canFund && !!coupon && coupon.funded_by !== 'platform' // only the description is editable
  const [v, setV] = useState<CouponInput>(() => {
    if (!coupon) return blank()
    const keys = Object.keys(blank()) as (keyof CouponInput)[]
    return Object.fromEntries(keys.map((k) => [k, coupon[k]])) as unknown as CouponInput
  })
  const [venueSearch, setVenueSearch] = useState('')
  const patch = (p: Partial<CouponInput>) => setV((s) => ({ ...s, ...p }))

  const providers = useQuery({ queryKey: ['admin', 'providers', 'list', { status: 'approved' }], queryFn: () => adminApi.providers.list({ status: 'approved' }) })
  const venues = useQuery({ queryKey: ['admin', 'venues', 'list', { all: true }], queryFn: () => adminApi.venues.list({}) })
  const venueRows = useMemo(() => {
    const t = venueSearch.trim().toLowerCase()
    return (venues.data ?? []).filter((x) => (!v.provider_id || x.provider_id === v.provider_id) && (!t || `${x.name} ${x.area}`.toLowerCase().includes(t)))
  }, [venues.data, venueSearch, v.provider_id])

  const errors: Partial<Record<keyof CouponInput, string>> = {}
  if (!/^[A-Za-z0-9_-]{3,24}$/.test(v.code)) errors.code = '3–24 letters, digits, _ or -'
  if (v.discount_type === 'percent' && !(v.percent_off && v.percent_off >= 1 && v.percent_off <= 100)) errors.percent_off = '1–100'
  if (v.discount_type === 'flat' && !(v.amount_off_paise && v.amount_off_paise >= 100)) errors.amount_off_paise = 'At least ₹1'
  if (v.starts_at && v.ends_at && v.ends_at <= v.starts_at) errors.ends_at = 'Must be after the start'
  if (v.funded_by !== 'platform' && !v.provider_id) errors.provider_id = 'Provider-funded coupons must target a provider'
  if (v.funded_by === 'shared' && !(v.provider_share_pct > 0 && v.provider_share_pct < 100)) errors.provider_share_pct = '1–99%'
  if (!canFund && !fundingLocked && v.funded_by !== 'platform') errors.funded_by = 'Only admins who manage providers can set up venue-funded coupons'
  const valid = fundingLocked ? v.description !== coupon?.description : Object.keys(errors).length === 0

  const save = useMutation({
    mutationFn: () => {
      const body: CouponInput = {
        ...v,
        code: v.code.toUpperCase(),
        percent_off: v.discount_type === 'percent' ? v.percent_off : null,
        amount_off_paise: v.discount_type === 'flat' ? v.amount_off_paise : null,
        max_discount_paise: v.discount_type === 'percent' ? v.max_discount_paise : null,
        provider_share_pct: v.funded_by === 'shared' ? v.provider_share_pct : v.funded_by === 'provider' ? 100 : 0,
      }
      if (coupon && fundingLocked) return adminApi.coupons.update(coupon.id, { description: v.description })
      return coupon ? adminApi.coupons.update(coupon.id, body) : adminApi.coupons.create(body)
    },
    onSuccess: (res) => {
      if (!isApprovalQueued(res)) toast.success(coupon ? 'Coupon updated' : 'Coupon created')
      qc.invalidateQueries({ queryKey: ['admin', 'coupons'] })
      onClose()
    },
  })

  // live preview on a ₹150 share
  const eligible = PREVIEW_SHARE >= v.min_amount_paise
  let discount = 0
  if (eligible) {
    discount = v.discount_type === 'percent' ? Math.round((PREVIEW_SHARE * (v.percent_off ?? 0)) / 100) : (v.amount_off_paise ?? 0)
    if (v.discount_type === 'percent' && v.max_discount_paise) discount = Math.min(discount, v.max_discount_paise)
    discount = Math.min(discount, PREVIEW_SHARE)
  }
  const providerPart = v.funded_by === 'provider' ? discount : v.funded_by === 'shared' ? Math.round((discount * v.provider_share_pct) / 100) : 0
  const platformPart = discount - providerPart

  return (
    <Drawer
      open
      onClose={onClose}
      width="max-w-3xl"
      title={coupon ? `Edit ${coupon.code}` : 'New coupon'}
      subtitle="Every change is audited."
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" disabled={!valid} loading={save.isPending} onClick={() => save.mutate()}>
            {coupon ? 'Save changes' : 'Create coupon'}
          </Button>
        </div>
      }
    >
      <div className="grid gap-6 lg:grid-cols-[1fr_15rem]">
        <div className="space-y-5">
          {fundingLocked && (
            <Callout tone="sun" title="Venue-funded coupon">
              This coupon is paid (partly) from {coupon?.funded_by === 'shared' ? 'a venue’s' : 'the venue’s'} settlement — only admins who manage providers can
              change it. You can still edit the description.
            </Callout>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Code" required error={v.code && errors.code}>
              <TextInput value={v.code} onChange={(e) => patch({ code: e.target.value.toUpperCase().replace(/\s/g, '') })} className="font-mono tracking-wider uppercase" maxLength={24} placeholder="MONSOON20" autoFocus={!coupon} disabled={fundingLocked} />
            </Field>
            <Field label="Description">
              <TextInput value={v.description} onChange={(e) => patch({ description: e.target.value })} maxLength={200} placeholder="Shown to players" />
            </Field>
          </div>

          <fieldset disabled={fundingLocked} className="min-w-0 space-y-5 disabled:opacity-60">

          <div>
            <div className="mb-1.5 text-xs font-medium text-muted">Discount</div>
            <Segmented<'percent' | 'flat'>
              value={v.discount_type}
              onChange={(t) => patch({ discount_type: t })}
              size="sm"
              options={[
                { value: 'percent', label: 'Percent' },
                { value: 'flat', label: 'Flat ₹' },
              ]}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            {v.discount_type === 'percent' ? (
              <>
                <Field label="Percent off" error={errors.percent_off}>
                  <TextInput inputMode="numeric" value={v.percent_off ?? ''} onChange={(e) => patch({ percent_off: e.target.value ? Number(e.target.value.replace(/\D/g, '')) : null })} className="num" />
                </Field>
                <Field label="Max discount (₹)" hint="Optional cap">
                  <TextInput inputMode="decimal" value={paiseToRupeesInput(v.max_discount_paise)} onChange={(e) => patch({ max_discount_paise: e.target.value ? rupeesToPaise(e.target.value) : null })} className="num" />
                </Field>
              </>
            ) : (
              <Field label="Amount off (₹)" error={errors.amount_off_paise}>
                <TextInput inputMode="decimal" value={paiseToRupeesInput(v.amount_off_paise)} onChange={(e) => patch({ amount_off_paise: e.target.value ? rupeesToPaise(e.target.value) : null })} className="num" />
              </Field>
            )}
            <Field label="Min share (₹)">
              <TextInput inputMode="decimal" value={paiseToRupeesInput(v.min_amount_paise) || '0'} onChange={(e) => patch({ min_amount_paise: rupeesToPaise(e.target.value || '0') || 0 })} className="num" />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Starts (optional)">
              <TextInput type="datetime-local" value={toLocalInput(v.starts_at)} onChange={(e) => patch({ starts_at: e.target.value ? new Date(e.target.value).toISOString() : null })} />
            </Field>
            <Field label="Ends (optional)" error={errors.ends_at}>
              <TextInput type="datetime-local" value={toLocalInput(v.ends_at)} onChange={(e) => patch({ ends_at: e.target.value ? new Date(e.target.value).toISOString() : null })} />
            </Field>
            <Field label="Total redemptions" hint="Empty = unlimited">
              <TextInput inputMode="numeric" value={v.usage_limit_total ?? ''} onChange={(e) => patch({ usage_limit_total: e.target.value ? Number(e.target.value.replace(/\D/g, '')) : null })} className="num" />
            </Field>
            <Field label="Per player">
              <TextInput inputMode="numeric" value={v.usage_limit_per_user} onChange={(e) => patch({ usage_limit_per_user: Math.max(1, Number(e.target.value.replace(/\D/g, '')) || 1) })} className="num" />
            </Field>
          </div>
          <Checkbox checked={v.first_booking_only} onChange={(b) => patch({ first_booking_only: b })} label="First booking only (verified phone never had a captured booking)" />

          <div className="space-y-3 rounded-2xl bg-white/[0.03] p-4 ring-1 ring-white/8">
            <div className="text-sm font-semibold">Targeting</div>
            <div>
              <div className="mb-1.5 text-xs text-muted">Sports {v.sports.length === 0 && <span className="text-subtle">(all)</span>}</div>
              <div className="flex flex-wrap gap-1.5">
                {SPORT_LIST.map((s) => (
                  <ChipToggle key={s} active={v.sports.includes(s)} onClick={() => patch({ sports: v.sports.includes(s) ? v.sports.filter((x) => x !== s) : [...v.sports, s] })}>
                    {SPORTS[s].emoji} {SPORTS[s].label}
                  </ChipToggle>
                ))}
              </div>
            </div>
            <Field label="Provider" error={errors.provider_id}>
              <Select value={v.provider_id ?? ''} onChange={(e) => patch({ provider_id: e.target.value || null, turf_ids: [] })} className="w-full">
                <option value="">Any provider</option>
                {(providers.data ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
            <div>
              <div className="mb-1.5 text-xs text-muted">
                Venues {v.turf_ids.length === 0 ? <span className="text-subtle">(all{v.provider_id ? ' of this provider' : ''})</span> : <span className="text-fg">({v.turf_ids.length} selected)</span>}
              </div>
              <SearchInput value={venueSearch} onChange={setVenueSearch} placeholder="Filter venues" />
              <div className="mt-2 flex max-h-32 flex-wrap gap-1.5 overflow-y-auto">
                {venueRows.slice(0, 60).map((x) => (
                  <ChipToggle key={x.id} active={v.turf_ids.includes(x.id)} onClick={() => patch({ turf_ids: v.turf_ids.includes(x.id) ? v.turf_ids.filter((t) => t !== x.id) : [...v.turf_ids, x.id] })}>
                    {x.name}
                  </ChipToggle>
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-3 rounded-2xl bg-white/[0.03] p-4 ring-1 ring-white/8">
            <div className="text-sm font-semibold">Who pays for the discount</div>
            <Segmented<CouponInput['funded_by']>
              value={v.funded_by}
              onChange={(fb) => patch({ funded_by: fb, provider_share_pct: fb === 'shared' ? 50 : 0 })}
              size="sm"
              options={
                canFund
                  ? [
                      { value: 'platform', label: 'Pytch' },
                      { value: 'provider', label: 'Venue' },
                      { value: 'shared', label: 'Shared' },
                    ]
                  : fundingLocked
                    ? [{ value: v.funded_by, label: v.funded_by === 'shared' ? 'Shared' : 'Venue' }]
                    : [{ value: 'platform', label: 'Pytch' }]
              }
            />
            {!canFund && !fundingLocked && (
              <p className="text-xs text-subtle">Venue-funded and shared coupons are set up by admins who manage providers (it changes a venue’s payout).</p>
            )}
            {errors.funded_by && <p className="text-xs text-flare">{errors.funded_by}</p>}
            {canFund && v.funded_by !== 'platform' && (
              <p className="text-xs text-subtle">Saving a venue-funded coupon asks for your authenticator code.</p>
            )}
            {v.funded_by === 'shared' && (
              <Field label={`Venue share: ${v.provider_share_pct}% · Pytch ${100 - v.provider_share_pct}%`} error={errors.provider_share_pct}>
                <Slider value={v.provider_share_pct} onChange={(n) => patch({ provider_share_pct: n })} min={1} max={99} />
              </Field>
            )}
            <p className="text-xs text-muted">
              {v.funded_by === 'platform'
                ? 'Pytch absorbs the discount; the venue is paid as if the seat was paid in full.'
                : 'The venue’s share is deducted in its settlement statement as a venue-funded discount.'}
            </p>
          </div>

          <div className="flex items-center justify-between rounded-xl bg-white/4 px-4 py-3 ring-1 ring-white/8">
            <span className="text-sm">Active</span>
            <Switch checked={v.is_active} onChange={(b) => patch({ is_active: b })} label="Active" />
          </div>
          </fieldset>
          {save.isError && <Callout tone="flare">{(save.error as Error).message}</Callout>}
        </div>

        {/* live preview */}
        <aside className="lg:sticky lg:top-0 lg:self-start">
          <div className="rounded-2xl bg-gradient-to-br from-volt/12 to-electric/8 p-4 ring-1 ring-volt/25">
            <div className="text-[11px] font-semibold tracking-wider text-volt uppercase">Live preview</div>
            <div className="mt-1 text-xs text-muted">On a {inr(PREVIEW_SHARE)} player share</div>
            <div className="mt-3 font-mono text-lg font-bold tracking-wider">{v.code || 'CODE'}</div>
            {!eligible ? (
              <p className="mt-3 text-sm text-sun">Not eligible — minimum share is {inr(v.min_amount_paise)}.</p>
            ) : (
              <dl className="mt-3 space-y-1.5 text-sm">
                <Row k="Share" v={inr(PREVIEW_SHARE)} />
                <Row k="Discount" v={`− ${inr(discount)}`} accent />
                <div className="my-2 border-t border-white/10" />
                <Row k="Player pays" v={inr(PREVIEW_SHARE - discount)} strong />
                <div className="pt-2 text-[11px] text-muted">Funded by</div>
                <Row k="Pytch" v={inr(platformPart)} />
                <Row k="Venue" v={inr(providerPart)} />
              </dl>
            )}
            <div className="mt-3 flex flex-wrap gap-1">
              {v.first_booking_only && <Chip size="xs">First booking</Chip>}
              {v.sports.map((s) => (
                <Chip key={s} size="xs">
                  {SPORTS[s as Sport]?.emoji}
                </Chip>
              ))}
              {v.usage_limit_total && <Chip size="xs">{v.usage_limit_total} uses</Chip>}
            </div>
          </div>
        </aside>
      </div>
    </Drawer>
  )
}

function Row({ k, v, strong, accent }: { k: string; v: string; strong?: boolean; accent?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-muted">{k}</dt>
      <dd className={cn('num', strong && 'text-base font-semibold', accent && 'text-volt')}>{v}</dd>
    </div>
  )
}

function RedemptionsDrawer({ coupon, onClose }: { coupon: CouponOut | null; onClose: () => void }) {
  const q = useQuery({ queryKey: ['admin', 'coupons', 'redemptions', coupon?.id], queryFn: () => adminApi.coupons.redemptions(coupon!.id), enabled: !!coupon })
  return (
    <Drawer open={!!coupon} onClose={onClose} title={coupon ? `${coupon.code} · redemptions` : ''} subtitle={coupon ? `${coupon.used_count} used · ${inr(coupon.total_discount_paise)} discounted` : undefined}>
      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <DataTable
          rows={q.data}
          loading={q.isLoading}
          rowKey={(r) => r.id}
          maxHeight=""
          empty="No redemptions yet."
          columns={[
            {
              key: 'u',
              header: 'Player',
              cell: (r) => (
                <div>
                  <div className="text-sm">{r.user_name}</div>
                  <MaskedPhone phone={r.user_phone} className="text-xs text-muted" />
                </div>
              ),
            },
            { key: 'd', header: 'Discount', align: 'right', cell: (r) => <Money paise={r.discount_paise} /> },
            { key: 's', header: 'Status', cell: (r) => <StatusChip status={r.status} /> },
            { key: 'w', header: 'When', cell: (r) => <span className="text-xs text-muted">{dateTime(r.created_at)}</span>, hideBelow: 'sm' },
          ]}
        />
      )}
    </Drawer>
  )
}
