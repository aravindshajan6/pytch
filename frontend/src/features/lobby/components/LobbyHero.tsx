import { CalendarPlus, Check, Clock, ShieldCheck, Undo2, Wallet } from 'lucide-react'
import { motion } from 'motion/react'
import { Button, LinkButton } from '@/components/ui/Button'
import { Countdown } from '@/components/ui/Countdown'
import { ProgressRing } from '@/components/ui/ProgressRing'
import { useCountdown } from '@/hooks/useCountdown'
import { useIsDesktop } from '@/hooks/useMediaQuery'
import { useMeta } from '@/hooks/useMeta'
import { cn } from '@/lib/cn'
import { formatINR, formatWhen } from '@/lib/format'
import type { LobbyDetail } from '@/types/api'
import { downloadIcs } from '../lib'

const URGENT_MS = 5 * 60 * 1000

/** The big state-driven hero at the top of the waiting room. */
export function LobbyHero({ lobby, onDeadline }: { lobby: LobbyDetail; onDeadline: () => void }) {
  if (lobby.status === 'expired' || lobby.status === 'cancelled') return <ClosedHero lobby={lobby} />
  if (lobby.status === 'completed') return <CompletedHero lobby={lobby} />
  if (lobby.status === 'forming' && lobby.mode === 'split') return <SplitHero lobby={lobby} onDeadline={onDeadline} />
  if (lobby.status === 'forming' && lobby.mode === 'full') return <FullPendingHero lobby={lobby} onDeadline={onDeadline} />
  return <ConfirmedHero lobby={lobby} />
}

function Shell({ children, tone = 'volt', pulse }: { children: React.ReactNode; tone?: 'volt' | 'flare' | 'electric' | 'neutral'; pulse?: boolean }) {
  const glow = {
    volt: 'from-volt/15 via-mint/5',
    flare: 'from-flare/20 via-grape/10',
    electric: 'from-electric/15 via-mint/5',
    neutral: 'from-white/5 via-transparent',
  }[tone]
  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1], delay: 0.05 }}
      className={cn(
        'glass relative overflow-hidden rounded-3xl p-6 shadow-card sm:p-8',
        tone === 'flare' && 'border-flare/40',
        pulse && 'shadow-glow-flare',
      )}
    >
      <div aria-hidden className={cn('pointer-events-none absolute inset-0 bg-gradient-to-br to-transparent', glow)} />
      <div aria-hidden className="pitch-grid pointer-events-none absolute inset-0 opacity-40 [mask-image:radial-gradient(ellipse_at_top_right,black,transparent_70%)]" />
      <div className="relative">{children}</div>
    </motion.section>
  )
}

function SplitHero({ lobby, onDeadline }: { lobby: LobbyDetail; onDeadline: () => void }) {
  const c = useCountdown(lobby.pay_deadline)
  const urgent = c.totalMs > 0 && c.totalMs < URGENT_MS
  const desktop = useIsDesktop()
  const unpaid = lobby.total_spots - lobby.paid_spots
  const windowMin = useMeta().data?.split_window_minutes ?? 30

  return (
    <Shell tone={urgent ? 'flare' : 'volt'} pulse={urgent}>
      <div className="flex flex-col items-center gap-6 sm:flex-row sm:gap-10">
        <div className="relative">
          {urgent && <span aria-hidden className="absolute inset-4 animate-pulse-ring rounded-full bg-flare/25" />}
          <ProgressRing
            value={lobby.total_spots ? lobby.paid_spots / lobby.total_spots : 0}
            size={desktop ? 196 : 176}
            stroke={14}
            from={urgent ? 'var(--color-flare)' : 'var(--color-volt)'}
            to={urgent ? 'var(--color-grape)' : 'var(--color-mint)'}
          >
            <div className="font-display text-3xl font-bold">{formatINR(lobby.share_paise)}</div>
            <div className="text-[11px] font-semibold tracking-wider text-muted uppercase">each</div>
            <div className="mt-2 rounded-full bg-white/6 px-2.5 py-0.5 font-mono text-xs">
              <span className={urgent ? 'text-flare' : 'text-volt'}>{lobby.paid_spots}</span>/{lobby.total_spots} paid
            </div>
          </ProgressRing>
        </div>

        <div className="flex-1 text-center sm:text-left">
          <div className={cn('text-xs font-bold tracking-[0.2em] uppercase', urgent ? 'text-flare' : 'text-volt')}>
            {urgent ? 'Last call — window closing' : 'Payment window closes in'}
          </div>
          <Countdown
            to={lobby.pay_deadline}
            onExpire={onDeadline}
            className="mt-1 font-display text-6xl leading-none font-bold sm:text-7xl"
          />
          <p className="mt-4 max-w-md text-sm leading-relaxed text-muted">
            Everyone pays <b className="text-fg">{formatINR(lobby.share_paise)}</b> within {windowMin} min. All {lobby.total_spots} paid →
            match confirmed. If not, every share lands back as Pytch Credits automatically.{' '}
            <span className="text-fg/80">Nobody chases anybody.</span>
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-2 sm:justify-start">
            <span className={cn('inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold', urgent ? 'bg-flare/15 text-flare' : 'bg-sun/12 text-sun')}>
              <Clock className="h-3.5 w-3.5" /> {unpaid} seat{unpaid === 1 ? '' : 's'} still to pay
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/6 px-3 py-1 text-xs text-muted">
              <Undo2 className="h-3.5 w-3.5" /> Auto-refund if it falls through
            </span>
          </div>
        </div>
      </div>
    </Shell>
  )
}

