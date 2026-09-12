import { useQuery } from '@tanstack/react-query'
import { ArrowLeftRight, Check, ClipboardCheck, FileSearch, LogOut, Mail, Phone, PlusCircle, Rocket } from 'lucide-react'
import { motion } from 'motion/react'
import { useState } from 'react'
import { Link } from 'react-router'
import { Logo } from '@/components/layout/Logo'
import { Button } from '@/components/ui/Button'
import { Sheet } from '@/components/ui/Sheet'
import { ThemeToggle } from '@/components/ui/ThemeToggle'
import { AuthBackdrop } from '@/features/auth/AuthBackdrop'
import { cn } from '@/lib/cn'
import { formatDateLong, timeAgo } from '@/lib/format'
import { partnerApi } from '../api/endpoints'
import { pk } from '../api/keys'
import { StatusPill } from '../components/kit'
import { ProviderList } from '../components/PartnerShell'
import { useLogout } from '../session'
import { useMembership, usePartnerAuth } from '../stores/partnerAuth'

const SUPPORT_EMAIL = 'partners@pytch.in'

/** Full-screen state for a provider that is pending, rejected or suspended. */
export default function ApplicationStatusPage() {
  const membership = useMembership()
  const multi = usePartnerAuth((s) => s.memberships.length > 1)
  const logout = useLogout()
  const [switching, setSwitching] = useState(false)
  const provider = useQuery({ queryKey: pk.provider, queryFn: partnerApi.provider, refetchInterval: 30_000 })
  const status = provider.data?.status ?? membership?.provider_status ?? 'pending'
  const name = provider.data?.name ?? membership?.provider_name ?? 'Your venue'

  return (
    <div className="relative min-h-dvh">
      <AuthBackdrop />
      <header className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4 sm:px-6">
        <div className="flex items-center gap-2">
          <Logo to="/" />
          <span className="rounded-md bg-volt/12 px-1.5 py-0.5 text-[10px] font-bold tracking-[0.14em] text-volt uppercase ring-1 ring-volt/30">Partner</span>
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle className="h-9 w-9 rounded-lg [&_svg]:h-[18px] [&_svg]:w-[18px]" />
          <button type="button" onClick={logout} aria-label="Log out" className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg text-muted hover:bg-white/8 hover:text-flare">
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 pb-16 sm:px-6">
        <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} className="glass rounded-3xl p-6 shadow-card sm:p-8">
          <div className="flex flex-wrap items-center gap-3">
            <StatusPill status={status === 'pending' ? 'pending' : status} label={status === 'pending' ? 'Under review' : undefined} />
            {provider.data && <span className="text-xs text-muted">Submitted {timeAgo(provider.data.created_at)}</span>}
          </div>
          <h1 className="mt-4 text-2xl leading-tight font-bold sm:text-3xl">
            {status === 'pending' && (
              <>
                We’re reviewing <span className="text-volt">{name}</span>
              </>
            )}
            {status === 'rejected' && <>We couldn’t approve {name} yet</>}
            {status === 'suspended' && <>{name} is paused</>}
          </h1>
          <p className="mt-3 max-w-xl text-muted">
            {status === 'pending' &&
              'Our partner team checks your details, calls you to verify the venue and bank account, then switches your calendar on. Most applications are approved within 2 working days — this page updates by itself.'}
            {status === 'rejected' &&
              'Something in the application didn’t check out. The reason is below — reply to our team or start a fresh application with the corrected details.'}
            {status === 'suspended' &&
              'Bookings and payouts for this venue account are on hold. Your existing Pytch bookings are honoured. Contact our partner team to resolve this.'}
          </p>

          {provider.data?.status_reason && status !== 'pending' && (
            <div className={cn('mt-5 rounded-2xl p-4 text-sm ring-1', status === 'rejected' ? 'bg-flare/8 ring-flare/30' : 'bg-sun/8 ring-sun/30')}>
              <div className="text-xs font-bold tracking-wider text-muted uppercase">Reason from Pytch</div>
              <p className="mt-1">{provider.data.status_reason}</p>
            </div>
          )}

          {status === 'pending' && <Timeline createdAt={provider.data?.created_at} />}

          <div className="mt-8 flex flex-wrap gap-2">
            <a href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(`Partner application: ${name}`)}`} className="inline-flex h-11 items-center gap-2 rounded-xl bg-white/5 px-4 text-sm font-semibold ring-1 ring-white/10 hover:bg-white/10">
              <Mail className="h-4 w-4" /> {SUPPORT_EMAIL}
            </a>
            <a href="tel:+914842000000" className="inline-flex h-11 items-center gap-2 rounded-xl bg-white/5 px-4 text-sm font-semibold ring-1 ring-white/10 hover:bg-white/10">
              <Phone className="h-4 w-4" /> Call partner support
            </a>
            {status === 'rejected' && (
              <Link to="/partner/apply" className="inline-flex h-11 items-center gap-2 rounded-xl bg-volt px-4 text-sm font-semibold text-ink-950">
                <PlusCircle className="h-4 w-4" /> New application
              </Link>
            )}
            {multi && (
              <Button variant="ghost" onClick={() => setSwitching(true)}>
                <ArrowLeftRight className="h-4 w-4" /> Switch venue account
              </Button>
            )}
          </div>
        </motion.div>

        {status === 'pending' && (
          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            {[
              { t: 'Keep your details handy', d: 'GSTIN, PAN and a cancelled cheque speed up the verification call.' },
              { t: 'Photos sell slots', d: 'After approval, add 3–5 bright photos of each pitch under Venues.' },
              { t: 'Sell elsewhere too?', d: 'You’ll be able to import calendars and mirror other apps under Channels.' },
            ].map((c) => (
              <div key={c.t} className="rounded-2xl bg-white/[0.03] p-4 ring-1 ring-white/8">
                <div className="text-sm font-semibold">{c.t}</div>
                <p className="mt-1 text-sm text-muted">{c.d}</p>
              </div>
            ))}
          </div>
        )}
      </main>

      <Sheet open={switching} onClose={() => setSwitching(false)} title="Switch venue account" size="sm">
        <ProviderList onPicked={() => setSwitching(false)} />
      </Sheet>
    </div>
  )
}

function Timeline({ createdAt }: { createdAt?: string }) {
  const steps = [
    { icon: ClipboardCheck, title: 'Application received', text: createdAt ? formatDateLong(createdAt) : 'Just now', state: 'done' as const },
    { icon: FileSearch, title: 'Verification', text: 'Details check + a call with our partner team', state: 'current' as const },
    { icon: Check, title: 'Approved', text: 'Your calendar and payouts switch on', state: 'todo' as const },
    { icon: Rocket, title: 'Go live', text: 'Players in Kochi can book your pitches', state: 'todo' as const },
  ]
  return (
    <ol className="mt-7 space-y-0">
      {steps.map((s, i) => (
        <li key={s.title} className="relative flex gap-4 pb-6 last:pb-0">
          {i < steps.length - 1 && <span className={cn('absolute top-10 left-5 h-[calc(100%-2.5rem)] w-px', s.state === 'done' ? 'bg-volt/60' : 'bg-white/10')} aria-hidden />}
          <span
            className={cn(
              'relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full ring-1',
              s.state === 'done' && 'bg-volt text-ink-950 ring-volt',
              s.state === 'current' && 'bg-electric/12 text-electric ring-electric/50',
              s.state === 'todo' && 'bg-white/4 text-muted ring-white/10',
            )}
          >
            {s.state === 'current' && <span className="absolute inset-0 animate-ping rounded-full ring-2 ring-electric/40" />}
            <s.icon className="h-4 w-4" />
          </span>
          <div className="pt-1.5">
            <div className={cn('text-sm font-semibold', s.state === 'todo' && 'text-muted')}>
              {s.title}
              {s.state === 'current' && <span className="ml-2 text-xs font-medium text-electric">In progress</span>}
            </div>
            <div className="text-sm text-muted">{s.text}</div>
          </div>
        </li>
      ))}
    </ol>
  )
}

