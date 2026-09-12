import { useMemo } from 'react'
import { SPORT_LIST, sportInfo, type SportInfo } from '@/lib/sports'
import { useMeta } from './useMeta'

/**
 * Sports to offer in filters/pickers: the admin-managed catalog from `/meta` (active sports only, in
 * catalog order), falling back to the built-in list while meta loads or if it fails.
 */
export function useSports(): SportInfo[] {
  const { data } = useMeta()
  return useMemo(
    () => (data?.sports?.length ? data.sports.map((s) => sportInfo(s.key, s)) : SPORT_LIST.map((k) => sportInfo(k))),
    [data?.sports],
  )
}
