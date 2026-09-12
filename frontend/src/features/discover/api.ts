import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { api, type TurfQuery } from '@/lib/api/endpoints'
import { qk } from '@/lib/api/queryKeys'

export function useTurfs(q: TurfQuery) {
  return useQuery({
    queryKey: qk.turfs(q),
    queryFn: () => api.turfs.list(q),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  })
}

export function useDebouncedValue<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}
