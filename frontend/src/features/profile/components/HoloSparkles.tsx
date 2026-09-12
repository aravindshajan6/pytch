import { Sparkles } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { useReducedMotion } from 'motion/react'
import { cssVar, useResolvedTheme } from '@/stores/theme'

/**
 * R3F particle aura behind elite / verified player cards. Lazy-loaded so the
 * three.js chunk only ships to profiles that earn it. WebGL can't read CSS vars,
 * so the colour tokens are resolved for the active theme (re-rendered on change).
 */
export default function HoloSparkles({ tokens }: { tokens: [string, string] }) {
  const reduce = useReducedMotion()
  const theme = useResolvedTheme()
  const colors = tokens.map((t) => cssVar(t) || '#ffffff')
  return (
    <Canvas
      aria-hidden
      className="pointer-events-none !absolute inset-0"
      dpr={[1, 1.5]}
      frameloop={reduce ? 'demand' : 'always'}
      gl={{ alpha: true, antialias: false, powerPreference: 'low-power' }}
      camera={{ position: [0, 0, 6], fov: 50 }}
    >
      <Sparkles count={70} scale={[7, 7, 3]} size={theme === 'light' ? 3.5 : 4} speed={0.35} noise={0.6} color={colors[0]} opacity={0.9} />
      <Sparkles count={40} scale={[5, 6, 2]} size={2.5} speed={0.6} noise={1} color={colors[1]} opacity={0.8} />
    </Canvas>
  )
}
