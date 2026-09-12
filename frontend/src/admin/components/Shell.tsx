import { useQuery } from '@tanstack/react-query'
import { ChevronDown, KeyRound, LogOut, Menu, ShieldCheck, Timer, UserCog, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { Suspense, useEffect, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router'
import { LogoMark } from '@/components/layout/Logo'
import { Chip } from '@/components/ui/Chip'
import { PageLoader } from '@/components/ui/States'
import { ThemeToggle } from '@/components/ui/ThemeToggle'
import { cn } from '@/lib/cn'
import { initials } from '@/lib/format'
import { adminApi, qk } from '../lib/api'
import { ROLE_LABEL, dateTime } from '../lib/format'
import { logout } from '../lib/http'
import { formatClock, useIdleCountdown, useIdleTimer } from '../lib/idle'
import { useNow } from '../lib/hooks'
import { hasPerm, useSession } from '../lib/session'
import { useStepUp } from '../lib/stepup'
import { IdleWarning } from './Dialogs'
import { GlobalSearch } from './GlobalSearch'
import { NAV_GROUPS } from './navConfig'

function usePendingApprovals() {
  const me = useSession((s) => s.me)
  const health = useQuery({ queryKey: qk.health, queryFn: adminApi.system.health, refetchInterval: 60_000, staleTime: 30_000 })
  return hasPerm(me, 'approvals.decide') ? (health.data?.pending_approvals ?? 0) : 0
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const me = useSession((s) => s.me)
  const demo = useSession((s) => s.demo)
  const pending = usePendingApprovals()

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-16 items-center gap-2.5 px-5">
        <Link to="/" onClick={onNavigate} className="group flex items-center gap-2.5" aria-label="PYTCH Admin — dashboard">
          <LogoMark className="h-8 w-8 transition-transform duration-500 group-hover:rotate-90" />
          <span className="font-display text-lg font-bold tracking-tight">
            PYT<span className="text-volt">C</span>H
          </span>
        </Link>
        <span className="rounded-md bg-white/6 px-1.5 py-0.5 text-[10px] font-semibold tracking-[0.14em] text-muted uppercase ring-1 ring-white/10">
          Admin
        </span>
        {demo && (
          <Chip tone="sun" size="xs" className="ml-auto">
            Demo
          </Chip>
        )}
      </div>
      <nav className="flex-1 space-y-4 overflow-y-auto px-3 pt-1 pb-4" aria-label="Console">
        {NAV_GROUPS.map((g) => {
          const items = g.items.filter((i) => !i.perm || hasPerm(me, i.perm))
          if (!items.length) return null
          return (
            <div key={g.label}>
              <div className="mb-1.5 px-3 text-[10px] font-semibold tracking-[0.16em] text-subtle uppercase">{g.label}</div>
              <ul className="space-y-0.5">
                {items.map((item) => (
                  <li key={item.to}>
                    <NavLink
                      to={item.to}
                      end={item.end}
                      onClick={onNavigate}
                      className={({ isActive }) =>
                        cn(
                          'group relative flex h-8 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors',
                          isActive ? 'bg-white/7 text-fg' : 'text-fg/65 hover:bg-white/4 hover:text-fg',
                        )
                      }
                    >
                      {({ isActive }) => (
                        <>
                          {isActive && (
                            <motion.span
                              layoutId="nav-active"
                              className="absolute top-2 bottom-2 left-0 w-0.5 rounded-full bg-volt"
                              transition={{ type: 'spring', stiffness: 500, damping: 40 }}
                            />
                          )}
                          <item.icon className={cn('h-4 w-4 shrink-0', isActive ? 'text-volt' : 'text-muted group-hover:text-fg')} />
                          <span className="truncate">{item.label}</span>
                          {item.badge === 'approvals' && pending > 0 && (
                            <span className="num ml-auto rounded-md bg-flare/15 px-1.5 py-0.5 text-[10px] font-semibold text-flare ring-1 ring-flare/30">
                              {pending}
                            </span>
                          )}
                        </>
                      )}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          )
        })}
      </nav>
      <div className="border-t border-white/6 px-5 py-3 text-[11px] text-subtle">
        <div className="flex items-center gap-1.5">
          <ShieldCheck className="h-3.5 w-3.5 text-mint" /> MFA-secured session · {ROLE_LABEL[me?.role ?? ''] ?? me?.role}
        </div>
      </div>
    </div>
  )
}

function ElevatedChip() {
  const until = useStepUp((s) => s.elevatedUntil)
  const now = useNow(1000, !!until && until > Date.now())
  if (!until || until <= now) return null
  return (
    <span
      className="hidden items-center gap-1.5 rounded-lg bg-volt/10 px-2 py-1 text-xs font-medium text-volt ring-1 ring-volt/30 sm:inline-flex"
      title="Sensitive actions won’t ask for your code again until this runs out"
    >
      <KeyRound className="h-3.5 w-3.5" /> Elevated <span className="num">{formatClock(until - now)}</span>
    </span>
  )
}

function AccountMenu() {
  const me = useSession((s) => s.me)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const idleMs = useIdleCountdown(open)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (!me) return null
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex h-10 cursor-pointer items-center gap-2 rounded-xl px-1.5 transition hover:bg-white/6 sm:pr-2.5"
      >
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-volt to-mint font-display text-[11px] font-bold text-night">
          {initials(me.name || me.email)}
        </span>
        <span className="hidden text-left leading-tight md:block">
          <span className="block max-w-36 truncate text-xs font-semibold">{me.name}</span>
          <span className="block text-[10px] text-muted">{ROLE_LABEL[me.role] ?? me.role}</span>
        </span>
        <ChevronDown className="hidden h-3.5 w-3.5 text-muted md:block" />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.15 }}
            className="glass-strong absolute top-12 right-0 z-50 w-72 overflow-hidden rounded-2xl shadow-2xl"
          >
            <div className="border-b border-white/8 px-4 py-3">
              <div className="truncate text-sm font-semibold">{me.name}</div>
              <div className="truncate text-xs text-muted">{me.email}</div>
              <div className="mt-2 flex items-center gap-2">
                <Chip tone="volt" size="xs">
                  {ROLE_LABEL[me.role] ?? me.role}
                </Chip>
                {me.mfa_enrolled && (
                  <Chip tone="mint" size="xs">
                    MFA on
                  </Chip>
                )}
              </div>
            </div>
            <div className="space-y-1.5 border-b border-white/8 px-4 py-3 text-xs">
              <div className="flex items-center justify-between text-muted">
                <span className="inline-flex items-center gap-1.5">
                  <Timer className="h-3.5 w-3.5" /> Idle sign-out in
                </span>
                <span className="num text-fg">{formatClock(idleMs)}</span>
              </div>
              {me.previous_login_at && (
                <div className="flex items-center justify-between gap-2 text-muted">
                  <span>Previous sign-in</span>
                  <span className="truncate text-right text-fg/80">
                    {dateTime(me.previous_login_at)}
                    {me.previous_login_ip ? ` · ${me.previous_login_ip}` : ''}
                  </span>
                </div>
              )}
            </div>
            <div className="p-1.5">
              <Link
                role="menuitem"
                to="/account"
                onClick={() => setOpen(false)}
                className="flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-sm hover:bg-white/6"
              >
                <UserCog className="h-4 w-4 text-muted" /> My account & sessions
              </Link>
              <button
                role="menuitem"
                type="button"
                onClick={() => void logout()}
                className="flex h-9 w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 text-sm text-flare hover:bg-flare/10"
              >
                <LogOut className="h-4 w-4" /> Sign out
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export function Shell() {
  const [drawer, setDrawer] = useState(false)
  const location = useLocation()
  const demo = useSession((s) => s.demo)
  const { warning, staySignedIn } = useIdleTimer()

  // close the mobile drawer on navigation
  useEffect(() => setDrawer(false), [location.pathname])

  return (
    <div className="relative min-h-dvh">
      <a
        href="#main"
        className="sr-only z-[60] rounded-lg bg-volt px-4 py-2 font-semibold text-ink-950 focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to content
      </a>
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 pitch-grid opacity-40 [mask-image:radial-gradient(ellipse_at_top,black_20%,transparent_70%)]" />

      {/* desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-60 border-r border-white/6 bg-[var(--admin-sidebar)] backdrop-blur-xl lg:block">
        <Sidebar />
      </aside>

      {/* mobile / tablet drawer */}
      <AnimatePresence>
        {drawer && (
          <div className="fixed inset-0 z-[800] lg:hidden" role="dialog" aria-modal aria-label="Navigation">
            <motion.div className="absolute inset-0 bg-ink-950/60 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setDrawer(false)} />
            <motion.aside
              className="glass-strong absolute inset-y-0 left-0 w-72 max-w-[85vw] shadow-2xl"
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'spring', stiffness: 400, damping: 40 }}
            >
              <button onClick={() => setDrawer(false)} aria-label="Close navigation" className="absolute top-4 right-3 z-10 cursor-pointer rounded-lg p-1.5 text-muted hover:bg-white/8">
                <X className="h-5 w-5" />
              </button>
              <Sidebar onNavigate={() => setDrawer(false)} />
            </motion.aside>
          </div>
        )}
      </AnimatePresence>

      <div className="lg:pl-60">
        <header className="sticky top-0 z-30 border-b border-white/6 bg-ink-900/75 backdrop-blur-xl">
          <div className="flex h-16 items-center gap-2 px-4 sm:gap-3 sm:px-6 lg:px-8">
            <button onClick={() => setDrawer(true)} aria-label="Open navigation" className="-ml-1 cursor-pointer rounded-lg p-2 text-fg/80 hover:bg-white/6 lg:hidden">
              <Menu className="h-5 w-5" />
            </button>
            <GlobalSearch className="min-w-0 flex-1 md:max-w-md" />
            <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
              {demo && (
                <span
                  className="hidden rounded-lg bg-sun/12 px-2 py-1 text-[11px] font-bold tracking-[0.14em] text-sun uppercase ring-1 ring-sun/35 sm:inline-flex"
                  title="Demo mode — mock payments, seeded data"
                >
                  Demo
                </span>
              )}
              <ElevatedChip />
              <ThemeToggle />
              <AccountMenu />
            </div>
          </div>
        </header>
        <main id="main" className="mx-auto w-full max-w-[1480px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <Suspense fallback={<PageLoader />}>
            <Outlet />
          </Suspense>
        </main>
      </div>

      <IdleWarning open={warning} onStay={staySignedIn} />
    </div>
  )
}
