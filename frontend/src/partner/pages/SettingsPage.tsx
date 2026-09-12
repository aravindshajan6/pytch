import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, BadgeCheck, Check, Hourglass, Landmark, Lock, LogOut, Palette, Pencil, ShieldCheck, Store } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import { ErrorState, Skeleton } from '@/components/ui/States'
import { ThemeSelector } from '@/components/ui/ThemeToggle'
import { errorMessage } from '@/lib/api/client'
import { timeAgo } from '@/lib/format'
import type { ProviderOut, ProviderUpdate } from '@/types/partner'
import { partnerApi } from '../api/endpoints'
import { pk } from '../api/keys'
import { ConfirmSheet, Field, KV, PageTitle, Panel, StatusPill, TextInput } from '../components/kit'
import { NameSheet } from '../components/NameSheet'
import { describeApiError } from '../lib/errors'
import { EMAIL_RE, IFSC_RE } from '../lib/validation'
import { ROLE_LABEL, useLogout } from '../session'
import { useCan, useMembership, usePartnerAuth } from '../stores/partnerAuth'

export default function SettingsPage() {
  const provider = useQuery({ queryKey: pk.provider, queryFn: partnerApi.provider })
  const owner = useCan('owner')
  return (
    <div>
      <PageTitle title="Settings" subtitle="Business profile, payout account and how the portal looks." />
      {provider.isError ? (
        <ErrorState error={provider.error} onRetry={() => provider.refetch()} />
      ) : !provider.data ? (
        <div className="grid gap-5 lg:grid-cols-2 [&>*]:min-w-0">
          <Skeleton className="h-96 rounded-3xl" />
          <Skeleton className="h-96 rounded-3xl" />
        </div>
      ) : (
        <div className="grid items-start gap-5 lg:grid-cols-2 [&>*]:min-w-0">
          <ProfileForm key={provider.data.id + provider.data.name} p={provider.data} owner={owner} />
          <div className="space-y-5">
            <BankForm key={provider.data.id + (provider.data.bank_account_last4 ?? '') + (provider.data.pending_bank_change?.requested_at ?? '')} p={provider.data} owner={owner} />
            <Appearance />
            <Account p={provider.data} />
          </div>
        </div>
      )}
    </div>
  )
}

function useSaveProvider(success: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: ProviderUpdate) => partnerApi.updateProvider(body),
    onSuccess: (p) => {
      qc.setQueryData(pk.provider, p)
      qc.invalidateQueries({ queryKey: pk.me })
      toast.success(success)
    },
    onError: (e) => toast.error('Couldn’t save', { description: describeApiError(e, FIELD_LABELS) ?? errorMessage(e) }),
  })
}

const FIELD_LABELS: Record<string, string> = {
  name: 'Business name',
  contact_name: 'Contact person',
  contact_email: 'Email',
  address: 'Address',
  bank_account_name: 'Account holder',
  bank_ifsc: 'IFSC',
  bank_account_last4: 'Last 4 digits',
}

function ProfileForm({ p, owner }: { p: ProviderOut; owner: boolean }) {
  const save = useSaveProvider('Business profile saved')
  const [name, setName] = useState(p.name)
  const [contact, setContact] = useState(p.contact_name)
  const [email, setEmail] = useState(p.contact_email ?? '')
  const [address, setAddress] = useState(p.address ?? '')
  const emailError = email && !EMAIL_RE.test(email) ? 'That email doesn’t look right.' : null
  const dirty = name !== p.name || contact !== p.contact_name || email !== (p.contact_email ?? '') || address !== (p.address ?? '')
  return (
    <Panel
      title={
        <span className="flex items-center gap-2">
          <Store className="h-4 w-4 text-volt" /> Business profile
        </span>
      }
      subtitle={owner ? 'Shown on statements and to Pytch support.' : 'Only the owner can edit these details.'}
    >
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          if (!emailError) save.mutate({ name: name.trim(), contact_name: contact.trim(), contact_email: email.trim() || null, address: address.trim() || null })
        }}
      >
        <Field label="Business name" htmlFor="st-n">
          <TextInput id="st-n" value={name} onChange={(e) => setName(e.target.value)} disabled={!owner} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Contact person" htmlFor="st-c">
            <TextInput id="st-c" value={contact} onChange={(e) => setContact(e.target.value)} disabled={!owner} />
          </Field>
          <Field label="Contact phone" hint="Change via Pytch support">
            <TextInput value={p.contact_phone} disabled className="font-mono" />
          </Field>
        </div>
        <Field label="Email" htmlFor="st-e" error={emailError}>
          <TextInput id="st-e" type="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={!owner} />
        </Field>
        <Field label="Address" htmlFor="st-a">
          <TextInput id="st-a" value={address} onChange={(e) => setAddress(e.target.value)} disabled={!owner} />
        </Field>
        <div className="divide-y divide-white/6 rounded-2xl bg-white/[0.03] px-4 ring-1 ring-white/8">
          <KV k="Legal name" v={p.legal_name ?? '—'} />
          <KV k="GSTIN" v={p.gstin ?? 'Not provided'} mono />
          <KV k="Commission" v={`${(p.commission_bps / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}% on Pytch bookings`} />
          <KV k="Settlement" v={p.settlement_cycle[0]!.toUpperCase() + p.settlement_cycle.slice(1)} />
          <KV k="Status" v={<StatusPill status={p.status} />} />
        </div>
        {owner && (
          <div className="flex justify-end">
            <Button type="submit" disabled={!dirty || !!emailError} loading={save.isPending}>
              <Check className="h-4 w-4" /> Save profile
            </Button>
          </div>
        )}
      </form>
    </Panel>
  )
}

