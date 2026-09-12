import L from 'leaflet'
import { Crosshair, Loader2, Minus, Plus } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { MapContainer, Marker, TileLayer } from 'react-leaflet'
import { cn } from '@/lib/cn'
import { formatINR } from '@/lib/format'
import { requestGps, useLocationStore } from '@/stores/location'
import type { TurfSummary } from '@/types/api'

/**
 * Tiles: CARTO's dark_all now watermarks key-less requests ("API KEY REQUIRED"), so by default we
 * render OSM tiles through the theme's `--map-filter` (dark: CSS night filter, light: near-normal OSM).
 * Set VITE_MAP_TILE_URL (e.g. a keyed CARTO dark_all URL) to use a native basemap instead.
 */
const CUSTOM_TILES: string | undefined = import.meta.env.VITE_MAP_TILE_URL || undefined
const TILE_URL = CUSTOM_TILES ?? 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
const ATTRIBUTION = CUSTOM_TILES?.includes('carto')
  ? '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
  : '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
const THEME_FILTER = '[filter:var(--map-filter)]'

function priceIcon(t: TurfSummary, active: boolean) {
  const forming = t.open_lobbies_count > 0
  const pill = active
    ? 'scale-115 bg-volt text-ink-950 shadow-[0_0_0_4px_color-mix(in_srgb,_var(--color-volt)_22%,_transparent),0_0_30px_color-mix(in_srgb,_var(--color-volt)_calc(75%*var(--glow-strength)),_transparent)]'
    : 'bg-ink-700/95 text-fg ring-1 ring-white/20 shadow-[0_6px_18px_rgb(0_0_0/calc(0.6*var(--glow-strength)))] hover:ring-volt/60'
  const tail = active ? 'bg-volt' : 'bg-ink-700 ring-1 ring-white/20'
  const dot = forming
    ? `<span class="relative flex h-2 w-2"><span class="absolute inline-flex h-full w-full animate-ping rounded-full ${active ? 'bg-ink-950' : 'bg-volt'} opacity-75"></span><span class="relative inline-flex h-2 w-2 rounded-full ${active ? 'bg-ink-950' : 'bg-volt'}"></span></span>`
    : ''
  return L.divIcon({
    className: '',
    iconSize: [0, 0],
    iconAnchor: [0, 0],
    html: `<div class="absolute top-0 left-0 flex -translate-x-1/2 -translate-y-full cursor-pointer flex-col items-center pb-0.5">
      <div class="relative z-[1] flex origin-bottom items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 font-mono text-[11px] font-bold transition-all duration-200 ${pill}">${dot}${formatINR(t.min_price_per_hour_paise)}</div>
      <div class="-mt-1 h-2 w-2 rotate-45 ${tail}"></div>
    </div>`,
  })
}

const userIcon = L.divIcon({
  className: '',
  iconSize: [0, 0],
  iconAnchor: [0, 0],
  html: `<div class="absolute top-0 left-0 h-4 w-4 -translate-x-1/2 -translate-y-1/2">
    <span class="absolute inset-0 animate-pulse-ring rounded-full bg-electric/60"></span>
    <span class="relative block h-4 w-4 rounded-full bg-electric shadow-[0_0_18px_color-mix(in_srgb,_var(--color-electric)_calc(90%*var(--glow-strength)),_transparent)] ring-[3px] ring-ink-900"></span>
  </div>`,
})

export interface TurfMapProps {
  turfs: TurfSummary[]
  hoveredId: string | null
  selectedId: string | null
  onHover: (id: string | null) => void
  onSelect: (id: string) => void
  className?: string
}