function FullPendingHero({ lobby, onDeadline }: { lobby: LobbyDetail; onDeadline: () => void }) {
  const pending = lobby.booking.status === 'pending_payment'
  return (
    <Shell tone="electric">
      <div className="flex flex-col items-center gap-6 sm:flex-row sm:gap-10">
        <FillRing lobby={lobby} />
        <div className="flex-1 text-center sm:text-left">
          {pending ? (
            <>
              <div className="text-xs font-bold tracking-[0.2em] text-electric uppercase">Host is securing the pitch</div>
              <Countdown to={lobby.booking.expires_at} onExpire={onDeadline} className="mt-1 font-display text-5xl leading-none font-bold sm:text-6xl" />
              <p className="mt-4 max-w-md text-sm text-muted">
                The host pays the full {formatINR(lobby.booking.total_paise)} to lock the slot. Everyone who joins pays {formatINR(lobby.share_paise)} straight back to them.
              </p>
            </>
          ) : (
            <FullCopy lobby={lobby} />
          )}
        </div>
      </div>
    </Shell>
  )
}

function FullCopy({ lobby }: { lobby: LobbyDetail }) {
  return (
    <>
      <div className="flex items-center justify-center gap-2 text-xs font-bold tracking-[0.2em] text-electric uppercase sm:justify-start">
        <ShieldCheck className="h-4 w-4" /> Pitch secured
      </div>
      <h2 className="mt-2 text-2xl font-bold sm:text-3xl">
        Join for <span className="text-gradient-volt">{formatINR(lobby.share_paise)}</span>
      </h2>
      <p className="mt-2 max-w-md text-sm text-muted">
        Host has secured the pitch — join for {formatINR(lobby.share_paise)}, it auto-reimburses the host. No UPI requests, no awkward reminders.
      </p>
    </>
  )
}

function FillRing({ lobby, done }: { lobby: LobbyDetail; done?: boolean }) {
  const desktop = useIsDesktop()
  return (
    <ProgressRing
      value={done ? 1 : lobby.total_spots ? lobby.filled_spots / lobby.total_spots : 0}
      size={desktop ? 180 : 160}
      stroke={12}
      from={done ? 'var(--color-volt)' : 'var(--color-electric)'}
      to="var(--color-mint)"
    >
      {done ? (
        <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 300, damping: 14, delay: 0.2 }}>
          <Check className="h-14 w-14 text-volt" strokeWidth={3} />
        </motion.div>
      ) : (
        <>
          <div className="font-display text-4xl font-bold">
            {lobby.filled_spots}
            <span className="text-xl text-muted">/{lobby.total_spots}</span>
          </div>
          <div className="text-[11px] font-semibold tracking-wider text-muted uppercase">players in</div>
        </>
      )}
    </ProgressRing>
  )
}

