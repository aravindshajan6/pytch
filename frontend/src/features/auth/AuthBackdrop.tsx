import { motion } from 'motion/react'

/** Slow-drifting floodlight orbs over a masked pitch grid — the ambient layer for auth screens. */
export function AuthBackdrop() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-ink-900">
      <motion.div
        className="absolute -top-40 -left-32 h-[34rem] w-[34rem] rounded-full bg-volt/[0.13] blur-[110px]"
        animate={{ x: [0, 80, -20, 0], y: [0, 60, 120, 0] }}
        transition={{ duration: 22, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="absolute top-1/3 -right-40 h-[30rem] w-[30rem] rounded-full bg-electric/[0.1] blur-[110px]"
        animate={{ x: [0, -90, 20, 0], y: [0, -40, 60, 0] }}
        transition={{ duration: 26, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="absolute -bottom-48 left-1/4 h-[28rem] w-[28rem] rounded-full bg-grape/[0.1] blur-[120px]"
        animate={{ x: [0, 60, -60, 0], y: [0, -50, 0, 0] }}
        transition={{ duration: 30, repeat: Infinity, ease: 'easeInOut' }}
      />
      <div className="pitch-grid absolute inset-0 [mask-image:radial-gradient(ellipse_at_50%_40%,black_10%,transparent_70%)]" />
      <div className="noise absolute inset-0" />
    </div>
  )
}
