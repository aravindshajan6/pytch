import { useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'
import { api } from '@/lib/api/endpoints'
import { qk } from '@/lib/api/queryKeys'
import { useAuth } from '@/stores/auth'

/** Current user, kept in sync with the persisted auth store. */
export function useMe() {
  const token = useAuth((s) => s.accessToken)
  const setUser = useAuth((s) => s.setUser)
  const query = useQuery({ queryKey: qk.me, queryFn: api.users.me, enabled: !!token, staleTime: 30_000 })
  useEffect(() => {
    if (query.data) setUser(query.data)
  }, [query.data, setUser])
  return { ...query, user: query.data ?? useAuth.getState().user }
}
