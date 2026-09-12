import { PauseCircle } from 'lucide-react'
import { motion } from 'motion/react'
import { cn } from '@/lib/cn'

/** `meta.bookings_enabled === false`: say so up front instead of letting the Book button 503. */
export function BookingsPaused({ className }: { className?: string }) {
  return (
    <motion.div
      role="status"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn('flex items-start gap-3 rounded-2xl bg-sun/10 p-4 ring-1 ring-sun/30', className)}
    >
      <PauseCircle className="mt-0.5 h-5 w-5 shrink-0 text-sun" />
      <div className="text-sm">
        <div className="font-semibold text-fg">New bookings are paused right now</div>
        <div className="mt-0.5 text-xs text-muted">You can still browse slots and join games that are already forming. Please check back soon.</div>
      </div>
    </motion.div>
  )
}
