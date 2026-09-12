/**
 * Idle auto-logout: warn at 13 min without interaction, sign out at 15 min (the server enforces the
 * same 15-min idle window on the session). Activity in any console tab counts for all tabs.
 * While the operator is active, a light keep-alive (GET /admin/auth/me every 4 min) keeps the server
 * session's idle clock in step with what the UI shows.
 */
import { useEffect, useRef, useState } from 'react'
import { onChannel, postChannel } from './channel'
import { http, logout } from './http'

export const IDLE_WARN_MS = 13 * 60_000
export const IDLE_LOGOUT_MS = 15 * 60_000
const KEEPALIVE_MS = 4 * 60_000
const BROADCAST_THROTTLE_MS = 15_000

let lastActivity = Date.now()
let lastBroadcast = 0
let lastKeepalive = Date.now()

export const idleRemainingMs = () => Math.max(0, IDLE_LOGOUT_MS - (Date.now() - lastActivity))

export function markActivity(at = Date.now(), broadcast = true) {
  if (at <= lastActivity) return
  lastActivity = at
  if (broadcast && at - lastBroadcast > BROADCAST_THROTTLE_MS) {
    lastBroadcast = at
    postChannel({ type: 'activity', at })
  }
}

/** Mount once inside the authenticated shell. Returns the warning state for the modal. */
export function useIdleTimer() {
  const [warning, setWarning] = useState(false)
  const warningRef = useRef(false)

  useEffect(() => {
    lastActivity = Date.now()
    lastKeepalive = Date.now()
    const passive = () => !warningRef.current && markActivity()
    const deliberate = () => markActivity()
    const passiveEvents = ['mousemove', 'wheel', 'scroll', 'touchmove'] as const
    const deliberateEvents = ['pointerdown', 'keydown'] as const
    passiveEvents.forEach((e) => window.addEventListener(e, passive, { passive: true, capture: true }))
    deliberateEvents.forEach((e) => window.addEventListener(e, deliberate, { passive: true, capture: true }))
    const offChannel = onChannel((m) => {
      if (m.type === 'activity') markActivity(m.at, false)
    })

    const tick = window.setInterval(() => {
      const idle = Date.now() - lastActivity
      if (idle >= IDLE_LOGOUT_MS) {
        void logout('You were signed out after 15 minutes of inactivity.')
        return
      }
      const warn = idle >= IDLE_WARN_MS
      if (warn !== warningRef.current) {
        warningRef.current = warn
        setWarning(warn)
      }
      // keep the server-side idle window aligned with real UI activity
      if (!warn && Date.now() - lastKeepalive > KEEPALIVE_MS && idle < KEEPALIVE_MS) {
        lastKeepalive = Date.now()
        http.get('/admin/auth/me').catch(() => {})
      }
    }, 1000)

    return () => {
      passiveEvents.forEach((e) => window.removeEventListener(e, passive, { capture: true }))
      deliberateEvents.forEach((e) => window.removeEventListener(e, deliberate, { capture: true }))
      offChannel()
      window.clearInterval(tick)
    }
  }, [])

  const staySignedIn = () => {
    markActivity()
    lastKeepalive = Date.now()
    warningRef.current = false
    setWarning(false)
    http.get('/admin/auth/me').catch(() => {})
  }

  return { warning, staySignedIn }
}

/** Re-render every second with the time left before idle sign-out (for the session timer). */
export function useIdleCountdown(enabled = true) {
  const [ms, setMs] = useState(idleRemainingMs)
  useEffect(() => {
    if (!enabled) return
    const id = window.setInterval(() => setMs(idleRemainingMs()), 1000)
    return () => window.clearInterval(id)
  }, [enabled])
  return ms
}

export const formatClock = (ms: number) => {
  const s = Math.ceil(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
