import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api/endpoints'
import { qk } from '@/lib/api/queryKeys'
import { useAuth } from '@/stores/auth'
import { syncHomeLocation } from '@/stores/location'
import type { UserUpdate, UUID } from '@/types/api'

export function useMyProfile() {
  return useQuery({ queryKey: qk.myProfile, queryFn: api.users.myProfile })
}

export function usePlayerProfile(userId: UUID | undefined) {
  return useQuery({ queryKey: qk.profile(userId ?? ''), queryFn: () => api.users.profile(userId!), enabled: !!userId })
}

export function useGamification() {
  return useQuery({ queryKey: qk.gamification, queryFn: api.gamification.me })
}

export function useRatingSummary() {
  return useQuery({ queryKey: qk.ratingSummary, queryFn: api.ratings.me })
}

export function useUpdateProfile() {
  const qc = useQueryClient()
  const setUser = useAuth((s) => s.setUser)
  return useMutation({
    mutationFn: (body: UserUpdate) => api.users.update(body),
    onSuccess: (user) => {
      qc.setQueryData(qk.me, user)
      setUser(user)
      syncHomeLocation(user)
      qc.invalidateQueries({ queryKey: qk.me })
      qc.invalidateQueries({ queryKey: qk.myProfile })
    },
  })
}
