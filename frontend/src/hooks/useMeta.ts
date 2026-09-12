import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api/endpoints'
import { qk } from '@/lib/api/queryKeys'

/** App-wide config (business rules, sports, areas). Cached for the session. */
export function useMeta() {
  return useQuery({ queryKey: qk.meta, queryFn: api.meta, staleTime: Infinity, gcTime: Infinity })
}
