import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { toast } from 'sonner'
import { qk } from '@/lib/api/queryKeys'
import { celebrate } from '@/lib/celebrate'
import { realtime, useRealtimeEvent } from '@/lib/realtime'
import { useAuth } from '@/stores/auth'
import type { Notification } from '@/types/api'

/** Where a notification should take the user when tapped. */
export function notificationHref(n: Pick<Notification, 'type' | 'data'>): string | null {
  const d = n.data as Record<string, string | undefined>
  if (d.url) return d.url
  if (n.type === 'sos') return '/app/bench'
  if (n.type === 'rating_request' && d.lobby_id) return `/app/rate/${d.lobby_id}`
  if (n.type === 'weather_alert' && d.alert_id) return `/app/weather/${d.alert_id}`
  if (n.type === 'recording_ready' && d.recording_id) return `/app/highlights/recordings/${d.recording_id}`
  if (d.lobby_id) return `/app/lobby/${d.lobby_id}`
  return null
}

/**
 * Owns the WebSocket lifecycle and the app-wide reactions to user-channel events
 * (cache invalidation + toasts). Feature pages subscribe to their own channels via `useChannel`.
 */
export function RealtimeProvider({ children }: { children: React.ReactNode }) {
  const token = useAuth((s) => s.accessToken)
  const patchUser = useAuth((s) => s.patchUser)
  const qc = useQueryClient()
  const navigate = useNavigate()
  const location = useLocation()

  useEffect(() => {
    if (token) realtime.connect(token)
    else realtime.disconnect()
  }, [token])

  useRealtimeEvent('notification.new', (n) => {
    qc.invalidateQueries({ queryKey: qk.notifications })
    if (n.type === 'sos' || n.type === 'badge_earned' || n.type === 'level_up') return // dedicated handlers below
    const href = notificationHref(n)
    // The page the user is looking at already renders this event live — don't double up.
    const lobbyId = (n.data as { lobby_id?: string }).lobby_id
    const onThatLobby = !!lobbyId && location.pathname === `/app/lobby/${lobbyId}`
    if (onThatLobby && (n.type === 'member_joined' || n.type === 'payment_received' || n.type === 'member_left')) return
    const tone = n.type === 'weather_alert' || n.type === 'lobby_expired' ? toast.warning : toast
    tone(n.title, {
      description: n.body,
      action: href ? { label: 'View', onClick: () => navigate(href) } : undefined,
    })
    if (n.type === 'lobby_confirmed') celebrate()
    if (n.type === 'rating_request') qc.invalidateQueries({ queryKey: qk.pendingRatings })
    if (n.type === 'weather_alert') qc.invalidateQueries({ queryKey: qk.weatherAlerts })
    if (n.type === 'recording_ready') qc.invalidateQueries({ queryKey: qk.recordings })
  })

  useRealtimeEvent('sos.new', (sos) => {
    qc.invalidateQueries({ queryKey: qk.sos })
    if (location.pathname === '/app/bench') return // the bench page animates the card in itself
    toast(`🚨 SOS: ${sos.lobby.title}`, {
      description: `${sos.spots_needed} spot${sos.spots_needed > 1 ? 's' : ''} · ${sos.discount_pct}% off · kicks off soon`,
      duration: 12000,
      action: { label: 'Answer', onClick: () => navigate('/app/bench') },
    })
  })
  useRealtimeEvent('sos.closed', () => qc.invalidateQueries({ queryKey: qk.sos }))

  useRealtimeEvent('wallet.updated', ({ balance_paise }) => {
    patchUser({ wallet_balance_paise: balance_paise })
    qc.invalidateQueries({ queryKey: qk.wallet })
    qc.setQueryData(qk.me, (u: object | undefined) => (u ? { ...u, wallet_balance_paise: balance_paise } : u))
  })

  useRealtimeEvent('badge.earned', (b) => {
    celebrate()
    toast.success(`${b.icon} ${b.name} unlocked`, { description: b.description, duration: 6000 })
    qc.invalidateQueries({ queryKey: qk.gamification })
    qc.invalidateQueries({ queryKey: qk.myProfile })
  })

  useRealtimeEvent('level.up', ({ level }) => {
    celebrate()
    toast.success(`Level ${level}!`, { description: 'You levelled up. Keep the streak alive 🔥' })
    qc.invalidateQueries({ queryKey: qk.gamification })
    qc.invalidateQueries({ queryKey: qk.me })
  })

  return <>{children}</>
}
