import { ArrowLeft, Check, MapPin, Palette } from 'lucide-react'
import { motion } from 'motion/react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { FilterChip } from '@/components/ui/Chip'
import { Input, Label, Textarea } from '@/components/ui/Form'
import { Segmented } from '@/components/ui/Segmented'
import { ErrorState, PageHeader, Skeleton } from '@/components/ui/States'
import { ThemeSelector } from '@/components/ui/ThemeToggle'
import { useMe } from '@/hooks/useMe'
import { useMeta } from '@/hooks/useMeta'
import { errorMessage } from '@/lib/api/client'
import { cn } from '@/lib/cn'
import { SPORT_LIST, sportInfo } from '@/lib/sports'
import type { DominantFoot, PlayerProfile, SkillLevel, Sport, UserMe } from '@/types/api'
import { useMyProfile, useUpdateProfile } from './api'
import { PlayerCard } from './components/PlayerCard'

const POSITIONS: Record<Sport, string[]> = {
  football: ['Goalkeeper', 'Defender', 'Midfielder', 'Winger', 'Forward'],
  cricket: ['Batter', 'Bowler', 'All-rounder', 'Wicket-keeper'],
  badminton: ['Singles', 'Doubles'],
  pickleball: ['Singles', 'Doubles'],
  basketball: ['Guard', 'Forward', 'Center'],
}

const LEVELS: { value: SkillLevel; label: string; emoji: string; hint: string }[] = [
  { value: 'beginner', label: 'Beginner', emoji: '🌱', hint: 'Just for fun' },
  { value: 'intermediate', label: 'Intermediate', emoji: '⚡', hint: 'Play most weeks' },
  { value: 'advanced', label: 'Advanced', emoji: '🔥', hint: 'Club-level' },
  { value: 'pro', label: 'Pro', emoji: '👑', hint: 'Competitive' },
]

interface FormState {
  name: string
  bio: string
  position: string
  dominant_foot: DominantFoot | null
  preferred_sports: Sport[]
  self_skill_level: SkillLevel | null
  home_area: string | null
}

export default function EditProfilePage() {
  const me = useMe()
  const profile = useMyProfile()

  if (me.isLoading && !me.user)
    return (
      <div className="space-y-4">
        <Skeleton className="h-16" />
        <Skeleton className="h-96" />
      </div>
    )
  if (!me.user) return <ErrorState error={me.error} onRetry={() => me.refetch()} />
  return <EditForm user={me.user} profile={profile.data} />
}

