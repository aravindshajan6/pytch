import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Bot, ChevronDown, CloudLightning, FastForward, FlaskConical, UserMinus } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { useMeta } from '@/hooks/useMeta'
import { errorMessage } from '@/lib/api/client'
import { api } from '@/lib/api/endpoints'
import { qk } from '@/lib/api/queryKeys'
import { cn } from '@/lib/cn'
import type { LobbyDetail } from '@/types/api'

type Action = 'fill' | 'dropout' | 'storm' | 'complete'

/** Floating, clearly-labelled demo panel (only when the backend runs with DEMO_MODE). */
export function DemoConsole({ lobby, raised }: { lobby: LobbyDetail; raised?: boolean }) {
  const demo = useMeta().data?.demo_mode
  const [open, setOpen] = useState(false)
  const qc = useQueryClient()
  const navigate = useNavigate()

  const run = useMutation({
    mutationFn: async (a: Action) => {
      switch (a) {
        case 'fill':
          return api.dev.fill(lobby.id)
        case 'dropout':
          return api.dev.dropout(lobby.id)
        case 'storm':
          return api.dev.storm(lobby.id)
        case 'complete':
          return api.dev.complete(lobby.id)
      }
    },
    onSuccess: (res, a) => {
      qc.invalidateQueries({ queryKey: qk.lobby(lobby.id) })
      if (a === 'fill') toast.success('🤖 Bots are joining and paying one by one — watch the seats')
      if (a === 'dropout') toast('A player dropped out — SOS fired to the bench 🚨')
      if (a === 'complete') {
        toast.success('⏱️ Full time! Ratings window and recording pipeline kicked off')
        qc.invalidateQueries({ queryKey: qk.pendingRatings })
      }
      if (a === 'storm' && res && 'id' in res) {
        qc.invalidateQueries({ queryKey: qk.weatherAlerts })
        navigate(`/app/weather/${res.id}`)
      }
    },
    onError: (e) => toast.error(errorMessage(e)),
  })

  const live = lobby.status === 'forming' || lobby.status === 'confirmed'
  if (!demo || !live) return null

  const actions: { key: Action; label: string; hint: string; icon: typeof Bot; disabled?: boolean }[] = [
    { key: 'fill', label: 'Fill with bots', hint: 'Bots join & pay ~1.5 s apart', icon: Bot, disabled: !live || lobby.spots_left + (lobby.filled_spots - lobby.paid_spots) === 0 },
    { key: 'dropout', label: 'Simulate dropout', hint: 'Paid player drops → auto SOS', icon: UserMinus, disabled: lobby.status !== 'confirmed' },
    { key: 'storm', label: 'Simulate storm', hint: 'Heavy-rain alert for this match', icon: CloudLightning, disabled: !live },
    { key: 'complete', label: 'Fast-forward to full time', hint: 'Ratings, XP, recording', icon: FastForward, disabled: lobby.status !== 'confirmed' },
  ]

  return createPortal(
    <div className={cn('fixed right-4 z-[45] lg:right-6 lg:bottom-6', raised ? 'bottom-[172px] short:bottom-[128px]' : 'bottom-24 short:bottom-14', open ? 'w-[min(18rem,calc(100vw-2rem))]' : 'w-auto')}>
      <motion.div layout className="glass-strong overflow-hidden rounded-2xl border-dashed !border-grape/50 shadow-2xl">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex w-full cursor-pointer items-center gap-2 px-3.5 py-2.5 text-left"
        >
          <FlaskConical className="h-4 w-4 text-[var(--color-grape-soft)]" />
          <span className={cn('flex-1 text-sm font-semibold', !open && 'hidden sm:inline')}>Demo controls</span>
          <span className="rounded bg-grape/25 px-1.5 py-0.5 text-[9px] font-bold tracking-widest text-[var(--color-grape-soft)]">DEMO</span>
          <ChevronDown className={cn('h-4 w-4 text-muted transition-transform', open && 'rotate-180')} />
        </button>
        <AnimatePresence initial={false}>
          {open && (
            <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} className="overflow-hidden">
              <div className="space-y-1.5 px-3 pb-3">
                <p className="px-1 pb-1 text-[11px] text-subtle">Simulated events for the demo — not available in production.</p>
                {actions.map((a) => (
                  <button
                    key={a.key}
                    type="button"
                    disabled={a.disabled || run.isPending}
                    onClick={() => run.mutate(a.key)}
                    className="flex w-full cursor-pointer items-center gap-3 rounded-xl bg-white/[0.03] px-3 py-2.5 text-left ring-1 ring-white/6 transition hover:bg-grape/15 hover:ring-grape/40 disabled:cursor-not-allowed disabled:opacity-35"
                  >
                    <a.icon className={cn('h-4 w-4 shrink-0 text-[var(--color-grape-soft)]', run.isPending && run.variables === a.key && 'animate-pulse')} />
                    <span className="min-w-0">
                      <span className="block text-xs font-semibold">{a.label}</span>
                      <span className="block truncate text-[10px] text-muted">{a.hint}</span>
                    </span>
                  </button>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>,
    document.body,
  )
}
