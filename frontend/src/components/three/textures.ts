/**
 * Procedural canvas textures for the hero scene — everything is baked once at
 * mount so the scene needs no image downloads and no real-time lights.
 */
import * as THREE from 'three'
import { mulberry32 } from './random'

export { mulberry32 }

function canvas(w: number, h = w) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return [c, c.getContext('2d')!] as const
}

function finish(c: HTMLCanvasElement, srgb = true) {
  const tex = new THREE.CanvasTexture(c)
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace
  tex.needsUpdate = true
  return tex
}

/** Soft round glow (white core → transparent). Tint it with the material colour. */
export function glowTexture(size = 256) {
  const [c, g] = canvas(size)
  const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  grd.addColorStop(0, 'rgba(255,255,255,1)')
  grd.addColorStop(0.18, 'rgba(255,255,255,0.55)')
  grd.addColorStop(0.45, 'rgba(255,255,255,0.12)')
  grd.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grd
  g.fillRect(0, 0, size, size)
  return finish(c, false)
}

/** Contact shadow blob. */
export function shadowTexture(size = 256) {
  const [c, g] = canvas(size)
  const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  grd.addColorStop(0, 'rgba(0,0,0,0.85)')
  grd.addColorStop(0.5, 'rgba(0,0,0,0.35)')
  grd.addColorStop(1, 'rgba(0,0,0,0)')
  g.fillStyle = grd
  g.fillRect(0, 0, size, size)
  return finish(c, false)
}

/** Thin glowing ring used as a "hologram" marker under the ball. */
export function ringTexture(size = 512) {
  const [c, g] = canvas(size)
  const r = size / 2
  const grd = g.createRadialGradient(r, r, r * 0.55, r, r, r)
  grd.addColorStop(0, 'rgba(255,255,255,0)')
  grd.addColorStop(0.72, 'rgba(255,255,255,0.05)')
  grd.addColorStop(0.86, 'rgba(255,255,255,0.9)')
  grd.addColorStop(0.9, 'rgba(255,255,255,0.35)')
  grd.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grd
  g.fillRect(0, 0, size, size)
  // tick marks, like a HUD dial
  g.strokeStyle = 'rgba(255,255,255,0.5)'
  g.lineWidth = size * 0.006
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * Math.PI * 2
    const inner = i % 4 === 0 ? 0.62 : 0.68
    g.beginPath()
    g.moveTo(r + Math.cos(a) * r * inner, r + Math.sin(a) * r * inner)
    g.lineTo(r + Math.cos(a) * r * 0.74, r + Math.sin(a) * r * 0.74)
    g.stroke()
  }
  return finish(c, false)
}

export interface TurfLayout {
  /** world size of the (square) turf plane */
  world: number
  /** pitch width (x) and length (z) in world units */
  pitchW: number
  pitchL: number
  /** pitch centre z offset in world units */
  centerZ: number
  /** world points where floodlight pools are baked */
  pools: [number, number][]
}

/** Colours for the two moods of the turf: floodlit night match vs. golden-hour day game. */
const TURF = {
  night: {
    surround: '#040806',
    stripes: ['#0e2619', '#0b1f15'],
    pool: ['rgba(190,255,140,0.22)', 'rgba(120,220,120,0.08)'],
    grain: ['rgba(255,255,255,0.035)', 'rgba(0,0,0,0.12)'],
    vignette: 'rgba(0,0,0,0.65)',
    near: '4,8,6',
    nearAlpha: 0.94,
  },
  day: {
    surround: '#6f9a58',
    stripes: ['#5f9f40', '#6dae4b'],
    pool: ['rgba(255,236,170,0.26)', 'rgba(255,230,160,0.08)'],
    grain: ['rgba(255,255,255,0.06)', 'rgba(20,50,10,0.1)'],
    vignette: 'rgba(60,90,45,0.45)',
    near: '223,233,214',
    nearAlpha: 0.9,
  },
} as const

