import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api/endpoints'
import { qk } from '@/lib/api/queryKeys'
import type { UUID, WeatherAlert } from '@/types/api'

export function useWeatherAlert(id: UUID | undefined) {
  return useQuery({ queryKey: qk.weatherAlert(id ?? ''), queryFn: () => api.weather.alert(id!), enabled: !!id })
}

export function useAlternatives(alert: WeatherAlert | undefined) {
  const enabled = !!alert && alert.is_host && alert.status === 'open'
  return useQuery({
    queryKey: qk.alternatives(alert?.id ?? ''),
    queryFn: () => api.weather.alternatives(alert!.id),
    enabled,
    staleTime: 20_000,
  })
}

function useInvalidateAfterResolve() {
  const qc = useQueryClient()
  return (alert: WeatherAlert) => {
    qc.invalidateQueries({ queryKey: qk.weatherAlerts })
    qc.invalidateQueries({ queryKey: qk.weatherAlert(alert.id) })
    qc.invalidateQueries({ queryKey: qk.lobby(alert.lobby_id) })
    qc.invalidateQueries({ queryKey: qk.lobbiesAll })
  }
}

export function useTransfer(alert: WeatherAlert) {
  const done = useInvalidateAfterResolve()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (slotId: UUID) => api.weather.transfer(alert.id, slotId),
    onSuccess: (lobby) => {
      qc.setQueryData(qk.lobby(lobby.id), lobby)
      done(alert)
    },
    onError: () => qc.invalidateQueries({ queryKey: qk.alternatives(alert.id) }),
  })
}

export function useRainCheck(alert: WeatherAlert) {
  const done = useInvalidateAfterResolve()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api.weather.rainCheck(alert.id),
    onSuccess: () => {
      done(alert)
      qc.invalidateQueries({ queryKey: qk.wallet })
      qc.invalidateQueries({ queryKey: qk.me })
    },
  })
}

export function useDismissAlert(alert: WeatherAlert) {
  const done = useInvalidateAfterResolve()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api.weather.dismiss(alert.id),
    onSuccess: (a) => {
      qc.setQueryData(qk.weatherAlert(a.id), a)
      done(alert)
    },
  })
}