function EditForm({ user, profile }: { user: UserMe; profile: PlayerProfile | undefined }) {
  const navigate = useNavigate()
  const meta = useMeta()
  const update = useUpdateProfile()
  const [f, setF] = useState<FormState>(() => ({
    name: user.name,
    bio: user.bio ?? '',
    position: user.position ?? '',
    dominant_foot: user.dominant_foot,
    preferred_sports: user.preferred_sports,
    self_skill_level: user.self_skill_level,
    home_area: user.home_area,
  }))
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((s) => ({ ...s, [k]: v }))

  const nameError = f.name.trim().length < 2 ? 'At least 2 characters' : f.name.trim().length > 40 ? 'Max 40 characters' : null
  const suggestions = [...new Set((f.preferred_sports.length ? f.preferred_sports : ['football' as Sport]).flatMap((s) => POSITIONS[s]))]

  const toggleSport = (s: Sport) =>
    set('preferred_sports', f.preferred_sports.includes(s) ? f.preferred_sports.filter((x) => x !== s) : [...f.preferred_sports, s])

  const onSave = (e: React.FormEvent) => {
    e.preventDefault()
    if (nameError) return void toast.error(nameError)
    const area = meta.data?.areas.find((a) => a.name === f.home_area)
    update.mutate(
      {
        name: f.name.trim(),
        bio: f.bio.trim() || null,
        position: f.position.trim() || null,
        dominant_foot: f.dominant_foot,
        preferred_sports: f.preferred_sports,
        self_skill_level: f.self_skill_level,
        home_area: f.home_area,
        ...(area ? { home_lat: area.lat, home_lng: area.lng } : {}),
      },
      {
        onSuccess: () => {
          toast.success('Profile updated')
          navigate('/app/profile')
        },
        onError: (err) => toast.error(errorMessage(err)),
      },
    )
  }

  const preview = {
    ...user,
    name: f.name.trim() || user.name,
    position: f.position.trim() || null,
    preferred_sports: f.preferred_sports,
    home_area: f.home_area,
  }

  return (
    <form onSubmit={onSave}>
      <Link to="/app/profile" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted transition hover:text-fg">
        <ArrowLeft className="h-4 w-4" /> Profile
      </Link>
      <PageHeader eyebrow="Your card" title="Edit profile" subtitle="How you show up in lobbies, leaderboards and on your player card." />

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-5">
          <Card className="space-y-5 p-5 sm:p-6">
            <div>
              <Label htmlFor="pf-name">Display name</Label>
              <Input
                id="pf-name"
                value={f.name}
                maxLength={40}
                onChange={(e) => set('name', e.target.value)}
                aria-invalid={!!nameError}
                className={cn(nameError && 'ring-flare/60')}
              />
              {nameError && <p className="mt-1.5 text-xs text-flare">{nameError}</p>}
            </div>
            <div>
              <div className="flex items-baseline justify-between">
                <Label htmlFor="pf-bio">Bio</Label>
                <span className="font-mono text-[11px] text-subtle">{f.bio.length}/160</span>
              </div>
              <Textarea
                id="pf-bio"
                value={f.bio}
                maxLength={160}
                placeholder="Box-to-box engine. Never late. Buys the post-match chai."
                onChange={(e) => set('bio', e.target.value)}
              />
            </div>
          </Card>

          <Card className="space-y-5 p-5 sm:p-6">
            <div>
              <Label>Sports you play</Label>
              <div className="flex flex-wrap gap-2">
                {SPORT_LIST.map((s) => (
                  <FilterChip key={s} type="button" active={f.preferred_sports.includes(s)} aria-pressed={f.preferred_sports.includes(s)} onClick={() => toggleSport(s)}>
                    <span>{sportInfo(s).emoji}</span> {sportInfo(s).label}
                  </FilterChip>
                ))}
              </div>
            </div>
            <div>
              <Label htmlFor="pf-pos">Position</Label>
              <div className="mb-2 flex flex-wrap gap-1.5">
                {suggestions.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => set('position', p)}
                    aria-pressed={f.position === p}
                    className={cn(
                      'h-8 cursor-pointer rounded-full px-3 text-xs font-medium transition',
                      f.position === p ? 'bg-volt text-ink-950' : 'bg-white/5 text-fg/75 ring-1 ring-white/10 hover:bg-white/10',
                    )}
                  >
                    {p}
                  </button>
                ))}
              </div>
              <Input id="pf-pos" value={f.position} maxLength={30} placeholder="Or type your own" onChange={(e) => set('position', e.target.value)} />
            </div>
            <div>
              <Label>Dominant foot</Label>
              <Segmented
                aria-label="Dominant foot"
                value={f.dominant_foot ?? 'right'}
                onChange={(v) => set('dominant_foot', v)}
                options={[
                  { value: 'left', label: 'Left' },
                  { value: 'right', label: 'Right' },
                  { value: 'both', label: 'Both' },
                ]}
                className="w-full"
              />
            </div>
          </Card>

          <Card className="space-y-4 p-5 sm:p-6">
            <div>
              <Label>Self-rated level</Label>
              <p className="-mt-1 mb-3 text-xs text-subtle">Only a starting hint — your True Skill comes from teammates.</p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {LEVELS.map((l) => {
                  const on = f.self_skill_level === l.value
                  return (
                    <motion.button
                      key={l.value}
                      type="button"
                      aria-pressed={on}
                      whileTap={{ scale: 0.95 }}
                      onClick={() => set('self_skill_level', l.value)}
                      className={cn(
                        'relative cursor-pointer rounded-2xl p-3 text-left ring-1 transition',
                        on ? 'bg-volt/10 ring-volt/60' : 'bg-white/4 ring-white/8 hover:bg-white/8',
                      )}
                    >
                      <div className="text-2xl">{l.emoji}</div>
                      <div className="mt-1 text-sm font-semibold">{l.label}</div>
                      <div className="text-[11px] text-muted">{l.hint}</div>
                      {on && <Check className="absolute top-2.5 right-2.5 h-4 w-4 text-volt" />}
                    </motion.button>
                  )
                })}
              </div>
            </div>
          </Card>

          <Card className="p-5 sm:p-6">
            <Label>Home area</Label>
            <p className="-mt-1 mb-3 text-xs text-subtle">Used when GPS is off to find turfs and games near you.</p>
            {meta.isLoading ? (
              <Skeleton className="h-24" />
            ) : (
              <div className="flex flex-wrap gap-2">
                {meta.data?.areas.map((a) => (
                  <FilterChip key={a.name} type="button" active={f.home_area === a.name} aria-pressed={f.home_area === a.name} onClick={() => set('home_area', a.name)}>
                    <MapPin className="h-3.5 w-3.5" /> {a.name}
                  </FilterChip>
                ))}
              </div>
            )}
          </Card>

          <Card className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
            <div>
              <Label>
                <span className="inline-flex items-center gap-1.5">
                  <Palette className="h-3.5 w-3.5" /> Appearance
                </span>
              </Label>
              <p className="-mt-1 text-xs text-subtle">Floodlights or daylight — System follows your device.</p>
            </div>
            <ThemeSelector size="md" className="w-full shrink-0 sm:w-auto" />
          </Card>
        </div>

        {/* preview */}
        <aside className="hidden lg:block">
          <div className="sticky top-24 flex flex-col items-center">
            <div className="mb-3 text-xs font-semibold tracking-[0.2em] text-muted uppercase">Live preview</div>
            <PlayerCard user={preview} stats={profile?.stats} size="lg" />
          </div>
        </aside>
      </div>

      {/* sticky save bar — sits above the mobile bottom nav */}
      <div className="sticky bottom-24 z-20 mt-6 short:static lg:bottom-6">
        <div className="glass-strong flex items-center justify-end gap-3 rounded-3xl p-3 shadow-2xl">
          <Button type="button" variant="ghost" onClick={() => navigate('/app/profile')}>
            Cancel
          </Button>
          <Button type="submit" loading={update.isPending} disabled={!!nameError}>
            Save changes
          </Button>
        </div>
      </div>
    </form>
  )
}
