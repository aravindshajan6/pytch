import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export const KOCHI = { lat: 9.9816, lng: 76.2999 }

type Source = 'gps' | 'home' | 'default'

interface LocationState {
  lat: number
  lng: number
  source: Source
  label: string
  set: (lat: number, lng: number, source: Source, label?: string) => void
}

export const useLocationStore = create<LocationState>()(
  persist(
    (set) => ({
      ...KOCHI,
      source: 'default',
      label: 'Kochi',
      set: (lat, lng, source, label) => set({ lat, lng, source, label: label ?? (source === 'gps' ? 'Near you' : 'Kochi') }),
    }),
    { name: 'pytch-location' },
  ),
)

/** Ask the browser for GPS; resolves to the stored location either way. */
export function requestGps(): Promise<{ lat: number; lng: number }> {
  return new Promise((resolve) => {
    const s = useLocationStore.getState()
    if (!('geolocation' in navigator)) return resolve({ lat: s.lat, lng: s.lng })
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        useLocationStore.getState().set(pos.coords.latitude, pos.coords.longitude, 'gps')
        resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude })
      },
      () => resolve({ lat: s.lat, lng: s.lng }),
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 5 * 60 * 1000 },
    )
  })
}
