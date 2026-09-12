import { Check, Clock, Crown, Plus, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { Avatar } from '@/components/ui/Avatar'
import { useCountdown } from '@/hooks/useCountdown'
import { pop } from '@/lib/celebrate'
import { cn } from '@/lib/cn'
import type { LobbyDetail, LobbyMember, Team } from '@/types/api'
import { firstName } from '../lib'

export interface SeatsGridProps {
  lobby: LobbyDetail
  meId: string | undefined
  isHost: boolean
  onKick: (m: LobbyMember) => void
  onInvite: () => void
}

const ts = (d: string | null) => (d ? new Date(d).getTime() : Infinity)
const sortMembers = (a: LobbyMember, b: LobbyMember) => {
  if (a.status !== b.status) return a.status === 'paid' ? -1 : 1
  if (a.role === 'host' || b.role === 'host') return a.role === 'host' ? -1 : 1
  return a.status === 'paid' ? ts(a.paid_at) - ts(b.paid_at) : ts(a.joined_at) - ts(b.joined_at)
}

const TEAM_META: Record<Team, { label: string; kit: string; text: string; ring: string }> = {
  A: { label: 'Team A', kit: 'bg-volt', text: 'text-volt', ring: 'ring-volt/30' },
  B: { label: 'Team B', kit: 'bg-electric', text: 'text-electric', ring: 'ring-electric/30' },
}

/** Live seats: paid (volt), joined-but-unpaid (amber, with the seat-hold countdown when there is one), open (dashed invite). */
export function SeatsGrid({ lobby, meId, isHost, onKick, onInvite }: SeatsGridProps) {
  const members = [...lobby.members].sort(sortMembers)
  const empty = Math.max(0, lobby.total_spots - members.length)
  const hasTeams = members.some((m) => m.team)
  const closed = lobby.status === 'expired' || lobby.status === 'cancelled'
  const canInvite = !closed && lobby.status !== 'completed'

  const seatProps = { meId, isHost, onKick, lobbyOpen: !closed && lobby.status !== 'completed' }

  return (
    <section className="glass rounded-3xl p-5 sm:p-6" aria-label="Seats">
      <div className="mb-5 flex items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">The squad</h2>
          <p className="text-xs text-muted">
            {lobby.paid_spots} paid · {lobby.filled_spots - lobby.paid_spots} not paid · {lobby.spots_left} open
          </p>
        </div>
        <div className="flex items-center gap-3 text-[11px] text-muted">
          <Dot cls="bg-volt shadow-[0_0_8px_color-mix(in_srgb,_var(--color-volt)_calc(80%*var(--glow-strength)),_transparent)]" label="Paid" />
          <Dot cls="bg-sun" label="Not paid" />
          <Dot cls="border border-dashed border-white/30" label="Open" />
        </div>
      </div>

      {hasTeams ? (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 sm:gap-4">
            {(['A', 'B'] as const).map((t) => {
              const list = members.filter((m) => m.team === t)
              const rated = list.map((m) => m.user.true_skill).filter((v): v is number => v != null)
              const avg = rated.length ? Math.round(rated.reduce((s, v) => s + v, 0) / rated.length) : null
              const meta = TEAM_META[t]
              return (
                <motion.div
                  key={t}
                  layout
                  initial={{ opacity: 0, x: t === 'A' ? -16 : 16 }}
                  animate={{ opacity: 1, x: 0 }}
                  className={cn('rounded-2xl bg-white/[0.03] p-3 ring-1 sm:p-4', meta.ring)}
                >
                  <div className="mb-3 flex items-center justify-between">
                    <span className="flex items-center gap-2 text-sm font-semibold">
                      <span className={cn('h-3 w-3 rounded-sm', meta.kit)} /> {meta.label}
                    </span>
                    <span className={cn('font-mono text-xs', meta.text)}>avg TS {avg ?? '—'}</span>
                  </div>
                  <ul className="grid grid-cols-2 gap-x-2 gap-y-4 sm:grid-cols-3">
                    <AnimatePresence initial>
                      {list.map((m) => (
                        <Seat key={m.user.id} member={m} {...seatProps} />
                      ))}
                    </AnimatePresence>
                  </ul>
                </motion.div>
              )
            })}
          </div>
          {(members.some((m) => !m.team) || empty > 0) && (
            <div>
              <div className="mb-3 text-[11px] font-semibold tracking-wider text-muted uppercase">Unassigned & open</div>
              <ul className="grid grid-cols-4 gap-x-2 gap-y-5 sm:grid-cols-5">
                <AnimatePresence initial>
                  {members
                    .filter((m) => !m.team)
                    .map((m) => (
                      <Seat key={m.user.id} member={m} {...seatProps} />
                    ))}
                  {Array.from({ length: empty }, (_, i) => (
                    <EmptySeat key={`empty-${i}`} index={i} onInvite={onInvite} disabled={!canInvite} />
                  ))}
                </AnimatePresence>
              </ul>
            </div>
          )}
        </div>
      ) : (
        <ul className="grid grid-cols-4 gap-x-2 gap-y-5 sm:grid-cols-5">
          <AnimatePresence initial>
            {members.map((m) => (
              <Seat key={m.user.id} member={m} {...seatProps} />
            ))}
            {Array.from({ length: empty }, (_, i) => (
              <EmptySeat key={`empty-${i}`} index={i} onInvite={onInvite} disabled={!canInvite} />
            ))}
          </AnimatePresence>
        </ul>
      )}
    </section>
  )
}

function Dot({ cls, label }: { cls: string; label: string }) {
  return (
    <span className="hidden items-center gap-1.5 sm:flex">
      <span className={cn('h-2.5 w-2.5 rounded-full', cls)} /> {label}
    </span>
  )
}

const seatMotion = {
  initial: { opacity: 0, scale: 0.4, y: 10 },
  animate: { opacity: 1, scale: 1, y: 0 },
  exit: { opacity: 0, scale: 0.4 },
  transition: { type: 'spring' as const, stiffness: 420, damping: 22 },
}

function Seat({
  member,
  meId,
  isHost,
  onKick,
  lobbyOpen,
}: {
  member: LobbyMember
  meId: string | undefined
  isHost: boolean
  onKick: (m: LobbyMember) => void
  lobbyOpen: boolean
}) {
  const paid = member.status === 'paid'
  const me = member.user.id === meId
  const ref = useRef<HTMLDivElement>(null)
  const prev = useRef(member.status)
  const [burst, setBurst] = useState(0)

  // Someone just paid → spring pop + a little confetti from their seat.
  useEffect(() => {
    if (prev.current !== 'paid' && member.status === 'paid') {
      const r = ref.current?.getBoundingClientRect()
      if (r) pop((r.left + r.width / 2) / window.innerWidth, (r.top + r.height / 2) / window.innerHeight)
      setBurst((b) => b + 1)
    }
    prev.current = member.status
  }, [member.status])

  const canKick = isHost && !paid && member.role !== 'host' && lobbyOpen

  return (
    <motion.li layout {...seatMotion} className="flex min-w-0 flex-col items-center gap-1.5 text-center">
      <motion.div
        ref={ref}
        key={burst}
        animate={burst ? { scale: [1, 1.28, 0.94, 1] } : undefined}
        transition={{ duration: 0.6, ease: 'easeOut' }}
        className="relative"
      >
        <Link
          to={`/app/players/${member.user.id}`}
          aria-label={`${member.user.name}${paid ? ', paid' : ', not paid yet'}`}
          className={cn(
            'block rounded-full ring-[2.5px] ring-offset-[3px] ring-offset-ink-800 transition-shadow',
            paid ? 'shadow-[0_0_22px_-2px_color-mix(in_srgb,_var(--color-volt)_calc(70%*var(--glow-strength)),_transparent)] ring-volt' : 'ring-sun/80',
          )}
        >
          <Avatar user={member.user} size="lg" showVerified={false} />
        </Link>
        {!paid && <span aria-hidden className="pointer-events-none absolute inset-0 animate-pulse rounded-full ring-2 ring-sun/40" />}
        <span
          className={cn(
            'absolute -right-1 -bottom-1 flex h-5 w-5 items-center justify-center rounded-full ring-2 ring-ink-800',
            paid ? 'bg-volt text-ink-950' : 'bg-sun text-ink-950',
          )}
        >
          {paid ? <Check className="h-3 w-3" strokeWidth={3.5} /> : <Clock className="h-3 w-3" strokeWidth={3} />}
        </span>
        {member.role === 'host' && (
          <span title="Host" className="absolute -top-2 left-1/2 -translate-x-1/2 text-sun drop-shadow-[0_0_6px_color-mix(in_srgb,_var(--color-sun)_calc(80%*var(--glow-strength)),_transparent)]">
            <Crown className="h-4 w-4 fill-sun" />
          </span>
        )}
        {member.role === 'sub' && (
          <span className="absolute -top-2 left-1/2 -translate-x-1/2 rounded-full bg-flare px-1.5 text-[9px] font-bold text-snow">SUB</span>
        )}
        {canKick && (
          <button
            type="button"
            onClick={() => onKick(member)}
            aria-label={`Remove ${member.user.name}`}
            className="absolute -top-1 -right-1 flex h-5 w-5 cursor-pointer items-center justify-center rounded-full bg-ink-600 text-muted ring-2 ring-ink-800 transition hover:bg-flare hover:text-snow"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </motion.div>
      <div className="w-full min-w-0">
        <div className={cn('truncate text-xs font-semibold', me && 'text-volt')}>{me ? 'You' : firstName(member.user)}</div>
        {paid ? (
          <div className="font-mono text-[10px] text-muted">TS {member.user.true_skill == null ? '—' : Math.round(member.user.true_skill)}</div>
        ) : (
          <ReserveTimer until={member.reserved_until} />
        )}
      </div>
    </motion.li>
  )
}

/**
 * Unpaid seat: the hold countdown while the server reserves it, otherwise just "Not paid yet" — the API
 * doesn't say whether a checkout is actually in progress, so never claim "Paying…".
 */
function ReserveTimer({ until }: { until: string | null }) {
  const c = useCountdown(until)
  if (!until || c.expired) return <div className="text-[10px] font-semibold text-sun/90">Not paid yet</div>
  return (
    <div className="font-mono text-[10px] font-semibold text-sun tabular-nums" title="Seat held while they pay">
      {c.label}
    </div>
  )
}

function EmptySeat({ index, onInvite, disabled }: { index: number; onInvite: () => void; disabled?: boolean }) {
  return (
    <motion.li layout {...seatMotion} className="flex flex-col items-center gap-1.5">
      <button
        type="button"
        onClick={onInvite}
        disabled={disabled}
        aria-label="Invite a player to this open seat"
        className="group relative flex h-14 w-14 cursor-pointer items-center justify-center rounded-full border-2 border-dashed border-white/15 text-subtle transition hover:border-volt/70 hover:bg-volt/5 hover:text-volt disabled:cursor-default disabled:opacity-40"
      >
        {!disabled && (
          <span
            aria-hidden
            className="absolute inset-0 animate-pulse rounded-full bg-white/[0.03]"
            style={{ animationDelay: `${(index % 5) * 180}ms` }}
          />
        )}
        <Plus className="h-5 w-5 transition-transform group-hover:rotate-90" />
      </button>
      <span className="text-[11px] text-subtle">{disabled ? 'Empty' : 'Invite'}</span>
    </motion.li>
  )
}
