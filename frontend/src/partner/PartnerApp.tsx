import './partner.css'
import { useQuery } from '@tanstack/react-query'
import { lazy, Suspense, useEffect } from 'react'
import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router'
import { PageLoader } from '@/components/ui/States'
import { realtime } from '@/lib/realtime'
import { useAuth } from '@/stores/auth'
import type { PartnerRole } from '@/types/partner'
import { partnerApi } from './api/endpoints'
import { pk } from './api/keys'
import { NamePrompt } from './components/NameSheet'
import { PartnerShell } from './components/PartnerShell'
import { RANK, useProviderStatusWatch } from './session'
import { useMembership, usePartnerAuth } from './stores/partnerAuth'

const LoginPage = lazy(() => import('./pages/LoginPage'))
const ApplyPage = lazy(() => import('./pages/ApplyPage'))
const ChooseProviderPage = lazy(() => import('./pages/ChooseProviderPage'))
const ApplicationStatusPage = lazy(() => import('./pages/ApplicationStatusPage'))
const DashboardPage = lazy(() => import('./pages/DashboardPage'))
const CalendarPage = lazy(() => import('./pages/calendar/CalendarPage'))
const BookingsPage = lazy(() => import('./pages/BookingsPage'))
const VenuesPage = lazy(() => import('./pages/venues/VenuesPage'))
const VenueEditPage = lazy(() => import('./pages/venues/VenueEditPage'))
const EarningsPage = lazy(() => import('./pages/earnings/EarningsPage'))
const SettlementPage = lazy(() => import('./pages/earnings/SettlementPage'))
const ChannelsPage = lazy(() => import('./pages/channels/ChannelsPage'))
const TeamPage = lazy(() => import('./pages/TeamPage'))
const SettingsPage = lazy(() => import('./pages/SettingsPage'))
const PartnerNotFound = lazy(() => import('./pages/PartnerNotFound'))

/**
 * Service-provider portal, mounted at /partner/* (inside the app-wide Providers).
 * Owns its own session (`pytch-partner-auth`), HTTP client and descendant routes.
 */
export default function PartnerApp() {
  usePartnerRealtime()
  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        <Route path="login" element={<LoginPage />} />
        <Route element={<RequirePartnerAuth />}>
          <Route path="apply" element={<ApplyPage />} />
          <Route path="choose" element={<ChooseProviderPage />} />
          <Route element={<ProviderGate />}>
            <Route element={<PartnerShell />}>
              <Route index element={<DashboardPage />} />
              <Route path="calendar" element={<CalendarPage />} />
              <Route path="bookings" element={<BookingsPage />} />
              <Route element={<RequireRole min="manager" />}>
                <Route path="venues" element={<VenuesPage />} />
                <Route path="venues/:turfId" element={<VenueEditPage />} />
                <Route path="earnings" element={<EarningsPage />} />
                <Route path="earnings/settlements/:settlementId" element={<SettlementPage />} />
                <Route path="channels" element={<ChannelsPage />} />
                <Route path="team" element={<TeamPage />} />
                <Route path="settings" element={<SettingsPage />} />
              </Route>
              <Route path="*" element={<PartnerNotFound />} />
            </Route>
          </Route>
        </Route>
      </Routes>
    </Suspense>
  )
}

/**
 * The shared realtime client is driven by the player session in RealtimeProvider; inside the portal we
 * point it at the partner token instead (pitch channels accept partner tokens) and hand it back on exit.
 */
function usePartnerRealtime() {
  const token = usePartnerAuth((s) => s.accessToken)
  useEffect(() => {
    // defer past RealtimeProvider's own mount effect (parents' effects run after children's)
    const t = setTimeout(() => {
      if (token) return realtime.connect(token)
      // logged out of the portal: hand the socket back to the player session (if any)
      const player = useAuth.getState().accessToken
      if (player) realtime.connect(player)
      else realtime.disconnect()
    }, 0)
    return () => clearTimeout(t)
  }, [token])
  useEffect(
    () => () => {
      const player = useAuth.getState().accessToken
      if (player) realtime.connect(player)
      else realtime.disconnect()
    },
    [],
  )
}

function RequirePartnerAuth() {
  const token = usePartnerAuth((s) => s.accessToken)
  const signedOut = usePartnerAuth((s) => s.signedOut)
  const location = useLocation()
  // after an explicit "Log out" the next person starts on a clean login (no `?next=` into the last user's page)
  if (!token) return <Navigate to={signedOut ? '/partner/login' : `/partner/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />
  return <Outlet />
}

/** Membership & approval gate: apply → choose provider → under-review screen → the portal. */
function ProviderGate() {
  const setMe = usePartnerAuth((s) => s.setMe)
  const memberships = usePartnerAuth((s) => s.memberships)
  const providerId = usePartnerAuth((s) => s.providerId)
  const membership = useMembership()
  useProviderStatusWatch()

  // role / venue-scope / approval changes reach an open session: every minute, on focus and on any 403 (see watch)
  const me = useQuery({
    queryKey: pk.me,
    queryFn: partnerApi.me,
    staleTime: 20_000,
    refetchOnWindowFocus: true,
    refetchInterval: membership?.provider_status === 'pending' ? 30_000 : 60_000,
  })
  useEffect(() => {
    if (me.data) setMe(me.data)
  }, [me.data, setMe])

  if (memberships.length === 0) return me.isPending ? <PageLoader /> : <Navigate to="/partner/apply" replace />
  if (!providerId || !membership) return <Navigate to="/partner/choose" replace />
  return (
    <>
      {membership.provider_status !== 'approved' ? <ApplicationStatusPage /> : <Outlet />}
      <NamePrompt />
    </>
  )
}

function RequireRole({ min }: { min: PartnerRole }) {
  const m = useMembership()
  if (!m || RANK[m.role] < RANK[min]) return <Navigate to="/partner" replace />
  return <Outlet />
}
