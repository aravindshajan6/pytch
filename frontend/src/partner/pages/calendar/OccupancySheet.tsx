import { useMutation } from '@tanstack/react-query'
import { AlertTriangle, CalendarSync, Clock, Pencil, Phone, Trash2, Users } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import { ProgressBar } from '@/components/ui/ProgressRing'
import { Sheet } from '@/components/ui/Sheet'
import { useCountdown } from '@/hooks/useCountdown'
import { errorMessage } from '@/lib/api/client'
import { formatINR } from '@/lib/format'
import type { Pitch } from '@/types/api'
import type { BlockOccupancy, OfflinePaymentMode, PytchOccupancy } from '@/types/partner'
import { partnerApi } from '../../api/endpoints'
import { ChoiceChips, ConfirmSheet, CopyField, Field, KV, MoneyInput, SourceBadge, StatusPill, TextInput } from '../../components/kit'
import { describeApiError } from '../../lib/errors'
import { moneyError, paiseToRupees, rupeesToPaise } from '../../lib/money'
import { PAYMENT_MODES, SOURCES, paymentModeLabel } from '../../lib/sources'
import { dayLabel, hhmmLabel, istDateOf, istTimeOf } from '../../lib/time'
import { toE164 } from '../../lib/validation'
import { isBlock, isPytch, type GridItem } from './model'

export function OccupancySheet({
  item,
  pitch,
  onClose,
  onChanged,
  canManageChannels,
}: {
  item: GridItem | null
  pitch: Pitch | null
  onClose: () => void
  onChanged: () => void
  canManageChannels: boolean
}) {
  const cell = item?.cells[0]
  const occ = cell?.occupancy ?? null
  const when = item ? `${dayLabel(istDateOf(item.start), 'EEE, d MMM')} · ${hhmmLabel(istTimeOf(item.start))} – ${hhmmLabel(istTimeOf(item.end))}` : ''
  const title = isPytch(occ) ? occ.lobby_title : isBlock(occ) ? occ.customer_name || SOURCES[occ.source]?.label || 'Block' : item?.kind === 'held' ? 'Someone is checking out' : 'Booked'
  return (
    <Sheet open={!!item} onClose={onClose} title={title} description={`${pitch?.name ?? ''} · ${when}`} size="md">
      {item && (
        <div>
          {item.conflict && (
            <div className="mb-4 flex gap-2.5 rounded-2xl bg-flare/10 p-3.5 text-sm ring-1 ring-flare/35" role="alert">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-flare" />
              <div>
                <div className="font-semibold">Sync conflict on this slot</div>
                <p className="mt-0.5 text-muted">
                  {isPytch(occ)
                    ? occ.lobby_status === 'forming'
                      ? 'An imported booking overlaps this Pytch game. The game keeps the slot while its players pay — if it expires, the imported booking gets it.'
                      : 'An imported booking overlaps this confirmed Pytch game. The game keeps the slot; decide what happens to the other booking.'
                    : 'An imported booking overlaps this booking. The one logged first keeps the slot; decide what happens to the other.'}
                </p>
                {canManageChannels && (
                  <Link to="/partner/channels#conflicts" className="mt-2 inline-block text-xs font-semibold text-volt">
                    Open the conflict centre →
                  </Link>
                )}
              </div>
            </div>
          )}
          {isPytch(occ) && <PytchDetail occ={occ} item={item} />}
          {isBlock(occ) && <BlockDetail key={occ.block_id} occ={occ} item={item} onClose={onClose} onChanged={onChanged} />}
          {item.kind === 'held' && <HeldDetail until={cell!.held_until} />}
          {!occ && item.kind !== 'held' && <p className="text-sm text-muted">This slot is occupied. Details aren’t available for your role or venue.</p>}
        </div>
      )}
    </Sheet>
  )
}

