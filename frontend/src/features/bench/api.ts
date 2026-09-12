import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo } from 'react'
import { useMe } from '@/hooks/useMe'
import { useMeta } from '@/hooks/useMeta'
import { api } from '@/lib/api/endpoints'
import { qk } from '@/lib/api/queryKeys'
import { requestGps, useLocationStore } from '@/stores/location'
import type { BenchStatus, BenchUpdate, Sport } from '@/types/api'

/** `GET /bench/nearby` rounds the radius *up* to one of these — coarse on purpose (privacy). */
const NEARBY_RADII_KM = [2, 5, 10, 15]
export const nearbyRadiusKm = (km: number) => NEARBY_RADII_KM.find((r) => r >= km) ?? NEARBY_RADII_KM[NEARBY_RADII_KM.length - 1]!

/** The nearby count is bucketed server-side: exact up to 3, then a floor (4 = 4–9, 10 = 10–19, 20 = 20–49, 50 = 50+). */
export const benchCountLabel = (count: number) => (count >= 4 ? `${count}+` : String(count))

export function useBenchStatus() {
  return useQuery({ queryKey: qk.bench, queryFn: api.bench.me, staleTime: 15_000 })
}

/** Where the radar is centred: the live bench location, else the last known location. */
export function useBenchCenter(status: BenchStatus | undefined) {
  const storeLat = useLocationStore((s) => s.lat)
  const storeLng = useLocationStore((s) => s.lng)
  const live = status?.is_active && status.lat != null && status.lng != null
  const lat = live ? status.lat! : storeLat
  const lng = live ? status.lng! : storeLng
  return useMemo(() => ({ lat, lng }), [lat, lng])
}

/**
 * Approximate bench headcount around `center`. Blips are grid-snapped (~1 km cells), not real positions.
 * Errors (incl. 429 rate limits) stay quiet: the last good answer keeps showing.
 */
export function useBenchNearby(center: { lat: number; lng: number }, radiusKm: number, sport?: Sport) {
  // Round so tiny GPS jitter doesn't create new cache entries.
  const lat = Math.round(center.lat * 1000) / 1000
  const lng = Math.round(center.lng * 1000) / 1000
  const radius = nearbyRadiusKm(radiusKm) // same answer for every radius in a bucket → share the cache entry
  return useQuery({
    queryKey: [...qk.benchNearby(lat, lng, sport), radius],
    queryFn: () => api.bench.nearby({ lat, lng, sport, radius_km: radius }),
    refetchInterval: 20_000,
    placeholderData: (prev) => prev,
    retry: false,
  })
}

export function useSosFeed(enabled = true) {
  return useQuery({ queryKey: qk.sos, queryFn: api.bench.sos, enabled, refetchInterval: 30_000 })
}

export function useBenchUpdate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: BenchUpdate) => api.bench.update(body),
    onSuccess: (status) => {
      qc.setQueryData(qk.bench, status)
      qc.invalidateQueries({ queryKey: qk.sos })
      qc.invalidateQueries({ queryKey: ['bench', 'nearby'] })
    },
  })
}

export interface BenchSettings {
  radius_km: number
  sports: Sport[]
  duration_minutes: number
}

/** Defaults for a fresh bench session (last settings → profile sports → football). */
export function useBenchDefaults(status: BenchStatus | undefined): BenchSettings {
  const { user } = useMe()
  const meta = useMeta()
  const sports: Sport[] = status?.sports.length
    ? status.sports
    : user?.preferred_sports.length
      ? user.preferred_sports
      : ['football']
  return {
    radius_km: status?.radius_km || meta.data?.bench_default_radius_km || 5,
    sports,
    duration_minutes: 120,
  }
}

/** Go live (asks for GPS first) / go off. */
export function useBenchToggle() {
  const update = useBenchUpdate()
  const goLive = async (settings: BenchSettings) => {
    const { lat, lng } = await requestGps()
    return update.mutateAsync({ is_active: true, lat, lng, ...settings })
  }
  const goOff = () => update.mutateAsync({ is_active: false })
  return { goLive, goOff, pending: update.isPending, update }
}
