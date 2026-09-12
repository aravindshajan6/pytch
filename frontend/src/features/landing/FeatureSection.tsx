import { motion, useReducedMotion, useScroll, useTransform, type Variants } from 'motion/react'
import { useRef } from 'react'
import { cn } from '@/lib/cn'
import { alpha } from '@/lib/color'

export type Accent = 'volt' | 'flare' | 'grape' | 'electric' | 'sun'

/** `text` colours copy/icons; `tint` drives the translucent washes (theme vars, so light mode gets deepened accents). */
const ACCENT: Record<Accent, { text: string; tint: string }> = {
  volt: { text: 'var(--color-volt)', tint: 'var(--color-volt)' },
  flare: { text: 'var(--color-flare)', tint: 'var(--color-flare)' },
  grape: { text: 'var(--color-grape-soft)', tint: 'var(--color-grape)' },
  electric: { text: 'var(--color-electric)', tint: 'var(--color-electric)' },
  sun: { text: 'var(--color-sun)', tint: 'var(--color-sun)' },
}

const container: Variants = { hidden: {}, show: { transition: { staggerChildren: 0.09 } } }
const item: Variants = {
  hidden: { opacity: 0, y: 24 },
  show: { opacity: 1, y: 0, transition: { duration: 0.7, ease: [0.16, 1, 0.3, 1] } },
}

export interface FeatureSectionProps {
  id: string
  index: string
  eyebrow: string
  title: React.ReactNode
  body: React.ReactNode
  points: { icon: React.ComponentType<{ className?: string }>; text: React.ReactNode }[]
  accent: Accent
  demo: React.ReactNode
  flip?: boolean
}

/** One differentiator: copy + a live mini-UI, with scroll parallax and a giant outlined index number. */
export function FeatureSection({ id, index, eyebrow, title, body, points, accent, demo, flip }: FeatureSectionProps) {
  const ref = useRef<HTMLElement>(null)
  const reduced = useReducedMotion()
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end start'] })
  const demoY = useTransform(scrollYProgress, [0, 1], reduced ? [0, 0] : [70, -70])
  const numY = useTransform(scrollYProgress, [0, 1], reduced ? [0, 0] : [110, -110])
  const glowScale = useTransform(scrollYProgress, [0, 0.5, 1], [0.7, 1.1, 0.7])
  const a = ACCENT[accent]

  return (
    <section ref={ref} id={id} aria-labelledby={`${id}-title`} className="relative py-20 sm:py-28 lg:py-36">
      <div className="mx-auto grid max-w-6xl items-center gap-14 px-5 sm:px-8 lg:grid-cols-2 lg:gap-20">
        <div className={cn('relative', flip && 'lg:order-2')}>
          <motion.span
            aria-hidden
            style={{
              y: numY,
              backgroundImage: `linear-gradient(180deg, ${alpha(a.tint, 0.13)}, ${alpha(a.tint, 0)} 80%)`,
              WebkitBackgroundClip: 'text',
              backgroundClip: 'text',
            }}
            className="pointer-events-none absolute -top-20 -left-3 font-display text-[8.5rem] leading-none font-black text-transparent select-none sm:-top-24 sm:text-[12rem]"
          >
            {index}
          </motion.span>
          <motion.div variants={container} initial="hidden" whileInView="show" viewport={{ once: true, margin: '-12% 0px' }} className="relative">
            <motion.div variants={item} className="flex items-center gap-3 text-xs font-bold tracking-[0.22em] uppercase" style={{ color: a.text }}>
              <span className="h-px w-8" style={{ background: a.text }} />
              {eyebrow}
            </motion.div>
            <motion.h2 variants={item} id={`${id}-title`} className="mt-4 text-[clamp(2rem,5.2vw,3.4rem)] leading-[1.02] font-bold">
              {title}
            </motion.h2>
            <motion.p variants={item} className="mt-5 max-w-xl text-base leading-relaxed text-fg/70 sm:text-lg">
              {body}
            </motion.p>
            <ul className="mt-8 space-y-3.5">
              {points.map((p, i) => (
                <motion.li key={i} variants={item} className="flex items-start gap-3 text-sm text-fg/85 sm:text-base">
                  <span
                    className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
                    style={{ background: alpha(a.tint, 0.12), color: a.text, boxShadow: `inset 0 0 0 1px ${alpha(a.tint, 0.3)}` }}
                  >
                    <p.icon className="h-4 w-4" />
                  </span>
                  <span className="pt-0.5">{p.text}</span>
                </motion.li>
              ))}
            </ul>
          </motion.div>
        </div>

        <motion.div style={{ y: demoY }} className={cn('relative', flip && 'lg:order-1')}>
          <motion.div
            aria-hidden
            style={{ scale: glowScale, background: `radial-gradient(closest-side, ${alpha(a.tint, 0.18)}, transparent)` }}
            className="pointer-events-none absolute -inset-10 -z-10 blur-2xl"
          />
          <motion.div
            initial={{ opacity: 0, y: 40, scale: 0.96 }}
            whileInView={{ opacity: 1, y: 0, scale: 1 }}
            viewport={{ once: true, margin: '-10% 0px' }}
            transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
          >
            {demo}
          </motion.div>
        </motion.div>
      </div>
    </section>
  )
}
