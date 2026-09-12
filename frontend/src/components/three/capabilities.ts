/** Device capability probes used to decide whether to mount WebGL scenes. */

let webgl: boolean | null = null

/** True when a WebGL (2 or 1) context can be created. Cached; the probe context is released immediately. */
export function hasWebGL(): boolean {
  if (webgl !== null) return webgl
  try {
    const canvas = document.createElement('canvas')
    const ctx = (canvas.getContext('webgl2') ?? canvas.getContext('webgl')) as WebGLRenderingContext | null
    webgl = !!ctx
    ctx?.getExtension('WEBGL_lose_context')?.loseContext()
  } catch {
    webgl = false
  }
  return webgl
}

export const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** Rough "low power" heuristic: few cores or a small touch screen. */
export function isLowPower(): boolean {
  const cores = navigator.hardwareConcurrency ?? 4
  const touchSmall = window.matchMedia('(pointer: coarse)').matches && window.innerWidth < 768
  return cores <= 4 || touchSmall
}
