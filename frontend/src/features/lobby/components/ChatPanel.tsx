import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Lock, MessageCircle, SendHorizonal, Sparkles } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useLayoutEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Avatar } from '@/components/ui/Avatar'
import { Spinner } from '@/components/ui/States'
import { errorMessage, isApiError } from '@/lib/api/client'
import { api } from '@/lib/api/endpoints'
import { qk } from '@/lib/api/queryKeys'
import { cn } from '@/lib/cn'
import { formatTime } from '@/lib/format'
import type { LobbyDetail, LobbyMessage, UserPublic } from '@/types/api'
import { appendMessage, useLobbyMessages } from '../api'
import { firstName } from '../lib'

const QUICK = ['On my way 🏃', 'Running 5 min late', 'Bringing a ball ⚽', 'Who has bibs?']

export function ChatPanel({ lobby, me }: { lobby: LobbyDetail; me: UserPublic | null }) {
  const isMember = !!lobby.my_membership
  const msgsQ = useLobbyMessages(lobby.id, isMember)
  const qc = useQueryClient()
  const [text, setText] = useState('')
  const listRef = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const messages = msgsQ.data ?? []
  const key = qk.lobbyMessages(lobby.id)
  const closed = lobby.status === 'expired' || lobby.status === 'cancelled'

  const send = useMutation({
    mutationFn: (body: string) => api.lobbies.sendMessage(lobby.id, body),
    onMutate: (body) => {
      const temp: LobbyMessage = {
        id: `temp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        lobby_id: lobby.id,
        user: me,
        kind: 'chat',
        body,
        created_at: new Date().toISOString(),
      }
      stick.current = true
      qc.setQueryData<LobbyMessage[]>(key, (old) => [...(old ?? []), temp])
      return { tempId: temp.id }
    },
    onSuccess: (msg, _body, ctx) => qc.setQueryData<LobbyMessage[]>(key, (old) => appendMessage(old, msg, ctx?.tempId)),
    onError: (e, body, ctx) => {
      qc.setQueryData<LobbyMessage[]>(key, (old) => old?.filter((m) => m.id !== ctx?.tempId))
      setText((t) => t || body) // keep the draft
      if (isApiError(e, 'RATE_LIMITED')) toast.error('Easy, playmaker — too many messages', { description: 'Wait a few seconds, then send it again.' })
      else toast.error(errorMessage(e))
    },
  })

  // Auto-scroll: stick to the bottom unless the user scrolled up to read history.
  useLayoutEffect(() => {
    const el = listRef.current
    if (el && stick.current) el.scrollTo({ top: el.scrollHeight, behavior: messages.length > 1 ? 'smooth' : 'auto' })
  }, [messages.length])

  const submit = (body: string) => {
    const b = body.trim()
    if (!b || send.isPending) return
    setText('')
    send.mutate(b.slice(0, 500))
  }

  return (
    <section className="glass flex h-[460px] flex-col overflow-hidden rounded-3xl lg:h-[540px]" aria-label="Match chat">
      <div className="flex items-center justify-between border-b border-white/6 px-5 py-4">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <MessageCircle className="h-4.5 w-4.5 text-volt" /> Match chat
        </h2>
        <span className="text-xs text-muted">{lobby.filled_spots} in the room</span>
      </div>

      {!isMember ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/5 ring-1 ring-white/10">
            <Lock className="h-6 w-6 text-muted" />
          </div>
          <p className="max-w-[240px] text-sm text-muted">Join the lobby to chat with the squad, sort kits and plan the carpool.</p>
        </div>
      ) : (
        <>
          <div
            ref={listRef}
            onScroll={(e) => {
              const el = e.currentTarget
              stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
            }}
            className="flex-1 space-y-1 overflow-y-auto px-4 py-4"
            aria-live="polite"
          >
            {msgsQ.isLoading ? (
              <div className="flex h-full items-center justify-center">
                <Spinner />
              </div>
            ) : messages.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center text-center">
                <div className="text-4xl">👋</div>
                <p className="mt-2 text-sm text-muted">Say hi — first message sets the tone.</p>
              </div>
            ) : (
              <AnimatePresence initial={false}>
                {messages.map((m, i) => (
                  <Message key={m.id} msg={m} prev={messages[i - 1]} mine={!!me && m.user?.id === me.id} />
                ))}
              </AnimatePresence>
            )}
          </div>

          {!closed && (
            <div className="border-t border-white/6 p-3">
              {messages.length < 3 && (
                <div className="no-scrollbar mb-2 flex gap-1.5 overflow-x-auto">
                  {QUICK.map((q) => (
                    <button
                      key={q}
                      type="button"
                      onClick={() => submit(q)}
                      className="shrink-0 cursor-pointer rounded-full bg-white/5 px-3 py-1.5 text-xs text-fg/75 ring-1 ring-white/10 transition hover:bg-white/10 hover:text-fg"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              )}
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  submit(text)
                }}
                className="flex items-center gap-2"
              >
                <input
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  maxLength={500}
                  placeholder="Message the squad…"
                  aria-label="Message"
                  className="h-11 min-w-0 flex-1 rounded-xl bg-white/5 px-4 text-sm text-fg ring-1 ring-white/10 outline-none placeholder:text-subtle focus:ring-2 focus:ring-volt/70"
                />
                <motion.button
                  type="submit"
                  whileTap={{ scale: 0.9 }}
                  disabled={!text.trim()}
                  aria-label="Send"
                  className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-xl bg-volt text-ink-950 transition disabled:cursor-default disabled:opacity-30"
                >
                  <SendHorizonal className="h-4.5 w-4.5" />
                </motion.button>
              </form>
            </div>
          )}
        </>
      )}
    </section>
  )
}

function Message({ msg, prev, mine }: { msg: LobbyMessage; prev?: LobbyMessage; mine: boolean }) {
  const pending = msg.id.startsWith('temp-')
  if (msg.kind === 'system' || !msg.user) {
    return (
      <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="flex justify-center py-1.5">
        <span className="inline-flex max-w-[90%] items-center gap-1.5 rounded-full bg-white/4 px-3 py-1 text-center text-[11px] text-muted ring-1 ring-white/6">
          <Sparkles className="h-3 w-3 shrink-0 text-volt" />
          {msg.body}
        </span>
      </motion.div>
    )
  }
  const grouped =
    prev?.kind === 'chat' &&
    prev.user?.id === msg.user.id &&
    new Date(msg.created_at).getTime() - new Date(prev.created_at).getTime() < 5 * 60 * 1000

  return (
    <motion.div
      initial={{ opacity: 0, y: 10, scale: 0.97 }}
      animate={{ opacity: pending ? 0.6 : 1, y: 0, scale: 1 }}
      transition={{ type: 'spring', stiffness: 500, damping: 32 }}
      className={cn('flex items-end gap-2', mine ? 'justify-end' : 'justify-start', !grouped && 'pt-2')}
    >
      {!mine && (
        <span className="w-6 shrink-0">{!grouped && <Avatar user={msg.user} size="xs" showVerified={false} />}</span>
      )}
      <div className={cn('max-w-[78%]', mine && 'text-right')}>
        {!grouped && !mine && <div className="mb-0.5 ml-1 text-[11px] font-semibold text-muted">{firstName(msg.user)}</div>}
        <div
          title={formatTime(msg.created_at)}
          className={cn(
            'inline-block rounded-2xl px-3.5 py-2 text-left text-sm break-words whitespace-pre-wrap',
            mine ? 'rounded-br-md bg-volt text-ink-950' : 'rounded-bl-md bg-white/7 text-fg',
          )}
        >
          {msg.body}
        </div>
      </div>
    </motion.div>
  )
}
