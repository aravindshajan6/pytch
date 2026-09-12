/**
 * Lobby query hooks + realtime wiring. All keys come from `qk`.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { errorMessage, isApiError } from '@/lib/api/client'
import { api } from '@/lib/api/endpoints'
import { qk } from '@/lib/api/queryKeys'
import { useChannel } from '@/lib/realtime'
import type { LobbyDetail, LobbyMessage, LobbyUpdateReason, UserPublic, UUID } from '@/types/api'

export function useLobby(id: UUID | undefined) {
  return useQuery({
    queryKey: qk.lobby(id ?? ''),
    queryFn: () => api.lobbies.get(id!),
    enabled: !!id,
    // Realtime drives freshness; poll slowly as a safety net while things are moving.
    refetchInterval: (q) => (q.state.data?.status === 'forming' ? 20_000 : 60_000),
  })
}

export function useLobbyMessages(id: UUID | undefined, enabled: boolean) {
  return useQuery({
    queryKey: qk.lobbyMessages(id ?? ''),
    queryFn: () => api.lobbies.messages(id!),
    enabled: !!id && enabled,
    staleTime: 60_000,
  })
}

/** Append a message to the cache, de-duplicating by id (and replacing an optimistic twin). */
export function appendMessage(list: LobbyMessage[] | undefined, msg: LobbyMessage, replaceId?: string): LobbyMessage[] {
  const base = (list ?? []).filter((m) => m.id !== replaceId)
  if (base.some((m) => m.id === msg.id)) return base
  return [...base, msg]
}

const REASON_COPY: Partial<Record<LobbyUpdateReason, (name: string) => string>> = {
  member_joined: (n) => `${n} joined the lobby`,
  member_paid: (n) => `${n} paid their share 💸`,
  member_left: (n) => `${n} left the lobby`,
  teams_balanced: () => 'Teams have been balanced ⚖️',
  transferred: () => 'Match moved to a new pitch',
  sos: () => 'SOS sent to the bench 🚨',
}

/**
 * Realtime for the waiting room:
 * - `lobby:<id>` (anyone who can see the lobby): `lobby.updated` → invalidate the lobby.
 * - `chat:<id>` (current members only — joined, paid or host; the server rejects anyone else and drops
 *   the subscription when a member leaves or is removed): `lobby.message` → append to the chat cache.
 * `onUpdate` lets the page react (seat pop animations, celebrations).
 */
export function useLobbyRealtime(
  id: UUID | undefined,
  meId: UUID | undefined,
  { isMember, onUpdate }: { isMember: boolean; onUpdate?: (reason: LobbyUpdateReason, actor: UserPublic | null) => void },
) {
  const qc = useQueryClient()
  useChannel(id ? `lobby:${id}` : null, (m) => {
    if (!id || m.event !== 'lobby.updated') return
    qc.invalidateQueries({ queryKey: qk.lobby(id) })
    qc.invalidateQueries({ queryKey: qk.lobbiesAll })
    const { reason, actor } = m.data
    onUpdate?.(reason, actor)
    const copy = REASON_COPY[reason]
    if (copy && actor?.id !== meId && (actor || reason === 'teams_balanced' || reason === 'transferred' || reason === 'sos')) {
      toast(copy(actor?.name.split(' ')[0] ?? 'Someone'), { duration: 2600 })
    }
  })
  useChannel(id && isMember ? `chat:${id}` : null, (m) => {
    if (!id || m.event !== 'lobby.message') return
    // no history loaded yet → leave it to the initial fetch (seeding the cache would mark it fresh and skip history)
    qc.setQueryData<LobbyMessage[]>(qk.lobbyMessages(id), (old) => (old ? appendMessage(old, m.data) : old))
  })
}

/** Join mutation with the contract's error codes mapped to friendly toasts. */
export function useJoinLobby(onJoined: (lobby: LobbyDetail) => void, onAlreadyMember?: () => void) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, code }: { id: UUID; code?: string }) => api.lobbies.join(id, code),
    onSuccess: (lobby) => {
      qc.setQueryData(qk.lobby(lobby.id), lobby)
      qc.invalidateQueries({ queryKey: qk.lobbiesAll })
      onJoined(lobby)
    },
    onError: (e) => {
      if (isApiError(e, 'ALREADY_MEMBER')) return onAlreadyMember?.()
      if (isApiError(e, 'NOT_ELIGIBLE')) {
        const reasons = (e.details as { reasons?: string[] } | undefined)?.reasons
        return toast.error("You can't join this one yet", { description: reasons?.join(' · ') ?? e.message })
      }
      if (isApiError(e, 'LOBBY_FULL')) return toast.error('Lobby just filled up', { description: 'Try another match or join the bench.' })
      if (isApiError(e, 'LOBBY_CLOSED')) return toast.error('This lobby is closed')
      toast.error(errorMessage(e))
    },
  })
}
