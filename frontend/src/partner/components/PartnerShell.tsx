import { useQuery } from '@tanstack/react-query'
import {
  ArrowLeftRight,
  Building2,
  Cable,
  CalendarDays,
  Check,
  ExternalLink,
  IndianRupee,
  LayoutDashboard,
  LogOut,
  Menu,
  Settings,
  Ticket,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { Suspense, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { Link, NavLink, useLocation, useNavigate, useOutlet } from 'react-router'
import { LogoMark } from '@/components/layout/Logo'
import { Avatar } from '@/components/ui/Avatar'
import { Sheet } from '@/components/ui/Sheet'
import { PageLoader } from '@/components/ui/States'
import { ThemeToggle } from '@/components/ui/ThemeToggle'
import { cn } from '@/lib/cn'
import { realtime } from '@/lib/realtime'
import type { PartnerMembership, PartnerRole } from '@/types/partner'
import { partnerApi } from '../api/endpoints'
import { pk } from '../api/keys'
import { useResetPartnerCache, useTurfFilter, useVenues } from '../hooks'
import { RANK, ROLE_LABEL, useLogout } from '../session'
import { useCan, useMembership, usePartnerAuth } from '../stores/partnerAuth'
import { Select, StatusPill } from './kit'
import { MirrorAlerts, MirrorTodoButton } from './Mirror'

interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  end?: boolean
  min: PartnerRole
  badge?: 'conflicts'
}

const NAV: NavItem[] = [
  { to: '/partner', label: 'Dashboard', icon: LayoutDashboard, end: true, min: 'staff' },
  { to: '/partner/calendar', label: 'Calendar', icon: CalendarDays, min: 'staff' },
  { to: '/partner/bookings', label: 'Bookings', icon: Ticket, min: 'staff' },
  { to: '/partner/venues', label: 'Venues', icon: Building2, min: 'manager' },
  { to: '/partner/earnings', label: 'Earnings', icon: IndianRupee, min: 'manager' },
  { to: '/partner/channels', label: 'Channels', icon: Cable, min: 'manager', badge: 'conflicts' },
  { to: '/partner/team', label: 'Team', icon: Users, min: 'manager' },
  { to: '/partner/settings', label: 'Settings', icon: Settings, min: 'manager' },
]


function useNavItems() {
  const m = useMembership()
  const rank = m ? RANK[m.role] : 0
  return NAV.filter((n) => rank >= RANK[n.min])
}

function useOpenConflicts() {
  const manager = useCan('manager')
  const q = useQuery({ queryKey: pk.channels, queryFn: partnerApi.channels.overview, enabled: manager, refetchInterval: 60_000, staleTime: 30_000 })
  return q.data?.open_conflicts ?? 0
}

function useRealtimeStatus() {
  return useSyncExternalStore(
    (cb) => realtime.onStatus(cb),
    () => realtime.connected,
    () => false,
  )
}

// ─────────────────────────────────────────────────────────────────────────────

export function PartnerShell() {
  const location = useLocation()
  const outlet = useOutlet()
  const items = useNavItems()
  const conflicts = useOpenConflicts()
  const [drawer, setDrawer] = useState(false)
  const wide = location.pathname.startsWith('/partner/calendar')

  // close the drawer on navigation
  const [lastPath, setLastPath] = useState(location.pathname)
  if (lastPath !== location.pathname) {
    setLastPath(location.pathname)
    if (drawer) setDrawer(false)
  }

  return (
    <div className="relative min-h-dvh">
      <a
        href="#partner-main"
        className="sr-only z-[60] rounded-lg bg-volt px-4 py-2 font-semibold text-ink-950 focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to content
      </a>
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute -top-48 left-1/3 h-[520px] w-[520px] rounded-full bg-volt/[0.05] blur-[120px]" />
        <div className="absolute top-1/2 -right-40 h-[480px] w-[480px] rounded-full bg-electric/[0.04] blur-[120px]" />
        <div className="noise absolute inset-0" />
      </div>

      <MirrorAlerts />

      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col border-r border-white/6 bg-ink-900/75 px-3 py-5 backdrop-blur-xl lg:flex">
        <BrandMark />
        <ProviderCard className="mt-5" />
        <nav className="mt-5 flex flex-1 flex-col gap-0.5 overflow-y-auto" aria-label="Partner">
          {items.map((item) => (
            <SideLink key={item.to} item={item} badge={item.badge === 'conflicts' ? conflicts : 0} layoutId="pp-side-active" />
          ))}
        </nav>
        <UserBlock />
      </aside>

      {/* Top bar */}
      <header className="sticky top-0 z-30 border-b border-white/6 bg-ink-900/75 backdrop-blur-xl short:static lg:ml-64">
        <div className="flex h-14 items-center gap-2 px-3 sm:h-16 sm:gap-3 sm:px-6">
          <Link to="/partner" className="shrink-0 lg:hidden" aria-label="Partner dashboard">
            <LogoMark className="h-8 w-8" />
          </Link>
          <VenueSwitcher className="min-w-0 flex-1 sm:max-w-xs" />
          <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
            <MirrorTodoButton />
            <LiveIndicator />
            <ThemeToggle />
            <UserMenu className="hidden lg:block" />
          </div>
        </div>
      </header>

      <main id="partner-main" tabIndex={-1} className="overflow-x-clip pb-28 outline-none short:pb-20 lg:ml-64 lg:pb-12">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={location.pathname.split('/').slice(0, 3).join('/')}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
            className={cn('mx-auto px-3 pt-4 sm:px-6 sm:pt-6', wide ? 'max-w-[1600px]' : 'max-w-7xl')}
          >
            <Suspense fallback={<PageLoader />}>{outlet}</Suspense>
          </motion.div>
        </AnimatePresence>
      </main>

      <BottomNav items={items} conflicts={conflicts} onMore={() => setDrawer(true)} />
      <Drawer open={drawer} onClose={() => setDrawer(false)} items={items} conflicts={conflicts} />
    </div>
  )
}

function BrandMark() {
  return (
    <Link to="/partner" className="group flex items-center gap-2.5 px-2" aria-label="PYTCH Partner home">
      <LogoMark className="transition-transform duration-500 group-hover:rotate-90" />
      <span className="font-display text-lg font-bold tracking-tight">
        PYT<span className="text-volt">C</span>H
      </span>
      <span className="rounded-md bg-volt/12 px-1.5 py-0.5 text-[10px] font-bold tracking-[0.14em] text-volt uppercase ring-1 ring-volt/30">Partner</span>
    </Link>
  )
}

function SideLink({ item, badge, layoutId }: { item: NavItem; badge: number; layoutId: string }) {
  return (
    <NavLink
      to={item.to}
      end={item.end}
      className={({ isActive }) =>
        cn(
          'group relative flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium transition-colors',
          isActive ? 'text-ink-950' : 'text-fg/65 hover:bg-white/5 hover:text-fg',
        )
      }
    >
      {({ isActive }) => (
        <>
          {isActive && (
            <motion.span layoutId={layoutId} className="absolute inset-0 rounded-xl bg-volt shadow-glow-volt" transition={{ type: 'spring', stiffness: 450, damping: 35 }} />
          )}
          <item.icon className="relative z-10 h-5 w-5" />
          <span className="relative z-10">{item.label}</span>
          {badge > 0 && (
            <span
              className={cn(
                'relative z-10 ml-auto flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] font-bold',
                isActive ? 'bg-ink-950 text-volt' : 'bg-flare text-snow',
              )}
              aria-label={`${badge} open conflict${badge === 1 ? '' : 's'}`}
            >
              {badge > 9 ? '9+' : badge}
            </span>
          )}
        </>
      )}
    </NavLink>
  )
}

// ───────────── Provider / venue switching ─────────────

function ProviderCard({ className }: { className?: string }) {
  const m = useMembership()
  const count = usePartnerAuth((s) => s.memberships.length)
  const [open, setOpen] = useState(false)
  if (!m) return null
  return (
    <>
      <button
        type="button"
        onClick={() => count > 1 && setOpen(true)}
        className={cn(
          'flex w-full items-center gap-3 rounded-2xl bg-white/4 p-2.5 text-left ring-1 ring-white/8 transition',
          count > 1 ? 'cursor-pointer hover:bg-white/8' : 'cursor-default',
          className,
        )}
        aria-label={count > 1 ? `Venue account: ${m.provider_name}. Switch account` : `Venue account: ${m.provider_name}`}
      >
        <ProviderMonogram name={m.provider_name} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{m.provider_name}</span>
          <span className="block text-[11px] text-muted">{ROLE_LABEL[m.role]}</span>
        </span>
        {count > 1 && <ArrowLeftRight className="h-4 w-4 shrink-0 text-muted" />}
      </button>
      <ProviderSwitchSheet open={open} onClose={() => setOpen(false)} />
    </>
  )
}

export function ProviderMonogram({ name, className }: { name: string; className?: string }) {
  const letters = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('')
  return (
    <span
      className={cn(
        'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-volt to-mint font-display text-sm font-bold text-ink-950',
        className,
      )}
      aria-hidden
    >
      {letters}
    </span>
  )
}

export function ProviderList({ onPicked }: { onPicked?: () => void }) {
  const memberships = usePartnerAuth((s) => s.memberships)
  const current = usePartnerAuth((s) => s.providerId)
  const setProvider = usePartnerAuth((s) => s.setProvider)
  const reset = useResetPartnerCache()
  const navigate = useNavigate()
  const pick = (m: PartnerMembership) => {
    if (m.provider_id !== current) {
      reset()
      setProvider(m.provider_id)
    }
    onPicked?.()
    navigate('/partner', { replace: true })
  }
  return (
    <ul className="space-y-2">
      {memberships.map((m) => (
        <li key={m.provider_id}>
          <button
            type="button"
            onClick={() => pick(m)}
            className={cn(
              'flex min-h-16 w-full cursor-pointer items-center gap-3 rounded-2xl p-3 text-left ring-1 transition',
              m.provider_id === current ? 'bg-volt/10 ring-volt/50' : 'bg-white/4 ring-white/10 hover:bg-white/8',
            )}
          >
            <ProviderMonogram name={m.provider_name} />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-semibold">{m.provider_name}</span>
              <span className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted">
                {ROLE_LABEL[m.role]}
                {m.turf_ids && <span>· {m.turf_ids.length} venue{m.turf_ids.length === 1 ? '' : 's'}</span>}
              </span>
            </span>
            {m.provider_status !== 'approved' ? <StatusPill status={m.provider_status} /> : m.provider_id === current && <Check className="h-5 w-5 text-volt" />}
          </button>
        </li>
      ))}
    </ul>
  )
}

function ProviderSwitchSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Sheet open={open} onClose={onClose} title="Switch venue account" description="You’re a member of several venue businesses." size="sm">
      <ProviderList onPicked={onClose} />
    </Sheet>
  )
}

