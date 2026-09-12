import { useQuery } from '@tanstack/react-query'
import { Bell, CalendarDays, Compass, Film, Home, Radio, Swords, Trophy, User, Wallet } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { Suspense, useEffect, useRef, useState } from 'react'
import { Link, NavLink, useLocation, useOutlet } from 'react-router'
import { Avatar } from '@/components/ui/Avatar'
import { ThemeToggle } from '@/components/ui/ThemeToggle'
import { PageLoader } from '@/components/ui/States'
import { useMe } from '@/hooks/useMe'
import { api } from '@/lib/api/endpoints'
import { qk } from '@/lib/api/queryKeys'
import { cn } from '@/lib/cn'
import { formatINR } from '@/lib/format'
import { Logo } from './Logo'
import { MaintenanceBanner } from './MaintenanceBanner'

const NAV = [
  { to: '/app', label: 'Home', icon: Home, end: true },
  { to: '/app/discover', label: 'Discover', icon: Compass },
  { to: '/app/play', label: 'Play', icon: Swords },
  { to: '/app/matches', label: 'My matches', icon: CalendarDays },
  { to: '/app/bench', label: 'Bench', icon: Radio },
  { to: '/app/highlights', label: 'Highlights', icon: Film },
  { to: '/app/leaderboard', label: 'Leaderboard', icon: Trophy },
]

const MOBILE_NAV = [NAV[0]!, NAV[1]!, NAV[2]!, NAV[4]!, { to: '/app/profile', label: 'Me', icon: User }]

function useShellData() {
  const notifications = useQuery({
    queryKey: [...qk.notifications, 'badge'],
    queryFn: () => api.notifications.list({ unread_only: true, limit: 1 }),
    refetchInterval: 60_000,
  })
  const bench = useQuery({ queryKey: qk.bench, queryFn: api.bench.me })
  return { unread: notifications.data?.unread_count ?? 0, benchLive: !!bench.data?.is_active }
}

/** Bumps a key whenever `value` increases — used to replay the bell wiggle on new notifications. */
function useBumpOnIncrease(value: number) {
  const prev = useRef(value)
  const [bump, setBump] = useState(0)
  useEffect(() => {
    if (value > prev.current) setBump((b) => b + 1)
    prev.current = value
  }, [value])
  return bump
}

