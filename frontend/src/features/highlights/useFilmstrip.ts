import { useEffect, useState } from 'react'

/**
 * Grabs `count` evenly spaced thumbnails from a video via an offscreen <video> +
 * <canvas>. Frames stream in as they're captured. Silently gives up on CORS /
 * decode errors (callers fall back to a generated strip).
 */
export function useFilmstrip(src: string | null | undefined, duration: number | null | undefined, count = 10) {
  const [frames, setFrames] = useState<string[]>([])

  useEffect(() => {
    setFrames([])
    if (!src || !duration || duration <= 0) return
    let cancelled = false
    const video = document.createElement('video')
    video.muted = true
    video.preload = 'auto'
    video.playsInline = true
    video.crossOrigin = 'anonymous'
    const canvas = document.createElement('canvas')
    canvas.width = 160
    canvas.height = 90
    const ctx = canvas.getContext('2d')
    const out: string[] = []

    const grab = (i: number) => {
      if (cancelled || !ctx || i >= count) return
      const onSeeked = () => {
        video.removeEventListener('seeked', onSeeked)
        if (cancelled) return
        try {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
          out.push(canvas.toDataURL('image/jpeg', 0.55))
          setFrames([...out])
        } catch {
          cancelled = true // tainted canvas — stop quietly
          return
        }
        grab(i + 1)
      }
      video.addEventListener('seeked', onSeeked)
      video.currentTime = Math.min(duration - 0.1, ((i + 0.5) * duration) / count)
    }

    const onLoaded = () => grab(0)
    const onError = () => {
      cancelled = true
    }
    video.addEventListener('loadeddata', onLoaded, { once: true })
    video.addEventListener('error', onError, { once: true })
    video.src = src

    return () => {
      cancelled = true
      video.removeEventListener('loadeddata', onLoaded)
      video.removeEventListener('error', onError)
      video.removeAttribute('src')
      video.load()
    }
  }, [src, duration, count])

  return frames
}