function VenueSwitcher({ className }: { className?: string }) {
  const venues = useVenues()
  const [turfId, setTurfId] = useTurfFilter()
  const list = venues.data ?? []
  if (venues.isLoading) return <div className={cn('skeleton h-10 rounded-xl', className)} />
  if (list.length === 0) return <div className={className} />
  const options = [...(list.length > 1 ? [{ value: '', label: `All venues (${list.length})` }] : []), ...list.map((v) => ({ value: v.id, label: v.name }))]
  return (
    <div className={cn('flex min-w-0 items-center', className)}>
      <Building2 className="pointer-events-none relative z-10 -mr-8 ml-3 h-4 w-4 shrink-0 text-volt" aria-hidden />
      <Select
        aria-label="Venue"
        value={turfId ?? (list.length === 1 ? list[0]!.id : '')}
        onChange={(v) => setTurfId(v || null)}
        options={options}
        className="w-full [&_select]:h-10 [&_select]:pl-9 [&_select]:text-sm [&_select]:font-semibold"
      />
    </div>
  )
}

// ───────────── Live / user ─────────────

function LiveIndicator() {
  const live = useRealtimeStatus()
  return (
    <span
      className="hidden h-10 items-center gap-2 rounded-xl px-2.5 text-[11px] font-semibold text-muted ring-1 ring-white/8 sm:flex"
      title={live ? 'Live — the calendar updates the moment anything changes' : 'Reconnecting… calendar refreshes every minute meanwhile'}
    >
      <span className="relative flex h-2 w-2">
        {live && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-mint opacity-60" />}
        <span className={cn('relative inline-flex h-2 w-2 rounded-full', live ? 'bg-mint' : 'bg-sun')} />
      </span>
      {live ? 'Live' : 'Offline'}
    </span>
  )
}

function UserBlock() {
  const user = usePartnerAuth((s) => s.user)
  const logout = useLogout()
  if (!user) return null
  return (
    <div className="mt-3 flex items-center gap-2 border-t border-white/6 px-1 pt-3">
      <Avatar user={user} size="sm" showVerified={false} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold">{user.name || 'Venue partner'}</div>
        <div className="truncate font-mono text-[11px] text-muted">{user.phone}</div>
      </div>
      <button
        type="button"
        onClick={logout}
        aria-label="Log out"
        title="Log out"
        className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-xl text-muted transition hover:bg-white/8 hover:text-flare"
      >
        <LogOut className="h-4 w-4" />
      </button>
    </div>
  )
}

function UserMenu({ className }: { className?: string }) {
  const user = usePartnerAuth((s) => s.user)
  const m = useMembership()
  const logout = useLogout()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])
  if (!user) return null
  return (
    <div ref={ref} className={cn('relative', className)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Account menu"
        className="flex h-10 cursor-pointer items-center gap-2 rounded-xl pr-1 pl-1 transition hover:bg-white/5"
      >
        <Avatar user={user} size="sm" showVerified={false} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.97 }}
            transition={{ duration: 0.16 }}
            className="glass-strong absolute top-12 right-0 z-50 w-64 origin-top-right rounded-2xl p-2 shadow-card"
          >
            <div className="px-3 py-2">
              <div className="truncate font-semibold">{user.name || 'Venue partner'}</div>
              <div className="font-mono text-xs text-muted">{user.phone}</div>
              {m && (
                <div className="mt-1 truncate text-xs text-muted">
                  {ROLE_LABEL[m.role]} · {m.provider_name}
                </div>
              )}
            </div>
            <div className="my-1 h-px bg-white/8" />
            <Link role="menuitem" to="/app" className="flex h-10 items-center gap-2.5 rounded-xl px-3 text-sm text-fg/80 hover:bg-white/6 hover:text-fg">
              <ExternalLink className="h-4 w-4" /> Open the player app
            </Link>
            <button
              role="menuitem"
              type="button"
              onClick={logout}
              className="flex h-10 w-full cursor-pointer items-center gap-2.5 rounded-xl px-3 text-sm text-flare hover:bg-flare/10"
            >
              <LogOut className="h-4 w-4" /> Log out
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ───────────── Mobile nav ─────────────

