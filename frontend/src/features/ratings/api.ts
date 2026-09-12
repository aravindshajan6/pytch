import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api/endpoints'
import { qk } from '@/lib/api/queryKeys'
import type { RatingInput, UUID } from '@/types/api'

export function usePendingRatings() {
  return useQuery({ queryKey: qk.pendingRatings, queryFn: api.ratings.pending })
}

export function useSubmitRatings(lobbyId: UUID) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (ratings: RatingInput[]) => api.ratings.submit(lobbyId, { ratings }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.pendingRatings })
      qc.invalidateQueries({ queryKey: qk.gamification })
      qc.invalidateQueries({ queryKey: qk.me })
      qc.invalidateQueries({ queryKey: qk.myProfile })
    },
  })
}
