import { useMutation, useQueryClient } from '@tanstack/react-query'
import { StickyNote } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useParams, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { LinkButton } from '@/components/ui/Button'
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States'
import { usePayFlow } from '@/features/payments/PaymentSheet'
import { useIsDesktop } from '@/hooks/useMediaQuery'
import { useMe } from '@/hooks/useMe'
import { useMeta } from '@/hooks/useMeta'
import { errorMessage, isApiError } from '@/lib/api/client'
import { api } from '@/lib/api/endpoints'
import { qk } from '@/lib/api/queryKeys'
import { formatINR, formatWhen } from '@/lib/format'
import type { LobbyDetail, LobbyMember, LobbyStatus } from '@/types/api'
import { useJoinLobby, useLobby, useLobbyRealtime } from './api'
import { Banners } from './components/Banners'
import { ChatPanel } from './components/ChatPanel'
import { ConfirmSheet, type ConfirmConfig } from './components/ConfirmSheet'
import { DemoConsole } from './components/DemoConsole'
import { HostTools, SosCard } from './components/HostTools'
import { InvitePanel } from './components/InvitePanel'
import { LobbyHeader } from './components/LobbyHeader'
import { LobbyHero } from './components/LobbyHero'
import { MatchOnOverlay } from './components/MatchOnOverlay'
import { MyActions } from './components/MyActions'
import { SeatsGrid } from './components/SeatsGrid'
import { amountOwed, firstName, remainingToCover } from './lib'

export default function LobbyPage() {
  const { lobbyId } = useParams()
  const lobbyQ = useLobby(lobbyId)

  if (lobbyQ.isLoading) return <LobbySkeleton />
  if (lobbyQ.isError && !lobbyQ.data) {
    if (isApiError(lobbyQ.error, 'NOT_FOUND') || isApiError(lobbyQ.error, 'FORBIDDEN'))
      return (
        <EmptyState
          icon="🔒"
          title="This lobby isn't available"
          description="It may be private, or the link is wrong. Ask the host for the invite code."
          action={<LinkButton to="/app/play">Find open matches</LinkButton>}
        />
      )
    return <ErrorState error={lobbyQ.error} onRetry={() => lobbyQ.refetch()} />
  }
  if (!lobbyQ.data) return null
  return <WaitingRoom lobby={lobbyQ.data} />
}