function ConfirmedHero({ lobby }: { lobby: LobbyDetail }) {
  const c = useCountdown(lobby.start_at)
  const soon = c.totalMs > 0 && c.totalMs < 48 * 3600 * 1000
  const openSeats = lobby.mode === 'full' && lobby.spots_left > 0
  return (
    <Shell tone="volt">
      <div className="flex flex-col items-center gap-6 sm:flex-row sm:gap-10">
        <FillRing lobby={lobby} done={!openSeats} />
        <div className="flex-1 text-center sm:text-left">
          {openSeats ? (
            <FullCopy lobby={lobby} />
          ) : (
            <>
              <div className="text-xs font-bold tracking-[0.2em] text-volt uppercase">Match on · fully paid</div>
              <h2 className="mt-1 text-4xl font-black tracking-tight sm:text-5xl">
                <span className="text-gradient-volt">MATCH ON</span>
              </h2>
            </>
          )}
          <div className="mt-4">
            <div className="text-[11px] font-semibold tracking-wider text-muted uppercase">{c.expired ? 'Kicked off' : 'Kick-off in'}</div>
            {soon ? (
              <Countdown to={lobby.start_at} className="font-display text-4xl font-bold sm:text-5xl" urgentMs={0} />
            ) : (
              <div className="font-display text-2xl font-semibold">{formatWhen(lobby.start_at)}</div>
            )}
          </div>
          {lobby.my_membership && (
            <Button variant="secondary" size="sm" className="mt-4" onClick={() => downloadIcs(lobby)}>
              <CalendarPlus className="h-4 w-4" /> Add to calendar
            </Button>
          )}
        </div>
      </div>
    </Shell>
  )
}

function CompletedHero({ lobby }: { lobby: LobbyDetail }) {
  return (
    <Shell tone="electric">
      <div className="text-center sm:text-left">
        <div className="text-xs font-bold tracking-[0.2em] text-electric uppercase">Full time</div>
        <h2 className="mt-1 text-4xl font-black sm:text-5xl">GG 🤝</h2>
        <p className="mt-3 max-w-md text-sm text-muted">
          {lobby.my_membership
            ? 'Rate your teammates while it’s fresh — anonymous, and it builds everyone’s True Skill.'
            : 'This match has been played.'}
        </p>
        {lobby.my_membership && (
          <div className="mt-5 flex flex-wrap justify-center gap-2 sm:justify-start">
            <LinkButton to={`/app/rate/${lobby.id}`}>Rate teammates · +XP</LinkButton>
            <LinkButton to={`/app/turfs/${lobby.turf.slug}`} variant="secondary">
              Book a rematch
            </LinkButton>
          </div>
        )}
      </div>
    </Shell>
  )
}

function ClosedHero({ lobby }: { lobby: LobbyDetail }) {
  const expired = lobby.status === 'expired'
  const windowMin = useMeta().data?.split_window_minutes ?? 30
  return (
    <Shell tone="neutral">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
        <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-white/6 text-3xl">{expired ? '⏳' : '🚫'}</div>
        <div className="flex-1">
          <h2 className="text-2xl font-bold">{expired ? 'Time ran out' : 'Match cancelled'}</h2>
          <p className="mt-2 max-w-lg text-sm leading-relaxed text-muted">
            {expired
              ? `Not everyone paid within the ${windowMin}-minute window, so the slot was released. Every share that was paid has already landed back as Pytch Credits — nobody is out of pocket.`
              : 'The host called this one off. Everyone who paid was refunded to Pytch Credits instantly.'}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <LinkButton to="/app/wallet" variant="secondary" size="sm">
              <Wallet className="h-4 w-4" /> View credits
            </LinkButton>
            <LinkButton to={`/app/turfs/${lobby.turf.slug}`} size="sm">
              Book again
            </LinkButton>
            <LinkButton to="/app/play" variant="ghost" size="sm">
              Find another game
            </LinkButton>
          </div>
        </div>
      </div>
    </Shell>
  )
}
