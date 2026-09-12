import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api/endpoints'
import { qk } from '@/lib/api/queryKeys'
import { useLocationStore } from '@/stores/location'

export function useTurf(slug: string | undefined) {
  const lat = useLocationStore((s) => s.lat)
  const lng = useLocationStore((s) => s.lng)
  return useQuery({
    queryKey: qk.turf(slug ?? ''),
    queryFn: () => api.turfs.get(slug!, { lat: Math.round(lat * 1000) / 1000, lng: Math.round(lng * 1000) / 1000 }),
    enabled: !!slug,
    staleTime: 60_000,
  })
}

export function useSlots(pitchId: string | undefined, date: string) {
  return useQuery({
    queryKey: qk.slots(pitchId ?? '', date),
    queryFn: () => api.turfs.slots(pitchId!, date),
    enabled: !!pitchId,
    staleTime: 20_000,
    // realtime keeps this fresh; poll as a fallback when the socket is down
    refetchInterval: 60_000,
  })
}
