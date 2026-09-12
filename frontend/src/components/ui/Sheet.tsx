import { X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useIsDesktop } from '@/hooks/useMediaQuery'
import { cn } from '@/lib/cn'

export interface SheetProps {
  open: boolean
  onClose: () => void
  title?: React.ReactNode
  description?: React.ReactNode
  children: React.ReactNode
  /** Desktop dialog width */
  size?: 'sm' | 'md' | 'lg'
  className?: string
  dismissible?: boolean
}

const WIDTH = { sm: 'max-w-md', md: 'max-w-lg', lg: 'max-w-2xl' }

/** Bottom sheet on mobile (drag to dismiss), centred dialog on desktop. */
export function Sheet({ open, onClose, title, description, children, size = 'md', className, dismissible = true }: SheetProps) {
  const desktop = useIsDesktop()

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && dismissible && onClose()
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open, onClose, dismissible])

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[1000] flex items-end justify-center lg:items-center" role="dialog" aria-modal>
          <motion.div
            className="absolute inset-0 bg-ink-950/70 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => dismissible && onClose()}
          />
          <motion.div
            className={cn(
              'glass-strong relative z-10 max-h-[92dvh] w-full overflow-y-auto shadow-2xl',
              desktop ? `rounded-3xl ${WIDTH[size]} mx-4` : 'safe-bottom rounded-t-[2rem]',
              className,
            )}
            initial={desktop ? { opacity: 0, scale: 0.94, y: 20 } : { y: '100%' }}
            animate={desktop ? { opacity: 1, scale: 1, y: 0 } : { y: 0 }}
            exit={desktop ? { opacity: 0, scale: 0.96, y: 10 } : { y: '100%' }}
            transition={{ type: 'spring', stiffness: 380, damping: 36 }}
            drag={!desktop && dismissible ? 'y' : false}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.6 }}
            onDragEnd={(_, info) => info.offset.y > 120 && onClose()}
          >
            {!desktop && <div className="mx-auto mt-3 h-1.5 w-12 rounded-full bg-white/20" />}
            {(title || dismissible) && (
              <div className="flex items-start justify-between gap-4 px-6 pt-5">
                <div>
                  {title && <h3 className="text-lg font-semibold">{title}</h3>}
                  {description && <p className="mt-1 text-sm text-muted">{description}</p>}
                </div>
                {dismissible && (
                  <button
                    onClick={onClose}
                    className="-mr-2 cursor-pointer rounded-full p-2 text-muted transition hover:bg-white/10 hover:text-fg"
                    aria-label="Close"
                  >
                    <X className="h-5 w-5" />
                  </button>
                )}
              </div>
            )}
            <div className="px-6 pt-4 pb-6">{children}</div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