function BottomNav({ items, conflicts, onMore }: { items: NavItem[]; conflicts: number; onMore: () => void }) {
  const primary = items.filter((i) => ['Dashboard', 'Calendar', 'Bookings', 'Channels'].includes(i.label))
  const label = (i: NavItem) => (i.label === 'Dashboard' ? 'Home' : i.label)
  return (
    <nav className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-white/8 bg-ink-900/90 px-1 pt-1.5 backdrop-blur-xl short:pt-1 lg:hidden" aria-label="Partner">
      <div className="mx-auto flex max-w-lg items-stretch justify-between">
        {primary.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.end} className="relative min-w-0 flex-1">
            {({ isActive }) => (
              <div className="relative flex min-h-12 flex-col items-center justify-center gap-0.5 py-1">
                {isActive && (
                  <motion.span layoutId="pp-mobile-active" className="absolute inset-x-2 inset-y-0 rounded-2xl bg-volt/12 ring-1 ring-volt/30" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />
                )}
                <span className="relative">
                  <item.icon className={cn('h-5 w-5', isActive ? 'text-volt' : 'text-fg/60')} />
                  {item.badge === 'conflicts' && conflicts > 0 && (
                    <span className="absolute -top-1.5 -right-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-flare px-1 text-[9px] font-bold text-snow">
                      {conflicts > 9 ? '9+' : conflicts}
                    </span>
                  )}
                </span>
                <span className={cn('relative text-[10px] font-semibold short:hidden', isActive ? 'text-volt' : 'text-fg/55')}>{label(item)}</span>
              </div>
            )}
          </NavLink>
        ))}
        <button type="button" onClick={onMore} className="relative flex min-h-12 min-w-0 flex-1 cursor-pointer flex-col items-center justify-center gap-0.5 py-1" aria-label="More">
          <Menu className="h-5 w-5 text-fg/60" />
          <span className="text-[10px] font-semibold text-fg/55 short:hidden">More</span>
        </button>
      </div>
    </nav>
  )
}