/** A requested payout-account change waiting for Pytch finance (four-eyes) — payouts pause meanwhile. */
function PendingBankChange({ p }: { p: ProviderOut }) {
  const c = p.pending_bank_change
  return (
    <div className="flex gap-3 rounded-2xl bg-sun/8 p-4 ring-1 ring-sun/30" role="status">
      <Hourglass className="mt-0.5 h-5 w-5 shrink-0 text-sun" />
      <div className="min-w-0 text-sm">
        <div className="font-semibold">{c ? 'Change pending review — payouts on hold' : 'Payouts on hold'}</div>
        {c ? (
          <>
            <div className="mt-1 font-mono text-xs break-words text-fg/85">
              {c.account_name ?? 'New account'} · {c.ifsc ?? '—'} · •••• {c.last4 ?? '—'}
            </div>
            <p className="mt-1 text-xs text-muted">
              Requested {timeAgo(c.requested_at)}. A Pytch finance reviewer confirms it (usually within a working day); settlements resume to the new account once approved.
            </p>
          </>
        ) : (
          <p className="mt-1 text-xs text-muted">A payout change is being verified by Pytch finance. Settlements resume once it’s approved.</p>
        )}
      </div>
    </div>
  )
}

function BankForm({ p, owner }: { p: ProviderOut; owner: boolean }) {
  const save = useSaveProvider('Bank details submitted for verification')
  const pending = p.pending_bank_change
  const [editing, setEditing] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [holder, setHolder] = useState(p.bank_account_name ?? '')
  const [ifsc, setIfsc] = useState(p.bank_ifsc ?? '')
  const [last4, setLast4] = useState(p.bank_account_last4 ?? '')
  const errors = {
    holder: holder.trim().length < 2 ? 'Account holder name, as on the passbook.' : null,
    ifsc: !IFSC_RE.test(ifsc) ? 'IFSC is 11 characters, e.g. HDFC0001234.' : null,
    last4: !/^\d{4}$/.test(last4) ? 'Exactly 4 digits.' : null,
  }
  const valid = !errors.holder && !errors.ifsc && !errors.last4
  const [touched, setTouched] = useState(false)

  return (
    <Panel
      title={
        <span className="flex items-center gap-2">
          <Landmark className="h-4 w-4 text-volt" /> Payout account
        </span>
      }
      subtitle="Where your weekly settlements are paid."
      actions={
        owner &&
        !editing && (
          <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
            {pending ? 'Use another account' : p.bank_account_last4 ? 'Change' : 'Add account'}
          </Button>
        )
      }
    >
      {!editing ? (
        <div className="space-y-3">
          {(pending || p.payouts_on_hold) && <PendingBankChange p={p} />}
          {p.bank_account_last4 ? (
            <div className="flex items-center gap-4 rounded-2xl bg-white/[0.03] p-4 ring-1 ring-white/8">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/6">
                <Landmark className="h-5 w-5 text-muted" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold">{p.bank_account_name}</div>
                <div className="font-mono text-xs text-muted">
                  {p.bank_ifsc} · •••• {p.bank_account_last4}
                </div>
                {pending && (
                  <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted">
                    <StatusPill status="paused" label="Being replaced" />
                    Stays on file until the change is approved
                  </div>
                )}
              </div>
              {pending ? null : p.kyc_verified ? (
                <span className="flex shrink-0 items-center gap-1 text-xs font-semibold text-mint">
                  <BadgeCheck className="h-4 w-4" /> Verified
                </span>
              ) : (
                <StatusPill status="pending" label="Verifying" />
              )}
            </div>
          ) : (
            !pending && <p className="rounded-2xl border border-dashed border-white/12 p-5 text-center text-sm text-muted">No payout account yet — add one to receive settlements.</p>
          )}
        </div>
      ) : (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            setTouched(true)
            if (valid) setConfirm(true)
          }}
        >
          <div className="flex gap-2.5 rounded-2xl bg-sun/8 p-3.5 text-sm ring-1 ring-sun/30">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-sun" />
            <p className="text-muted">
              <b className="text-fg">Payouts pause until Pytch verifies the new account.</b> For your security, a Pytch finance reviewer confirms every bank change (usually within a working
              day) before money moves.
            </p>
          </div>
          <Field label="Account holder name" htmlFor="bk-h" error={touched ? errors.holder : null}>
            <TextInput id="bk-h" value={holder} onChange={(e) => setHolder(e.target.value)} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="IFSC" htmlFor="bk-i" error={touched ? errors.ifsc : null}>
              <TextInput id="bk-i" value={ifsc} onChange={(e) => setIfsc(e.target.value.toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 11))} className="font-mono tracking-wider" />
            </Field>
            <Field label="Account no. — last 4" htmlFor="bk-l" error={touched ? errors.last4 : null}>
              <TextInput id="bk-l" inputMode="numeric" value={last4} onChange={(e) => setLast4(e.target.value.replace(/\D/g, '').slice(0, 4))} className="font-mono tracking-[0.3em]" />
            </Field>
          </div>
          <p className="flex items-center gap-1.5 text-xs text-muted">
            <Lock className="h-3.5 w-3.5" /> We only keep the last 4 digits here; the full number is confirmed on a verification call.
          </p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button type="submit">Submit for verification</Button>
          </div>
        </form>
      )}
      <ConfirmSheet
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Change payout account?"
        description={
          pending
            ? 'This replaces the change that’s already waiting for review. Settlements stay on hold until Pytch verifies the new account — you’ll get a notification when payouts resume.'
            : 'Settlements are put on hold until Pytch verifies the new account. You’ll get a notification when payouts resume.'
        }
        confirmLabel="Yes, submit change"
        pending={save.isPending}
        onConfirm={() =>
          save.mutate(
            { bank_account_name: holder.trim(), bank_ifsc: ifsc, bank_account_last4: last4 },
            {
              onSuccess: () => {
                setConfirm(false)
                setEditing(false)
              },
            },
          )
        }
      />
    </Panel>
  )
}

