import { useQuery } from '@tanstack/react-query'
import { CalendarDays, Home, Lock, MapPin, ShieldCheck, Sun, Ticket, Video, Zap } from 'lucide-react'
import { motion } from 'motion/react'
import { useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router'
import { Avatar, AvatarStack } from '@/components/ui/Avatar'
import { Button, LinkButton } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { SportBadge } from '@/components/ui/PlayerBits'
import { ProgressBar } from '@/components/ui/ProgressRing'
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States'
import { TurfArt } from '@/components/ui/TurfArt'
import { isApiError } from '@/lib/api/client'
import { api } from '@/lib/api/endpoints'
import { qk } from '@/lib/api/queryKeys'
import { formatINR, formatSlotRange, formatWhen } from '@/lib/format'
import type { LobbyDetail } from '@/types/api'
import { useJoinLobby } from './api'
import { STATUS_META, firstName } from './lib'

export default function JoinByCodePage() {
  const { code = '' } = useParams()
  const upper = code.toUpperCase()
  const q = useQuery({ queryKey: qk.lobbyByCode(upper), queryFn: () => api.lobbies.byCode(upper), enabled: !!upper })

  if (q.isLoading)
    return (
      <div className="mx-auto max-w-lg">
        <Skeleton className="h-[520px] rounded-3xl" />
      </div>
    )
  if (q.isError) {
    if (isApiError(q.error, 'NOT_FOUND')) return <CodeNotFound code={upper} />
    return <ErrorState error={q.error} onRetry={() => q.refetch()} />
  }
  if (!q.data) return null
  if (q.data.my_membership) return <Navigate to={`/app/lobby/${q.data.id}`} replace />
  return <Invite lobby={q.data} />
}

function Invite({ lobby }: { lobby: LobbyDetail }) {
  const navigate = useNavigate()
  const join = useJoinLobby(
    (l) => navigate(`/app/lobby/${l.id}?pay=1`),
    () => navigate(`/app/lobby/${lobby.id}`),
  )
  const open = lobby.status === 'forming' || (lobby.status === 'confirmed' && lobby.spots_left > 0)
  const status = STATUS_META[lobby.status]

  return (
    <div className="mx-auto max-w-lg">
      <motion.div
        initial={{ opacity: 0, y: 30, rotateX: 12 }}
        animate={{ opacity: 1, y: 0, rotateX: 0 }}
        transition={{ type: 'spring', stiffness: 160, damping: 20 }}
        style={{ transformPerspective: 900 }}
        className="glass relative overflow-hidden rounded-3xl shadow-card"
      >
        <TurfArt seed={lobby.turf.id} sport={lobby.sport} src={lobby.turf.cover_url} className="h-44">
          <div className="flex h-full flex-col justify-between p-4">
            <div className="flex items-start justify-between">
              <span className="inline-flex h-7 items-center gap-1.5 rounded-full bg-volt px-3 text-xs font-bold text-ink-950 shadow-glow-volt">
                <Ticket className="h-3.5 w-3.5" /> You're invited
              </span>
              <SportBadge sport={lobby.sport} format={lobby.format} className="bg-ink-900/70 backdrop-blur" />
            </div>
            <div className="flex items-center gap-2">
              <Avatar user={lobby.host} size="md" className="ring-2 ring-ink-900 rounded-full" />
              <div className="text-sm leading-tight">
                <div className="font-semibold">{firstName(lobby.host)}</div>
                <div className="text-xs text-fg/70">invited you to play</div>
              </div>
            </div>
          </div>
        </TurfArt>

        <div className="space-y-5 p-5 sm:p-6">
          <div>
            <div className="flex items-center gap-2">
              <Chip tone={status.tone} size="xs" dot={status.live}>
                {status.label}
              </Chip>
              <span className="font-mono text-xs text-subtle">#{lobby.code}</span>
            </div>
            <h1 className="mt-2 text-2xl font-bold">{lobby.title}</h1>
          </div>

          <ul className="space-y-2.5 text-sm">
            <li className="flex items-center gap-2.5">
              <CalendarDays className="h-4 w-4 text-volt" /> {formatWhen(lobby.start_at)}
              <span className="text-muted">({formatSlotRange(lobby.start_at, lobby.end_at)})</span>
            </li>
            <li className="flex items-center gap-2.5">
              <MapPin className="h-4 w-4 text-volt" />
              <Link to={`/app/turfs/${lobby.turf.slug}`} className="hover:text-volt">
                {lobby.turf.name}
              </Link>
              <span className="text-muted">· {lobby.turf.area}</span>
            </li>
            <li className="flex items-center gap-2.5 text-muted">
              {lobby.pitch.is_indoor ? <Home className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
              {lobby.pitch.name} · {lobby.pitch.is_indoor ? 'Indoor' : 'Outdoor'}
            </li>
          </ul>

          <div className="rounded-2xl bg-white/4 p-4 ring-1 ring-white/8">
            <div className="flex items-center justify-between">
              <AvatarStack users={lobby.members.map((m) => m.user)} max={6} size="sm" total={lobby.filled_spots} />
              <div className="text-right">
                <div className="font-display text-2xl font-bold text-volt">{formatINR(lobby.share_paise)}</div>
                <div className="text-[10px] tracking-wider text-muted uppercase">your share</div>
              </div>
            </div>
            <ProgressBar value={lobby.total_spots ? lobby.filled_spots / lobby.total_spots : 0} className="mt-4" />
            <div className="mt-1.5 flex justify-between text-xs">
              <span className="font-semibold">
                {lobby.spots_left > 0 ? `${lobby.spots_left} spot${lobby.spots_left === 1 ? '' : 's'} left` : 'Full'}
              </span>
              <span className="text-muted">
                {lobby.filled_spots}/{lobby.total_spots} in · {lobby.paid_spots} paid
              </span>
            </div>
          </div>

          <p className="text-xs leading-relaxed text-muted">
            {lobby.mode === 'split'
              ? `Split pay: everyone pays ${formatINR(lobby.share_paise)}. If the squad isn't fully paid in time, every share is refunded to credits automatically.`
              : `The host has already paid for the pitch — your ${formatINR(lobby.share_paise)} reimburses them automatically.`}
          </p>

          {(lobby.min_true_skill != null || lobby.verified_only || lobby.recorded) && (
            <div className="flex flex-wrap gap-1.5">
              {lobby.min_true_skill != null && <Chip tone="grape">True Skill {Math.round(lobby.min_true_skill)}+</Chip>}
              {lobby.verified_only && (
                <Chip tone="volt">
                  <ShieldCheck className="h-3 w-3" /> Verified only
                </Chip>
              )}
              {lobby.recorded && (
                <Chip tone="electric">
                  <Video className="h-3 w-3" /> Recorded match
                </Chip>
              )}
            </div>
          )}

          {!lobby.eligibility.can_join && open && (
            <div className="rounded-2xl bg-flare/8 p-4 ring-1 ring-flare/30">
              <div className="flex items-center gap-2 text-sm font-semibold text-flare">
                <Lock className="h-4 w-4" /> You can't join this one yet
              </div>
              <ul className="mt-1.5 list-inside list-disc space-y-0.5 text-xs text-fg/75">
                {lobby.eligibility.reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </div>
          )}

          {open ? (
            <Button
              block
              size="lg"
              disabled={!lobby.eligibility.can_join}
              loading={join.isPending}
              onClick={() => join.mutate({ id: lobby.id, code: lobby.code })}
            >
              <Zap className="h-5 w-5 fill-current" /> Join · {formatINR(lobby.share_paise)}
            </Button>
          ) : (
            <div className="rounded-2xl bg-white/4 p-4 text-center text-sm text-muted ring-1 ring-white/8">
              This match isn't taking players any more.
              <div className="mt-3">
                <LinkButton to="/app/play" size="sm">
                  Find another game
                </LinkButton>
              </div>
            </div>
          )}
        </div>
      </motion.div>
    </div>
  )
}

function CodeNotFound({ code }: { code: string }) {
  const navigate = useNavigate()
  const [value, setValue] = useState('')
  return (
    <EmptyState
      icon="🔎"
      title={`No game with code ${code}`}
      description="Double-check the code with your host — codes are 6 characters."
      action={
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (value.trim()) navigate(`/app/join/${value.trim().toUpperCase()}`)
          }}
        >
          <input
            value={value}
            onChange={(e) => setValue(e.target.value.toUpperCase())}
            maxLength={8}
            placeholder="ABC123"
            aria-label="Lobby code"
            className="h-11 w-36 rounded-xl bg-white/5 px-4 text-center font-mono tracking-[0.3em] ring-1 ring-white/10 outline-none focus:ring-2 focus:ring-volt/70"
          />
          <Button type="submit">Find</Button>
        </form>
      }
    />
  )
}
