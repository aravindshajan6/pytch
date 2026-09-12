import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api/endpoints'
import { qk } from '@/lib/api/queryKeys'
import { useLocationStore } from '@/stores/location'

export const useUpcoming = () => useQuery({ queryKey: qk.myLobbies('upcoming'), queryFn: () => api.lobbies.mine('upcoming') })

export function useNearbyLobbies() {
  const { lat, lng } = useLocationStore()
  const q = { lat, lng, radius_km: 20, limit: 10 }
  return useQuery({ queryKey: qk.lobbies(q), queryFn: () => api.lobbies.list(q) })
}

export const usePendingRatings = () => useQuery({ queryKey: qk.pendingRatings, queryFn: api.ratings.pending })
export const useWeatherAlerts = () => useQuery({ queryKey: qk.weatherAlerts, queryFn: api.weather.alerts })
export const useGamification = () => useQuery({ queryKey: qk.gamification, queryFn: api.gamification.me })

export const useTrendingClips = () =>
  useQuery({
    queryKey: qk.highlightFeed('trending'),
    queryFn: () => api.highlights.feed({ sort: 'trending', limit: 6 }),
  })

export const useWeeklyLeaders = () =>
  useQuery({ queryKey: qk.leaderboard('xp', 'week'), queryFn: () => api.gamification.leaderboard('xp', 'week') })
