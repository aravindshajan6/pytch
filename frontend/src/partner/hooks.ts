import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useState } from 'react'
import { istDate } from '@/lib/format'
import { partnerApi } from './api/endpoints'
import { pk } from './api/keys'
import { usePartnerAuth, usePartnerUi } from './stores/partnerAuth'

/** Own venues (staff see only the venues they are scoped to). */
export function useVenues() {
  const pid = usePartnerAuth((s) => s.providerId)
  return useQuery({ queryKey: pk.venues, queryFn: partnerApi.venues.list, enabled: !!pid, staleTime: 60_000 })
}

/** Global venue filter for the acting provider (null = all venues). Falls back if the venue disappeared. */
export function useTurfFilter(): [string | null, (id: string | null) => void] {
  const pid = usePartnerAuth((s) => s.providerId)
  const stored = usePartnerUi((s) => (pid ? (s.turfByProvider[pid] ?? null) : null))
  const setTurf = usePartnerUi((s) => s.setTurf)
  const venues = useVenues().data
  const valid = stored && venues && !venues.some((v) => v.id === stored) ? null : stored
  const set = useCallback((id: string | null) => pid && setTurf(pid, id), [pid, setTurf])
  return [valid, set]
}

/** A venue that is always concrete (calendar needs one): the filter, else the first venue. */
export function useConcreteTurf() {
  const [turfId, setTurfId] = useTurfFilter()
  const venues = useVenues()
  const turf = venues.data?.find((v) => v.id === turfId) ?? venues.data?.[0] ?? null
  return { turf, venues, setTurfId }
}

/** Today's IST date, refreshed when the day rolls over (front desks stay open past midnight). */
export function useToday(): string {
  const [today, setToday] = useState(() => istDate())
  useEffect(() => {
    const id = setInterval(() => setToday((t) => (istDate() === t ? t : istDate())), 60_000)
    return () => clearInterval(id)
  }, [])
  return today
}

/** Ticks every `ms` — for "now" lines and relative times. */
export function useNow(ms = 60_000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(id)
  }, [ms])
  return now
}

/** Drop every partner query (provider switch / logout). */
export function useResetPartnerCache() {
  const qc = useQueryClient()
  return useCallback(() => qc.removeQueries({ queryKey: pk.all }), [qc])
}