function PytchDetail({ occ, item }: { occ: PytchOccupancy; item: GridItem }) {
  const pct = occ.total_spots ? occ.paid_spots / occ.total_spots : 0
  const fee = item.cells.reduce((n, c) => n + (c.occupancy?.kind === 'pytch' ? c.occupancy.amount_paise : 0), 0)
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <SourceBadge source="pytch" />
        <StatusPill status={occ.lobby_status} />
      </div>
      <div className="mt-4 rounded-2xl bg-white/4 p-4 ring-1 ring-white/8">
        <div className="flex items-center justify-between text-sm">
          <span className="flex items-center gap-2 text-muted">
            <Users className="h-4 w-4" /> Players paid
          </span>
          <span className="font-mono font-semibold">
            {occ.paid_spots}/{occ.total_spots}
          </span>
        </div>
        <ProgressBar value={pct} className="mt-2.5" tone={pct >= 1 ? 'volt' : 'electric'} />
        {occ.lobby_status === 'forming' && (
          <p className="mt-2 text-xs text-muted">The game is still filling up. If it isn’t fully paid in time, Pytch releases the slot automatically.</p>
        )}
      </div>
      <div className="mt-3 divide-y divide-white/6">
        <KV k="Host" v={occ.host_name} />
        <KV k="Pitch fee" v={formatINR(fee || occ.amount_paise)} mono />
        <KV k="Paid out" v="Via your weekly Pytch settlement" />
      </div>
      <CopyField label="Booking code" value={occ.booking_code} className="mt-3" />
      <p className="mt-4 text-xs text-muted">
        Players manage this booking in the Pytch app. For a cancellation or a no-show, contact Pytch partner support — don’t block over it.
      </p>
    </div>
  )
}

function HeldDetail({ until }: { until: string | null }) {
  const c = useCountdown(until)
  return (
    <div className="flex items-start gap-3 rounded-2xl bg-sun/10 p-4 ring-1 ring-sun/35">
      <Clock className="mt-0.5 h-5 w-5 shrink-0 text-sun" />
      <div className="text-sm">
        <div className="font-semibold">A player is paying for this slot on Pytch</div>
        <p className="mt-1 text-muted">
          It’s held {until && !c.expired ? <>for another <span className="font-mono text-fg">{c.label}</span></> : 'for a few minutes'}. If they don’t finish, it frees up automatically and
          you’ll see it turn green here.
        </p>
      </div>
    </div>
  )
}

/** A block runs past the visible range only if its first cell starts earlier or its last cell ends later. */
function continues(item: GridItem): boolean {
  const first = item.cells[0]?.occupancy
  const last = item.cells[item.cells.length - 1]?.occupancy
  return (isBlock(first) && first.starts_before) || (isBlock(last) && last.ends_after)
}

