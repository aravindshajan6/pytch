/**
 * PYTCH hero scene — a neon-seamed football hovering over a floodlit night pitch.
 *
 * Everything is procedural (no downloads): the ball is a shader-drawn truncated
 * icosahedron (spherical Voronoi over the 12 pentagon + 20 hexagon centres),
 * the turf is a baked canvas texture, floodlight beams are additive cones and
 * the crowd is a twinkling point cloud. No real-time lights are used, so the
 * look is deterministic and cheap. `useFrame` callbacks never allocate.
 *
 * Two moods, picked by `mood` (driven by the app theme): `night` is the original
 * floodlit match; `day` is a golden-hour afternoon game — sunlit turf with painted
 * lines, hazy grandstand, soft sun-lit ball and ink-coloured (not additive) accents
 * so it reads on a light page. The page supplies the sky (the canvas is transparent).
 *
 * Default export so it can be `React.lazy`-loaded (keeps three.js out of the
 * initial bundle). Mount through `<HeroCanvas>` which handles fallbacks.
 */
import { PerformanceMonitor, Sparkles, Float } from '@react-three/drei'
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { glowTexture, mulberry32, ringTexture, shadowTexture, standTexture, turfTexture, type TurfLayout } from './textures'

export type HeroVariant = 'full' | 'lite'
export type HeroMood = 'night' | 'day'

export interface HeroSceneProps {
  variant?: HeroVariant
  /** false → frameloop paused (e.g. scrolled off-screen) */
  active?: boolean
  /** link ball spin / camera to window scroll */
  scrollLinked?: boolean
  /** lighting mood — follows the app theme (dark → night, light → day) */
  mood?: HeroMood
  onReady?: () => void
}

const VOLT = new THREE.Color('#c8ff2e')
const FLOOD = new THREE.Color('#f3ffe0')

/** Everything that changes between the night and day moods. Night values are the original look. */
const PALETTE = {
  night: {
    fog: '#05080a',
    sparkles: '#e3ff94',
    sparkleOpacity: 0.65,
    ball: { hex: '#e7efe9', pent: '#0a1411', seam: VOLT, rim: VOLT.clone().multiplyScalar(0.85), light: '#ffffff', amb: 0.2, diff: 0.9, glow: 1 },
    ballGlow: 0.22,
    rings: [
      { color: VOLT, opacity: 0.7 },
      { color: new THREE.Color('#3dd9ff'), opacity: 0.45 },
    ],
    additive: true,
    groundRing: { color: VOLT, base: 0.45, amp: 0.15 },
    shadow: 0.75,
    mast: '#0d1512',
    lamp: '#f7ffe9',
    lampGlow: [0.9, 0.16],
    beam: { color: FLOOD, opacity: 0.2 },
    stand: '#020504',
    crowd: ['#fff6e0', '#fff6e0', '#c8ff2e', '#3dd9ff'],
    crowdTwinkle: 1,
    crowdSize: 1,
    crowdHaze: 0,
  },
  day: {
    fog: '#e6ecdf',
    sparkles: '#d6a93c',
    sparkleOpacity: 0.55,
    ball: {
      hex: '#fbfcf8',
      pent: '#17231c',
      seam: new THREE.Color('#3f7d00'),
      rim: new THREE.Color('#fff1cf').multiplyScalar(0.55),
      light: '#fffaf0',
      amb: 0.5,
      diff: 0.62,
      glow: 0.3,
    },
    ballGlow: 0,
    rings: [
      { color: new THREE.Color('#3f7d00'), opacity: 0.75 },
      { color: new THREE.Color('#0e7490'), opacity: 0.5 },
    ],
    additive: false,
    groundRing: { color: new THREE.Color('#2d5a00'), base: 0.3, amp: 0.1 },
    shadow: 0.6,
    mast: '#7f8d85',
    lamp: '#eef1ea',
    lampGlow: [0, 0],
    beam: { color: new THREE.Color('#fff3d6'), opacity: 0.06 },
    stand: '#b9c4b6',
    crowd: ['#f7f7f2', '#1f4d00', '#d61f5e', '#0e7490', '#b45309', '#3f7d00', '#6d28d9', '#f7f7f2'],
    crowdTwinkle: 0.2,
    crowdSize: 0.7,
    crowdHaze: 0.3,
  },
} as const
type Palette = (typeof PALETTE)[HeroMood]

