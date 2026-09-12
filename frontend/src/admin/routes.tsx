import { lazy, Suspense } from 'react'
import { createBrowserRouter, Link, Navigate, RouterProvider, useLocation } from 'react-router'
import { LogoMark } from '@/components/layout/Logo'
import type { AdminPermission } from '@/types/admin'
import { NoAccess } from './components/bits'
import { Shell } from './components/Shell'
import { setNavigator } from './lib/nav'
import { hasPerm, useSession } from './lib/session'
import { safeInAppPath } from '@/lib/safePath'

const Login = lazy(() => import('./pages/Login'))
const Dashboard = lazy(() => import('./pages/Dashboard'))
const PlayersList = lazy(() => import('./pages/players/PlayersList'))
const PlayerDetail = lazy(() => import('./pages/players/PlayerDetail'))
const ProvidersList = lazy(() => import('./pages/providers/ProvidersList'))
const ProviderDetail = lazy(() => import('./pages/providers/ProviderDetail'))
const Venues = lazy(() => import('./pages/Venues'))
const BookingsList = lazy(() => import('./pages/bookings/BookingsList'))
const BookingDetail = lazy(() => import('./pages/bookings/BookingDetail'))
const Payments = lazy(() => import('./pages/Payments'))
const Approvals = lazy(() => import('./pages/Approvals'))
const Settlements = lazy(() => import('./pages/settlements/Settlements'))
const SettlementDetail = lazy(() => import('./pages/settlements/SettlementDetail'))
const Coupons = lazy(() => import('./pages/Coupons'))
const Catalog = lazy(() => import('./pages/Catalog'))
const Broadcasts = lazy(() => import('./pages/Broadcasts'))
const Settings = lazy(() => import('./pages/Settings'))
const Audit = lazy(() => import('./pages/Audit'))
const Team = lazy(() => import('./pages/Team'))
const Account = lazy(() => import('./pages/Account'))
const System = lazy(() => import('./pages/System'))

function Splash() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4">
      <LogoMark className="h-10 w-10 animate-[sweep_2.4s_linear_infinite]" />
      <p className="text-xs tracking-[0.2em] text-subtle uppercase">Securing session…</p>
    </div>
  )
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const status = useSession((s) => s.status)
  const location = useLocation()
  if (status === 'booting') return <Splash />
  if (status !== 'authed') return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />
  return <>{children}</>
}

function LoginRoute() {
  const status = useSession((s) => s.status)
  const location = useLocation()
  if (status === 'booting') return <Splash />
  if (status === 'authed') {
    const from = (location.state as { from?: string } | null)?.from
    // only ever redirect to an in-app path (no open redirects)
    return <Navigate to={safeInAppPath(from, '/')} replace />
  }
  return (
    <Suspense fallback={<Splash />}>
      <Login />
    </Suspense>
  )
}

/** Permission gate for a whole page (the server enforces the same rule). */
function Gate({ perm, children }: { perm: AdminPermission; children: React.ReactNode }) {
  const me = useSession((s) => s.me)
  return hasPerm(me, perm) ? <>{children}</> : <NoAccess perm={perm} />
}

function NotFound() {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center text-center">
      <div className="font-display text-5xl font-bold text-gradient-volt">404</div>
      <p className="mt-2 text-sm text-muted">This console page doesn’t exist.</p>
      <Link to="/" className="mt-4 text-sm font-semibold text-volt hover:underline">
        Back to dashboard
      </Link>
    </div>
  )
}

const g = (perm: AdminPermission, el: React.ReactNode) => <Gate perm={perm}>{el}</Gate>

const router = createBrowserRouter([
  { path: '/login', element: <LoginRoute /> },
  {
    path: '/',
    element: (
      <RequireAuth>
        <Shell />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <Dashboard /> },
      { path: 'players', element: g('users.view', <PlayersList />) },
      { path: 'players/:id', element: g('users.view', <PlayerDetail />) },
      { path: 'providers', element: g('providers.view', <ProvidersList />) },
      { path: 'providers/:id', element: g('providers.view', <ProviderDetail />) },
      { path: 'venues', element: g('venues.view', <Venues />) },
      { path: 'bookings', element: g('bookings.view', <BookingsList />) },
      { path: 'bookings/:id', element: g('bookings.view', <BookingDetail />) },
      { path: 'payments', element: g('payments.view', <Payments />) },
      { path: 'approvals', element: g('approvals.decide', <Approvals />) },
      { path: 'settlements', element: g('payouts.view', <Settlements />) },
      { path: 'settlements/:id', element: g('payouts.view', <SettlementDetail />) },
      { path: 'coupons', element: g('coupons.view', <Coupons />) },
      { path: 'catalog', element: g('catalog.manage', <Catalog />) },
      { path: 'broadcasts', element: g('broadcast.send', <Broadcasts />) },
      { path: 'settings', element: g('settings.view', <Settings />) },
      { path: 'audit', element: g('audit.view', <Audit />) },
      { path: 'team', element: g('admins.manage', <Team />) },
      { path: 'account', element: <Account /> },
      { path: 'system', element: <System /> },
      { path: '*', element: <NotFound /> },
    ],
  },
])

setNavigator((to) => void router.navigate(to))

export function AppRouter() {
  return <RouterProvider router={router} />
}