/** Dark Leaflet map with glowing price-pill markers, synced hover/selection and a locate-me control. */
export function TurfMap({ turfs, hoveredId, selectedId, onHover, onSelect, className }: TurfMapProps) {
  const loc = useLocationStore()
  const [map, setMap] = useState<L.Map | null>(null)
  const [locating, setLocating] = useState(false)

  // Fit to results whenever the *set* of turfs changes (not on hover/sort).
  const idsKey = useMemo(() => turfs.map((t) => t.id).sort().join(','), [turfs])
  const lastFit = useRef('')
  useEffect(() => {
    if (!map || !idsKey || lastFit.current === idsKey) return
    lastFit.current = idsKey
    const pts = turfs.map((t) => L.latLng(t.lat, t.lng))
    pts.push(L.latLng(loc.lat, loc.lng))
    map.flyToBounds(L.latLngBounds(pts), { padding: [48, 48], maxZoom: 14, duration: 0.8 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, idsKey])

  // Pan to a selected turf (e.g. clicked in the list).
  useEffect(() => {
    if (!map || !selectedId) return
    const t = turfs.find((x) => x.id === selectedId)
    if (t) map.flyTo([t.lat, t.lng], Math.max(map.getZoom(), 14), { duration: 0.7 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, selectedId])

  const locate = async () => {
    setLocating(true)
    const p = await requestGps()
    setLocating(false)
    map?.flyTo([p.lat, p.lng], 14, { duration: 0.9 })
  }

  const ctrl =
    'flex h-10 w-10 cursor-pointer items-center justify-center rounded-xl bg-ink-800/90 text-fg ring-1 ring-white/10 backdrop-blur transition hover:bg-ink-700 hover:text-volt'

  return (
    <div className={cn('relative isolate overflow-hidden', className)}>
      <MapContainer
        ref={setMap}
        center={[loc.lat, loc.lng]}
        zoom={13}
        zoomControl={false}
        scrollWheelZoom
        className="h-full w-full"
        attributionControl
      >
        <TileLayer url={TILE_URL} attribution={ATTRIBUTION} subdomains="abcd" maxZoom={19} className={CUSTOM_TILES ? undefined : THEME_FILTER} />
        <Marker position={[loc.lat, loc.lng]} icon={userIcon} interactive={false} zIndexOffset={-100} />
        {turfs.map((t) => (
          <TurfMarker
            key={t.id}
            turf={t}
            active={t.id === hoveredId || t.id === selectedId}
            onHover={onHover}
            onSelect={onSelect}
          />
        ))}
      </MapContainer>

      {/* vignette so the map melts into the ink background */}
      <div className="pointer-events-none absolute inset-0 z-[500] shadow-[inset_0_0_80px_color-mix(in_srgb,_var(--color-ink-950)_calc(85%*var(--glow-strength)),_transparent)]" />

      <div className="absolute top-3 right-3 z-[600] flex flex-col gap-2">
        <button type="button" className={ctrl} onClick={() => map?.zoomIn()} aria-label="Zoom in">
          <Plus className="h-4 w-4" />
        </button>
        <button type="button" className={ctrl} onClick={() => map?.zoomOut()} aria-label="Zoom out">
          <Minus className="h-4 w-4" />
        </button>
        <button type="button" className={cn(ctrl, 'mt-1')} onClick={locate} aria-label="Locate me">
          {locating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Crosshair className={cn('h-4 w-4', loc.source === 'gps' && 'text-electric')} />}
        </button>
      </div>
    </div>
  )
}

function TurfMarker({
  turf,
  active,
  onHover,
  onSelect,
}: {
  turf: TurfSummary
  active: boolean
  onHover: (id: string | null) => void
  onSelect: (id: string) => void
}) {
  const icon = useMemo(() => priceIcon(turf, active), [turf, active])
  const handlers = useMemo(
    () => ({
      mouseover: () => onHover(turf.id),
      mouseout: () => onHover(null),
      click: () => onSelect(turf.id),
      keypress: (e: L.LeafletKeyboardEvent) => e.originalEvent.key === 'Enter' && onSelect(turf.id),
    }),
    [turf.id, onHover, onSelect],
  )
  return (
    <Marker
      position={[turf.lat, turf.lng]}
      icon={icon}
      zIndexOffset={active ? 1000 : turf.open_lobbies_count > 0 ? 100 : 0}
      eventHandlers={handlers}
      title={turf.name}
      alt={`${turf.name}, from ${formatINR(turf.min_price_per_hour_paise)} per hour`}
    />
  )
}