/** Shared pointer state (normalised −1..1). Mutated by a window listener, read in useFrame. */
const pointer = { x: 0, y: 0 }

const LAYOUT: TurfLayout = {
  world: 40,
  pitchW: 10,
  pitchL: 16,
  centerZ: -1.5,
  pools: [
    [-3.2, -6.5],
    [3.2, -6.5],
    [-4, 0.5],
    [4, 0.5],
    [0, -1.5],
  ],
}
const BALL_Z = LAYOUT.centerZ

export default function HeroScene({ variant = 'full', active = true, scrollLinked = true, mood = 'night', onReady }: HeroSceneProps) {
  const [maxDpr, setMaxDpr] = useState(2)

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      pointer.x = (e.clientX / window.innerWidth) * 2 - 1
      pointer.y = -((e.clientY / window.innerHeight) * 2 - 1)
    }
    window.addEventListener('pointermove', onMove, { passive: true })
    return () => window.removeEventListener('pointermove', onMove)
  }, [])

  const lite = variant === 'lite'

  return (
    <Canvas
      flat
      dpr={[1, maxDpr]}
      frameloop={active ? 'always' : 'never'}
      camera={{ position: lite ? [0, 0.4, 8.6] : [0, 2.4, 8.4], fov: lite ? 34 : 38, near: 0.1, far: 80 }}
      gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
      onCreated={({ gl }) => {
        gl.setClearColor(0x000000, 0)
        onReady?.()
      }}
      style={{ touchAction: 'pan-y' }}
      aria-hidden
    >
      <PerformanceMonitor flipflops={3} onDecline={() => setMaxDpr(1.25)} onIncline={() => setMaxDpr(2)} onFallback={() => setMaxDpr(1)} />
      {/* keyed by mood: materials with different blending/fog flags are rebuilt on a theme switch */}
      {!lite && <fog key={`fog-${mood}`} attach="fog" args={[PALETTE[mood].fog, 14, 38]} />}
      {lite ? <LiteWorld key={mood} p={PALETTE[mood]} /> : <FullWorld key={mood} p={PALETTE[mood]} mood={mood} scrollLinked={scrollLinked} />}
    </Canvas>
  )
}

// ───────────────────────────── Worlds ─────────────────────────────

function FullWorld({ scrollLinked, p, mood }: { scrollLinked: boolean; p: Palette; mood: HeroMood }) {
  const size = useThree((s) => s.size)
  const aspect = size.width / size.height
  const wide = aspect > 1.15
  // keep the ball at ~78% of the frame width whatever the aspect ratio (≈0.57 × half-frustum width)
  const bx = wide ? Math.min(4, 1.94 * aspect) : 0

  return (
    <>
      <Rig wide={wide} scrollLinked={scrollLinked} />
      <group position={[bx, 0, 0]}>
        <Turf mood={mood} />
        <Crowd p={p} />
        <Floodlight p={p} base={[-9, 0, -17]} target={[-3.2, 0, -6.5]} height={6.8} />
        <Floodlight p={p} base={[9, 0, -17]} target={[3.2, 0, -6.5]} height={6.8} />
        <Floodlight p={p} base={[-13, 0, -9]} target={[-4, 0, 0.5]} height={6} />
        <Floodlight p={p} base={[13, 0, -9]} target={[4, 0, 0.5]} height={6} />
        <BallRig p={p} y={wide ? 1.8 : 2.2} z={BALL_Z} scale={wide ? 1.2 : 0.95} scrollLinked={scrollLinked} />
        <Sparkles count={80} scale={[16, 7, 16]} position={[0, 3.2, -4]} size={3} speed={0.35} opacity={p.sparkleOpacity} color={p.sparkles} noise={1} />
      </group>
    </>
  )
}