function Appearance() {
  return (
    <Panel
      title={
        <span className="flex items-center gap-2">
          <Palette className="h-4 w-4 text-volt" /> Appearance
        </span>
      }
      subtitle="Light mode reads better on a sunny front desk; dark saves battery at night."
    >
      <ThemeSelector size="md" />
    </Panel>
  )
}

function Account({ p }: { p: ProviderOut }) {
  const user = usePartnerAuth((s) => s.user)
  const m = useMembership()
  const logout = useLogout()
  const [editingName, setEditingName] = useState(false)
  return (
    <Panel
      title={
        <span className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-volt" /> Your login
        </span>
      }
    >
      <div className="divide-y divide-white/6">
        <KV
          k="Name"
          v={
            <button type="button" onClick={() => setEditingName(true)} className="inline-flex cursor-pointer items-center gap-1.5 hover:text-volt">
              {user?.name_is_default ? <span className="text-muted">Add your name</span> : user?.name || '—'}
              <Pencil className="h-3.5 w-3.5 text-muted" aria-label="Edit name" />
            </button>
          }
        />
        <KV k="Phone" v={user?.phone} mono />
        <KV k="Role" v={m ? `${ROLE_LABEL[m.role]} · ${p.name}` : '—'} />
      </div>
      <Button variant="outline" className="mt-4 hover:border-flare/60 hover:text-flare" onClick={logout}>
        <LogOut className="h-4 w-4" /> Log out of the partner portal
      </Button>
      <NameSheet open={editingName} onClose={() => setEditingName(false)} />
    </Panel>
  )
}
