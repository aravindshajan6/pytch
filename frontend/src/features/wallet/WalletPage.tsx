import { useQuery } from '@tanstack/react-query'
import { ArrowDownLeft, ArrowUpRight, Gift, HandCoins, LifeBuoy, ShoppingBag, Sparkles, Umbrella, Undo2, Zap, type LucideIcon } from 'lucide-react'
import { motion, useMotionTemplate, useMotionValue, useReducedMotion, useSpring, useTransform } from 'motion/react'
import { useEffect, useMemo } from 'react'
import { LogoMark } from '@/components/layout/Logo'
import { AnimatedNumber } from '@/components/ui/AnimatedNumber'
import { LinkButton } from '@/components/ui/Button'
import { EmptyState, ErrorState, PageHeader, Skeleton } from '@/components/ui/States'
import { useMe } from '@/hooks/useMe'
import { api } from '@/lib/api/endpoints'
import { qk } from '@/lib/api/queryKeys'
import { cn } from '@/lib/cn'
import { formatDay, formatINR, formatTime } from '@/lib/format'
import { useAuth } from '@/stores/auth'
import type { WalletTxn, WalletTxnKind } from '@/types/api'
import { alpha } from '@/lib/color'

const KIND: Record<WalletTxnKind, { icon: LucideIcon; color: string; label: string }> = {
  refund: { icon: Undo2, color: 'var(--color-mint)', label: 'Refund' },
  rain_check: { icon: Umbrella, color: 'var(--color-sun)', label: 'Rain-check' },
  reimbursement: { icon: HandCoins, color: 'var(--color-electric)', label: 'Reimbursement' },
  dropout_credit: { icon: LifeBuoy, color: 'var(--color-flare)', label: 'Dropout credit' },
  spend: { icon: ShoppingBag, color: 'var(--color-muted)', label: 'Spent on a booking' },
  bonus: { icon: Gift, color: 'var(--color-grape-soft)', label: 'Bonus' },
}

const HOW = [
  { icon: Undo2, color: 'var(--color-mint)', title: 'Refunds', body: 'Split didn’t fill in 30 min, or you left before kick-off.' },
  { icon: Umbrella, color: 'var(--color-sun)', title: 'Rain-checks', body: '100% back when a game is rained off — plus a ₹25 bonus.' },
  { icon: HandCoins, color: 'var(--color-electric)', title: 'Reimbursements', body: 'Fronted a full booking? Every joiner’s share lands here.' },
  { icon: LifeBuoy, color: 'var(--color-flare)', title: 'Dropout credits', body: 'A sub took your seat — you get back what they paid.' },
]

const inr = (paise: number) => formatINR(Math.round(paise))
/** Light mode lifts the translucent panels onto solid white surfaces (dark keeps its glassy tint). */
const LIGHT_SURFACE = '[[data-theme=light]_&]:bg-ink-800 [[data-theme=light]_&]:shadow-card'