function Drawer({ open, onClose, items, conflicts }: { open: boolean; onClose: () => void; items: NavItem[]; conflicts: number }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])
  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[900] lg:hidden" role="dialog" aria-modal aria-label="Menu">
          <motion.div className="absolute inset-0 bg-ink-950/70 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.aside
            initial={{ x: '-100%' }}
            animate={{ x: 0 }}
            exit={{ x: '-100%' }}
            transition={{ type: 'spring', stiffness: 380, damping: 38 }}
            className="glass-strong absolute inset-y-0 left-0 flex w-[min(20rem,86vw)] flex-col px-3 py-4"
          >
            <div className="flex items-center justify-between">
              <BrandMark />
              <button type="button" onClick={onClose} aria-label="Close menu" className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-xl text-muted hover:bg-white/8">
                <X className="h-5 w-5" />
              </button>
            </div>
            <ProviderCard className="mt-4" />
            <nav className="mt-4 flex flex-1 flex-col gap-0.5 overflow-y-auto">
              {items.map((item) => (
                <SideLink key={item.to} item={item} badge={item.badge === 'conflicts' ? conflicts : 0} layoutId="pp-drawer-active" />
              ))}
              <Link to="/app" className="mt-2 flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm text-fg/65 hover:bg-white/5">
                <ExternalLink className="h-5 w-5" /> Player app
              </Link>
            </nav>
            <UserBlock />
          </motion.aside>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
