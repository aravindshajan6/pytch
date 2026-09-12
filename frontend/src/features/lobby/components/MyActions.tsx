import { Check, Crown, Lock, LogOut, Star, Timer, UserPlus, Zap } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { Button, LinkButton } from '@/components/ui/Button'
import { useCountdown } from '@/hooks/useCountdown'
import { cn } from '@/lib/cn'
import { formatINR } from '@/lib/format'
import type { LobbyDetail } from '@/types/api'

export interface MyActionsProps {
  lobby: LobbyDetail
  owed: number
  joining: boolean
  onJoin: () => void
  onPay: () => void
  onLeave: () => void
  onInvite: () => void
  variant: 'bar' | 'card'
}

/** "My CTA": join / pay / you're in / leave — as a sticky mobile bar or a desktop card. */
export function MyActions({ lobby, owed, joining, onJoin, onPay, onLeave, onInvite, variant }: MyActionsProps) {
  const me = lobby.my_membership
  const isHost = me?.role === 'host'
  const closed = lobby.status === 'expired' || lobby.status === 'cancelled'
  if (closed) return null
  if (lobby.status === 'completed' && !me) return null

  const wrap = cn(
    variant === 'bar'
      ? 'glass-strong flex items-center gap-3 rounded-2xl p-3 pl-4 shadow-[0_20px_50px_-10px_rgb(0_0_0/0.9)] [[data-theme=light]_&]:shadow-[0_18px_40px_-14px_rgb(14_42_26/0.35)]'
      : 'glass flex items-center gap-4 rounded-3xl p-5',
  )

  let state: string
  let body: React.ReactNode

  if (lobby.status === 'completed') {
    state = 'done'
    body = (
      <>
        <Summary top="Full time" main="GG 🤝" />
        <LinkButton to={`/app/rate/${lobby.id}`} size={variant === 'bar' ? 'md' : 'lg'}>
          <Star className="h-4 w-4" /> Rate teammates
        </LinkButton>
      </>
    )
  } else if (!me) {
    if (lobby.eligibility.can_join) {
      state = 'join'
      body = (
        <>
          <Summary
            top={`${lobby.spots_left} spot${lobby.spots_left === 1 ? '' : 's'} left`}
            main={formatINR(lobby.share_paise)}
            hint={lobby.mode === 'full' ? 'reimburses the host' : 'your share'}
          />
          <Button size={variant === 'bar' ? 'md' : 'lg'} loading={joining} onClick={onJoin} className="min-w-32">
            <Zap className="h-4 w-4 fill-current" /> Join match
          </Button>
        </>
      )
    } else {
      state = 'locked'
      body = (
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-flare/12 text-flare ring-1 ring-flare/30">
            <Lock className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <div className="text-sm font-semibold">You can't join this one yet</div>
            <ul className={cn('mt-0.5 text-xs text-muted', variant === 'bar' && 'truncate')}>
              {(lobby.eligibility.reasons.length ? lobby.eligibility.reasons : ['Not eligible for this lobby']).map((r) => (
                <li key={r} className={variant === 'bar' ? 'truncate' : undefined}>
                  {r}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )
    }
  } else if (owed > 0) {
    state = 'pay'
    const hostFull = isHost && lobby.mode === 'full'
    body = (
      <>
        <Summary
          top={hostFull ? 'Secure the pitch' : 'Your share'}
          main={formatINR(owed)}
          hint={!isHost && me.reserved_until ? <SeatTimer until={me.reserved_until} /> : isHost ? 'you host, you pay too' : undefined}
        />
        <div className="flex items-center gap-2">
          {!isHost && variant === 'card' && (
            <Button variant="ghost" size="md" onClick={onLeave} aria-label="Leave lobby">
              <LogOut className="h-4 w-4" />
            </Button>
          )}
          <Button size={variant === 'bar' ? 'md' : 'lg'} onClick={onPay} className="relative min-w-36 overflow-hidden">
            <motion.span
              aria-hidden
              initial={{ x: '-150%' }}
              animate={{ x: '250%' }}
              transition={{ repeat: Infinity, duration: 1.6, ease: 'easeInOut', repeatDelay: 1.4 }}
              className="absolute inset-y-0 left-0 w-1/2 -skew-x-12 bg-gradient-to-r from-transparent via-snow/50 to-transparent"
            />
            <span className="relative">{hostFull ? 'Pay & lock it' : 'Pay my share'}</span>
          </Button>
        </div>
      </>
    )
  } else {
    state = 'in'
    body = (
      <>
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <motion.span
            initial={{ scale: 0, rotate: -90 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ type: 'spring', stiffness: 420, damping: 16 }}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-volt text-ink-950 shadow-glow-volt"
          >
            <Check className="h-5 w-5" strokeWidth={3} />
          </motion.span>
          <div className="min-w-0">
            <div className="font-display text-base font-semibold">You're in ✓</div>
            <div className="truncate text-xs text-muted">
              {isHost ? (
                <span className="inline-flex items-center gap-1">
                  <Crown className="h-3 w-3 text-sun" /> Hosting · paid {formatINR(me.paid_paise)}
                </span>
              ) : (
                `Paid ${formatINR(me.paid_paise)}${lobby.status === 'forming' ? ' · waiting on the squad' : ''}`
              )}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {lobby.spots_left > 0 && (
            <Button variant="secondary" size="sm" onClick={onInvite}>
              <UserPlus className="h-3.5 w-3.5" /> Invite
            </Button>
          )}
          {!isHost && (
            <Button variant="ghost" size="sm" onClick={onLeave} aria-label="Leave match">
              <LogOut className="h-3.5 w-3.5" />
              {lobby.spots_left === 0 && ' Leave'}
            </Button>
          )}
        </div>
      </>
    )
  }

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={state}
        initial={{ opacity: 0, y: variant === 'bar' ? 24 : 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: variant === 'bar' ? 24 : -10 }}
        transition={{ type: 'spring', stiffness: 420, damping: 32 }}
        className={wrap}
      >
        {body}
      </motion.div>
    </AnimatePresence>
  )
}

function Summary({ top, main, hint }: { top: string; main: string; hint?: React.ReactNode }) {
  return (
    <div className="min-w-0 flex-1">
      <div className="truncate text-[11px] font-semibold tracking-wider text-muted uppercase">{top}</div>
      <div className="font-display text-2xl leading-tight font-bold">{main}</div>
      {hint && <div className="truncate text-[11px] text-subtle">{hint}</div>}
    </div>
  )
}

function SeatTimer({ until }: { until: string }) {
  const c = useCountdown(until)
  if (c.expired) return <span className="text-flare">Seat hold expired</span>
  return (
    <span className="inline-flex items-center gap-1 text-sun">
      <Timer className="h-3 w-3" /> Seat held <span className="font-mono tabular-nums">{c.label}</span>
    </span>
  )
}