export default function WalletPage() {
  const { user } = useMe()
  const patchUser = useAuth((s) => s.patchUser)
  const wallet = useQuery({ queryKey: qk.wallet, queryFn: api.wallet.get })

  // keep the shell's balance chip in sync with the ledger
  useEffect(() => {
    if (wallet.data && user && wallet.data.balance_paise !== user.wallet_balance_paise) patchUser({ wallet_balance_paise: wallet.data.balance_paise })
  }, [wallet.data, user, patchUser])

  const txns = useMemo(() => wallet.data?.transactions ?? [], [wallet.data])
  const stats = useMemo(() => {
    let inP = 0
    let outP = 0
    for (const t of txns) {
      if (t.amount_paise >= 0) inP += t.amount_paise
      else outP -= t.amount_paise
    }
    return { inP, outP }
  }, [txns])
  const groups = useMemo(() => groupByDay(txns), [txns])

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader eyebrow="Wallet" title="Pytch Credits" subtitle="Instant, zero-fee, spent automatically at checkout." />

      <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr]">
        {wallet.isPending ? (
          <Skeleton className="aspect-[1.6/1] w-full rounded-[2rem]" />
        ) : (
          <BalanceCard balance={wallet.data?.balance_paise ?? user?.wallet_balance_paise ?? 0} name={user?.name ?? 'Player'} history={txns} />
        )}

        <div className="grid grid-cols-2 gap-3 self-start">
          <StatTile icon={ArrowDownLeft} color="var(--color-mint)" label="Credited" value={stats.inP} loading={wallet.isPending} />
          <StatTile icon={ArrowUpRight} color="var(--color-muted)" label="Spent" value={stats.outP} loading={wallet.isPending} />
          <div className={cn('col-span-2 rounded-3xl bg-white/4 p-5 ring-1 ring-white/8', LIGHT_SURFACE)}>
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Sparkles className="h-4 w-4 text-volt" /> How credits work
            </div>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              Refunds, rain-checks, reimbursements &amp; dropout credits land here <span className="text-fg">instantly</span>; spend them on
              any booking — they’re applied before your card or UPI.
            </p>
            <ul className="mt-4 grid gap-2 sm:grid-cols-2">
              {HOW.map((h, i) => (
                <motion.li
                  key={h.title}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.15 + i * 0.06 }}
                  className="flex gap-3 rounded-2xl bg-white/3 p-3 ring-1 ring-white/6"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl" style={{ background: `${alpha(h.color, 0.1)}`, color: h.color }}>
                    <h.icon className="h-4 w-4" />
                  </span>
                  <span>
                    <span className="block text-sm font-semibold">{h.title}</span>
                    <span className="block text-xs leading-snug text-muted">{h.body}</span>
                  </span>
                </motion.li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      <section className="mt-10" aria-labelledby="ledger-title">
        <div className="mb-4 flex items-end justify-between">
          <h2 id="ledger-title" className="text-xl font-semibold">
            Activity
          </h2>
          {txns.length > 0 && <span className="text-xs text-subtle">Last {txns.length} transactions</span>}
        </div>

        {wallet.isPending ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-[4.5rem] w-full" />
            ))}
          </div>
        ) : wallet.isError ? (
          <ErrorState error={wallet.error} onRetry={() => wallet.refetch()} />
        ) : txns.length === 0 ? (
          <EmptyState
            icon="🪙"
            title="No credits yet"
            description="When a split doesn’t fill, a game gets rained off, or someone subs in for you, the money lands here instantly — ready for your next booking."
            action={
              <LinkButton to="/app/play" variant="secondary">
                <Zap className="h-4 w-4 text-volt" /> Find a game
              </LinkButton>
            }
          />
        ) : (
          <div className="space-y-6">
            {groups.map((g) => (
              <div key={g.day}>
                <div className="mb-2 text-xs font-semibold tracking-[0.18em] text-muted uppercase">{g.day}</div>
                <ul className={cn('overflow-hidden rounded-3xl bg-white/[0.025] ring-1 ring-white/8', LIGHT_SURFACE)}>
                  {g.items.map((t, i) => (
                    <TxnRow key={t.id} t={t} index={i} />
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

function BalanceCard({ balance, name, history }: { balance: number; name: string; history: WalletTxn[] }) {
  const reduced = useReducedMotion()
  const px = useMotionValue(0.5)
  const py = useMotionValue(0.5)
  const rx = useSpring(useTransform(py, [0, 1], [7, -7]), { stiffness: 180, damping: 18 })
  const ry = useSpring(useTransform(px, [0, 1], [-9, 9]), { stiffness: 180, damping: 18 })
  const gx = useTransform(px, [0, 1], [10, 90])
  const gy = useTransform(py, [0, 1], [0, 100])
  const glare = useMotionTemplate`radial-gradient(circle at ${gx}% ${gy}%, color-mix(in srgb, var(--color-white) 16%, transparent), transparent 45%)`
  const games = Math.floor(balance / 15000)

  return (
    <div style={{ perspective: 1200 }}>
      <motion.div
        initial={{ opacity: 0, y: 24, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: 'spring', stiffness: 120, damping: 18 }}
        style={reduced ? undefined : { rotateX: rx, rotateY: ry, transformStyle: 'preserve-3d' }}
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          px.set((e.clientX - r.left) / r.width)
          py.set((e.clientY - r.top) / r.height)
        }}
        onPointerLeave={() => {
          px.set(0.5)
          py.set(0.5)
        }}
        // the card is a dark island in both themes (a premium black card on the light page)
        data-theme="dark"
        className="relative aspect-[1.6/1] w-full overflow-hidden rounded-[2rem] p-6 shadow-[0_40px_90px_-30px_color-mix(in_srgb,_var(--color-mint)_45%,_transparent)] ring-1 ring-white/15 sm:p-8 [[data-theme=light]_&]:shadow-[0_36px_70px_-28px_rgb(4_120_87/0.5),0_12px_24px_-12px_rgb(14_42_26/0.35)]"
      >
        {/* animated mesh */}
        <div className="absolute inset-0 bg-[linear-gradient(135deg,#0f2a1d_0%,#0a1612_45%,#0c1f2b_100%)]" />
        <motion.div
          aria-hidden
          className="absolute -top-1/3 -left-1/4 h-[120%] w-[80%] rounded-full bg-volt/25 blur-[70px]"
          animate={reduced ? undefined : { x: [0, 40, 0], y: [0, 30, 0] }}
          transition={{ duration: 12, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div
          aria-hidden
          className="absolute -right-1/4 -bottom-1/2 h-[120%] w-[70%] rounded-full bg-electric/20 blur-[80px]"
          animate={reduced ? undefined : { x: [0, -30, 0], y: [0, -20, 0] }}
          transition={{ duration: 14, repeat: Infinity, ease: 'easeInOut' }}
        />
        <div aria-hidden className="pitch-grid absolute inset-0 opacity-40" />
        <motion.div aria-hidden className="pointer-events-none absolute inset-0" style={{ background: glare }} />

        <div className="relative flex h-full flex-col" style={{ transform: 'translateZ(40px)' }}>
          <div className="flex items-start justify-between">
            <div>
              <div className="text-[11px] font-bold tracking-[0.25em] text-fg/60">PYTCH CREDITS</div>
              <div className="mt-1 text-xs text-muted">Available balance</div>
            </div>
            <LogoMark className="h-9 w-9" />
          </div>
          <div className="mt-auto">
            <div className="font-display text-[clamp(2.6rem,9vw,4rem)] leading-none font-bold tracking-tight">
              <AnimatedNumber value={balance} format={(n) => inr(n)} duration={1.4} />
            </div>
            <div className="mt-2 text-sm text-fg/70">
              {games > 0 ? (
                <>
                  ≈ <span className="font-semibold text-volt">{games}</span> game{games === 1 ? '' : 's'} at ₹150 a share
                </>
              ) : (
                'Auto-applied to your next booking'
              )}
            </div>
          </div>
          <div className="mt-5 flex items-end justify-between gap-4">
            <div className="min-w-0">
              <div className="text-[10px] tracking-[0.2em] text-muted uppercase">Holder</div>
              <div className="truncate font-mono text-sm tracking-wider text-fg/90 uppercase">{name}</div>
            </div>
            <Sparkline history={history} />
          </div>
        </div>
      </motion.div>
    </div>
  )
}

/** Running-balance sparkline (oldest → newest), drawn in on mount. */
function Sparkline({ history }: { history: WalletTxn[] }) {
  const pts = useMemo(() => {
    const vals = [...history].reverse().map((t) => t.balance_after_paise)
    if (vals.length < 2) return null
    const min = Math.min(...vals)
    const max = Math.max(...vals)
    const span = max - min || 1
    return vals.map((v, i) => `${(i / (vals.length - 1)) * 100},${28 - ((v - min) / span) * 26}`).join(' ')
  }, [history])
  if (!pts) return null
  return (
    <svg viewBox="0 0 100 30" className="h-10 w-28 shrink-0 overflow-visible sm:w-36" aria-hidden>
      <motion.polyline
        points={pts}
        fill="none"
        stroke="var(--color-volt)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 1.4, delay: 0.3, ease: [0.16, 1, 0.3, 1] }}
        style={{ filter: 'drop-shadow(0 0 6px color-mix(in srgb, var(--color-volt) 60%, transparent))' }}
      />
    </svg>
  )
}

function StatTile({ icon: Icon, color, label, value, loading }: { icon: LucideIcon; color: string; label: string; value: number; loading: boolean }) {
  return (
    <div className={cn('rounded-3xl bg-white/4 p-5 ring-1 ring-white/8', LIGHT_SURFACE)}>
      <div className="flex items-center gap-2 text-xs font-semibold tracking-wider text-muted uppercase">
        <span className="flex h-6 w-6 items-center justify-center rounded-lg" style={{ background: `${alpha(color, 0.1)}`, color }}>
          <Icon className="h-3.5 w-3.5" />
        </span>
        {label}
      </div>
      <div className="mt-3 font-display text-2xl">{loading ? <Skeleton className="h-7 w-24 rounded-lg" /> : <AnimatedNumber value={value} format={(n) => inr(n)} />}</div>
    </div>
  )
}

function TxnRow({ t, index }: { t: WalletTxn; index: number }) {
  const k = KIND[t.kind] ?? KIND.bonus
  const credit = t.amount_paise >= 0
  return (
    <motion.li
      initial={{ opacity: 0, x: -12 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: Math.min(index, 10) * 0.04, type: 'spring', stiffness: 300, damping: 28 }}
      className="flex items-center gap-4 border-b border-white/6 px-4 py-3.5 transition last:border-0 hover:bg-white/[0.03] sm:px-5"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl" style={{ background: `${alpha(k.color, 0.1)}`, color: k.color, boxShadow: `inset 0 0 0 1px ${alpha(k.color, 0.21)}` }}>
        <k.icon className="h-5 w-5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{t.note || k.label}</div>
        <div className="mt-0.5 text-xs text-muted">
          <span style={{ color: k.color }}>{k.label}</span> · {formatTime(t.created_at)}
        </div>
      </div>
      <div className="text-right">
        <div className={cn('font-mono text-sm font-semibold tabular-nums', credit ? 'text-mint' : 'text-fg/85')}>{formatINR(t.amount_paise, { sign: true })}</div>
        <div className="mt-0.5 font-mono text-[11px] text-subtle tabular-nums">Bal {formatINR(t.balance_after_paise)}</div>
      </div>
    </motion.li>
  )
}

function groupByDay(items: WalletTxn[]) {
  const out: { day: string; items: WalletTxn[] }[] = []
  for (const t of items) {
    const day = formatDay(t.created_at)
    const last = out[out.length - 1]
    if (last && last.day === day) last.items.push(t)
    else out.push({ day, items: [t] })
  }
  return out
}