export function AppShell() {
  const { user } = useMe()
  const { unread, benchLive } = useShellData()
  const bellBump = useBumpOnIncrease(unread)
  const location = useLocation()
  const outlet = useOutlet()

  return (
    <div className="relative min-h-dvh">
      <a
        href="#main"
        className="sr-only z-[60] rounded-lg bg-volt px-4 py-2 font-semibold text-ink-950 focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to content
      </a>
      {/* ambient floodlight glow + grain */}
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute -top-40 left-1/3 h-[520px] w-[520px] rounded-full bg-volt/[0.06] blur-[120px]" />
        <div className="absolute top-1/2 -right-40 h-[480px] w-[480px] rounded-full bg-electric/[0.05] blur-[120px]" />
        <div className="noise absolute inset-0" />
      </div>

      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col border-r border-white/6 bg-ink-900/70 px-4 py-6 backdrop-blur-xl lg:flex">
        <Logo to="/app" className="px-2" />
        <nav className="mt-10 flex flex-1 flex-col gap-1">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  'group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors',
                  isActive ? 'text-ink-950' : 'text-fg/65 hover:bg-white/5 hover:text-fg',
                )
              }
            >
              {({ isActive }) => (
                <>
                  {isActive && (
                    <motion.span
                      layoutId="sidebar-active"
                      className="absolute inset-0 rounded-xl bg-volt shadow-glow-volt"
                      transition={{ type: 'spring', stiffness: 450, damping: 35 }}
                    />
                  )}
                  <item.icon className="relative z-10 h-5 w-5" />
                  <span className="relative z-10">{item.label}</span>
                  {item.label === 'Bench' && benchLive && (
                    <span className="relative z-10 ml-auto flex items-center gap-1.5 text-[10px] font-bold tracking-wider text-flare uppercase">
                      <span className="relative flex h-2 w-2">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-flare opacity-75" />
                        <span className="relative inline-flex h-2 w-2 rounded-full bg-flare" />
                      </span>
                      Live
                    </span>
                  )}
                </>
              )}
            </NavLink>
          ))}
        </nav>
        {user && (
          <div className="space-y-2">
            <Link to="/app/wallet" className="flex items-center justify-between rounded-xl bg-white/4 px-3 py-2.5 text-sm ring-1 ring-white/8 transition hover:bg-white/8">
              <span className="flex items-center gap-2 text-muted">
                <Wallet className="h-4 w-4 text-mint" /> Credits
              </span>
              <span className="font-mono font-semibold">{formatINR(user.wallet_balance_paise)}</span>
            </Link>
            <Link to="/app/profile" className="flex items-center gap-3 rounded-xl px-2 py-2 transition hover:bg-white/5">
              <Avatar user={user} size="md" ring />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">{user.name}</div>
                <div className="text-xs text-muted">Level {user.level}</div>
              </div>
            </Link>
          </div>
        )}
      </aside>

      {/* Top bar */}
      <header className="sticky top-0 z-30 short:static border-b border-white/6 bg-ink-900/70 backdrop-blur-xl lg:ml-64">
        <MaintenanceBanner />
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-3 px-4 sm:px-6">
          <Logo to="/app" className="lg:invisible" wordmarkClassName="max-[359px]:hidden" />
          <div className="flex items-center gap-2">
            <ThemeToggle />
            {user && (
              <Link
                to="/app/wallet"
                className="flex h-10 items-center gap-2 rounded-xl bg-white/5 px-3 text-sm ring-1 ring-white/10 transition hover:bg-white/10 lg:hidden"
              >
                <Wallet className="h-4 w-4 text-mint" />
                <span className="font-mono font-semibold">{formatINR(user.wallet_balance_paise, { compact: true })}</span>
              </Link>
            )}
            <Link
              to="/app/notifications"
              aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
              className="relative flex h-10 w-10 items-center justify-center rounded-xl bg-white/5 ring-1 ring-white/10 transition hover:bg-white/10"
            >
              <motion.span
                key={bellBump}
                className="inline-flex"
                initial={false}
                animate={bellBump ? { rotate: [0, -18, 14, -10, 6, 0] } : undefined}
                transition={{ duration: 0.7 }}
                style={{ originY: 0 }}
              >
                <Bell className="h-5 w-5" />
              </motion.span>
              <AnimatePresence>
                {unread > 0 && (
                  <motion.span
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    exit={{ scale: 0 }}
                    className="absolute -top-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-flare px-1 text-[10px] font-bold text-snow"
                  >
                    {unread > 9 ? '9+' : unread}
                  </motion.span>
                )}
              </AnimatePresence>
            </Link>
          </div>
        </div>
      </header>

      {/* Page */}
      <main id="main" tabIndex={-1} className="overflow-x-clip pb-28 outline-none short:pb-20 lg:ml-64 lg:pb-12">
        <AnimatePresence mode="wait">
          <motion.div
            key={location.pathname}
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
            className="mx-auto max-w-7xl px-4 pt-6 sm:px-6"
          >
            <Suspense fallback={<PageLoader />}>{outlet}</Suspense>
          </motion.div>
        </AnimatePresence>
      </main>

      {/* Mobile bottom nav */}
      <nav className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-white/8 bg-ink-900/85 px-2 pt-2 backdrop-blur-xl short:pt-1 lg:hidden">
        <div className="mx-auto flex max-w-md items-center justify-between">
          {MOBILE_NAV.map((item) => (
            <NavLink key={item.to} to={item.to} end={'end' in item ? item.end : false} className="relative flex-1">
              {({ isActive }) => (
                <div className="relative flex flex-col items-center gap-1 py-1.5">
                  {isActive && (
                    <motion.span
                      layoutId="mobile-active"
                      className="absolute inset-x-3 inset-y-0 rounded-2xl bg-volt/12 ring-1 ring-volt/30"
                      transition={{ type: 'spring', stiffness: 500, damping: 38 }}
                    />
                  )}
                  <span className="relative">
                    <item.icon className={cn('h-5 w-5 transition-colors', isActive ? 'text-volt' : 'text-fg/55')} />
                    {item.label === 'Bench' && benchLive && (
                      <span className="absolute -top-0.5 -right-1 h-2 w-2 animate-pulse rounded-full bg-flare" />
                    )}
                  </span>
                  <span className={cn('relative text-[10px] font-semibold short:hidden', isActive ? 'text-volt' : 'text-fg/50')}>
                    {item.label}
                  </span>
                </div>
              )}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  )
}
