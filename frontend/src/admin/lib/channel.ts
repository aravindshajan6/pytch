/**
 * Same-origin, cross-tab coordination (never carries tokens or PII):
 *  · logout   → every open console tab wipes its memory at once
 *  · activity → an active tab keeps the others from idling out
 *  · login    → other tabs on the login screen restore the session via the refresh cookie
 */
export type ChannelMessage = { type: 'logout' } | { type: 'activity'; at: number } | { type: 'login' }

const channel: BroadcastChannel | null = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('pytch-admin') : null

export function postChannel(msg: ChannelMessage) {
  try {
    channel?.postMessage(msg)
  } catch {
    /* closed channel */
  }
}

export function onChannel(fn: (msg: ChannelMessage) => void): () => void {
  if (!channel) return () => {}
  const handler = (e: MessageEvent) => {
    const d = e.data as ChannelMessage | undefined
    if (d && typeof d === 'object' && typeof d.type === 'string') fn(d)
  }
  channel.addEventListener('message', handler)
  return () => channel.removeEventListener('message', handler)
}