/**
 * 5/7-a-side pitch: mowing stripes, light pools, grain and lines. `night` = floodlit with neon
 * lines (canvas shadowBlur gives the glow); `day` = sunlit turf with crisp painted lines and the
 * far end in the stands' late-afternoon shadow. Mapped onto a plane rotated -90° about X,
 * so canvas y ↔ world z (top of the canvas = far end of the pitch).
 */
export function turfTexture(layout: TurfLayout, size = 2048, mood: 'night' | 'day' = 'night') {
  const [c, g] = canvas(size)
  const { world, pitchW, pitchL, centerZ, pools } = layout
  const k = size / world
  const X = (x: number) => (x + world / 2) * k
  const Z = (z: number) => (z + world / 2) * k
  const P = TURF[mood]
  const day = mood === 'day'

  // surround
  g.fillStyle = P.surround
  g.fillRect(0, 0, size, size)

  // playing surface with run-off
  const runW = pitchW + 4
  const runL = pitchL + 5
  const x0 = X(-runW / 2)
  const z0 = Z(centerZ - runL / 2)
  const band = 1.25 * k
  for (let i = 0; i * band < runL * k; i++) {
    g.fillStyle = i % 2 ? P.stripes[1] : P.stripes[0]
    g.fillRect(x0, z0 + i * band, runW * k, band + 1)
  }

  // floodlight pools
  for (const [px, pz] of pools) {
    const grd = g.createRadialGradient(X(px), Z(pz), 0, X(px), Z(pz), 7 * k)
    grd.addColorStop(0, P.pool[0])
    grd.addColorStop(0.5, P.pool[1])
    grd.addColorStop(1, 'rgba(0,0,0,0)')
    g.fillStyle = grd
    g.fillRect(0, 0, size, size)
  }

  // grass grain
  const rnd = mulberry32(7)
  for (let i = 0; i < 9000; i++) {
    const x = x0 + rnd() * runW * k
    const y = z0 + rnd() * runL * k
    g.fillStyle = rnd() > 0.5 ? P.grain[0] : P.grain[1]
    g.fillRect(x, y, 2, 2)
  }

  // vignette edge of the run-off into the dark surround
  const edge = g.createRadialGradient(X(0), Z(centerZ), runL * k * 0.2, X(0), Z(centerZ), runL * k * 0.75)
  edge.addColorStop(0, 'rgba(0,0,0,0)')
  edge.addColorStop(1, P.vignette)
  g.fillStyle = edge
  g.fillRect(0, 0, size, size)

  if (day) {
    // late-afternoon shadow of the main stand across the far end of the pitch
    const shade = g.createLinearGradient(0, Z(centerZ - runL / 2 - 2), 0, Z(centerZ - 1))
    shade.addColorStop(0, 'rgba(24,52,30,0.3)')
    shade.addColorStop(0.55, 'rgba(24,52,30,0.1)')
    shade.addColorStop(1, 'rgba(24,52,30,0)')
    g.fillStyle = shade
    g.fillRect(0, 0, size, Z(centerZ - 1))
  }

  // ── lines ──
  const lw = 0.075 * k
  const drawLines = (blur: number, alpha: number, color: string) => {
    g.save()
    g.strokeStyle = color
    g.fillStyle = color
    g.globalAlpha = alpha
    g.lineWidth = lw
    g.shadowColor = day ? 'rgba(255,255,255,0.7)' : '#c8ff2e'
    g.shadowBlur = blur
    const hw = pitchW / 2
    const hl = pitchL / 2
    const cz = centerZ
    // touch & goal lines
    g.strokeRect(X(-hw), Z(cz - hl), pitchW * k, pitchL * k)
    // halfway
    line(g, X(-hw), Z(cz), X(hw), Z(cz))
    // centre circle + spot
    g.beginPath()
    g.arc(X(0), Z(cz), 1.6 * k, 0, Math.PI * 2)
    g.stroke()
    dot(g, X(0), Z(cz), 0.14 * k)
    // penalty areas, goal areas, spots, arcs, goals (both ends)
    for (const s of [-1, 1]) {
      const gl = cz + s * hl
      const boxW = 5.4
      const boxD = 2.4
      g.strokeRect(X(-boxW / 2), s < 0 ? Z(gl) : Z(gl - boxD), boxW * k, boxD * k)
      g.strokeRect(X(-1.4), s < 0 ? Z(gl) : Z(gl - 0.8), 2.8 * k, 0.8 * k)
      dot(g, X(0), Z(gl - s * 1.8), 0.1 * k)
      g.beginPath()
      g.arc(X(0), Z(gl - s * 1.8), 1.3 * k, s < 0 ? 0.2 * Math.PI : 1.2 * Math.PI, s < 0 ? 0.8 * Math.PI : 1.8 * Math.PI)
      g.stroke()
      // goal mouth
      g.strokeRect(X(-0.9), s < 0 ? Z(gl - 0.5) : Z(gl), 1.8 * k, 0.5 * k)
    }
    // corner arcs
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
      g.beginPath()
      const cx = X(sx * hw)
      const cy = Z(cz + sz * hl)
      const start = sx < 0 ? (sz < 0 ? 0 : 1.5 * Math.PI) : sz < 0 ? 0.5 * Math.PI : Math.PI
      g.arc(cx, cy, 0.35 * k, start, start + Math.PI / 2)
      g.stroke()
    }
    g.restore()
  }
  if (day) {
    drawLines(6, 0.45, '#ffffff') // soft chalk spread
    drawLines(0, 0.92, '#ffffff') // crisp painted line
  } else {
    drawLines(28, 0.55, '#c8ff2e') // outer neon bloom
    drawLines(10, 0.95, '#f2ffd8') // crisp core
  }

  // fade the foreground (between camera and ball) into the page so near
  // touchlines don't slash across the hero copy
  const near = g.createLinearGradient(0, Z(centerZ + 2), 0, Z(centerZ + 9))
  near.addColorStop(0, `rgba(${P.near},0)`)
  near.addColorStop(1, `rgba(${P.near},${P.nearAlpha})`)
  g.fillStyle = near
  g.fillRect(0, Z(centerZ + 2), size, size)

  return finish(c)
}

