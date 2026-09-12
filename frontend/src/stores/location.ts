import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { UserMe } from '@/types/api'

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

/**
 * Use the player's saved home area as "where I am" — on session start (fresh device, new login) and after
 * a profile edit — unless live GPS is in use. Idempotent, so it's safe to call on every `me` refresh.
 */
export function syncHomeLocation(user: Pick<UserMe, 'home_lat' | 'home_lng' | 'home_area'> | null | undefined) {
  if (!user || user.home_lat == null || user.home_lng == null) return
  const s = useLocationStore.getState()
  if (s.source === 'gps') return
  const label = user.home_area ?? 'Home'
  if (s.source === 'home' && s.lat === user.home_lat && s.lng === user.home_lng && s.label === label) return
  s.set(user.home_lat, user.home_lng, 'home', label)
}

/** Forget a signed-out player's home area (a live GPS fix isn't personal data we stored — keep it). */
export function clearHomeLocation() {
  const s = useLocationStore.getState()
  if (s.source === 'home') s.set(KOCHI.lat, KOCHI.lng, 'default')
}