function WaitingRoom({ lobby }: { lobby: LobbyDetail }) {
  const qc = useQueryClient()
  const [params, setParams] = useSearchParams()
  const { user: me } = useMe()
  const meta = useMeta().data
  const desktop = useIsDesktop()
  const pay = usePayFlow()
  const payStart = pay.start

  const member = lobby.my_membership
  const isHost = member?.role === 'host' || lobby.host.id === me?.id
  const owed = amountOwed(lobby)
  const inviteRef = useRef<HTMLElement>(null)
  const [inviteFlash, setInviteFlash] = useState(0)
  const [confirm, setConfirm] = useState<ConfirmConfig | null>(null)
  const [confirmBusy, setConfirmBusy] = useState(false)

  const setLobby = useCallback(
    (l: LobbyDetail) => {
      qc.setQueryData(qk.lobby(l.id), l)
      qc.invalidateQueries({ queryKey: qk.lobbiesAll })
    },
    [qc],
  )
  const refresh = useCallback(() => qc.invalidateQueries({ queryKey: qk.lobby(lobby.id) }), [qc, lobby.id])

  useLobbyRealtime(lobby.id, me?.id)

  // ── Pay flow ────────────────────────────────────────────────────────────
  const openPay = useCallback(
    (l: LobbyDetail) => {
      const amount = amountOwed(l)
      if (amount <= 0) return
      const hostFull = l.mode === 'full' && l.my_membership?.role === 'host'
      payStart({
        title: hostFull ? 'Secure the pitch' : 'Pay your share',
        subtitle: `${l.title} · ${formatWhen(l.start_at)}`,
        amountPaise: amount,
        createIntent: (useCredits) => api.lobbies.pay(l.id, useCredits),
        onSuccess: () => {
          refresh()
          qc.invalidateQueries({ queryKey: qk.lobbiesAll })
        },
      })
    },
    [payStart, refresh, qc],
  )

  // ?pay=1 → open the pay sheet once, as soon as we know what I owe.
  const autoPay = useRef(false)
  useEffect(() => {
    if (autoPay.current || params.get('pay') !== '1') return
    autoPay.current = true
    const next = new URLSearchParams(params)
    next.delete('pay')
    setParams(next, { replace: true })
    if (amountOwed(lobby) > 0) openPay(lobby)
  }, [lobby, params, setParams, openPay])

  // ── Confirmed celebration (once per lobby) ──────────────────────────────
  const prevStatus = useRef<LobbyStatus | null>(null)
  const [matchOn, setMatchOn] = useState(false)
  useEffect(() => {
    const prev = prevStatus.current
    prevStatus.current = lobby.status
    if (lobby.status !== 'confirmed' || !lobby.my_membership) return
    const key = `pytch-matchon-${lobby.id}`
    let seen = false
    try {
      seen = localStorage.getItem(key) === '1'
    } catch {
      /* storage blocked */
    }
    if (seen) return
    const confirmedAt = lobby.booking.confirmed_at ? new Date(lobby.booking.confirmed_at).getTime() : 0
    const recent = Date.now() - confirmedAt < 15 * 60 * 1000
    if (prev === 'forming' || recent) {
      setMatchOn(true)
      try {
        localStorage.setItem(key, '1')
      } catch {
        /* ignore */
      }
    }
  }, [lobby.status, lobby.id, lobby.my_membership, lobby.booking.confirmed_at])

  // ── Mutations ───────────────────────────────────────────────────────────
  const join = useJoinLobby(
    (l) => {
      toast.success("You're in the lobby!", { description: amountOwed(l) > 0 ? 'Pay your share to lock your seat.' : undefined })
      if (amountOwed(l) > 0) openPay(l)
    },
    refresh,
  )

  const withConfirm = async (fn: () => Promise<unknown>) => {
    setConfirmBusy(true)
    try {
      await fn()
      setConfirm(null)
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setConfirmBusy(false)
    }
  }

  const balance = useMutation({
    mutationFn: () => api.lobbies.balanceTeams(lobby.id),
    onSuccess: (l) => {
      setLobby(l)
      toast.success('Teams balanced ⚖️', { description: 'Snake-drafted on True Skill.' })
    },
    onError: (e) => toast.error(errorMessage(e)),
  })

  const leave = () => {
    const paid = member?.status === 'paid'
    const discount = meta?.sub_discount_pct ?? 20
    const back = Math.round(((member?.paid_paise ?? lobby.share_paise) * (100 - discount)) / 100)
    setConfirm({
      title: 'Leave this match?',
      tone: 'danger',
      confirmLabel: 'Leave match',
      body:
        lobby.status === 'confirmed' && paid ? (
          <>
            The game is already locked. <b className="text-fg">Your seat goes to the bench at {discount}% off</b>; you get back what the sub pays (
            {formatINR(back)}) as Pytch Credits once someone takes it. Late drops also count against your reliability.
          </>
        ) : paid ? (
          <>Your {formatINR(member?.paid_paise ?? 0)} is refunded to Pytch Credits instantly and your seat opens up for someone else.</>
        ) : (
          <>Your reserved seat opens up for someone else. You haven't paid, so there's nothing to refund.</>
        ),
      onConfirm: () =>
        withConfirm(async () => {
          const l = await api.lobbies.leave(lobby.id)
          setLobby(l)
          toast('You left the match')
        }),
    })
  }

  const kick = (m: LobbyMember) =>
    setConfirm({
      title: `Remove ${firstName(m.user)}?`,
      tone: 'danger',
      confirmLabel: 'Remove',
      body: <>They haven't paid yet. Their seat opens up again for someone who will.</>,
      onConfirm: () =>
        withConfirm(async () => {
          const l = await api.lobbies.removeMember(lobby.id, m.user.id)
          setLobby(l)
          toast(`${firstName(m.user)} was removed`)
        }),
    })

  const cancel = () =>
    setConfirm({
      title: 'Cancel this match?',
      tone: 'danger',
      confirmLabel: 'Cancel match',
      body: (
        <>
          The slot is released and <b className="text-fg">everyone who paid is refunded to Pytch Credits instantly</b>. Confirmed matches can't be cancelled
          within {meta?.sos_window_hours ?? 6} h of kick-off — send an SOS to the bench instead.
        </>
      ),
      onConfirm: () =>
        withConfirm(async () => {
          try {
            const l = await api.bookings.cancel(lobby.booking.id)
            setLobby(l)
            qc.invalidateQueries({ queryKey: qk.slotsAll })
            toast('Match cancelled — refunds sent as credits')
          } catch (e) {
            if (isApiError(e, 'TOO_LATE')) throw new Error('Too close to kick-off to cancel. Send an SOS to the bench instead.', { cause: e })
            throw e
          }
        }),
    })

  const cover = () =>
    pay.start({
      title: 'Cover the remaining seats',
      subtitle: `Lock ${lobby.title} now — ${lobby.total_spots - lobby.paid_spots} unpaid seat${lobby.total_spots - lobby.paid_spots === 1 ? '' : 's'}`,
      amountPaise: remainingToCover(lobby),
      createIntent: (useCredits) => api.lobbies.coverRemaining(lobby.id, useCredits),
      onSuccess: refresh,
    })

  const sos = async (spots: number) => {
    try {
      await api.bench.createSos({ lobby_id: lobby.id, spots })
      toast.success('🚨 SOS sent to the bench', { description: 'Nearby subs are being pinged right now.' })
      refresh()
    } catch (e) {
      toast.error(errorMessage(e))
      throw e
    }
  }

  const invite = () => {
    inviteRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setInviteFlash((n) => n + 1)
  }

  const actionsProps = {
    lobby,
    owed,
    joining: join.isPending,
    onJoin: () => join.mutate(lobby.id),
    onPay: () => openPay(lobby),
    onLeave: leave,
    onInvite: invite,
  }
  const showInvite = lobby.status === 'forming' || lobby.status === 'confirmed'
  const hasMobileBar = !desktop && lobby.status !== 'expired' && lobby.status !== 'cancelled' && (lobby.status !== 'completed' || !!member)

  return (
    <div>
      <LobbyHeader lobby={lobby} />
      <Banners lobby={lobby} />

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-6">
          <LobbyHero lobby={lobby} onDeadline={refresh} />
          {lobby.open_sos && <SosCard sos={lobby.open_sos} />}
          <SeatsGrid lobby={lobby} meId={me?.id} isHost={isHost} onKick={kick} onInvite={invite} />
          {!desktop && showInvite && <InvitePanel ref={inviteRef} lobby={lobby} highlight={inviteFlash} />}
          {desktop && <MyActions {...actionsProps} variant="card" />}
          {isHost && (
            <HostTools lobby={lobby} onCover={cover} onBalance={() => balance.mutate()} balancing={balance.isPending} onSos={sos} onCancel={cancel} />
          )}
          {lobby.notes && (
            <section className="glass rounded-3xl p-5">
              <h2 className="flex items-center gap-2 text-sm font-semibold tracking-wider text-muted uppercase">
                <StickyNote className="h-4 w-4" /> Notes from {firstName(lobby.host)}
              </h2>
              <p className="mt-2 text-sm leading-relaxed whitespace-pre-wrap text-fg/85">{lobby.notes}</p>
            </section>
          )}
        </div>

        <div className="min-w-0 space-y-6">
          {desktop && showInvite && <InvitePanel ref={inviteRef} lobby={lobby} highlight={inviteFlash} />}
          <ChatPanel lobby={lobby} me={me} />
        </div>
      </div>

      {hasMobileBar && (
        <>
          <div className="h-24" aria-hidden />
          {createPortal(
            <div className="fixed inset-x-0 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-30 px-3 short:bottom-[calc(3rem+env(safe-area-inset-bottom))]">
              <div className="mx-auto max-w-lg">
                <MyActions {...actionsProps} variant="bar" />
              </div>
            </div>,
            document.body,
          )}
        </>
      )}

      <DemoConsole lobby={lobby} raised={hasMobileBar} />
      <MatchOnOverlay open={matchOn} lobby={lobby} onClose={() => setMatchOn(false)} />
      <ConfirmSheet config={confirm} onClose={() => !confirmBusy && setConfirm(null)} busy={confirmBusy} />
      {pay.sheet}
    </div>
  )
}

function LobbySkeleton() {
  return (
    <div>
      <Skeleton className="mb-4 h-5 w-16 rounded-lg" />
      <Skeleton className="h-44 rounded-3xl" />
      <div className="mt-6 grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-6">
          <Skeleton className="h-64 rounded-3xl" />
          <div className="glass rounded-3xl p-6">
            <div className="grid grid-cols-4 gap-5 sm:grid-cols-5">
              {Array.from({ length: 10 }, (_, i) => (
                <div key={i} className="flex flex-col items-center gap-2">
                  <div className="skeleton h-14 w-14 rounded-full" />
                  <div className="skeleton h-2.5 w-10 rounded" />
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="space-y-6">
          <Skeleton className="h-56 rounded-3xl" />
          <Skeleton className="h-96 rounded-3xl" />
        </div>
      </div>
    </div>
  )
}
