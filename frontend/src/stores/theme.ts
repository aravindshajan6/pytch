import { useEffect, useSyncExternalStore } from 'react'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type ThemeMode = 'dark' | 'light' | 'system'
export type ResolvedTheme = 'dark' | 'light'

/** Persisted under this key; index.html reads it before first paint to avoid a flash. */
export const THEME_STORAGE_KEY = 'pytch-theme'

interface ThemeState {
  mode: ThemeMode
  setMode: (mode: ThemeMode) => void
}

export const useThemeStore = create<ThemeState>()(
  persist((set) => ({ mode: 'dark', setMode: (mode) => set({ mode }) }), { name: THEME_STORAGE_KEY }),
)

const media = () => window.matchMedia('(prefers-color-scheme: light)')

function resolve(mode: ThemeMode): ResolvedTheme {
  if (mode === 'system') return media().matches ? 'light' : 'dark'
  return mode
}

function apply(theme: ResolvedTheme) {
  const root = document.documentElement
  root.dataset.theme = theme
  root.classList.toggle('dark', theme === 'dark')
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'light' ? '#f2f5ef' : '#05080a')
}

/** Mount once (in Providers): keeps <html data-theme> in sync with the store and the OS setting. */
export function useApplyTheme() {
  const mode = useThemeStore((s) => s.mode)
  useEffect(() => {
    apply(resolve(mode))
    if (mode !== 'system') return
    const mql = media()
    const onChange = () => apply(resolve('system'))
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [mode])
}

/** The theme actually on screen — for code that needs JS colours (canvas, WebGL, toasts, maps). */
export function useResolvedTheme(): ResolvedTheme {
  return useSyncExternalStore(
    (cb) => {
      const obs = new MutationObserver(cb)
      obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
      return () => obs.disconnect()
    },
    () => (document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'),
    () => 'dark',
  )
}

/** Read a CSS custom property (e.g. '--color-volt') as resolved for an element (default <html>). */
export function cssVar(name: string, el: Element = document.documentElement): string {
  return getComputedStyle(el).getPropertyValue(name).trim()
}