function LiteWorld({ p }: { p: Palette }) {
  return (
    <>
      <LiteRig />
      <BallRig p={p} y={0.55} z={0} scale={0.9} scrollLinked={false} shadow={false} />
      <Sparkles count={40} scale={[7, 5, 4]} size={2.4} speed={0.3} opacity={p === PALETTE.night ? 0.6 : 0.5} color={p.sparkles} />
    </>
  )
}

// ───────────────────────────── Camera rigs ─────────────────────────────

function scrollProgress() {
  return Math.min(1.4, window.scrollY / Math.max(1, window.innerHeight))
}

function Rig({ wide, scrollLinked }: { wide: boolean; scrollLinked: boolean }) {
  const look = useMemo(() => new THREE.Vector3(), [])
  useFrame((state, rawDelta) => {
    const delta = Math.min(rawDelta, 0.05)
    const s = scrollLinked ? scrollProgress() : 0
    const cam = state.camera
    const baseZ = wide ? 8.4 : 12.5
    const baseY = wide ? 2.4 : 2.1
    const tx = pointer.x * 0.9
    const ty = baseY + pointer.y * 0.45 + s * 2.2
    const tz = baseZ - s * 1.2
    cam.position.x = THREE.MathUtils.damp(cam.position.x, tx, 2.5, delta)
    cam.position.y = THREE.MathUtils.damp(cam.position.y, ty, 2.5, delta)
    cam.position.z = THREE.MathUtils.damp(cam.position.z, tz, 2.5, delta)
    // narrow screens: look lower so the ball sits in the upper third, above the headline
    look.set(0, wide ? 1.3 : -1.0, BALL_Z)
    cam.lookAt(look)
  })
  return null
}

function LiteRig() {
  const look = useMemo(() => new THREE.Vector3(0, 0, 0), [])
  useFrame((state, rawDelta) => {
    const delta = Math.min(rawDelta, 0.05)
    const cam = state.camera
    cam.position.x = THREE.MathUtils.damp(cam.position.x, pointer.x * 0.6, 2, delta)
    cam.position.y = THREE.MathUtils.damp(cam.position.y, 0.4 + pointer.y * 0.4, 2, delta)
    cam.lookAt(look)
  })
  return null
}

// ───────────────────────────── Ball ─────────────────────────────

const PENT_BIAS = 0.0248 // shifts pent/hex boundary so pentagons match a real truncated icosahedron

function panelCenters(): THREE.Vector3[] {
  const phi = (1 + Math.sqrt(5)) / 2
  const ico: THREE.Vector3[] = []
  for (const a of [-1, 1])
    for (const b of [-phi, phi]) {
      ico.push(new THREE.Vector3(0, a, b), new THREE.Vector3(a, b, 0), new THREE.Vector3(b, 0, a))
    }
  const faces: THREE.Vector3[] = []
  const edge = 2
  for (let i = 0; i < 12; i++)
    for (let j = i + 1; j < 12; j++)
      for (let k = j + 1; k < 12; k++) {
        const [a, b, c] = [ico[i]!, ico[j]!, ico[k]!]
        if (
          Math.abs(a.distanceTo(b) - edge) < 1e-3 &&
          Math.abs(b.distanceTo(c) - edge) < 1e-3 &&
          Math.abs(a.distanceTo(c) - edge) < 1e-3
        )
          faces.push(a.clone().add(b).add(c).normalize())
      }
  return [...ico.map((v) => v.clone().normalize()), ...faces] // 12 pentagons first, then 20 hexagons
}

const ballVertex = /* glsl */ `
  varying vec3 vObj;
  varying vec3 vN;
  varying vec3 vV;
  void main() {
    vObj = position;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vN = normalize(normalMatrix * normal);
    vV = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`