/**
 * Daytime grandstand: concrete tiers fading from sunlit top to shaded base, with seat rows.
 * Wraps round the stand cylinder (u = around, v = height).
 */
export function standTexture() {
  const [c, g] = canvas(256, 128)
  const grd = g.createLinearGradient(0, 0, 0, 128)
  grd.addColorStop(0, '#b3bfb1')
  grd.addColorStop(0.55, '#98a698')
  grd.addColorStop(1, '#6f7f72')
  g.fillStyle = grd
  g.fillRect(0, 0, 256, 128)
  // roof fascia along the top edge
  g.fillStyle = '#5d6b62'
  g.fillRect(0, 0, 256, 7)
  g.fillStyle = 'rgba(255,255,255,0.45)'
  g.fillRect(0, 7, 256, 1)
  for (let y = 16; y < 128; y += 9) {
    g.fillStyle = 'rgba(40,60,45,0.18)'
    g.fillRect(0, y, 256, 2)
    g.fillStyle = 'rgba(255,255,255,0.18)'
    g.fillRect(0, y - 1, 256, 1)
  }
  // stairways
  for (let x = 0; x < 256; x += 64) {
    g.fillStyle = 'rgba(255,255,255,0.22)'
    g.fillRect(x, 0, 3, 128)
  }
  const tex = finish(c)
  tex.wrapS = THREE.RepeatWrapping
  tex.repeat.set(10, 1)
  return tex
}

function line(g: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number) {
  g.beginPath()
  g.moveTo(x1, y1)
  g.lineTo(x2, y2)
  g.stroke()
}

function dot(g: CanvasRenderingContext2D, x: number, y: number, r: number) {
  g.beginPath()
  g.arc(x, y, r, 0, Math.PI * 2)
  g.fill()
}
