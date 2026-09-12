import { ArrowRight } from 'lucide-react'
import { motion, useMotionValueEvent, useScroll, useSpring } from 'motion/react'
import { useState } from 'react'
import { Logo } from '@/components/layout/Logo'
import { LinkButton } from '@/components/ui/Button'
import { ThemeToggle } from '@/components/ui/ThemeToggle'
import { cn } from '@/lib/cn'
import { useAuth } from '@/stores/auth'

const LINKS = [
  { href: '#features', label: 'Features' },
  { href: '#how', label: 'How it works' },
  { href: '#players', label: 'Players' },
]

/** Fixed top bar: transparent over the hero, frosted once you scroll; volt scroll-progress hairline. */
export function LandingNav({ onJump }: { onJump: (selector: string) => void }) {
  const authed = useAuth((s) => !!s.accessToken)
  const { scrollY, scrollYProgress } = useScroll()
  const progress = useSpring(scrollYProgress, { stiffness: 140, damping: 30, restDelta: 0.001 })
  const [scrolled, setScrolled] = useState(false)
  const [hidden, setHidden] = useState(false)

  useMotionValueEvent(scrollY, 'change', (y) => {
    const prev = scrollY.getPrevious() ?? 0
    setScrolled(y > 24)
    if (y > 600 && y > prev + 4) setHidden(true)
    else if (y < prev - 4 || y <= 600) setHidden(false)
  })

  return (
    <>
    <motion.header
      initial={{ y: -80, opacity: 0 }}
      animate={{ y: hidden ? -80 : 0, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 260, damping: 30 }}
      className="fixed inset-x-0 top-0 z-50"
    >
      <div
        className={cn(
          'mx-auto mt-3 flex h-14 max-w-6xl items-center justify-between gap-4 rounded-2xl px-4 transition-[background,box-shadow,border-color] duration-500 sm:px-5',
          'mx-3 sm:mx-6 xl:mx-auto',
          scrolled ? 'glass-strong shadow-card' : 'border border-transparent',
        )}
      >
        <Logo to="/" />
        <nav aria-label="Sections" className="hidden items-center gap-1 md:flex">
          {LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              onClick={(e) => {
                e.preventDefault()
                onJump(l.href)
              }}
              className="rounded-lg px-3 py-2 text-sm font-medium text-fg/70 transition hover:bg-white/5 hover:text-fg"
            >
              {l.label}
            </a>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <ThemeToggle className="h-9 w-9 rounded-lg [&_svg]:h-[18px] [&_svg]:w-[18px]" />
          {authed ? (
            <LinkButton to="/app" size="sm" className="h-9 px-4">
              Open app <ArrowRight className="h-4 w-4" />
            </LinkButton>
          ) : (
            <>
              <LinkButton to="/login" variant="ghost" size="sm" className="hidden h-9 sm:inline-flex">
                Log in
              </LinkButton>
              <LinkButton to="/login" size="sm" className="h-9 px-4">
                Start playing
              </LinkButton>
            </>
          )}
        </div>
      </div>
    </motion.header>
    <motion.div
      aria-hidden
      className="fixed inset-x-0 top-0 z-[60] h-[2px] origin-left bg-gradient-to-r from-volt via-mint to-electric"
      style={{ scaleX: progress }}
    />
    </>
  )
}
