import { Monitor, Moon, Sun } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { cn } from '@/lib/cn'
import { useResolvedTheme, useThemeStore, type ThemeMode } from '@/stores/theme'
import { Segmented } from './Segmented'

/** Icon button: flips between light and dark (leaves "system" for an explicit choice). */
export function ThemeToggle({ className }: { className?: string }) {
  const resolved = useResolvedTheme()
  const setMode = useThemeStore((s) => s.setMode)
  const next = resolved === 'dark' ? 'light' : 'dark'
  return (
    <button
      type="button"
      onClick={() => setMode(next)}
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
      className={cn(
        'relative flex h-10 w-10 cursor-pointer items-center justify-center overflow-hidden rounded-xl bg-white/5 ring-1 ring-white/10 transition hover:bg-white/10',
        className,
      )}
    >
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={resolved}
          initial={{ y: 18, rotate: -90, opacity: 0 }}
          animate={{ y: 0, rotate: 0, opacity: 1 }}
          exit={{ y: -18, rotate: 90, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 420, damping: 26 }}
          className="inline-flex"
        >
          {resolved === 'dark' ? <Moon className="h-5 w-5" /> : <Sun className="h-5 w-5 text-sun" />}
        </motion.span>
      </AnimatePresence>
    </button>
  )
}

/** Three-way selector for settings screens. */
export function ThemeSelector({ className, size = 'sm' }: { className?: string; size?: 'sm' | 'md' }) {
  const mode = useThemeStore((s) => s.mode)
  const setMode = useThemeStore((s) => s.setMode)
  return (
    <Segmented<ThemeMode>
      value={mode}
      onChange={setMode}
      size={size}
      className={className}
      options={[
        { value: 'dark', label: <><Moon className="h-3.5 w-3.5" /> Dark</> },
        { value: 'light', label: <><Sun className="h-3.5 w-3.5" /> Light</> },
        { value: 'system', label: <><Monitor className="h-3.5 w-3.5" /> System</> },
      ]}
    />
  )
}
