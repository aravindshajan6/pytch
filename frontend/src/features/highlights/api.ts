import {
  type QueryClient,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { api } from '@/lib/api/endpoints'
import { qk } from '@/lib/api/queryKeys'
import type { Clip, CreateClipRequest, Sport, UUID } from '@/types/api'

export type FeedSort = 'trending' | 'recent'
const FEED_PAGE = 12

/** Infinite highlights feed. Own key suffix so it never collides with plain `useQuery` users of `qk.highlightFeed`. */
export function useHighlightFeed(sort: FeedSort, sport?: Sport) {
  return useInfiniteQuery({
    queryKey: [...qk.highlightFeed(sort, sport), 'infinite'],
    queryFn: ({ pageParam }) => api.highlights.feed({ sort, sport, limit: FEED_PAGE, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (last) => {
      const next = last.offset + last.items.length
      return last.items.length > 0 && next < last.total ? next : undefined
    },
  })
}

export function useRecordings() {
  return useQuery({
    queryKey: qk.recordings,
    queryFn: api.highlights.recordings,
    refetchInterval: (q) => (q.state.data?.some((r) => r.status === 'processing') ? 8000 : false),
  })
}

export function useRecording(id: UUID | undefined) {
  return useQuery({
    queryKey: qk.recording(id ?? ''),
    queryFn: () => api.highlights.recording(id!),
    enabled: !!id,
    refetchInterval: (q) => (q.state.data?.status === 'processing' ? 6000 : false),
  })
}

export function useUserClips(userId: UUID | undefined) {
  return useQuery({
    queryKey: qk.userClips(userId ?? ''),
    queryFn: () => api.highlights.userClips(userId!),
    enabled: !!userId,
  })
}

// ───────────── cache patching: keep a clip consistent in every list it appears in ─────────────

type ClipFn = (c: Clip) => Clip | null

const isClip = (x: unknown): x is Clip =>
  !!x && typeof x === 'object' && 'recording_id' in x && 'start_s' in x && 'owner' in x

function mapList(list: unknown[], fn: ClipFn): unknown[] {
  let changed = false
  const out: unknown[] = []
  for (const item of list) {
    if (isClip(item)) {
      const n = fn(item)
      if (n !== item) changed = true
      if (n) out.push(n)
    } else {
      const n = mapClips(item, fn)
      if (n !== item) changed = true
      out.push(n)
    }
  }
  return changed ? out : list
}

/** Walks Page<Clip> / InfiniteData / Clip[] / Recording / PlayerProfile shapes. */
function mapClips(data: unknown, fn: ClipFn): unknown {
  if (Array.isArray(data)) return mapList(data, fn)
  if (!data || typeof data !== 'object') return data
  const obj = data as Record<string, unknown>
  let next: Record<string, unknown> = obj
  for (const key of ['items', 'pages', 'clips', 'pinned_clips']) {
    const v = obj[key]
    if (!Array.isArray(v)) continue
    const n = mapList(v, fn)
    if (n !== v) {
      if (next === obj) next = { ...obj }
      next[key] = n
    }
  }
  return next
}

export function patchClipCaches(qc: QueryClient, fn: ClipFn) {
  for (const prefix of [['highlights'], ['profile']]) {
    qc.setQueriesData<unknown>({ queryKey: prefix }, (old: unknown) => (old === undefined ? old : mapClips(old, fn)))
  }
}

export const replaceClip = (qc: QueryClient, clip: Clip) =>
  patchClipCaches(qc, (c) => (c.id === clip.id ? { ...c, ...clip } : c))

// ───────────── mutations ─────────────

export function useCreateClip(recordingId: UUID) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: CreateClipRequest) => api.highlights.createClip(recordingId, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.recording(recordingId) })
      qc.invalidateQueries({ queryKey: ['highlights', 'feed'] })
      qc.invalidateQueries({ queryKey: ['highlights', 'user'] })
      qc.invalidateQueries({ queryKey: qk.recordings })
      qc.invalidateQueries({ queryKey: qk.gamification })
    },
  })
}

export function usePinClip() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, pin }: { id: UUID; pin: boolean }) => (pin ? api.highlights.pin(id) : api.highlights.unpin(id)),
    onSuccess: (clip) => {
      replaceClip(qc, clip)
      qc.invalidateQueries({ queryKey: qk.myProfile })
    },
  })
}

export function useDeleteClip() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: UUID) => api.highlights.deleteClip(id),
    onSuccess: (_, id) => {
      patchClipCaches(qc, (c) => (c.id === id ? null : c))
      qc.invalidateQueries({ queryKey: qk.myProfile })
    },
  })
}