const ballFragment = /* glsl */ `
  uniform vec3 uCenters[32];
  uniform float uTime;
  uniform float uEnergy;
  uniform vec3 uHex;
  uniform vec3 uPent;
  uniform vec3 uSeam;
  uniform vec3 uRim;
  uniform vec3 uLight;
  uniform float uAmb;
  uniform float uDiff;
  uniform float uGlow;
  varying vec3 vObj;
  varying vec3 vN;
  varying vec3 vV;
  void main() {
    vec3 p = normalize(vObj);
    float b1 = -2.0;
    float b2 = -2.0;
    float pent = 0.0;
    for (int i = 0; i < 32; i++) {
      float d = dot(p, uCenters[i]) - (i < 12 ? ${PENT_BIAS} : 0.0);
      if (d > b1) { b2 = b1; b1 = d; pent = i < 12 ? 1.0 : 0.0; }
      else if (d > b2) { b2 = d; }
    }
    float e = b1 - b2;
    float seam = 1.0 - smoothstep(0.0, 0.011, e);
    float bloom = exp(-e * 70.0);
    float puff = smoothstep(0.9, 1.0, b1 + pent * ${PENT_BIAS});

    vec3 n = normalize(vN);
    vec3 v = normalize(vV);
    vec3 L = normalize(vec3(-0.35, 0.85, 0.45));
    float wrap = max(dot(n, L) * 0.55 + 0.45, 0.0);
    float spec = pow(max(dot(n, normalize(L + v)), 0.0), 42.0);
    float fres = pow(1.0 - max(dot(n, v), 0.0), 2.4);

    vec3 base = mix(uHex, uPent, pent);
    vec3 col = base * uLight * (uAmb + uDiff * wrap) * (0.9 + 0.1 * puff);
    col += vec3(spec) * mix(0.55, 0.3, pent);
    col *= 1.0 - seam * 0.6;
    float pulse = 0.7 + 0.3 * sin(uTime * 2.2 - p.y * 5.0);
    col += uSeam * (seam * 1.15 + bloom * 0.28) * pulse * uEnergy * uGlow;
    col += uSeam * pent * 0.05 * uGlow;
    col += uRim * fres;
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

function BallRig({
  p,
  y,
  z,
  scale = 1,
  scrollLinked,
  shadow = true,
}: {
  p: Palette
  y: number
  z: number
  scale?: number
  scrollLinked: boolean
  shadow?: boolean
}) {
  const group = useRef<THREE.Group>(null)
  const ball = useRef<THREE.Mesh>(null)
  const shadowRef = useRef<THREE.Mesh>(null)
  const ringRef = useRef<THREE.Mesh>(null)
  const glowRef = useRef<THREE.Sprite>(null)
  const spin = useRef({ vel: 0, x: 0 })
  const [hovered, setHovered] = useState(false)

  const centers = useMemo(panelCenters, [])
  const uniforms = useMemo(
    () => ({
      uCenters: { value: centers },
      uTime: { value: 0 },
      uEnergy: { value: 1 },
      uHex: { value: new THREE.Color(p.ball.hex) },
      uPent: { value: new THREE.Color(p.ball.pent) },
      uSeam: { value: p.ball.seam.clone() },
      uRim: { value: p.ball.rim.clone() },
      uLight: { value: new THREE.Color(p.ball.light) },
      uAmb: { value: p.ball.amb },
      uDiff: { value: p.ball.diff },
      uGlow: { value: p.ball.glow },
    }),
    [centers, p],
  )
  const blending = p.additive ? THREE.AdditiveBlending : THREE.NormalBlending
  const tex = useMemo(() => ({ glow: glowTexture(), shadow: shadowTexture(), ring: ringTexture() }), [])
  useEffect(() => () => Object.values(tex).forEach((t) => t.dispose()), [tex])

  useEffect(() => {
    document.body.style.cursor = hovered ? 'grab' : ''
    return () => void (document.body.style.cursor = '')
  }, [hovered])

  useFrame((state, rawDelta) => {
    const delta = Math.min(rawDelta, 0.05)
    const t = state.clock.elapsedTime
    const s = scrollLinked ? scrollProgress() : 0
    const b = ball.current
    const g = group.current
    if (!b || !g) return
    // kick impulse decays back to idle spin
    spin.current.vel = THREE.MathUtils.damp(spin.current.vel, 0, 1.4, delta)
    b.rotation.y += delta * (0.35 + spin.current.vel)
    // scroll-linked forward roll
    spin.current.x = THREE.MathUtils.damp(spin.current.x, s * Math.PI * 1.6, 3, delta)
    b.rotation.x = spin.current.x + Math.sin(t * 0.6) * 0.12
    b.rotation.z = Math.sin(t * 0.45) * 0.1
    const bob = Math.sin(t * 1.1) * 0.14
    g.position.y = y + bob + s * 0.9
    uniforms.uTime.value = t
    uniforms.uEnergy.value = 1 + Math.min(spin.current.vel, 6) * 0.25
    if (shadowRef.current) {
      const k = 1 - (bob + s * 0.9) * 0.35
      shadowRef.current.scale.setScalar(2.6 * scale * k)
      ;(shadowRef.current.material as THREE.MeshBasicMaterial).opacity = p.shadow * k
    }
    if (ringRef.current) {
      ringRef.current.rotation.z -= delta * 0.25
      ;(ringRef.current.material as THREE.MeshBasicMaterial).opacity = p.groundRing.base + Math.sin(t * 2) * p.groundRing.amp
    }
    if (glowRef.current) {
      const pulse = 4.4 + Math.sin(t * 2.2) * 0.25 + Math.min(spin.current.vel, 6) * 0.15
      glowRef.current.scale.setScalar(pulse)
    }
  })

  const kick = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation()
    spin.current.vel = Math.min(spin.current.vel + 9, 18)
  }

  return (
    <>
      <group ref={group} position={[0, y, z]} scale={scale}>
        {p.ballGlow > 0 && (
          <sprite ref={glowRef} scale={4.4} renderOrder={1}>
            <spriteMaterial map={tex.glow} color={VOLT} transparent opacity={p.ballGlow} blending={THREE.AdditiveBlending} depthWrite={false} fog={false} />
          </sprite>
        )}
        <mesh
          ref={ball}
          onPointerDown={kick}
          onPointerOver={() => setHovered(true)}
          onPointerOut={() => setHovered(false)}
          renderOrder={3}
        >
          <sphereGeometry args={[1, 96, 64]} />
          <shaderMaterial vertexShader={ballVertex} fragmentShader={ballFragment} uniforms={uniforms} />
        </mesh>
        <Float speed={1.4} rotationIntensity={0.6} floatIntensity={0.3}>
          <mesh rotation={[Math.PI / 2.3, 0.3, 0]}>
            <torusGeometry args={[1.5, 0.008, 8, 128]} />
            <meshBasicMaterial color={p.rings[0].color} transparent opacity={p.rings[0].opacity} blending={blending} depthWrite={false} fog={false} />
          </mesh>
          <mesh rotation={[Math.PI / 1.8, -0.5, 0.4]}>
            <torusGeometry args={[1.72, 0.005, 8, 128]} />
            <meshBasicMaterial color={p.rings[1].color} transparent opacity={p.rings[1].opacity} blending={blending} depthWrite={false} fog={false} />
          </mesh>
        </Float>
      </group>
      {shadow && (
        <>
          <mesh ref={shadowRef} rotation-x={-Math.PI / 2} position={[0, 0.02, z]} renderOrder={1}>
            <planeGeometry args={[1, 1]} />
            <meshBasicMaterial map={tex.shadow} transparent depthWrite={false} opacity={p.shadow} />
          </mesh>
          <mesh ref={ringRef} rotation-x={-Math.PI / 2} position={[0, 0.03, z]} renderOrder={1}>
            <planeGeometry args={[4.2 * scale, 4.2 * scale]} />
            <meshBasicMaterial map={tex.ring} color={p.groundRing.color} transparent opacity={0.5} blending={blending} depthWrite={false} />
          </mesh>
        </>
      )}
    </>
  )
}

// ───────────────────────────── Turf ─────────────────────────────

function Turf({ mood }: { mood: HeroMood }) {
  const gl = useThree((s) => s.gl)
  const map = useMemo(() => {
    const t = turfTexture(LAYOUT, 2048, mood)
    t.anisotropy = gl.capabilities.getMaxAnisotropy()
    t.generateMipmaps = true
    t.minFilter = THREE.LinearMipmapLinearFilter
    return t
  }, [gl, mood])
  useEffect(() => () => map.dispose(), [map])
  return (
    <mesh rotation-x={-Math.PI / 2} position={[0, 0, 0]}>
      <planeGeometry args={[LAYOUT.world, LAYOUT.world]} />
      <meshBasicMaterial map={map} />
    </mesh>
  )
}

// ───────────────────────────── Floodlights ─────────────────────────────

const beamVertex = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vN;
  varying vec3 vV;
  void main() {
    vUv = uv;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vN = normalize(normalMatrix * normal);
    vV = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`
const beamFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uTime;
  varying vec2 vUv;
  varying vec3 vN;
  varying vec3 vV;
  void main() {
    float facing = abs(dot(normalize(vN), normalize(vV)));
    float soft = pow(facing, 1.6);
    float along = smoothstep(0.0, 0.45, vUv.y) * (0.3 + 0.7 * vUv.y);
    float dust = 0.85 + 0.15 * sin(vUv.y * 38.0 - uTime * 1.6 + vUv.x * 18.0);
    float a = soft * along * dust * uOpacity;
    gl_FragColor = vec4(uColor, a); // additive: src * alpha + dst
  }
`

function Floodlight({
  p,
  base,
  target,
  height,
}: {
  p: Palette
  base: [number, number, number]
  target: [number, number, number]
  height: number
}) {
  const glow = useMemo(() => glowTexture(128), [])
  useEffect(() => () => glow.dispose(), [glow])

  const { head, beamPos, beamQuat, beamLen, headQuat } = useMemo(() => {
    const head = new THREE.Vector3(base[0], height, base[2])
    const tgt = new THREE.Vector3(...target)
    const dir = tgt.clone().sub(head)
    const beamLen = dir.length()
    dir.normalize()
    const beamQuat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir)
    const beamPos = head.clone().addScaledVector(dir, beamLen / 2)
    const m = new THREE.Matrix4().lookAt(head, tgt, new THREE.Vector3(0, 1, 0))
    const headQuat = new THREE.Quaternion().setFromRotationMatrix(m)
    return { head, beamPos, beamQuat, beamLen, headQuat }
  }, [base, target, height])

  const uniforms = useMemo(
    () => ({ uColor: { value: p.beam.color.clone() }, uOpacity: { value: p.beam.opacity }, uTime: { value: 0 } }),
    [p],
  )
  useFrame((s) => {
    uniforms.uTime.value = s.clock.elapsedTime
  })

  return (
    <group>
      {/* mast */}
      <mesh position={[base[0], height / 2, base[2]]}>
        <cylinderGeometry args={[0.06, 0.1, height, 8]} />
        <meshBasicMaterial color={p.mast} fog={!p.additive} />
      </mesh>
      {/* lamp head */}
      <mesh position={head} quaternion={headQuat}>
        <boxGeometry args={[1.1, 0.55, 0.1]} />
        <meshBasicMaterial color={p.lamp} toneMapped={false} fog={!p.additive} />
      </mesh>
      {p.lampGlow[0] > 0 && (
        <sprite position={head} scale={3.2}>
          <spriteMaterial map={glow} color="#eaffc2" transparent opacity={p.lampGlow[0]} blending={THREE.AdditiveBlending} depthWrite={false} fog={false} />
        </sprite>
      )}
      {p.lampGlow[1] > 0 && (
        <sprite position={head} scale={10}>
          <spriteMaterial map={glow} color="#c8ff2e" transparent opacity={p.lampGlow[1]} blending={THREE.AdditiveBlending} depthWrite={false} fog={false} />
        </sprite>
      )}
      {/* volumetric-ish beam */}
      <mesh position={beamPos} quaternion={beamQuat} renderOrder={2}>
        <coneGeometry args={[3.6, beamLen, 48, 1, true]} />
        <shaderMaterial
          vertexShader={beamVertex}
          fragmentShader={beamFragment}
          uniforms={uniforms}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          side={THREE.DoubleSide}
        />
      </mesh>
    </group>
  )
}

// ───────────────────────────── Crowd ─────────────────────────────

const crowdVertex = /* glsl */ `
  attribute float aPhase;
  attribute vec3 aColor;
  uniform float uTime;
  uniform float uPixelRatio;
  uniform float uTwinkle;
  uniform float uSize;
  uniform vec3 uHaze;
  uniform float uHazeAmt;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    float tw = 0.35 + 0.65 * (0.5 + 0.5 * sin(uTime * (0.8 + aPhase * 2.5) + aPhase * 40.0));
    vAlpha = 1.0 - uTwinkle * (1.0 - tw);
    vColor = mix(aColor, uHaze, uHazeAmt);
    gl_PointSize = (1.8 + aPhase * 2.2) * uPixelRatio * uSize * (38.0 / -mv.z);
  }