function BlockDetail({ occ, item, onClose, onChanged }: { occ: BlockOccupancy; item: GridItem; onClose: () => void; onChanged: () => void }) {
  const [editing, setEditing] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [name, setName] = useState(occ.customer_name ?? '')
  const [phone, setPhone] = useState(occ.customer_phone ?? '')
  const [amount, setAmount] = useState(paiseToRupees(occ.amount_paise))
  const [amountError, setAmountError] = useState<string | null>(null)
  const [mode, setMode] = useState<OfflinePaymentMode>(occ.payment_mode ?? 'cash')
  const [notes, setNotes] = useState(occ.notes ?? '')
  const [phoneError, setPhoneError] = useState<string | null>(null)
  const synced = occ.source === 'ical' || occ.source === 'api'
  const s = SOURCES[occ.source]

  const save = useMutation({
    mutationFn: () => {
      const e164 = phone.trim() ? toE164(phone) : null
      if (phone.trim() && !e164) throw new Error('PHONE')
      return partnerApi.blocks.update(occ.block_id, {
        customer_name: name.trim() || null,
        customer_phone: e164,
        amount_paise: rupeesToPaise(amount) ?? 0,
        payment_mode: occ.block_kind === 'booking' ? mode : null,
        notes: notes.trim() || null,
      })
    },
    onSuccess: () => {
      toast.success('Saved')
      setEditing(false)
      onChanged()
    },
    onError: (e) => (e instanceof Error && e.message === 'PHONE' ? setPhoneError('Enter a 10-digit Indian mobile.') : toast.error('Couldn’t save', { description: describeApiError(e) ?? errorMessage(e) })),
  })

  const remove = useMutation({
    mutationFn: () => partnerApi.blocks.remove(occ.block_id),
    onSuccess: () => {
      toast.success(occ.block_kind === 'booking' ? 'Booking cancelled — slot is open again' : 'Block removed — slot is open again')
      setConfirm(false)
      onChanged()
      onClose()
    },
    onError: (e) => toast.error('Couldn’t cancel', { description: errorMessage(e) }),
  })

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <SourceBadge source={occ.source} />
        <StatusPill status={occ.block_kind === 'booking' ? 'confirmed' : 'paused'} label={occ.block_kind === 'booking' ? 'Offline booking' : 'Blocked'} tone={occ.block_kind === 'booking' ? 'good' : 'neutral'} />
        {occ.block_kind === 'booking' && occ.payment_mode && <StatusPill status={occ.payment_mode === 'unpaid' ? 'unpaid' : 'paid'} label={paymentModeLabel(occ.payment_mode)} />}
      </div>

      {synced && (
        <div className="mt-4 flex gap-2.5 rounded-2xl bg-electric/8 p-3.5 text-sm ring-1 ring-electric/25">
          <CalendarSync className="mt-0.5 h-4 w-4 shrink-0 text-electric" />
          <p className="text-muted">
            {occ.source === 'ical'
              ? 'Imported from a calendar feed. Removing it here only lasts until the next sync — cancel it in the source calendar instead.'
              : 'Created by connected software through the Channel API. Changes here may be overwritten by that system.'}
          </p>
        </div>
      )}

      {!editing ? (
        <>
          <div className="mt-3 divide-y divide-white/6">
            {occ.block_kind === 'booking' && <KV k="Customer" v={occ.customer_name || '—'} />}
            {occ.customer_phone && (
              <KV
                k="Phone"
                v={
                  <a href={`tel:${occ.customer_phone}`} className="inline-flex items-center gap-1.5 font-mono text-volt">
                    <Phone className="h-3.5 w-3.5" /> {occ.customer_phone}
                  </a>
                }
              />
            )}
            {occ.block_kind === 'booking' && <KV k="Amount" v={occ.amount_paise ? formatINR(occ.amount_paise) : '—'} mono />}
            {occ.block_kind === 'booking' && <KV k="Payment" v={paymentModeLabel(occ.payment_mode)} />}
            <KV k="Covers" v={`${item.span} slot${item.span === 1 ? '' : 's'}${continues(item) ? ' (continues beyond this view)' : ''}`} />
            {occ.external_ref && <KV k={`${s.label} ref`} v={occ.external_ref} mono />}
            {occ.notes && <KV k="Notes" v={occ.notes} />}
          </div>
          <div className="mt-5 grid grid-cols-2 gap-2">
            <Button variant="secondary" onClick={() => setEditing(true)}>
              <Pencil className="h-4 w-4" /> Edit
            </Button>
            <Button variant="outline" className="hover:border-flare/60 hover:text-flare" onClick={() => setConfirm(true)}>
              <Trash2 className="h-4 w-4" /> {occ.block_kind === 'booking' ? 'Cancel booking' : 'Remove block'}
            </Button>
          </div>
        </>
      ) : (
        <form
          className="mt-4 grid gap-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault()
            const bad = occ.block_kind === 'booking' ? moneyError(amount) : null
            setAmountError(bad)
            if (!bad) save.mutate()
          }}
        >
          {occ.block_kind === 'booking' && (
            <>
              <Field label="Customer name" htmlFor="ob-n">
                <TextInput id="ob-n" value={name} onChange={(e) => setName(e.target.value)} />
              </Field>
              <Field label="Phone" htmlFor="ob-p" error={phoneError} optional>
                <TextInput
                  id="ob-p"
                  type="tel"
                  value={phone}
                  onChange={(e) => {
                    setPhone(e.target.value)
                    setPhoneError(null)
                  }}
                  className="font-mono"
                />
              </Field>
              <Field label="Amount" htmlFor="ob-a" error={amountError}>
                <MoneyInput
                  id="ob-a"
                  value={amount}
                  onChange={(v) => {
                    setAmount(v)
                    setAmountError(null)
                  }}
                  invalid={!!amountError}
                />
              </Field>
              <Field label="Payment" className="sm:col-span-2">
                <ChoiceChips size="sm" options={PAYMENT_MODES.map((p) => ({ value: p.value, label: p.label }))} value={mode} onChange={setMode} />
              </Field>
            </>
          )}
          <Field label="Notes" htmlFor="ob-no" className="sm:col-span-2" optional>
            <TextInput id="ob-no" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
          <div className="mt-1 flex gap-2 sm:col-span-2">
            <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button type="submit" className="flex-1" loading={save.isPending}>
              Save changes
            </Button>
          </div>
        </form>
      )}

      <ConfirmSheet
        open={confirm}
        onClose={() => setConfirm(false)}
        title={occ.block_kind === 'booking' ? 'Cancel this booking?' : 'Remove this block?'}
        description={`${hhmmLabel(istTimeOf(item.start))} – ${hhmmLabel(istTimeOf(item.end))} becomes bookable on Pytch again straight away.`}
        confirmLabel={occ.block_kind === 'booking' ? 'Cancel booking' : 'Remove block'}
        danger
        pending={remove.isPending}
        onConfirm={() => remove.mutate()}
      />
    </div>
  )
}
