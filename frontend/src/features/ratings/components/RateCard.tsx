import { Check, EyeOff, UserX } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { Avatar } from '@/components/ui/Avatar'
import { Switch } from '@/components/ui/Form'
import { TierBadge, TrueSkillPill } from '@/components/ui/PlayerBits'
import { cn } from '@/lib/cn'
import { hueFrom } from '@/lib/format'
import { useResolvedTheme } from '@/stores/theme'
import type { UserPublic } from '@/types/api'
import { isComplete, type RatingDraft } from '../draft'
import { StarRating } from './StarRating'

interface RateCardProps {
  user: UserPublic
  index: number
  total: number
  draft: RatingDraft
  tags: string[]
  onChange: (patch: Partial<RatingDraft>) => void
}

export function RateCard({ user, index, total, draft, tags, onChange }: RateCardProps) {
  const hue = hueFrom(user.id)
  const light = useResolvedTheme() === 'light'
  const done = isComplete(draft)

  const toggleTag = (t: string) => {
    if (draft.tags.includes(t)) onChange({ tags: draft.tags.filter((x) => x !== t) })
    else if (draft.tags.length < 3) onChange({ tags: [...draft.tags, t] })
  }

  return (
    <div className="glass-strong relative overflow-hidden rounded-[2rem] shadow-card">
      {/* header */}
      <div
        className="relative px-5 pt-5 pb-4"
        style={{
          // Player-hued wash: deep on night, a lighter pastel on day so the name stays crisp.
          background: light
            ? `linear-gradient(160deg, hsl(${hue} 75% 55% / 0.24), transparent 72%)`
            : `linear-gradient(160deg, hsl(${hue} 70% 30% / 0.55), transparent 70%)`,
        }}
      >
        <div className="flex items-center justify-between">
          <span className="font-mono text-xs text-muted">
            {index + 1} / {total}
          </span>
          <AnimatePresence>
            {done && (
              <motion.span
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0, opacity: 0 }}
                transition={{ type: 'spring', stiffness: 500, damping: 20 }}
                className="inline-flex items-center gap-1 rounded-full bg-volt px-2.5 py-1 text-[11px] font-bold text-ink-950"
              >
                <Check className="h-3 w-3" strokeWidth={3} /> Rated
              </motion.span>
            )}
          </AnimatePresence>
        </div>
        <div className="mt-2 flex items-center gap-4">
          <Avatar user={user} size="xl" ring />
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-xl font-bold sm:text-2xl">{user.name}</h2>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <TierBadge tier={user.tier} />
              <TrueSkillPill value={user.true_skill} />
              {user.position && <span className="text-xs text-muted">{user.position}</span>}
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-3 px-5 pb-5">
        {/* showed up */}
        <div
          className={cn(
            'flex items-center justify-between gap-3 rounded-2xl p-3 ring-1 transition-colors',
            draft.showed_up ? 'bg-white/4 ring-white/8' : 'bg-flare/10 ring-flare/40',
          )}
        >
          <div className="flex items-center gap-3">
            <div className={cn('flex h-9 w-9 items-center justify-center rounded-xl', draft.showed_up ? 'bg-mint/15 text-mint' : 'bg-flare/20 text-flare')}>
              {draft.showed_up ? <Check className="h-5 w-5" /> : <UserX className="h-5 w-5" />}
            </div>
            <div>
              <div className="text-sm font-semibold">Showed up?</div>
              <div className="text-[11px] text-subtle">{draft.showed_up ? 'They were there' : 'Reported as a no-show'}</div>
            </div>
          </div>
          <Switch checked={draft.showed_up} onChange={(v) => onChange({ showed_up: v })} label={`${user.name} showed up`} tone={draft.showed_up ? 'volt' : 'flare'} />
        </div>

        <AnimatePresence initial={false}>
          {draft.showed_up ? (
            <motion.div
              key="rows"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="space-y-3 overflow-hidden"
            >
              <StarRating
                label="Skill"
                hint="How good on the ball?"
                value={draft.skill}
                onChange={(v) => onChange({ skill: v })}
                words={['Struggled', 'Getting there', 'Solid', 'Class', 'Unreal']}
              />
              <StarRating
                label="Fair play"
                hint="Played clean, kept it cool?"
                value={draft.fair_play}
                onChange={(v) => onChange({ fair_play: v })}
                words={['Dirty', 'Hot-headed', 'Fine', 'Sporting', 'Gentleman']}
              />
              <StarRating
                label="Reliability"
                hint="On time, committed, stayed till the end?"
                value={draft.reliability}
                onChange={(v) => onChange({ reliability: v })}
                words={['Flaky', 'Late', 'OK', 'Dependable', 'Rock solid']}
              />
            </motion.div>
          ) : (
            <motion.p
              key="noshow"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="rounded-2xl bg-white/4 p-3 text-xs text-muted ring-1 ring-white/8"
            >
              No-shows skip skill ratings. If two or more teammates report it, their reliability takes the hit.
            </motion.p>
          )}
        </AnimatePresence>

        {/* tags */}
        {draft.showed_up && tags.length > 0 && (
          <div>
            <div className="mb-2 flex items-center justify-between text-xs">
              <span className="font-semibold tracking-wider text-muted uppercase">Standout traits</span>
              <span className={cn('font-mono', draft.tags.length === 3 ? 'text-volt' : 'text-subtle')}>{draft.tags.length}/3</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {tags.map((t) => {
                const on = draft.tags.includes(t)
                const blocked = !on && draft.tags.length >= 3
                return (
                  <motion.button
                    key={t}
                    type="button"
                    aria-pressed={on}
                    disabled={blocked}
                    onClick={() => toggleTag(t)}
                    whileTap={{ scale: 0.9 }}
                    className={cn(
                      'h-8 cursor-pointer rounded-full px-3 text-xs font-medium transition-all disabled:cursor-not-allowed disabled:opacity-35',
                      on
                        ? 'bg-volt text-ink-950 shadow-[0_0_18px_-4px_color-mix(in_srgb,_var(--color-volt)_80%,_transparent)]'
                        : 'bg-white/5 text-fg/75 ring-1 ring-white/10 hover:bg-white/10',
                    )}
                  >
                    {t}
                  </motion.button>
                )
              })}
            </div>
          </div>
        )}

        <p className="flex items-center justify-center gap-1.5 pt-1 text-[11px] text-subtle">
          <EyeOff className="h-3 w-3" /> Ratings are anonymous and only shown in aggregate
        </p>
      </div>
    </div>
  )
}