`
const crowdFragment = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.0, d) * vAlpha;
    gl_FragColor = vec4(vColor, a);
  }
`

function Crowd({ p }: { p: Palette }) {
  const dpr = useThree((s) => s.viewport.dpr)
  const geo = useMemo(() => {
    const count = 1100
    const rnd = mulberry32(42)
    const pos = new Float32Array(count * 3)
    const phase = new Float32Array(count)
    const color = new Float32Array(count * 3)
    const palette = p.crowd.map((c) => new THREE.Color(c))
    for (let i = 0; i < count; i++) {
      const theta = Math.PI * (0.28 + rnd() * 1.44) // wrap round the back and sides
      const r = 18 + rnd() * 5
      pos[i * 3] = Math.sin(theta) * r
      pos[i * 3 + 1] = 0.5 + (r - 18) * 0.72 + rnd() * 0.35 // tiers stay in front of the sloped stand
      pos[i * 3 + 2] = LAYOUT.centerZ + Math.cos(theta) * r
      phase[i] = rnd()
      const c = palette[Math.floor(rnd() * palette.length)]!
      color.set([c.r, c.g, c.b], i * 3)
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    g.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1))
    g.setAttribute('aColor', new THREE.BufferAttribute(color, 3))
    return g
  }, [p])
  useEffect(() => () => geo.dispose(), [geo])
  const standMap = useMemo(() => (p.additive ? null : standTexture()), [p])
  useEffect(() => () => standMap?.dispose(), [standMap])
  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uPixelRatio: { value: 1 },
      uTwinkle: { value: p.crowdTwinkle },
      uSize: { value: p.crowdSize },
      uHaze: { value: new THREE.Color(p.fog) },
      uHazeAmt: { value: p.crowdHaze },
    }),
    [p],
  )
  useFrame((s) => {
    uniforms.uTime.value = s.clock.elapsedTime
    uniforms.uPixelRatio.value = dpr
  })
  return (
    <>
      {/* stand silhouette */}
      <mesh position={[0, 2.2, LAYOUT.centerZ]}>
        <cylinderGeometry args={[23.8, 17.6, 4.4, 72, 1, true, Math.PI * 0.26, Math.PI * 1.48]} />
        {standMap ? (
          <meshBasicMaterial map={standMap} side={THREE.DoubleSide} />
        ) : (
          <meshBasicMaterial color={p.stand} side={THREE.DoubleSide} fog={false} />
        )}
      </mesh>
      <points geometry={geo} renderOrder={1}>
        <shaderMaterial
          vertexShader={crowdVertex}
          fragmentShader={crowdFragment}
          uniforms={uniforms}
          transparent
          depthWrite={false}
          blending={p.additive ? THREE.AdditiveBlending : THREE.NormalBlending}
        />
      </points>
    </>
  )
}
