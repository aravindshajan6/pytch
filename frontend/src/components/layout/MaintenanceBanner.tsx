import { Megaphone, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useState } from 'react'
import { useMeta } from '@/hooks/useMeta'
import { cn } from '@/lib/cn'

const BANNER_DISMISS_KEY = 'pytch-banner-dismissed'

/**
 * Admin-controlled notice (`meta.maintenance_banner`) — shown in the app shell, on the landing page and
 * on login. Dismissal is remembered per message for the session (a new message shows again).
 * `bar`: full-width strip (app header). `floating`: a rounded glass pill for pages without a header bar.
 */
export function MaintenanceBanner({ variant = 'bar', className }: { variant?: 'bar' | 'floating'; className?: string }) {
  const { data: meta } = useMeta()
  const message = meta?.maintenance_banner?.trim() || null
  const [dismissed, setDismissed] = useState<string | null>(() => {
    try {
      return sessionStorage.getItem(BANNER_DISMISS_KEY)
    } catch {
      return null
    }
  })
  const floating = variant === 'floating'
  return (
    <AnimatePresence initial={false}>
      {message && dismissed !== message && (
        <motion.div
          role="status"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          className={cn('overflow-hidden', !floating && 'border-b border-sun/25 bg-sun/12', className)}
        >
          <div
            className={cn(
              'mx-auto flex items-center gap-2.5 text-sm',
              floating
                ? 'max-w-6xl rounded-2xl bg-sun/12 px-4 py-2 ring-1 ring-sun/30 backdrop-blur-xl [[data-theme=light]_&]:bg-[color-mix(in_srgb,var(--color-sun)_14%,var(--color-snow))]'
                : 'max-w-7xl px-4 py-2 sm:px-6',
            )}
          >
            <Megaphone className="h-4 w-4 shrink-0 text-sun" aria-hidden />
            <p className="min-w-0 flex-1 text-fg/90">{message}</p>
            <button
              type="button"
              onClick={() => {
                setDismissed(message)
                try {
                  sessionStorage.setItem(BANNER_DISMISS_KEY, message)
                } catch {
                  /* storage unavailable */
                }
              }}
              aria-label="Dismiss notice"
              className="-mr-1.5 flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted transition hover:bg-white/8 hover:text-fg"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
