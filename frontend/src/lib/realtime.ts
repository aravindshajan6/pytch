/**
 * Realtime client: one WebSocket per tab, ref-counted channel subscriptions,
 * automatic reconnect with backoff + re-subscribe, heartbeat pings.
 */
import { useEffect, useRef } from 'react'
import type { ServerWsMessage, WsEventMap, WsEventName } from '@/types/api'

type AnyEvent = Extract<ServerWsMessage, { type: 'event' }>
type Listener = (msg: AnyEvent) => void

function wsUrl(token: string) {
  const explicit = import.meta.env.VITE_WS_URL
  const base = explicit ?? `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`
  return `${base}?token=${encodeURIComponent(token)}`
}

class RealtimeClient {
  private ws: WebSocket | null = null
  private token: string | null = null
  private channelRefs = new Map<string, number>()
  private listeners = new Set<Listener>()
  private statusListeners = new Set<(s: boolean) => void>()
  private retry = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private pingTimer: ReturnType<typeof setInterval> | null = null
  connected = false

  connect(token: string) {
    if (this.token === token && this.ws && this.ws.readyState <= WebSocket.OPEN) return
    this.disconnect()
    this.token = token
    this.open()
  }

  disconnect() {
    this.token = null
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    if (this.pingTimer) clearInterval(this.pingTimer)
    this.ws?.close()
    this.ws = null
    this.setConnected(false)
  }

  private open() {
    if (!this.token) return
    const ws = new WebSocket(wsUrl(this.token))
    this.ws = ws
    ws.onopen = () => {
      this.retry = 0
      this.setConnected(true)
      for (const ch of this.channelRefs.keys()) this.send({ op: 'subscribe', channel: ch })
      this.pingTimer = setInterval(() => this.send({ op: 'ping' }), 25000)
    }
    ws.onmessage = (e) => {
      let msg: ServerWsMessage
      try {
        msg = JSON.parse(e.data)
      } catch {
        return
      }
      if (msg.type === 'event') for (const l of this.listeners) l(msg as AnyEvent)
    }
    ws.onclose = (e) => {
      if (this.pingTimer) clearInterval(this.pingTimer)
      this.setConnected(false)
      if (this.ws !== ws || !this.token || e.code === 4401) return
      const delay = Math.min(1000 * 2 ** this.retry++, 15000) + Math.random() * 500
      this.reconnectTimer = setTimeout(() => this.open(), delay)
    }
  }

  private send(msg: object) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg))
  }

  private setConnected(v: boolean) {
    this.connected = v
    for (const l of this.statusListeners) l(v)
  }

  subscribe(channel: string) {
    const n = this.channelRefs.get(channel) ?? 0
    this.channelRefs.set(channel, n + 1)
    if (n === 0) this.send({ op: 'subscribe', channel })
    return () => {
      const left = (this.channelRefs.get(channel) ?? 1) - 1
      if (left <= 0) {
        this.channelRefs.delete(channel)
        this.send({ op: 'unsubscribe', channel })
      } else this.channelRefs.set(channel, left)
    }
  }

  addListener(l: Listener) {
    this.listeners.add(l)
    return () => void this.listeners.delete(l)
  }

  onStatus(l: (s: boolean) => void) {
    this.statusListeners.add(l)
    return () => void this.statusListeners.delete(l)
  }
}

export const realtime = new RealtimeClient()

/**
 * Subscribe to a channel (e.g. `lobby:<id>`, `pitch:<id>`) and receive its events.
 * Pass `null` to skip. Handler identity may change freely.
 */
export function useChannel(channel: string | null, handler: (msg: AnyEvent) => void) {
  const ref = useRef(handler)
  ref.current = handler
  useEffect(() => {
    if (!channel) return
    const unsub = realtime.subscribe(channel)
    const unlisten = realtime.addListener((m) => m.channel === channel && ref.current(m))
    return () => {
      unlisten()
      unsub()
    }
  }, [channel])
}

/** Listen for a specific event on any subscribed channel (user channel is auto-subscribed). */
export function useRealtimeEvent<K extends WsEventName>(event: K, handler: (data: WsEventMap[K]) => void) {
  const ref = useRef(handler)
  ref.current = handler
  useEffect(
    () => realtime.addListener((m) => m.event === event && ref.current(m.data as WsEventMap[K])),
    [event],
  )
}
