import { BadgeCheck, CalendarClock, CloudRain, Coins, Film, Home, Percent, Pin, Radar, RefreshCcw, ShieldCheck, Timer, Users, Zap } from 'lucide-react'
import { motion } from 'motion/react'
import { useEffect } from 'react'
import { BenchDemo } from './demos/BenchDemo'
import { HighlightsDemo } from './demos/HighlightsDemo'
import { SkillDemo } from './demos/SkillDemo'
import { SplitDemo } from './demos/SplitDemo'
import { WeatherDemo } from './demos/WeatherDemo'
import { FeatureSection } from './FeatureSection'
import { Hero } from './Hero'
import { LandingNav } from './LandingNav'
import { FinalCta, HowItWorks, LandingFooter, SocialProof, StatsMarquee } from './Sections'
import { useLenis } from './useLenis'

/**
 * Public marketing page — the first impression. 3D floodlit hero, a live
 * stats marquee, then one scroll-story section per differentiator, each with
 * an animated mini-UI of the real feature.
 */
export default function LandingPage() {
  const { scrollTo } = useLenis()

  useEffect(() => {
    const prev = document.title
    document.title = 'PYTCH — Play more. Chase less.'
    return () => void (document.title = prev)
  }, [])

  return (
    <div className="relative min-h-dvh overflow-x-clip bg-ink-900 text-fg">
      <a
        href="#features"
        onClick={(e) => {
          e.preventDefault()
          scrollTo('#features')
        }}
        className="sr-only z-[70] rounded-lg bg-volt px-4 py-2 font-semibold text-ink-950 focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to content
      </a>
      <div aria-hidden className="noise pointer-events-none fixed inset-0 z-[55]" />
      <LandingNav onJump={scrollTo} />

      <main>
        <Hero onJump={scrollTo} />
        <StatsMarquee />

        <div id="features" tabIndex={-1} className="relative outline-none">
          <div className="mx-auto max-w-6xl px-5 pt-24 sm:px-8 sm:pt-32">
            <motion.div
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
              className="max-w-3xl"
            >
              <div className="text-xs font-bold tracking-[0.22em] text-volt uppercase">Why PYTCH</div>
              <h2 className="mt-4 text-[clamp(2.2rem,6vw,4.2rem)] leading-[1] font-black">
                Five problems every Sunday-league captain knows. <span className="text-fg/35">Solved.</span>
              </h2>
            </motion.div>
          </div>

          <FeatureSection
            id="split"
            index="01"
            accent="volt"
            eyebrow="Zero-friction split payments"
            title={
              <>
                Nobody fronts <span className="text-volt">₹1,500</span> again.
              </>
            }
            body="Book the slot and PYTCH holds it for 30 minutes. Everyone pays their own share from one link — credits apply first. All paid? Locked. Not filled in time? Every rupee lands back instantly."
            points={[
              { icon: Timer, text: 'All-or-nothing 30-minute hold — no half-booked games' },
              { icon: Coins, text: '₹1,500 ÷ 10 = ₹150 each, rounded to the rupee' },
              { icon: RefreshCcw, text: 'Auto-refund to Pytch Credits if it doesn’t fill' },
            ]}
            demo={<SplitDemo />}
          />

          <FeatureSection
            id="bench"
            index="02"
            accent="flare"
            flip
            eyebrow="“Ready to sub” live bench"
            title={
              <>
                Two drop out at 6:30? <span className="text-gradient-flare">Bench has you.</span>
              </>
            }
            body="Go live on the bench and you’re on call for games within your radius. When someone bails, an SOS pings nearby subs — first to accept gets the spot at 20% off, paid for by the dropout."
            points={[
              { icon: Radar, text: 'Radar of players within 5 km — fuzzed, never exact locations' },
              { icon: Percent, text: '20% off for the sub, funded by the late dropout' },
              { icon: Zap, text: '+150 XP and the Hero Sub badge for answering' },
            ]}
            demo={<BenchDemo />}
          />

          <FeatureSection
            id="skill"
            index="03"
            accent="grape"
            eyebrow="Peer-verified True Skill"
            title={
              <>
                Your rating is earned, <span className="text-[var(--color-grape-soft)]">not typed.</span>
              </>
            }
            body="After every match your squad rates you anonymously on skill, fair play and reliability. Credibility-weighted, outlier-dampened, and turned into a 0–100 True Skill that hosts can gate games on."
            points={[
              { icon: Users, text: 'Only people you actually played with can rate you' },
              { icon: ShieldCheck, text: 'Revenge ratings and friend-boosting get dampened' },
              { icon: BadgeCheck, text: 'Hit the bar to earn the Verified Playmaker badge' },
            ]}
            demo={<SkillDemo />}
          />

          <FeatureSection
            id="highlights"
            index="04"
            accent="electric"
            flip
            eyebrow="Turf-cam highlight reels"
            title={
              <>
                That volley? <span className="text-electric">It’s on tape.</span>
              </>
            }
            body="Add the turf camera at checkout and the full match lands in your locker after the whistle. Scrub, trim a 60-second clip, pin your best three to your player card."
            points={[
              { icon: Film, text: 'Full-match recording, split across the squad' },
              { icon: Pin, text: 'Pin up to 3 clips to your profile' },
              { icon: Zap, text: 'Trending highlights feed across Kochi' },
            ]}
            demo={<HighlightsDemo />}
          />

          <FeatureSection
            id="weather"
            index="05"
            accent="sun"
            eyebrow="Weather-smart rescheduling"
            title={
              <>
                Monsoon? <span className="text-sun">Moved indoors</span> in one tap.
              </>
            }
            body="We watch the hourly forecast for every outdoor game. Rain on the radar and the host gets indoor alternatives at the same time — we cover up to ₹200 of the difference. Or rain-check for a full refund plus ₹25."
            points={[
              { icon: CloudRain, text: 'Hyper-local hourly forecast for every outdoor slot' },
              { icon: Home, text: 'Indoor pitches within 10 km, same kick-off, locked atomically' },
              { icon: CalendarClock, text: 'Everyone’s notified — nobody refreshes the group chat' },
            ]}
            demo={<WeatherDemo />}
          />
        </div>

        <HowItWorks />
        <SocialProof />
        <FinalCta />
      </main>

      <LandingFooter onJump={scrollTo} />
    </div>
  )
}
